/**
 * Mocked tests for the inactive order worker and the browser client.
 * No network calls. Finance sandbox order ids are not used as if this worker created them.
 */
import { readFileSync } from 'node:fs';
import { quoteCart } from '../shared/price-order.js';
import { CATALOG } from '../shared/catalog.js';
import {
  captureServerOrder,
  createServerOrder,
  selectCheckoutMode
} from '../shared/order-client.js';
import { handleRequest, resetPayPalTokenCache } from '../worker/src/index.js';

const failures = [];
function expectEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures.push(name + ' expected ' + b + ' got ' + a);
    console.log('FAIL', name);
    console.log('  got ', a);
  } else console.log('OK  ', name);
}

const OPEN = new Date('2026-11-28T17:00:00Z');
const CLOSED = new Date('2026-11-05T22:00:00Z');
const CODE = 'BLACKFRIDAY26';

const quotes = [
  ['120 one-time', [{ slug: 'descriptions-basic', qty: 2 }], CLOSED, '', '120.00'],
  ['900 website', [{ slug: 'website-basic', qty: 1 }], CLOSED, '', '900.00'],
  ['1 monthly deposit', [{ slug: 'monthly-care', qty: 1 }], CLOSED, '', '1.00'],
  ['2160 rush', [{ slug: 'website-standard', qty: 1 }, { slug: 'rush', qty: 1 }], CLOSED, '', '2160.00'],
  ['1125 promo', [{ slug: 'website-basic', qty: 1 }, { slug: 'rush', qty: 1 }], OPEN, CODE, '1125.00'],
  ['mixed 900', [{ slug: 'website-basic', qty: 1 }, { slug: 'monthly-care', qty: 1 }], CLOSED, '', '900.00']
];
for (const [name, lines, now, code, value] of quotes) {
  const quote = await quoteCart(lines, { now, discountCode: code });
  expectEqual('quote ' + name, quote.ok ? quote.value : quote.error, value);
}

expectEqual('rush only', (await quoteCart([{ slug: 'rush', qty: 5 }], { now: CLOSED })).error, 'nothing_to_charge');
expectEqual('unknown slug', (await quoteCart([{ slug: 'nope', qty: 1 }], { now: CLOSED })).error, 'unknown_slug');
expectEqual('qty 100', (await quoteCart([{ slug: 'website-basic', qty: 100 }], { now: CLOSED })).error, 'invalid_qty');
expectEqual('quote ignores a client price field', (await quoteCart([{ slug: 'website-basic', qty: 1, price: 0.01 }], { now: CLOSED })).value, '900.00');
expectEqual('alias website', (await quoteCart([{ slug: 'website', qty: 1 }], { now: CLOSED })).value, '1600.00');
expectEqual('discount closed', (await quoteCart([{ slug: 'website-basic', qty: 1 }], { now: CLOSED, discountCode: CODE })).error, 'discount_inactive');
expectEqual('bad code', (await quoteCart([{ slug: 'website-basic', qty: 1 }], { now: OPEN, discountCode: 'NOPE' })).error, 'discount_invalid');

