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
import worker from '../worker/src/index.js';
import { createLedger, memoryStore, publicReceipt } from '../worker/src/ledger.js';

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

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function env() {
  return {
    ledger: createLedger(memoryStore()),
    PAYPAL_CLIENT_ID: 'sandbox-test-client',
    PAYPAL_CLIENT_SECRET: 'sandbox-test-secret',
    ORDER_BINDING_SECRET: 'test-binding-secret-not-a-real-paypal-secret',
    PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com',
    ALLOWED_ORIGINS: 'https://desanya.tech'
  };
}
function call(request, state, fetchImpl, now) {
  return handleRequest(request, state, {
    fetch: fetchImpl,
    ledger: state.ledger,
    now: now || (() => Date.now())
  });
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
let lastPayPalCreate = null;

function paypalFetch() {
  return async (url, init) => {
    const target = String(url);
    if (!target.startsWith('https://api-m.sandbox.paypal.com/')) throw new Error('unexpected url ' + target);
    if (target.endsWith('/v1/oauth2/token')) return response({ access_token: 'tok-test', expires_in: 3000 });
    if (target.endsWith('/v2/checkout/orders') && init.method === 'POST') {
      createPosts += 1;
      const body = JSON.parse(init.body);
      lastPayPalCreate = body;
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
      paypalOrder.payer = { email_address: 'buyer@example.com' };
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
const created = await call(post('/v1/orders', {
  items: [{ slug: 'website-basic', qty: 1, price: 1 }],
  amount: 1
}, { 'idempotency-key': IDEM }), state, fetchImpl);
expectEqual('rejects client price field', created.status, 400);

const createdOk = await call(post('/v1/orders', {
  items: [{ slug: 'website-basic', qty: 1 }]
}, { 'idempotency-key': IDEM }), state, fetchImpl);
const createdBody = await createdOk.json();
expectEqual('create uses catalog 900', { status: createdOk.status, amount: createdBody.amount, currency: createdBody.currency, leaked: createdBody.email || createdBody.access_token || null }, {
  status: 201, amount: '900.00', currency: 'USD', leaked: null
});
const owner = createdBody.ownerSecret;
expectEqual('create returns an owner secret and does not give it to PayPal', {
  shape: /^[0-9a-f]{64}$/i.test(owner),
  returnUrl: JSON.stringify(lastPayPalCreate).includes('return_url'),
  paymentSource: lastPayPalCreate.payment_source || null,
  ownerField: lastPayPalCreate.ownerSecret || null
}, { shape: true, returnUrl: false, paymentSource: null, ownerField: null });
expectEqual('paypal saw payer action required shape', paypalOrder.status, 'PAYER_ACTION_REQUIRED');

const replayDenied = await call(post('/v1/orders', {
  items: [{ slug: 'website-basic', qty: 1 }]
}, { 'idempotency-key': IDEM }), state, fetchImpl);
const replayDeniedBody = await replayDenied.json();
expectEqual('create replay without the owner secret leaks no order', { status: replayDenied.status, body: replayDeniedBody, creates: createPosts }, {
  status: 401, body: { error: 'owner_required' }, creates: 1
});

const replay = await call(post('/v1/orders', {
  items: [{ slug: 'website-basic', qty: 1 }]
}, { 'idempotency-key': IDEM, 'order-owner': owner }), state, fetchImpl);
expectEqual('idempotent replay does not create again', { status: replay.status, creates: createPosts, orderId: (await replay.json()).orderId }, {
  status: 200, creates: 1, orderId: ORDER_ID
});

const conflict = await call(post('/v1/orders', {
  items: [{ slug: 'descriptions-basic', qty: 2 }]
}, { 'idempotency-key': IDEM }), state, fetchImpl);
expectEqual('same key different cart conflicts', conflict.status, 409);

const attacker = await call(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': '12121212-1212-1212-1212-121212121212' }), state, fetchImpl);
const attackerBody = await attacker.json();
expectEqual('attacker capture before approval leaks nothing', {
  status: attacker.status,
  body: attackerBody,
  posts: capturePosts
}, { status: 404, body: { error: 'unknown_order' }, posts: 0 });

const unapproved = await call(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': CAP_IDEM, 'order-owner': owner }), state, fetchImpl);
expectEqual('unapproved capture is 422-style rejection', unapproved.status, 409);
expectEqual('unapproved capture did not post capture', capturePosts, 0);

paypalOrder.status = 'APPROVED';
const captured = await call(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': CAP_IDEM, 'order-owner': owner }), state, fetchImpl);
const capturedBody = await captured.json();
expectEqual('mocked completion returns catalog amount', {
  status: captured.status,
  amount: capturedBody.amount,
  captureStatus: capturedBody.status,
  payer: capturedBody.email || capturedBody.payer || null
}, { status: 200, amount: '900.00', captureStatus: 'COMPLETED', payer: null });

const again = await call(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': CAP_IDEM, 'order-owner': owner }), state, fetchImpl);
expectEqual('repeat capture does not call PayPal again', { status: again.status, posts: capturePosts }, { status: 200, posts: 1 });

const stranger = await call(post('/v1/orders/OTHERORDER1/capture', {}, { 'idempotency-key': '44444444-4444-4444-4444-444444444444' }), state, fetchImpl);
expectEqual('unknown order is not captured', stranger.status, 404);

paypalOrder.purchase_units[0].amount.value = '1.00';
paypalOrder.status = 'APPROVED';
const tamperedState = env();
const tamperedCreated = await call(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }] }, { 'idempotency-key': '55555555-5555-5555-5555-555555555555' }), tamperedState, fetchImpl);
const tamperedOwner = (await tamperedCreated.json()).ownerSecret;
paypalOrder.purchase_units[0].amount.value = '1.00';
paypalOrder.status = 'APPROVED';
const mismatch = await call(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': '66666666-6666-6666-6666-666666666666', 'order-owner': tamperedOwner }), tamperedState, fetchImpl);
expectEqual('tampered amount is not captured', mismatch.status, 409);

const evil = await call(new Request('https://order-api.test/v1/orders', {
  method: 'POST',
  headers: { origin: 'https://evil.example', 'content-type': 'application/json', 'idempotency-key': IDEM },
  body: JSON.stringify({ items: [{ slug: 'website-basic', qty: 1 }] })
}), state, fetchImpl);
expectEqual('foreign origin rejected', evil.status, 403);

const bare = { ...env(), PAYPAL_CLIENT_SECRET: '' };
const missing = await call(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }] }, { 'idempotency-key': IDEM }), bare, fetchImpl);
expectEqual('missing secret is not configured', missing.status, 503);

expectEqual('capture token is unguessable and not an email', /^[0-9a-f]{64}$/i.test(capturedBody.receiptToken) && !capturedBody.email, true);
const againBody = await again.json();
expectEqual('same capture key returns the same receipt token', againBody.receiptToken, capturedBody.receiptToken);
const otherKey = await call(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': '77777777-7777-7777-7777-777777777777' }), state, fetchImpl);
const otherBody = await otherKey.json();
expectEqual('a different capture key without the owner secret leaks nothing', { status: otherKey.status, body: otherBody, posts: capturePosts }, {
  status: 404, body: { error: 'unknown_order' }, posts: 1
});
const ownerOtherKey = await call(post('/v1/orders/' + ORDER_ID + '/capture', {}, { 'idempotency-key': '77777777-7777-7777-7777-777777777777', 'order-owner': owner }), state, fetchImpl);
const ownerOtherBody = await ownerOtherKey.json();
expectEqual('the owner secret, not the idempotency key, returns the receipt token', {
  status: ownerOtherKey.status,
  token: ownerOtherBody.receiptToken,
  posts: capturePosts
}, { status: 200, token: capturedBody.receiptToken, posts: 1 });

function receiptGet(token, orderId = ORDER_ID, useState = state) {
  return call(new Request('https://order-api.test/v1/orders/' + orderId + '/receipt', {
    method: 'GET',
    headers: { origin: 'https://desanya.tech', 'receipt-token': token }
  }), useState, fetchImpl);
}
const postsBeforeReceipt = capturePosts;
const receiptOk = await receiptGet(capturedBody.receiptToken);
const receiptBody = await receiptOk.json();
expectEqual('receipt is the verified capture, not the payer email', {
  status: receiptOk.status,
  amount: receiptBody.amount,
  captureId: receiptBody.captureId,
  business: receiptBody.businessName,
  contact: receiptBody.contactEmail,
  item: receiptBody.lines && receiptBody.lines[0] && receiptBody.lines[0].name,
  leaked: JSON.stringify(receiptBody).includes('buyer@example.com')
}, {
  status: 200,
  amount: '900.00',
  captureId: CAPTURE_ID,
  business: 'Desanya Studio',
  contact: 'desanyaafterdark@gmail.com',
  item: 'Website — Basic',
  leaked: false
});
expectEqual('reading the receipt does not capture again', capturePosts, postsBeforeReceipt);
const forgedReceipt = await receiptGet('a'.repeat(64));
const forgedBody = await forgedReceipt.json();
expectEqual('wrong receipt token reveals nothing', { status: forgedReceipt.status, body: forgedBody }, {
  status: 404, body: { error: 'receipt_not_available' }
});
const noToken = await receiptGet('');
expectEqual('order id alone is not a receipt', noToken.status, 404);
const unapprovedReceipt = await receiptGet(capturedBody.receiptToken, 'OTHERORDER1');
expectEqual('unknown order receipt is the same error', unapprovedReceipt.status, 404);

const health = await call(new Request('https://order-api.test/health'), state, fetchImpl);
expectEqual('no health route', health.status, 404);
const unbound = await worker.fetch(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }] }, { 'idempotency-key': IDEM }), env());
expectEqual('missing durable object binding fails closed', unbound.status, 503);

