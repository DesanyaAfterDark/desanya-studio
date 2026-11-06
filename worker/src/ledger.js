/**
 * Order ledger for one SQLite Durable Object.
 * Checks and inserts are synchronous, so this object does not interleave them.
 * Workers KV get-then-put is not used and is not exactly-once.
 * The receipt token is stored for the capture page. Nothing here sends email.
 */

const IN_FLIGHT_MS = 20000;

export const RECEIPT_BUSINESS = 'Desanya Studio';
export const RECEIPT_CONTACT = 'desanyaafterdark@gmail.com';

function isUnique(err) {
  return String(err && err.message || '').includes('UNIQUE constraint failed');
}

function copy(row) {
  return row ? { ...row } : null;
}

export function publicReceipt(record) {
  if (!record || record.status !== 'COMPLETED' || !record.captureId || !record.orderId || !record.paidAt) return null;
  if (record.currency !== 'USD' || !/^\d+\.\d{2}$/.test(String(record.value || ''))) return null;
  let lines;
  try { lines = JSON.parse(record.linesJson); } catch { return null; }
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 20) return null;
  const clean = [];
  for (const line of lines) {
    if (!line || typeof line !== 'object') return null;
    const name = String(line.name || '');
    const quantity = String(line.quantity || '');
    const unitAmount = String(line.unitAmount || '');
    if (!name || name.length > 127 || !/^\d+$/.test(quantity) || Number(quantity) < 1) return null;
    if (!/^\d+\.\d{2}$/.test(unitAmount)) return null;
    clean.push({ name, quantity, unitAmount });
  }
  return {
    orderId: record.orderId,
    captureId: record.captureId,
    paidAt: record.paidAt,
    currency: 'USD',
    amount: record.value,
    lines: clean,
    businessName: RECEIPT_BUSINESS,
    contactEmail: RECEIPT_CONTACT
  };
}

export function createLedger(store) {
  return {
    reserveCreate(input, now) {
      const existing = store.getIdem(input.idempotencyKey);
      if (existing) {
        if (existing.cartHash !== input.cartHash || existing.value !== input.value) return { action: 'conflict' };
        if (existing.orderId) return { action: 'replay', orderId: existing.orderId, value: existing.value };
        if (existing.startedAt && now - existing.startedAt < IN_FLIGHT_MS) return { action: 'in_progress' };
        store.markStarted(input.idempotencyKey, now);
        return { action: 'resume' };
      }
      try {
        store.insertIdem({
          idempotencyKey: input.idempotencyKey,
          cartHash: input.cartHash,
          value: input.value,
          customId: input.customId,
          linesJson: input.linesJson,
          itemTotal: input.itemTotal,
          discount: input.discount,
          orderId: '',
          status: 'reserving',
          startedAt: now
        });
      } catch (err) {
        if (!isUnique(err)) throw err;
        return this.reserveCreate(input, now);
      }
      return { action: 'resume' };
    },
    markRetryable(idempotencyKey) {
      store.markStarted(idempotencyKey, 0);
    },
    saveCreated({ idempotencyKey, orderId }) {
      const idem = store.getIdem(idempotencyKey);
      if (!idem) throw new Error('missing reservation');
      if (idem.orderId && idem.orderId !== orderId) throw new Error('order id changed');
      store.insertOrder({
        orderId,
        idempotencyKey,
        value: idem.value,
        currency: 'USD',
        cartHash: idem.cartHash,
        customId: idem.customId,
        linesJson: idem.linesJson,
        itemTotal: idem.itemTotal,
        discount: idem.discount,
        status: 'CREATED',
        captureId: '',
        captureRequestId: '',
        captureStartedAt: 0,
        paidAt: '',
        receiptToken: '',
        receiptIdempotencyKey: ''
      });
      store.setIdemOrder(idempotencyKey, orderId);
    },
    getOrder(orderId) {
      return copy(store.getOrder(orderId));
    },
    markMismatch(orderId) {
      store.setOrderStatus(orderId, 'MISMATCH');
    },
    claimCapture(orderId, now) {
      const row = store.getOrder(orderId);
      if (!row) return { action: 'unknown' };
      if (row.status === 'COMPLETED' && row.captureId) return { action: 'completed', record: copy(row) };
      if (row.status === 'CAPTURING' && row.captureRequestId && row.captureStartedAt && now - row.captureStartedAt < IN_FLIGHT_MS) {
        return { action: 'in_progress', requestId: row.captureRequestId };
      }
      const requestId = row.captureRequestId || crypto.randomUUID();
      store.setCaptureClaim(orderId, requestId, now);
      const current = store.getOrder(orderId);
      return { action: 'capture', requestId: current.captureRequestId, record: copy(current) };
    },
    markCaptureRetryable(orderId) {
      store.clearCaptureFlight(orderId);
    },
    saveCompleted(orderId, captureId, paidAt, token, idempotencyKey) {
      store.setCompleted(orderId, captureId, paidAt, token, idempotencyKey);
      return copy(store.getOrder(orderId));
    }
  };
}

