/**
 * Inactive until a reviewed deploy. See worker/README.md.
 * Prices come from the shared catalog. Browser prices are not accepted.
 * Order state is one SQLite Durable Object, not Workers KV.
 * A receipt token is returned only to the capture request that owns it.
 * This worker does not send email.
 */
import { quoteCart, sha256Hex } from '../../shared/price-order.js';
import { publicReceipt } from './ledger.js';

const PAYPAL_BASES = new Set([
  'https://api-m.sandbox.paypal.com',
  'https://api-m.paypal.com'
]);
const MAX_BODY = 4096;

let tokenCache = { value: '', expiresAt: 0, base: '' };

export function resetPayPalTokenCache() {
  tokenCache = { value: '', expiresAt: 0, base: '' };
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!origin || !list.includes(origin)) return '';
  return origin;
}

function json(status, body, origin) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers.vary = 'Origin';
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function configured(env) {
  const base = String(env.PAYPAL_API_BASE || '').replace(/\/$/, '');
  if (!PAYPAL_BASES.has(base)) return null;
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.ORDER_BINDING_SECRET) return null;
  if (String(env.ORDER_BINDING_SECRET).length < 32) return null;
  if (String(env.ALLOWED_ORIGINS || '').trim() === '') return null;
  return { ...env, PAYPAL_API_BASE: base };
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function newReceiptToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { error: 'body_too_large' };
  try {
    return { value: raw ? JSON.parse(raw) : {} };
  } catch {
    return { error: 'invalid_json' };
  }
}

function validateCreateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  for (const key of Object.keys(body)) {
    if (key !== 'items' && key !== 'discountCode') return { error: 'unexpected_field' };
  }
  if (!Array.isArray(body.items)) return { error: 'invalid_items' };
  const items = [];
  for (const line of body.items) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return { error: 'invalid_items' };
    for (const key of Object.keys(line)) {
      if (key !== 'slug' && key !== 'qty') return { error: 'unexpected_field' };
    }
    items.push({ slug: line.slug, qty: line.qty });
  }
  const discountCode = body.discountCode == null ? '' : body.discountCode;
  if (typeof discountCode !== 'string' || discountCode.length > 40) return { error: 'invalid_discount' };
  return { items, discountCode };
}

async function accessToken(env, fetchImpl) {
  const now = Date.now();
  if (tokenCache.value && tokenCache.base === env.PAYPAL_API_BASE && tokenCache.expiresAt > now + 60000) {
    return tokenCache.value;
  }
  const basic = btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET);
  const response = await fetchImpl(env.PAYPAL_API_BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + basic,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error('oauth');
  const data = await response.json();
  if (!data || typeof data.access_token !== 'string' || !data.expires_in) throw new Error('oauth');
  tokenCache = {
    value: data.access_token,
    base: env.PAYPAL_API_BASE,
    expiresAt: now + Number(data.expires_in) * 1000
  };
  return data.access_token;
}