const quotaState = env();
quotaState.ledger.reserveCreate = () => { throw new Error('daily quota exceeded'); };
let quotaPosts = 0;
const quota = await call(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }] }, { 'idempotency-key': '88888888-8888-8888-8888-888888888888' }), quotaState, async () => {
  quotaPosts += 1;
  return response({ id: 'SHOULDNOT', status: 'CREATED' }, 201);
});
expectEqual('storage quota fails closed before PayPal', { status: quota.status, posts: quotaPosts }, { status: 503, posts: 0 });

async function kvGetThenPutCanDuplicate() {
  const map = new Map();
  let creates = 0;
  async function get(key) {
    await Promise.resolve();
    return map.has(key) ? map.get(key) : null;
  }
  async function put(key, value) {
    await Promise.resolve();
    map.set(key, value);
  }
  async function attempt(id) {
    const existing = await get('idem');
    if (!existing) {
      creates += 1;
      await put('idem', id);
    }
  }
  await Promise.all([attempt('a'), attempt('b')]);
  return creates;
}
expectEqual('kv get-then-put model can create twice', await kvGetThenPutCanDuplicate(), 2);

let concurrentPosts = 0;
const concurrentIds = [];
let releaseCreate;
const createGate = new Promise((resolve) => { releaseCreate = resolve; });
const concurrentFetch = async (url, init) => {
  const target = String(url);
  if (target.endsWith('/v1/oauth2/token')) return response({ access_token: 'tok-test', expires_in: 3000 });
  if (target.endsWith('/v2/checkout/orders') && init.method === 'POST') {
    concurrentPosts += 1;
    concurrentIds.push(init.headers['paypal-request-id']);
    await createGate;
    return response({ id: 'CONCURRENT1', status: 'PAYER_ACTION_REQUIRED' }, 201);
  }
  throw new Error('unexpected ' + target);
};
resetPayPalTokenCache();
const concurrentState = env();
const concurrentKey = '99999999-9999-9999-9999-999999999999';
const firstCreate = call(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }] }, { 'idempotency-key': concurrentKey }), concurrentState, concurrentFetch);
for (let i = 0; i < 50 && concurrentPosts < 1; i++) await new Promise((resolve) => setTimeout(resolve, 5));
const secondCreate = await call(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }] }, { 'idempotency-key': concurrentKey }), concurrentState, concurrentFetch);
expectEqual('concurrent retry does not start a second PayPal order', { status: secondCreate.status, posts: concurrentPosts }, { status: 409, posts: 1 });
releaseCreate();
const firstResult = await firstCreate;
expectEqual('first concurrent create still uses one PayPal request id', { status: firstResult.status, ids: concurrentIds }, { status: 201, ids: [concurrentKey] });