const cartText = readFileSync(new URL('../assets/cart.js', import.meta.url), 'utf8');
const pairs = [...cartText.matchAll(/'([a-z0-9-]+)':\s+\{\s*name:\s+'([^']+)',\s*price:\s+([0-9.]+)/g)];
let catalogDrift = 0;
for (const pair of pairs) {
  const item = CATALOG[pair[1]];
  if (!item || item.name !== pair[2] || item.price !== Number(pair[3])) catalogDrift += 1;
}
expectEqual('catalog matches cart.js', catalogDrift, 0);
const checkout = readFileSync(new URL('../checkout.html', import.meta.url), 'utf8');
expectEqual('checkout order api inactive', checkout.includes("var PAYPAL_ORDER_API = '';"), true);
expectEqual('checkout stays live mode', checkout.includes("var PAYPAL_MODE = 'live'"), true);

expectEqual('blank api is browser', selectCheckoutMode(''), { mode: 'browser', url: '' });
expectEqual('http api is invalid', selectCheckoutMode('http://orders.example.com'), { mode: 'invalid', url: '' });
expectEqual('https api is server', selectCheckoutMode('https://orders.example.com/'), { mode: 'server', url: 'https://orders.example.com' });

let clientCreateCalled = false;
await createServerOrder('https://orders.example.com', {
  items: [{ slug: 'website-basic', qty: 1 }],
  idempotencyKey: '11111111-1111-1111-1111-111111111111',
  fetchImpl: async () => new Response('no', { status: 500 })
}).catch(() => { clientCreateCalled = true; });
expectEqual('failed server create does not invent success', clientCreateCalled, true);

function memoryKv() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value) { map.set(key, String(value)); }
  };
}
function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function env() {
  return {
    ORDERS: memoryKv(),
    PAYPAL_CLIENT_ID: 'sandbox-test-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-test-secret',
    ORDER_BINDING_SECRET: 'test-binding-secret-not-a-real-paypal-secret',
    PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com',
    ALLOWED_ORIGINS: 'https://desanya.tech'
  };
}
function approvedOrder(id, value, customId) {
  return {
    id,
    status: 'APPROVED',
    intent: 'CAPTURE',
    purchase_units: [{
      custom_id: customId,
      amount: { currency_code: 'USD', value },
      items: [{ name: 'from-server', quantity: '1', unit_amount: { currency_code: 'USD', value } }]
    }]
  };
}
function capturedOrder(id, value, customId, captureId) {
  const order = approvedOrder(id, value, customId);
  order.status = 'COMPLETED';
  order.purchase_units[0].payments = {
    captures: [{ id: captureId, status: 'COMPLETED', amount: { currency_code: 'USD', value } }]
  };
  return order;
}

const ORDER_ID = 'TESTORDER1';
const CAPTURE_ID = 'TESTCAPTURE1';
let paypalOrder = null;
let capturePosts = 0;
let createPosts = 0;

function paypalFetch() {
  return async (url, init) => {
    const target = String(url);
    if (!target.startsWith('https://api-m.sandbox.paypal.com/')) throw new Error('unexpected url ' + target);
    if (target.endsWith('/v1/oauth2/token')) return response({ access_token: 'tok-test', expires_in: 3000 });
    if (target.endsWith('/v2/checkout/orders') && init.method === 'POST') {
      createPosts += 1;
      const body = JSON.parse(init.body);
      paypalOrder = {
        id: ORDER_ID,
        status: 'PAYER_ACTION_REQUIRED',
        intent: body.intent,
        purchase_units: body.purchase_units
      };
      return response({ id: ORDER_ID, status: 'PAYER_ACTION_REQUIRED' }, 201);
    }
    if (target.endsWith('/v2/checkout/orders/' + ORDER_ID) && (!init.method || init.method === 'GET')) {
      return response(paypalOrder);
    }
    if (target.endsWith('/capture') && init.method === 'POST') {
      capturePosts += 1;
      if (!init.headers['paypal-request-id'] && !init.headers['PayPal-Request-Id']) {
        return response({ name: 'MISSING_REQUEST_ID' }, 400);
      }
      if (paypalOrder.status !== 'APPROVED' && paypalOrder.status !== 'COMPLETED') {
        return response({ name: 'ORDER_NOT_APPROVED', message: 'Payer has not yet approved the Order for payment' }, 422);
      }
      paypalOrder = capturedOrder(ORDER_ID, paypalOrder.purchase_units[0].amount.value, paypalOrder.purchase_units[0].custom_id, CAPTURE_ID);
      return response(paypalOrder);
    }
    throw new Error('unhandled ' + target);
  };
}

function post(path, body, headers = {}) {
  return new Request('https://order-api.test' + path, {
    method: 'POST',
    headers: { origin: 'https://desanya.tech', 'content-type': 'application/json', ...headers },
    body: body == null ? '' : JSON.stringify(body)
  });
}
const IDEM = '22222222-2222-2222-2222-222222222222';
const CAP_IDEM = '33333333-3333-3333-3333-333333333333';