async function paypal(env, fetchImpl, path, { method, body, requestId }) {
  const token = await accessToken(env, fetchImpl);
  const headers = {
    authorization: 'Bearer ' + token,
    'content-type': 'application/json'
  };
  if (requestId) headers['paypal-request-id'] = requestId;
  const response = await fetchImpl(env.PAYPAL_API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { ok: response.ok, status: response.status, body: parsed };
}

function purchaseUnit(order) {
  const units = order && Array.isArray(order.purchase_units) ? order.purchase_units : [];
  return units.length === 1 ? units[0] : null;
}

function amountsMatch(left, right) {
  if (String(left) === String(right)) return true;
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a.toFixed(2) === b.toFixed(2);
}

const WAITABLE_PAYPAL_STATUS = new Set(['CREATED', 'PAYER_ACTION_REQUIRED', 'PENDING', 'PENDING_APPROVAL']);

function defaultApprovalDelays() {
  return [0, 500, 1000, 1600, 2400];
}

async function readPayPalOrderUntilReady(env, fetchImpl, orderId, deps) {
  const sleep = typeof deps.sleep === 'function' ? deps.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const delays = Array.isArray(deps.approvalDelays) ? deps.approvalDelays : defaultApprovalDelays();
  const list = delays.length ? delays : [0];
  let last = { ok: false, status: 0, body: null };
  for (let i = 0; i < list.length; i++) {
    if (list[i] > 0) await sleep(list[i]);
    last = await paypal(env, fetchImpl, '/v2/checkout/orders/' + orderId, { method: 'GET' });
    const status = last.body && last.body.status;
    if (!last.ok || !status) return last;
    if (status === 'APPROVED' || status === 'COMPLETED') return last;
    if (!WAITABLE_PAYPAL_STATUS.has(status)) return last;
  }
  return last;
}

function completedCapture(order, expectedValue) {
  const unit = purchaseUnit(order);
  if (!unit || !unit.payments || !Array.isArray(unit.payments.captures) || unit.payments.captures.length !== 1) return null;
  const capture = unit.payments.captures[0];
  const amount = capture && capture.amount ? capture.amount : {};
  if (!capture || capture.status !== 'COMPLETED' || order.status !== 'COMPLETED') return null;
  if (amount.currency_code !== 'USD' || !amountsMatch(amount.value, expectedValue)) return null;
  if (!/^[A-Z0-9]+$/.test(String(capture.id || ''))) return null;
  return { captureId: String(capture.id) };
}

function publicCapture(record, includeToken) {
  const body = {
    orderId: record.orderId,
    captureId: record.captureId,
    status: 'COMPLETED',
    currency: 'USD',
    amount: record.value
  };
  if (includeToken && record.receiptToken) body.receiptToken = record.receiptToken;
  return body;
}

function legacyToken(record, request) {
  if (record.ownerHash) return false;
  const key = request.headers.get('idempotency-key') || '';
  return !!(record.receiptToken && record.receiptIdempotencyKey && safeEqual(key, record.receiptIdempotencyKey));
}

function newOwnerSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ownerMatches(request, ownerHash) {
  if (!ownerHash) return false;
  const presented = request.headers.get('order-owner') || '';
  if (!/^[0-9a-f]{64}$/i.test(presented)) return false;
  return safeEqual(await sha256Hex(presented), ownerHash);
}

function quoteLines(quote) {
  return JSON.stringify({
    version: 2,
    paid: quote.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitAmount: item.unitAmount
    })),
    requested: quote.requested,
    laterRecurring: quote.laterRecurring
  });
}

async function createOrder(request, env, fetchImpl, origin, ledger, now) {
  const idempotencyKey = request.headers.get('idempotency-key') || '';
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json(400, { error: 'invalid_idempotency' }, origin);
  const incoming = await readBody(request);
  if (incoming.error) return json(incoming.error === 'body_too_large' ? 413 : 400, { error: incoming.error }, origin);
  const parsed = validateCreateBody(incoming.value);
  if (parsed.error) return json(400, { error: parsed.error }, origin);
  const quote = await quoteCart(parsed.items, { now: new Date(now()), discountCode: parsed.discountCode });
  if (!quote.ok) return json(400, { error: quote.error }, origin);
  const customId = (await hmacHex(env.ORDER_BINDING_SECRET, quote.value + '|USD|' + quote.cartHash + '|' + idempotencyKey)).slice(0, 127);
  let gate;
  try {
    gate = ledger.reserveCreate({
      idempotencyKey,
      cartHash: quote.cartHash,
      value: quote.value,
      customId,
      linesJson: quoteLines(quote),
      itemTotal: quote.itemTotal,
      discount: quote.discount
    }, now());
  } catch {
    return json(503, { error: 'storage_unavailable' }, origin);
  }
  if (gate.action === 'conflict') return json(409, { error: 'idempotency_conflict' }, origin);
  if (gate.action === 'in_progress') return json(409, { error: 'order_in_progress' }, origin);
  if (gate.action === 'replay') {
    if (!await ownerMatches(request, gate.ownerHash)) return json(401, { error: 'owner_required' }, origin);
    return json(200, { orderId: gate.orderId, amount: gate.value, currency: 'USD' }, origin);
  }

  let ownerSecret = '';
  if (!gate.ownerHash) {
    ownerSecret = newOwnerSecret();
    let claimed = false;
    try { claimed = ledger.claimOwner(idempotencyKey, await sha256Hex(ownerSecret), now()); } catch { claimed = false; }
    if (!claimed) return json(409, { error: 'order_in_progress' }, origin);
  } else if (!await ownerMatches(request, gate.ownerHash)) {
    return json(401, { error: 'owner_required' }, origin);
  }

  // JS SDK createOrder/onApprove does not use a merchant return URL.
  // return_url and cancel_url belong to payment_source.paypal.experience_context
  // for a redirect approval. They are omitted here so the body cannot be an open redirect.
  // The owner secret is not placed in this payload.
  const paypalBody = {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: 'desanya',
      custom_id: customId,
      description: quote.mode === 'deposit' ? 'Desanya Studio monthly placeholder' : 'Desanya Studio',
      amount: {
        currency_code: 'USD',
        value: quote.value,
        breakdown: Object.assign(
          { item_total: { currency_code: 'USD', value: quote.itemTotal } },
          Number(quote.discount) > 0 ? { discount: { currency_code: 'USD', value: quote.discount } } : {}
        )
      },
      items: quote.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unit_amount: { currency_code: 'USD', value: item.unitAmount }
      }))
    }]
  };
  let created;
  try {
    created = await paypal(env, fetchImpl, '/v2/checkout/orders', {
      method: 'POST',
      body: paypalBody,
      requestId: idempotencyKey
    });
  } catch {
    ledger.markRetryable(idempotencyKey);
    return json(502, { error: 'paypal_unavailable' }, origin);
  }
  if (!created.ok || !created.body || !/^[A-Z0-9]+$/.test(String(created.body.id || ''))) {
    ledger.markRetryable(idempotencyKey);
    return json(502, { error: 'paypal_rejected' }, origin);
  }
  try {
    ledger.saveCreated({ idempotencyKey, orderId: String(created.body.id) });
  } catch {
    ledger.markRetryable(idempotencyKey);
    return json(502, { error: 'order_not_stored' }, origin);
  }
  const createdBody = { orderId: String(created.body.id), amount: quote.value, currency: 'USD' };
  if (ownerSecret) createdBody.ownerSecret = ownerSecret;
  return json(201, createdBody, origin);
}

