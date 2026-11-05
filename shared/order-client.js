/**
 * Browser helper for a deployed order worker.
 * An empty PAYPAL_ORDER_API stays on the existing browser checkout.
 * A configured URL that fails does not fall back to browser prices.
 */

export function selectCheckoutMode(configured) {
  const raw = String(configured || '').trim();
  if (!raw) return { mode: 'browser', url: '' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { mode: 'invalid', url: '' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    return { mode: 'invalid', url: '' };
  }
  if (!/^[a-z0-9.-]+$/i.test(url.hostname)) return { mode: 'invalid', url: '' };
  const path = url.pathname.replace(/\/$/, '');
  return { mode: 'server', url: url.origin + path };
}

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

export function readServerOrder(body) {
  const record = asRecord(body);
  if (!record) return null;
  const orderId = String(record.orderId || '');
  const amount = String(record.amount || '');
  const currency = String(record.currency || '');
  if (!/^[A-Z0-9]+$/.test(orderId) || orderId.length > 36) return null;
  if (currency !== 'USD' || !/^\d+\.\d{2}$/.test(amount) || Number(amount) <= 0) return null;
  return { orderId, amount, currency };
}

export function readServerCapture(body, expectedAmount) {
  const record = asRecord(body);
  if (!record) return null;
  const orderId = String(record.orderId || '');
  const captureId = String(record.captureId || '');
  const amount = String(record.amount || '');
  const currency = String(record.currency || '');
  if (record.status !== 'COMPLETED') return null;
  if (!/^[A-Z0-9]+$/.test(orderId) || !/^[A-Z0-9]+$/.test(captureId)) return null;
  if (currency !== 'USD' || !/^\d+\.\d{2}$/.test(amount) || Number(amount) <= 0) return null;
  if (expectedAmount && amount !== expectedAmount) return null;
  return { orderId, captureId, status: 'COMPLETED', currency, amount };
}

async function postJson(url, idempotencyKey, body, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey
    },
    body: JSON.stringify(body)
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const error = new Error('order_api_' + response.status);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

export async function createServerOrder(baseUrl, { items, discountCode, idempotencyKey, fetchImpl = fetch }) {
  const mode = selectCheckoutMode(baseUrl);
  if (mode.mode !== 'server') throw new Error('order_api_not_configured');
  if (!/^[0-9a-f-]{36}$/i.test(String(idempotencyKey || ''))) throw new Error('order_api_idempotency');
  const payload = { items };
  if (discountCode) payload.discountCode = discountCode;
  const parsed = await postJson(mode.url + '/v1/orders', idempotencyKey, payload, fetchImpl);
  const order = readServerOrder(parsed);
  if (!order) throw new Error('order_api_bad_response');
  return order;
}

export async function captureServerOrder(baseUrl, orderId, { idempotencyKey, expectedAmount, fetchImpl = fetch }) {
  const mode = selectCheckoutMode(baseUrl);
  if (mode.mode !== 'server') throw new Error('order_api_not_configured');
  if (!/^[A-Z0-9]+$/.test(String(orderId || ''))) throw new Error('order_api_order');
  if (!/^[0-9a-f-]{36}$/i.test(String(idempotencyKey || ''))) throw new Error('order_api_idempotency');
  const parsed = await postJson(
    mode.url + '/v1/orders/' + encodeURIComponent(orderId) + '/capture',
    idempotencyKey,
    {},
    fetchImpl
  );
  const capture = readServerCapture(parsed, expectedAmount);
  if (!capture) throw new Error('order_api_amount_mismatch');
  return capture;
}

if (typeof window !== 'undefined') {
  window.DesanyaOrderClient = { selectCheckoutMode, createServerOrder, captureServerOrder, readServerOrder, readServerCapture };
}
