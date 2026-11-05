/**
 * Inactive until deployed with host secrets. See worker/README.md.
 * Creates and captures PayPal orders from the shared catalog only.
 * Browser prices are not accepted. Orders this worker did not create are not captured.
 */
import { quoteCart } from '../../shared/price-order.js';

const PAYPAL_BASES = new Set([
  'https://api-m.sandbox.paypal.com',
  'https://api-m.paypal.com'
]);
const MAX_BODY = 4096;
const KV_TTL_SECONDS = 45 * 24 * 60 * 60;

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
  if (!env.ORDERS || String(env.ALLOWED_ORIGINS || '').trim() === '') return null;
  if (String(env.ORDER_BINDING_SECRET).length < 32) return null;
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
  const keys = Object.keys(body);
  for (const key of keys) {
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

function completedCapture(order, expectedValue) {
  const unit = purchaseUnit(order);
  if (!unit || !unit.payments || !Array.isArray(unit.payments.captures) || unit.payments.captures.length !== 1) {
    return null;
  }
  const capture = unit.payments.captures[0];
  const amount = capture && capture.amount ? capture.amount : {};
  if (!capture || capture.status !== 'COMPLETED' || order.status !== 'COMPLETED') return null;
  if (amount.currency_code !== 'USD' || amount.value !== expectedValue) return null;
  if (!/^[A-Z0-9]+$/.test(String(capture.id || ''))) return null;
  return { orderId: String(order.id), captureId: String(capture.id), status: 'COMPLETED', currency: 'USD', amount: expectedValue };
}

function publicCapture(record) {
  return {
    orderId: record.orderId,
    captureId: record.captureId,
    status: 'COMPLETED',
    currency: 'USD',
    amount: record.value
  };
}

async function createOrder(request, env, fetchImpl, origin) {
  const idempotencyKey = request.headers.get('idempotency-key') || '';
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json(400, { error: 'invalid_idempotency' }, origin);
  const incoming = await readBody(request);
  if (incoming.error) return json(incoming.error === 'body_too_large' ? 413 : 400, { error: incoming.error }, origin);
  const parsed = validateCreateBody(incoming.value);
  if (parsed.error) return json(400, { error: parsed.error }, origin);
  const quote = await quoteCart(parsed.items, { now: new Date(), discountCode: parsed.discountCode });
  if (!quote.ok) return json(400, { error: quote.error }, origin);

  const idemKey = 'idem:' + idempotencyKey;
  const existingRaw = await env.ORDERS.get(idemKey);
  if (existingRaw) {
    const existing = JSON.parse(existingRaw);
    if (existing.cartHash !== quote.cartHash || existing.value !== quote.value) {
      return json(409, { error: 'idempotency_conflict' }, origin);
    }
    return json(200, { orderId: existing.orderId, amount: existing.value, currency: 'USD' }, origin);
  }

  const customId = (await hmacHex(env.ORDER_BINDING_SECRET, quote.value + '|USD|' + quote.cartHash + '|' + idempotencyKey)).slice(0, 127);
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
    return json(502, { error: 'paypal_unavailable' }, origin);
  }
  if (!created.ok || !created.body || !/^[A-Z0-9]+$/.test(String(created.body.id || ''))) {
    return json(502, { error: 'paypal_rejected' }, origin);
  }
  const record = {
    orderId: String(created.body.id),
    value: quote.value,
    currency: 'USD',
    cartHash: quote.cartHash,
    customId,
    status: 'CREATED',
    captureId: '',
    captureRequestId: '',
    idempotencyKey
  };
  await env.ORDERS.put('order:' + record.orderId, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
  await env.ORDERS.put(idemKey, JSON.stringify({
    orderId: record.orderId,
    value: record.value,
    cartHash: record.cartHash
  }), { expirationTtl: KV_TTL_SECONDS });
  return json(201, { orderId: record.orderId, amount: record.value, currency: 'USD' }, origin);
}

async function captureOrder(request, env, fetchImpl, origin, orderId) {
  if (!/^[A-Z0-9]+$/.test(orderId) || orderId.length > 36) return json(404, { error: 'unknown_order' }, origin);
  const idempotencyKey = request.headers.get('idempotency-key') || '';
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json(400, { error: 'invalid_idempotency' }, origin);
  const raw = await env.ORDERS.get('order:' + orderId);
  if (!raw) return json(404, { error: 'unknown_order' }, origin);
  const record = JSON.parse(raw);
  if (record.value == null || record.currency !== 'USD' || !record.customId || !record.cartHash) {
    return json(409, { error: 'order_binding' }, origin);
  }
  if (record.status === 'COMPLETED' && record.captureId) return json(200, publicCapture(record), origin);

  let shown;
  try {
    shown = await paypal(env, fetchImpl, '/v2/checkout/orders/' + orderId, { method: 'GET' });
  } catch {
    return json(502, { error: 'paypal_unavailable' }, origin);
  }
  if (!shown.ok || !shown.body) return json(502, { error: 'paypal_rejected' }, origin);
  const unit = purchaseUnit(shown.body);
  const amount = unit && unit.amount ? unit.amount : {};
  const rebound = await hmacHex(env.ORDER_BINDING_SECRET, amount.value + '|USD|' + record.cartHash + '|' + record.idempotencyKey);
  if (!unit || amount.currency_code !== 'USD' || amount.value !== record.value || !safeEqual(String(unit.custom_id || ''), record.customId) || !safeEqual(rebound.slice(0, 127), record.customId)) {
    record.status = 'MISMATCH';
    await env.ORDERS.put('order:' + orderId, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
    return json(409, { error: 'amount_mismatch' }, origin);
  }
  if (shown.body.status === 'COMPLETED') {
    const existing = completedCapture(shown.body, record.value);
    if (!existing) return json(409, { error: 'amount_mismatch' }, origin);
    record.status = 'COMPLETED';
    record.captureId = existing.captureId;
    await env.ORDERS.put('order:' + orderId, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
    return json(200, publicCapture(record), origin);
  }
  if (shown.body.status !== 'APPROVED') return json(409, { error: 'not_approved' }, origin);

  if (!record.captureRequestId) {
    record.captureRequestId = crypto.randomUUID();
    record.status = 'CAPTURING';
    await env.ORDERS.put('order:' + orderId, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
  }
  let captured;
  try {
    captured = await paypal(env, fetchImpl, '/v2/checkout/orders/' + orderId + '/capture', {
      method: 'POST',
      requestId: record.captureRequestId
    });
  } catch {
    return json(502, { error: 'paypal_unavailable' }, origin);
  }
  const fromCapture = captured.ok ? completedCapture(captured.body, record.value) : null;
  if (!fromCapture) {
    try {
      shown = await paypal(env, fetchImpl, '/v2/checkout/orders/' + orderId, { method: 'GET' });
    } catch {
      return json(502, { error: 'paypal_unavailable' }, origin);
    }
    const recovered = shown.ok ? completedCapture(shown.body, record.value) : null;
    if (!recovered) return json(502, { error: 'capture_not_completed' }, origin);
    record.status = 'COMPLETED';
    record.captureId = recovered.captureId;
    await env.ORDERS.put('order:' + orderId, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
    return json(200, publicCapture(record), origin);
  }
  record.status = 'COMPLETED';
  record.captureId = fromCapture.captureId;
  await env.ORDERS.put('order:' + orderId, JSON.stringify(record), { expirationTtl: KV_TTL_SECONDS });
  return json(200, publicCapture(record), origin);
}

export async function handleRequest(request, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const origin = allowedOrigin(request, env);
  if (request.method === 'OPTIONS') {
    if (!origin) return json(403, { error: 'origin_not_allowed' }, '');
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, idempotency-key',
        'access-control-max-age': '600',
        vary: 'Origin',
        'cache-control': 'no-store'
      }
    });
  }
  const ready = configured(env);
  if (!ready) return json(503, { error: 'not_configured' }, origin);
  if (!origin) return json(403, { error: 'origin_not_allowed' }, '');
  const url = new URL(request.url);
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);
  if (url.pathname === '/v1/orders') return createOrder(request, ready, fetchImpl, origin);
  const captureMatch = url.pathname.match(/^\/v1\/orders\/([A-Z0-9]+)\/capture$/);
  if (captureMatch) return captureOrder(request, ready, fetchImpl, origin, captureMatch[1]);
  return json(404, { error: 'not_found' }, origin);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