async function finishCompleted(ledger, request, origin, record, captureId, now) {
  const paidAt = record.paidAt || new Date(now()).toISOString();
  const token = record.receiptToken || newReceiptToken();
  const key = request.headers.get('idempotency-key') || '';
  let saved;
  try {
    saved = ledger.saveCompleted(record.orderId, captureId, paidAt, token, key);
  } catch {
    ledger.markCaptureRetryable(record.orderId);
    return json(502, { error: 'capture_not_stored' }, origin);
  }
  return json(200, publicCapture(saved, !!saved.ownerHash || legacyToken(saved, request)), origin);
}

async function captureOrder(request, env, fetchImpl, origin, ledger, now, orderId, deps = {}) {
  if (!/^[A-Z0-9]+$/.test(orderId) || orderId.length > 36) return json(404, { error: 'unknown_order' }, origin);
  const idempotencyKey = request.headers.get('idempotency-key') || '';
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json(400, { error: 'invalid_idempotency' }, origin);
  let record;
  try { record = ledger.getOrder(orderId); } catch { return json(503, { error: 'storage_unavailable' }, origin); }
  if (!record) return json(404, { error: 'unknown_order' }, origin);
  if (record.ownerHash && !await ownerMatches(request, record.ownerHash)) {
    return json(404, { error: 'unknown_order' }, origin);
  }
  if (record.value == null || record.currency !== 'USD' || !record.customId || !record.cartHash) {
    return json(409, { error: 'order_binding' }, origin);
  }
  if (record.status === 'COMPLETED' && record.captureId) {
    return json(200, publicCapture(record, !!record.ownerHash || legacyToken(record, request)), origin);
  }

  let shown;
  try {
    shown = await readPayPalOrderUntilReady(env, fetchImpl, orderId, deps);
  } catch {
    return json(502, { error: 'paypal_unavailable' }, origin);
  }
  if (!shown.ok || !shown.body) return json(502, { error: 'paypal_rejected' }, origin);
  if (shown.body.status === 'COMPLETED') {
    const existing = completedCapture(shown.body, record.value);
    if (!existing) return json(409, { error: 'amount_mismatch' }, origin);
    return finishCompleted(ledger, request, origin, record, existing.captureId, now);
  }
  if (shown.body.status !== 'APPROVED') return json(409, { error: 'not_approved' }, origin);
  const unit = purchaseUnit(shown.body);
  const amount = unit && unit.amount ? unit.amount : {};
  const reboundValue = amountsMatch(amount.value, record.value) ? record.value : amount.value;
  const rebound = await hmacHex(env.ORDER_BINDING_SECRET, reboundValue + '|USD|' + record.cartHash + '|' + record.idempotencyKey);
  if (!unit || amount.currency_code !== 'USD' || !amountsMatch(amount.value, record.value) || !safeEqual(String(unit.custom_id || ''), record.customId) || !safeEqual(rebound.slice(0, 127), record.customId)) {
    try { ledger.markMismatch(orderId); } catch { return json(503, { error: 'storage_unavailable' }, origin); }
    return json(409, { error: 'amount_mismatch' }, origin);
  }

  let claim;
  try { claim = ledger.claimCapture(orderId, now()); } catch { return json(503, { error: 'storage_unavailable' }, origin); }
  if (claim.action === 'unknown') return json(404, { error: 'unknown_order' }, origin);
  if (claim.action === 'completed') {
    return json(200, publicCapture(claim.record, !!claim.record.ownerHash || legacyToken(claim.record, request)), origin);
  }
  if (claim.action === 'in_progress') return json(409, { error: 'capture_in_progress' }, origin);

  let captured;
  try {
    captured = await paypal(env, fetchImpl, '/v2/checkout/orders/' + orderId + '/capture', {
      method: 'POST',
      requestId: claim.requestId
    });
  } catch {
    ledger.markCaptureRetryable(orderId);
    return json(502, { error: 'paypal_unavailable' }, origin);
  }
  const fromCapture = captured.ok ? completedCapture(captured.body, record.value) : null;
  if (!fromCapture) {
    try {
      shown = await paypal(env, fetchImpl, '/v2/checkout/orders/' + orderId, { method: 'GET' });
    } catch {
      ledger.markCaptureRetryable(orderId);
      return json(502, { error: 'paypal_unavailable' }, origin);
    }
    const recovered = shown.ok ? completedCapture(shown.body, record.value) : null;
    if (!recovered) {
      ledger.markCaptureRetryable(orderId);
      return json(502, { error: 'capture_not_completed' }, origin);
    }
    return finishCompleted(ledger, request, origin, ledger.getOrder(orderId) || record, recovered.captureId, now);
  }
  return finishCompleted(ledger, request, origin, ledger.getOrder(orderId) || record, fromCapture.captureId, now);
}