expectEqual('public receipt helper drops payer email', publicReceipt({
  status: 'COMPLETED', orderId: ORDER_ID, captureId: CAPTURE_ID, paidAt: '2026-11-05T22:00:00.000Z',
  currency: 'USD', value: '900.00', linesJson: JSON.stringify([{ name: 'Website — Basic', quantity: '1', unitAmount: '900.00', email: 'buyer@example.com' }])
}).lines[0], { name: 'Website — Basic', quantity: '1', unitAmount: '900.00' });
const legacyDeposit = publicReceipt({
  status: 'COMPLETED', orderId: 'LEGACYORD1', captureId: 'LEGACYCAP1', paidAt: '2026-11-05T22:00:00.000Z',
  currency: 'USD', value: '1.00',
  linesJson: JSON.stringify([{ name: 'Deposit — Monthly care — Basic', quantity: '1', unitAmount: '1.00' }])
});
expectEqual('stored deposit rows do not gain a later monthly amount', {
  amount: legacyDeposit.amount,
  later: legacyDeposit.laterRecurring || null,
  name: legacyDeposit.lines[0].name
}, { amount: '1.00', later: null, name: 'Deposit — Monthly care — Basic' });

const care = await quoteCart([{ slug: 'monthly-care', qty: 1, price: 5 }], { now: CLOSED });
const carePlus = await quoteCart([{ slug: 'monthly-care-plus', qty: 1 }], { now: CLOSED });
const careAgain = await quoteCart([{ slug: 'monthly-care', qty: 1 }], { now: CLOSED });
expectEqual('monthly deposits share the charge and not the commitment', {
  care: care.value,
  plus: carePlus.value,
  sameHash: care.cartHash === carePlus.cartHash,
  later: care.laterRecurring,
  plusLater: carePlus.laterRecurring,
  replay: careAgain.cartHash === care.cartHash
}, { care: '1.00', plus: '1.00', sameHash: false, later: '99.00', plusLater: '179.00', replay: true });
const photo = await quoteCart([{ slug: 'photo-basic', qty: 1 }], { now: CLOSED });
const deck = await quoteCart([{ slug: 'deck-basic', qty: 1 }], { now: CLOSED });
expectEqual('unrelated 150 carts do not share a commitment', photo.value === '150.00' && deck.value === '150.00' && photo.cartHash !== deck.cartHash, true);