export function memoryStore() {
  const idem = new Map();
  const orders = new Map();
  return {
    getIdem(key) { return idem.get(key) || null; },
    insertIdem(row) {
      if (idem.has(row.idempotencyKey)) throw new Error('UNIQUE constraint failed: idempotency.idempotency_key');
      idem.set(row.idempotencyKey, { ...row });
    },
    markStarted(key, startedAt) {
      const row = idem.get(key);
      if (row) row.startedAt = startedAt;
    },
    setIdemOrder(key, orderId) {
      const row = idem.get(key);
      if (row) {
        row.orderId = orderId;
        row.status = 'created';
        row.startedAt = 0;
      }
    },
    getOrder(orderId) { return orders.get(orderId) || null; },
    insertOrder(row) {
      const existing = orders.get(row.orderId);
      if (existing) {
        if (existing.value !== row.value || existing.idempotencyKey !== row.idempotencyKey) throw new Error('order id changed');
        return;
      }
      orders.set(row.orderId, { ...row });
    },
    setOrderStatus(orderId, status) {
      const row = orders.get(orderId);
      if (row) row.status = status;
    },
    setCaptureClaim(orderId, requestId, now) {
      const row = orders.get(orderId);
      if (!row || row.status === 'COMPLETED') return;
      if (!row.captureRequestId) row.captureRequestId = requestId;
      row.status = 'CAPTURING';
      row.captureStartedAt = now;
    },
    clearCaptureFlight(orderId) {
      const row = orders.get(orderId);
      if (row && row.status !== 'COMPLETED') row.captureStartedAt = 0;
    },
    setCompleted(orderId, captureId, paidAt, token, idempotencyKey) {
      const row = orders.get(orderId);
      if (!row) throw new Error('missing order');
      if (row.captureId && row.captureId !== captureId) throw new Error('capture id changed');
      row.status = 'COMPLETED';
      row.captureId = captureId;
      row.captureStartedAt = 0;
      if (!row.receiptToken) {
        row.receiptToken = token;
        row.receiptIdempotencyKey = idempotencyKey;
        row.paidAt = paidAt;
      }
    }
  };
}

function mapIdem(row) {
  if (!row) return null;
  return {
    idempotencyKey: row.idempotency_key,
    cartHash: row.cart_hash,
    value: row.value,
    customId: row.custom_id,
    linesJson: row.lines_json,
    itemTotal: row.item_total,
    discount: row.discount,
    orderId: row.order_id || '',
    status: row.status,
    startedAt: Number(row.started_at || 0)
  };
}

function mapOrder(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    idempotencyKey: row.idempotency_key,
    value: row.value,
    currency: row.currency,
    cartHash: row.cart_hash,
    customId: row.custom_id,
    linesJson: row.lines_json,
    itemTotal: row.item_total,
    discount: row.discount,
    status: row.status,
    captureId: row.capture_id || '',
    captureRequestId: row.capture_request_id || '',
    captureStartedAt: Number(row.capture_started_at || 0),
    paidAt: row.paid_at || '',
    receiptToken: row.receipt_token || '',
    receiptIdempotencyKey: row.receipt_idempotency_key || ''
  };
}

function first(sql, query, params) {
  const cursor = sql.exec(query, ...params);
  const rows = typeof cursor.toArray === 'function' ? cursor.toArray() : [...cursor];
  return rows[0] || null;
}

