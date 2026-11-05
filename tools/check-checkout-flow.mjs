/**
 * Checkout display, payload, receipt, and analytics.
 * PayPal and FormSubmit are mocked or blocked. No order is sent.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json'
};

const mockSdk = `window.paypal={Buttons:function(config){window.__paypalConfig=config;return{render:function(sel){var host=document.querySelector(sel);if(!host)return Promise.resolve();var button=document.createElement('button');button.type='button';button.id='audit-mock-paypal';button.textContent='mock';button.addEventListener('click',function(){Promise.resolve(config.onClick({}, {resolve:function(){return Promise.resolve(true);},reject:function(){return Promise.reject(new Error('rejected'));}})).then(function(){return config.createOrder({}, {order:{create:function(payload){window.__paypalPayload=payload;return Promise.resolve('MOCK');}}});}).then(function(){window.__paypalClick='created';}).catch(function(){window.__paypalClick='rejected';});});host.appendChild(button);return Promise.resolve();}};}};`;

function serve() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (rel.includes('..')) { res.writeHead(403); res.end(); return; }
      let file = join(root, rel);
      if (rel === '' || rel.endsWith('/')) file = join(file, 'index.html');
      try {
        const body = readFileSync(file);
        res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end('missing');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const failures = [];
function expectEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures.push(name + ' expected ' + b + ' got ' + a);
    console.log('FAIL', name, a);
  } else console.log('OK  ', name);
}

const server = await serve();
const port = server.address().port;
const debugPort = 9900 + (process.pid % 200);
const chrome = spawn('/usr/bin/google-chrome-stable', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=/tmp/desanya-flow-${process.pid}`,
  'about:blank'
], { stdio: 'ignore' });

let ws;
try {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      const data = await res.json();
      ws = new WebSocket(data.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve);
        ws.addEventListener('error', reject);
      });
      break;
    } catch { await sleep(150); }
  }
  if (!ws) throw new Error('chrome did not open');
  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id);
      clearTimeout(item.timer);
      pending.delete(msg.id);
      if (msg.error) item.reject(new Error(JSON.stringify(msg.error)));
      else item.resolve(msg.result);
      return;
    }
    if (msg.method === 'Fetch.requestPaused') {
      const p = msg.params;
      const url = (p.request && p.request.url) || '';
      const sessionId = msg.sessionId;
      if (url.includes('paypal.com/sdk/js')) {
        cdp('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
          body: Buffer.from(mockSdk).toString('base64')
        }, sessionId).catch(() => {});
      } else {
        cdp('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {});
      }
    }
  });
  function cdp(method, params = {}, sessionId) {
    const id = ++msgId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)); }, 20000);
      pending.set(id, { resolve, reject, timer });
    });
  }
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Page.enable', {}, S);
  await cdp('Fetch.enable', { patterns: [
    { urlPattern: '*paypal.com*', requestStage: 'Request' },
    { urlPattern: '*formsubmit.co*', requestStage: 'Request' }
  ] }, S);
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.addEventListener('submit', function (e) {
      var action = ((e.target && e.target.getAttribute && e.target.getAttribute('action')) || '').toLowerCase();
      if (action.indexOf('formsubmit') !== -1) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  ` }, S);

  async function ev(expression) {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, S);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 500));
    return result.result.value;
  }
  async function go(path) {
    await cdp('Page.navigate', { url: `http://127.0.0.1:${port}${path}` }, S);
    await ev(`new Promise((r) => { if (document.readyState === 'complete') setTimeout(r, 200); else window.addEventListener('load', () => setTimeout(r, 200)); })`);
  }
  async function loadCart(cart) {
    await go('/checkout.html');
    await ev(`localStorage.setItem('desanya_cart_v1', ${JSON.stringify(JSON.stringify(cart))}); sessionStorage.removeItem('desanya_last_order'); localStorage.removeItem('audit_gtag'); location.reload();`);
    await ev(`new Promise((resolve) => { const t = Date.now(); const tick = () => {
      const main = document.getElementById('checkout-main');
      if ((main && !main.hidden && window.DesanyaCart && window.DesanyaCart.getCount() > 0) || Date.now() - t > 8000) resolve(1);
      else setTimeout(tick, 40);
    }; tick(); })`);
    await sleep(250);
  }

  await loadCart({ rush: 1 });
  const rush = await ev(`({
    due: document.getElementById('checkout-total').textContent,
    nopay: document.getElementById('checkout-nopay-note').hidden ? '' : document.getElementById('checkout-nopay-note').textContent.trim(),
    placeholderHidden: document.getElementById('checkout-placeholder-note').hidden,
    payHidden: document.getElementById('paypal-buttons').hidden,
    canCharge: window.DesanyaCart.canChargeNow(),
    count: window.DesanyaCart.getCount()
  })`);
  expectEqual('rush-only display', rush, {
    due: '$0',
    nopay: 'Rush delivery is 35% of the one-time items in the cart. Add a one-time service to price it. Nothing is charged for rush by itself.',
    placeholderHidden: true,
    payHidden: true,
    canCharge: false,
    count: 1
  });

  await loadCart({ 'monthly-care': 1 });
  const monthlyClick = await ev(`(async () => {
    document.getElementById('co-name').value = 'Audit Person';
    document.getElementById('co-email').value = 'audit@example.com';
    localStorage.removeItem('audit_gtag');
    window.gtag = function () { const prev = JSON.parse(localStorage.getItem('audit_gtag') || '[]'); prev.push([].slice.call(arguments)); localStorage.setItem('audit_gtag', JSON.stringify(prev)); };
    const cfg = window.__paypalConfig;
    let payload = null;
    await cfg.onClick({}, { resolve: () => Promise.resolve(true), reject: () => Promise.reject(new Error('no')) });
    await cfg.createOrder({}, { order: { create: (p) => { payload = p; return Promise.resolve('MOCK'); } } });
    await cfg.onApprove({}, { order: { capture: async () => ({ id: 'ORDER1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '1.00' } }] } }] }) } });
    return { payload: payload.purchase_units[0].amount.value, name: payload.purchase_units[0].items[0].name };
  })()`);
  await sleep(300);
  const monthlyAfter = await ev(`({
    href: location.href,
    h1: document.querySelector('h1').textContent,
    amount: document.getElementById('thanks-amount') && document.getElementById('thanks-amount').textContent,
    order: sessionStorage.getItem('desanya_last_order'),
    gtag: localStorage.getItem('audit_gtag')
  })`);
  expectEqual('monthly payload', monthlyClick, { payload: '1.00', name: 'Deposit — Monthly care — Basic' });
  expectEqual('monthly receipt', {
    hash: monthlyAfter.href.includes('#receipt'),
    h1: monthlyAfter.h1,
    amount: monthlyAfter.amount,
    purchase: (JSON.parse(monthlyAfter.gtag || '[]')).filter((row) => row[1] === 'purchase')[0]
  }, {
    hash: true,
    h1: 'Payment received.',
    amount: 'USD 1.00',
    purchase: ['event', 'purchase', { transaction_id: 'CAP1', value: 1, currency: 'USD' }]
  });

  await go('/thanks/?paid=1');
  const paidOnly = await ev(`document.querySelector('h1').textContent`);
  expectEqual('paid=1 alone is not a receipt', paidOnly, 'Got it — your request is in.');

  await go('/thanks/#receipt');
  const stillReceipt = await ev(`document.querySelector('h1').textContent`);
  expectEqual('hash plus stored capture still shows receipt', stillReceipt, 'Payment received.');

  await ev(`sessionStorage.removeItem('desanya_last_order')`);
  await go('/thanks/?fresh=1#receipt');
  const bareHash = await ev(`document.querySelector('h1').textContent`);
  expectEqual('hash without capture is not a receipt', bareHash, 'Got it — your request is in.');

  await loadCart({ 'website-basic': 1, 'monthly-care': 1 });
  const mixed = await ev(`(async () => {
    document.getElementById('co-name').value = 'Audit Person';
    document.getElementById('co-email').value = 'audit@example.com';
    localStorage.removeItem('audit_gtag');
    window.gtag = function () { const prev = JSON.parse(localStorage.getItem('audit_gtag') || '[]'); prev.push([].slice.call(arguments)); localStorage.setItem('audit_gtag', JSON.stringify(prev)); };
    const before = window.DesanyaCart.getTotal();
    const cfg = window.__paypalConfig;
    let payload = null;
    await cfg.createOrder({}, { order: { create: (p) => { payload = p; return Promise.resolve('MOCK'); } } });
    await cfg.onApprove({}, { order: { capture: async () => ({ id: 'ORDER2', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP2', status: 'COMPLETED', amount: { currency_code: 'USD', value: payload.purchase_units[0].amount.value } }] } }] }) } });
    return { before: before, payload: payload.purchase_units[0].amount.value, names: payload.purchase_units[0].items.map((i) => i.name) };
  })()`);
  await sleep(250);
  const mixedGtag = await ev(`JSON.parse(localStorage.getItem('audit_gtag') || '[]')[0]`);
  expectEqual('mixed payload excludes monthly', mixed, { before: 999, payload: '900.00', names: ['Website — Basic'] });
  expectEqual('mixed analytics uses capture', mixedGtag, ['event', 'purchase', { transaction_id: 'CAP2', value: 900, currency: 'USD' }]);

  await loadCart({ 'descriptions-basic': 1 });
  const failed = await ev(`(async () => {
    document.getElementById('co-name').value = 'Audit Person';
    document.getElementById('co-email').value = 'audit@example.com';
    localStorage.removeItem('audit_gtag');
    window.gtag = function () { const prev = JSON.parse(localStorage.getItem('audit_gtag') || '[]'); prev.push([].slice.call(arguments)); localStorage.setItem('audit_gtag', JSON.stringify(prev)); };
    const cfg = window.__paypalConfig;
    await cfg.onApprove({}, { order: { capture: async () => ({ id: 'ORDER3', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP3', status: 'PENDING', amount: { currency_code: 'USD', value: '60.00' } }] } }] }) } });
    await cfg.onCancel();
    return {
      count: window.DesanyaCart.getCount(),
      error: document.getElementById('checkout-error').textContent,
      gtag: localStorage.getItem('audit_gtag'),
      href: location.pathname
    };
  })()`);
  expectEqual('pending capture and cancel keep the cart', failed, {
    count: 1,
    error: 'Payment canceled. Your cart is still here.',
    gtag: null,
    href: '/checkout.html'
  });

  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    var fixed = new Date('2026-11-28T17:00:00Z');
    var NativeDate = Date;
    function FakeDate() {
      if (!(this instanceof FakeDate)) return String(fixed);
      if (arguments.length === 0) return new NativeDate(fixed.getTime());
      return new NativeDate(...arguments);
    }
    FakeDate.prototype = NativeDate.prototype;
    FakeDate.now = function () { return fixed.getTime(); };
    FakeDate.parse = NativeDate.parse;
    FakeDate.UTC = NativeDate.UTC;
    window.Date = FakeDate;
  })();` }, S);
  await loadCart({ 'website-basic': 1 });
  const coupon = await ev(`(async () => {
    document.getElementById('co-discount').value = 'BLACKFRIDAY26';
    document.querySelector('[data-discount-apply]').click();
    await new Promise((r) => setTimeout(r, 80));
    const applied = document.querySelector('[data-discount-msg]').textContent;
    const due = document.getElementById('checkout-total').textContent;
    document.getElementById('co-discount').value = 'NOTACODE';
    document.querySelector('[data-discount-apply]').click();
    await new Promise((r) => setTimeout(r, 80));
    return { applied, due, later: document.querySelector('[data-discount-msg]').textContent, still: document.getElementById('checkout-total').textContent };
  })()`);
  expectEqual('later invalid code keeps the applied message', coupon, {
    applied: 'Code applied.',
    due: '$810',
    later: 'Code applied.',
    still: '$810'
  });

  await go('/services.html');
  await ev(`localStorage.removeItem('desanya_cart_v1'); location.reload();`);
  await sleep(300);
  const focus = await ev(`(async () => {
    const btn = document.querySelector('[data-add-to-cart="website-basic"]');
    btn.focus();
    btn.click();
    await new Promise((r) => setTimeout(r, 50));
    const opened = document.activeElement && document.activeElement.classList.contains('ds-cart-close');
    const dialog = document.querySelector('.ds-cart-drawer');
    const items = [...dialog.querySelectorAll('a[href], button')].filter((el) => el.getClientRects().length);
    items[items.length - 1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const wrapped = document.activeElement && document.activeElement.classList.contains('ds-cart-close');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    return {
      opened, wrapped,
      restored: document.activeElement === btn,
      closed: !document.getElementById('ds-cart-root').classList.contains('open')
    };
  })()`);
  expectEqual('cart focus trap and restore', focus, { opened: true, wrapped: true, restored: true, closed: true });

  const frozen = await ev(`(() => { try { window.DesanyaCart.catalog['website-basic'].price = 1; } catch (err) {} return window.DesanyaCart.catalog['website-basic'].price; })()`);
  expectEqual('catalog price stays frozen', frozen, 900);
} finally {
  chrome.kill('SIGKILL');
  server.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('checkout flow checks passed (no PayPal transaction)');