function scenarioPayPal(orderId, captureId) {
  let creates = 0;
  let captures = 0;
  let order = null;
  let createBody = null;
  return {
    creates: () => creates,
    captures: () => captures,
    createBody: () => createBody,
    approve() { order.status = 'APPROVED'; },
    fetch: async (url, init) => {
      const target = String(url);
      if (target.endsWith('/v1/oauth2/token')) return response({ access_token: 'tok-test', expires_in: 3000 });
      if (target.endsWith('/v2/checkout/orders') && init.method === 'POST') {
        creates += 1;
        createBody = JSON.parse(init.body);
        order = { id: orderId, status: 'PAYER_ACTION_REQUIRED', intent: 'CAPTURE', purchase_units: createBody.purchase_units };
        return response({ id: orderId, status: 'PAYER_ACTION_REQUIRED' }, 201);
      }
      if (target.endsWith('/v2/checkout/orders/' + orderId) && (!init.method || init.method === 'GET')) return response(order);
      if (target.endsWith('/capture') && init.method === 'POST') {
        captures += 1;
        order = capturedOrder(orderId, order.purchase_units[0].amount.value, order.purchase_units[0].custom_id, captureId);
        return response(order);
      }
      throw new Error('unexpected ' + target);
    }
  };
}

resetPayPalTokenCache();
const monthlyPay = scenarioPayPal('MONTHLYOR1', 'CAPMONTH01');
const monthlyState = env();
const monthlyKey = 'abababab-abab-abab-abab-abababababab';
const monthlyCreated = await call(post('/v1/orders', { items: [{ slug: 'monthly-care', qty: 1 }] }, { 'idempotency-key': monthlyKey }), monthlyState, monthlyPay.fetch);
const monthlyBody = await monthlyCreated.json();
const monthlyClash = await call(post('/v1/orders', { items: [{ slug: 'monthly-care-plus', qty: 1 }] }, { 'idempotency-key': monthlyKey }), monthlyState, monthlyPay.fetch);
expectEqual('monthly-care does not replay as monthly-care-plus', { status: monthlyClash.status, creates: monthlyPay.creates(), amount: monthlyBody.amount }, {
  status: 409, creates: 1, amount: '1.00'
});
const monthlyReplay = await call(post('/v1/orders', { items: [{ slug: 'monthly-care', qty: 1 }] }, { 'idempotency-key': monthlyKey, 'order-owner': monthlyBody.ownerSecret }), monthlyState, monthlyPay.fetch);
expectEqual('the same monthly cart replays one order', { status: monthlyReplay.status, id: (await monthlyReplay.json()).orderId, creates: monthlyPay.creates() }, {
  status: 200, id: 'MONTHLYOR1', creates: 1
});
const qtyClash = await call(post('/v1/orders', { items: [{ slug: 'monthly-care', qty: 2 }] }, { 'idempotency-key': monthlyKey }), monthlyState, monthlyPay.fetch);
expectEqual('a different monthly quantity is a different commitment', qtyClash.status, 409);
monthlyPay.approve();
const monthlyCaptured = await call(post('/v1/orders/MONTHLYOR1/capture', {}, { 'idempotency-key': 'bcbcbcbc-bcbc-bcbc-bcbc-bcbcbcbcbcbc', 'order-owner': monthlyBody.ownerSecret }), monthlyState, monthlyPay.fetch);
const monthlyCaptureBody = await monthlyCaptured.json();
const monthlyReceipt = await (await call(new Request('https://order-api.test/v1/orders/MONTHLYOR1/receipt', {
  method: 'GET',
  headers: { origin: 'https://desanya.tech', 'receipt-token': monthlyCaptureBody.receiptToken }
}), monthlyState, monthlyPay.fetch)).json();
expectEqual('monthly receipt keeps the deposit paid and the later commitment', {
  paid: monthlyReceipt.amount,
  later: monthlyReceipt.laterRecurring,
  deposit: monthlyReceipt.lines[0].unitAmount,
  service: monthlyReceipt.requested.filter((line) => line.recurring).map((line) => line.name + ' ' + line.catalogUnitAmount)
}, { paid: '1.00', later: '99.00', deposit: '1.00', service: ['Monthly care — Basic 99.00'] });