function readReceipt(request, origin, ledger, orderId) {
  if (!/^[A-Z0-9]+$/.test(orderId) || orderId.length > 36) return json(404, { error: 'receipt_not_available' }, origin);
  const token = request.headers.get('receipt-token') || '';
  let record;
  try { record = ledger.getOrder(orderId); } catch { return json(503, { error: 'storage_unavailable' }, origin); }
  if (!record || !record.receiptToken || !safeEqual(token, record.receiptToken)) {
    return json(404, { error: 'receipt_not_available' }, origin);
  }
  const receipt = publicReceipt(record);
  if (!receipt) return json(404, { error: 'receipt_not_available' }, origin);
  return json(200, receipt, origin);
}

export async function handleRequest(request, env, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/health' || url.pathname === '/health/') return json(404, { error: 'not_found' }, '');
  const fetchImpl = deps.fetch || fetch;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const origin = allowedOrigin(request, env);
  if (request.method === 'OPTIONS') {
    if (!origin) return json(403, { error: 'origin_not_allowed' }, '');
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, idempotency-key, receipt-token, order-owner',
        'access-control-max-age': '600',
        vary: 'Origin',
        'cache-control': 'no-store'
      }
    });
  }
  const ready = configured(env);
  const ledger = deps.ledger || null;
  if (!ready || !ledger) return json(503, { error: 'not_configured' }, origin);
  if (!origin) return json(403, { error: 'origin_not_allowed' }, '');
  const receiptMatch = url.pathname.match(/^\/v1\/orders\/([A-Za-z0-9]+)\/receipt$/);
  if (receiptMatch) {
    if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, origin);
    return readReceipt(request, origin, ledger, receiptMatch[1]);
  }
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);
  if (url.pathname === '/v1/orders') return createOrder(request, ready, fetchImpl, origin, ledger, now);
  const captureMatch = url.pathname.match(/^\/v1\/orders\/([A-Z0-9]+)\/capture$/);
  if (captureMatch) return captureOrder(request, ready, fetchImpl, origin, ledger, now, captureMatch[1], deps);
  return json(404, { error: 'not_found' }, origin);
}