export function sqlStore(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS idempotency (
    idempotency_key TEXT PRIMARY KEY,
    cart_hash TEXT NOT NULL,
    value TEXT NOT NULL,
    custom_id TEXT NOT NULL,
    lines_json TEXT NOT NULL,
    item_total TEXT NOT NULL,
    discount TEXT NOT NULL,
    order_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL DEFAULT 0
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS orders (
    order_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    currency TEXT NOT NULL,
    cart_hash TEXT NOT NULL,
    custom_id TEXT NOT NULL,
    lines_json TEXT NOT NULL,
    item_total TEXT NOT NULL,
    discount TEXT NOT NULL,
    status TEXT NOT NULL,
    capture_id TEXT NOT NULL DEFAULT '',
    capture_request_id TEXT NOT NULL DEFAULT '',
    capture_started_at INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT NOT NULL DEFAULT '',
    receipt_token TEXT NOT NULL DEFAULT '',
    receipt_idempotency_key TEXT NOT NULL DEFAULT ''
  )`);
  return {
    getIdem(key) {
      return mapIdem(first(sql, 'SELECT * FROM idempotency WHERE idempotency_key = ?', [key]));
    },
    insertIdem(row) {
      sql.exec(
        `INSERT INTO idempotency
          (idempotency_key, cart_hash, value, custom_id, lines_json, item_total, discount, order_id, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', 'reserving', ?)`,
        row.idempotencyKey, row.cartHash, row.value, row.customId, row.linesJson, row.itemTotal, row.discount, row.startedAt
      );
    },
    markStarted(key, startedAt) {
      sql.exec('UPDATE idempotency SET started_at = ? WHERE idempotency_key = ?', startedAt, key);
    },
    setIdemOrder(key, orderId) {
      sql.exec(`UPDATE idempotency SET order_id = ?, status = 'created', started_at = 0 WHERE idempotency_key = ?`, orderId, key);
    },
    getOrder(orderId) {
      return mapOrder(first(sql, 'SELECT * FROM orders WHERE order_id = ?', [orderId]));
    },
    insertOrder(row) {
      const existing = mapOrder(first(sql, 'SELECT * FROM orders WHERE order_id = ?', [row.orderId]));
      if (existing) {
        if (existing.value !== row.value || existing.idempotencyKey !== row.idempotencyKey) throw new Error('order id changed');
        return;
      }
      sql.exec(
        `INSERT INTO orders
          (order_id, idempotency_key, value, currency, cart_hash, custom_id, lines_json, item_total, discount, status, capture_id, capture_request_id, capture_started_at, paid_at, receipt_token, receipt_idempotency_key)
         VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, 'CREATED', '', '', 0, '', '', '')`,
        row.orderId, row.idempotencyKey, row.value, row.cartHash, row.customId, row.linesJson, row.itemTotal, row.discount
      );
    },
    setOrderStatus(orderId, status) {
      sql.exec('UPDATE orders SET status = ? WHERE order_id = ?', status, orderId);
    },
    setCaptureClaim(orderId, requestId, now) {
      sql.exec(
        `UPDATE orders
         SET capture_request_id = CASE WHEN capture_request_id = '' THEN ? ELSE capture_request_id END,
             status = 'CAPTURING',
             capture_started_at = ?
         WHERE order_id = ? AND status != 'COMPLETED'`,
        requestId, now, orderId
      );
    },
    clearCaptureFlight(orderId) {
      sql.exec(`UPDATE orders SET capture_started_at = 0 WHERE order_id = ? AND status != 'COMPLETED'`, orderId);
    },
    setCompleted(orderId, captureId, paidAt, token, idempotencyKey) {
      const existing = mapOrder(first(sql, 'SELECT * FROM orders WHERE order_id = ?', [orderId]));
      if (!existing) throw new Error('missing order');
      if (existing.captureId && existing.captureId !== captureId) throw new Error('capture id changed');
      if (existing.receiptToken) {
        sql.exec(
          `UPDATE orders SET status = 'COMPLETED', capture_id = ?, capture_started_at = 0 WHERE order_id = ?`,
          captureId, orderId
        );
        return;
      }
      sql.exec(
        `UPDATE orders
         SET status = 'COMPLETED', capture_id = ?, capture_started_at = 0, paid_at = ?, receipt_token = ?, receipt_idempotency_key = ?
         WHERE order_id = ?`,
        captureId, paidAt, token, idempotencyKey, orderId
      );
    }
  };
}