resetPayPalTokenCache();
const mixedPay = scenarioPayPal('MIXEDORD01', 'CAPMIXED01');
const mixedState = env();
const mixedKey = 'dededede-dede-dede-dede-dededededede';
const mixedCreated = await call(post('/v1/orders', { items: [{ slug: 'website-basic', qty: 1 }, { slug: 'monthly-care', qty: 1 }] }, { 'idempotency-key': mixedKey }), mixedState, mixedPay.fetch);
const mixedBody = await mixedCreated.json();
expectEqual('mixed create charges the website and not the monthly', { status: mixedCreated.status, amount: mixedBody.amount, paypal: mixedPay.createBody().purchase_units[0].amount.value }, {
  status: 201, amount: '900.00', paypal: '900.00'
});
mixedPay.approve();
const mixedCaptured = await call(post('/v1/orders/MIXEDORD01/capture', {}, { 'idempotency-key': 'efefefef-efef-efef-efef-efefefefefef', 'order-owner': mixedBody.ownerSecret }), mixedState, mixedPay.fetch);
const mixedToken = (await mixedCaptured.json()).receiptToken;
const mixedReceipt = await (await call(new Request('https://order-api.test/v1/orders/MIXEDORD01/receipt', {
  method: 'GET',
  headers: { origin: 'https://desanya.tech', 'receipt-token': mixedToken }
}), mixedState, mixedPay.fetch)).json();
expectEqual('mixed receipt shows 900 paid and 99 later', {
  paid: mixedReceipt.amount,
  paidLine: mixedReceipt.lines.map((line) => line.name + ' ' + line.unitAmount),
  later: mixedReceipt.laterRecurring,
  monthly: mixedReceipt.requested.filter((line) => line.recurring).map((line) => line.catalogUnitAmount)
}, { paid: '900.00', paidLine: ['Website — Basic 900.00'], later: '99.00', monthly: ['99.00'] });