resetPayPalTokenCache();
const state = env();
const fetchImpl = paypalFetch();
const created = await handleRequest(post('/v1/orders', {
  items: [{ slug: 'website-basic', qty: 1, price: 1 }],
  amount: 1
}, { 'idempotency-key': IDEM }), state, { fetch: fetchImpl });
expectEqual('rejects client price field', created.status, 400);

const createdOk = await handleRequest(post('/v1/orders', {
  items: [{ slug: 'website-basic', qty: 1 }]
}, { 'idempotency-key': IDEM }), state, { fetch: fetchImpl });
const createdBody = await createdOk.json();
expectEqual('create uses catalog 900', { status: createdOk.status, amount: createdBody.amount, currency: createdBody.currency, leaked: createdBody.email || createdBody.access_token || null }, {
  status: 201, amount: '900.00', currency: 'USD', leaked: null
});
expectEqual('paypal saw payer action required shape', paypalOrder.status, 'PAYER_ACTION_REQUIRED');

const replay = await handleRequest(post('/v1/orders', {
  items: [{ slug: 'website-basic', qty: 1 }]
}, { 'idempotency-key': IDEM }), state, { fetch: fetchImpl });
expectEqual('idempotent replay does not create again', { status: replay.status, creates: createPosts, orderId: (await replay.json()).orderId }, {
  status: 200, creates: 1, orderId: ORDER_ID
});

const conflict = await handleRequest(post('/v1/orders', {
  items: [{ slug: 'descriptions-basic', qty: 2 }]
}, { 'idempotency-key': IDEM }), state, { fetch: fetchImpl });
expectEqual('same key different cart conflicts', conflict.status, 409);

const unapproved = await handleRequest(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': CAP_IDEM }), state, { fetch: fetchImpl });
expectEqual('unapproved capture is 422-style rejection', unapproved.status, 409);
expectEqual('unapproved capture did not post capture', capturePosts, 0);

paypalOrder.status = 'APPROVED';
const captured = await handleRequest(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': CAP_IDEM }), state, { fetch: fetchImpl });
const capturedBody = await captured.json();
expectEqual('mocked completion returns catalog amount', {
  status: captured.status,
  amount: capturedBody.amount,
  captureStatus: capturedBody.status,
  payer: capturedBody.email || capturedBody.payer || null
}, { status: 200, amount: '900.00', captureStatus: 'COMPLETED', payer: null });

const again = await handleRequest(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': CAP_IDEM }), state, { fetch: fetchImpl });
expectEqual('repeat capture does not call PayPal again', { status: again.status, posts: capturePosts }, { status: 200, posts: 1 });

const stranger = await handleRequest(post('/v1/orders/OTHERORDER1/capture', {}, { 'idempotency-key': '44444444-4444-4444-4444-444444444444' }), state, { fetch: fetchImpl });
expectEqual('unknown order is not captured', stranger.status, 404);

paypalOrder.purchase_units[0].amount.value = '1.00';
paypalOrder.status = 'APPROVED';
const tamperedState = env();
await handleRequest(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }] }, { 'idempotency-key': '55555555-5555-5555-5555-555555555555' }), tamperedState, { fetch: fetchImpl });
paypalOrder.purchase_units[0].amount.value = '1.00';
paypalOrder.status = 'APPROVED';
const mismatch = await handleRequest(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': '66666666-6666-6666-6666-666666666666' }), tamperedState, { fetch: fetchImpl });
expectEqual('tampered amount is not captured', mismatch.status, 409);

const evil = await handleRequest(new Request('https://order-api.test/v1/orders', {
  method: 'POST',
  headers: { origin: 'https://evil.example', 'content-type': 'application/json', 'idempotency-key': IDEM },
  body: JSON.stringify({ items: [{ slug: 'website-basic', qty: 1 }] })
}), state, { fetch: fetchImpl });
expectEqual('foreign origin rejected', evil.status, 403);

const bare = { ...env(), PAYPAL_CLIENT_SECRET: '' };
const missing = await handleRequest(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }] }, { 'idempotency-key': IDEM }), bare, { fetch: fetchImpl });
expectEqual('missing secret is not configured', missing.status, 503);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('order api checks passed (mocked PayPal only, no sandbox capture)');