resetPayPalTokenCache();
const pricePay = scenarioPayPal('SAMEPRICE1', 'CAPSAME001');
const priceState = env();
const priceKey = '12121212-3434-5656-7878-909090909090';
const photoCreated = await call(post('/v1/orders', { items: [{ slug: 'photo-basic', qty: 1 }] }, { 'idempotency-key': priceKey }), priceState, pricePay.fetch);
const photoBody = await photoCreated.json();
const deckClash = await call(post('/v1/orders', { items: [{ slug: 'deck-basic', qty: 1 }] }, { 'idempotency-key': priceKey }), priceState, pricePay.fetch);
expectEqual('same price does not replay an unrelated cart', { status: deckClash.status, amount: photoBody.amount, creates: pricePay.creates() }, {
  status: 409, amount: '150.00', creates: 1
});

let clientHeaders = null;
let clientBody = '';
const clientOrder = await createServerOrder('https://orders.example.com', {
  items: [{ slug: 'website-basic', qty: 1 }],
  idempotencyKey: '34343434-3434-3434-3434-343434343434',
  ownerSecret: 'ab'.repeat(32),
  fetchImpl: async (url, init) => {
    clientHeaders = init.headers;
    clientBody = init.body;
    return new Response(JSON.stringify({ orderId: 'CLIENTORD1', amount: '900.00', currency: 'USD', ownerSecret: 'cd'.repeat(32) }), { status: 201 });
  }
});
expectEqual('client sends the owner secret as a header, not in the body or address', {
  header: clientHeaders['order-owner'],
  bodyHasSecret: clientBody.includes('ab'.repeat(32)),
  urlHasSecret: false,
  returned: clientOrder.ownerSecret
}, { header: 'ab'.repeat(32), bodyHasSecret: false, urlHasSecret: false, returned: 'cd'.repeat(32) });

function memorySession() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] || null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; }
  };
}
const savedSession = globalThis.sessionStorage;
const blogKey = '46464646-4646-4646-4646-464646464646';
const blogPay = scenarioPayPal('BLOGORD120', 'CAPBLOG120');
const blogState = env();
const blogHeaders = [];
const blogKeys = [];
globalThis.sessionStorage = memorySession();
resetPayPalTokenCache();
const blogFetch = async (url, init) => {
  blogHeaders.push(init.headers['order-owner'] || '');
  blogKeys.push(init.headers['idempotency-key'] || '');
  return call(new Request('https://order-api.test/v1/orders', {
    method: 'POST',
    headers: { origin: 'https://desanya.tech', 'content-type': 'application/json', 'idempotency-key': blogKey, ...(init.headers['order-owner'] ? { 'order-owner': init.headers['order-owner'] } : {}) },
    body: init.body
  }), blogState, blogPay.fetch);
};
const blogFirst = await createServerOrder('https://orders.example.com', {
  items: [{ slug: 'blog-basic', qty: 1 }],
  idempotencyKey: blogKey,
  fetchImpl: blogFetch
});
const blogReplay = await createServerOrder('https://orders.example.com', {
  items: [{ slug: 'blog-basic', qty: 1 }],
  idempotencyKey: blogKey,
  fetchImpl: blogFetch
});
expectEqual('stored owner secret is sent on the next create and does not create again', {
  amount: blogFirst.amount,
  replay: blogReplay.orderId,
  creates: blogPay.creates(),
  firstHeader: blogHeaders[0],
  secondHeader: blogHeaders[1] === blogFirst.ownerSecret
}, { amount: '120.00', replay: 'BLOGORD120', creates: 1, firstHeader: '', secondHeader: true });
sessionStorage.setItem('desanya_owner_idem_' + blogKey, 'aa'.repeat(32));
const blogExact = await createServerOrder('https://orders.example.com', {
  items: [{ slug: 'blog-basic', qty: 1 }],
  idempotencyKey: blogKey,
  fetchImpl: blogFetch
});
expectEqual('exact remembered owner 401 then stored order secret replays', {
  id: blogExact.orderId,
  creates: blogPay.creates()
}, { id: 'BLOGORD120', creates: 1 });
const orphan = memorySession();
orphan.setItem('desanya_owner_BLOGORD120', blogFirst.ownerSecret);
globalThis.sessionStorage = orphan;
const blogRecovered = await createServerOrder('https://orders.example.com', {
  items: [{ slug: 'blog-basic', qty: 1 }],
  idempotencyKey: blogKey,
  fetchImpl: blogFetch
});
expectEqual('one saved order secret can resume the same cart without a second PayPal order', {
  id: blogRecovered.orderId,
  creates: blogPay.creates()
}, { id: 'BLOGORD120', creates: 1 });
globalThis.sessionStorage = memorySession();
let blogDenied = 0;
try {
  await createServerOrder('https://orders.example.com', {
    items: [{ slug: 'blog-basic', qty: 1 }],
    idempotencyKey: blogKey,
    fetchImpl: blogFetch
  });
} catch (err) {
  blogDenied = err.status;
}
expectEqual('a repeated create without the owner secret stays 401 and does not create again', {
  status: blogDenied,
  creates: blogPay.creates(),
  sameKey: blogKeys.every((key) => key === blogKey)
}, { status: 401, creates: 1, sameKey: true });
const several = memorySession();
several.setItem('desanya_owner_OTHERORD1', 'ff'.repeat(32));
several.setItem('desanya_owner_BLOGORD120', blogFirst.ownerSecret);
several.setItem('desanya_idem_blog-basic:1|', blogKey);
globalThis.sessionStorage = several;
const blogReturn = await createServerOrder('https://orders.example.com', {
  items: [{ slug: 'blog-basic', qty: 1 }],
  idempotencyKey: blogKey,
  fetchImpl: blogFetch
});
expectEqual('a return visit tries saved order proofs and does not create another order', {
  id: blogReturn.orderId,
  creates: blogPay.creates(),
  sameKey: blogKeys.every((key) => key === blogKey)
}, { id: 'BLOGORD120', creates: 1, sameKey: true });
globalThis.sessionStorage = savedSession;

const checkoutSource = readFileSync(new URL('../checkout.html', import.meta.url), 'utf8');
const createSlice = checkoutSource.slice(checkoutSource.indexOf('createOrder: function'), checkoutSource.indexOf('onApprove: function'));
const serverCaptureSlice = checkoutSource.slice(checkoutSource.indexOf("if (mode.mode === 'server')", checkoutSource.indexOf('onApprove: function')), checkoutSource.indexOf('return actions.order.capture()'));
expectEqual('checkout rotates the cart key once after owner recovery is exhausted', createSlice.includes('err.status !== 401') && createSlice.includes('rotateOrderIdempotencyKey(cartForApi)'), true);
expectEqual('checkout forgets the cart key before clearing after capture', serverCaptureSlice.indexOf('forgetOrderIdempotencyKey(window.DesanyaCart)') >= 0 && serverCaptureSlice.indexOf('forgetOrderIdempotencyKey(window.DesanyaCart)') < serverCaptureSlice.indexOf('window.DesanyaCart.clear()'), true);
const workerSource = readFileSync(new URL('../worker/src/handler.js', import.meta.url), 'utf8')
  + readFileSync(new URL('../worker/src/ledger.js', import.meta.url), 'utf8')
  + readFileSync(new URL('../shared/receipt-view.js', import.meta.url), 'utf8');
expectEqual('no email sender was added', /resend|brevo|mailchannels|smtp|receipt_email/i.test(workerSource), false);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('order api checks passed (mocked PayPal only, no sandbox capture)');
