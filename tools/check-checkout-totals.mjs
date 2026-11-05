/**
 * Prove cart and PayPal capture amounts without creating a PayPal order.
 *
 * Loads the real assets/cart.js in headless Chrome and checks one-time,
 * mixed, monthly-only, rush, and discount carts. No capture() call.
 *
 *   node tools/check-checkout-totals.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

const harness = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>totals</title></head>
<body>
<script>
  var openWindow = location.search.indexOf('window=open') !== -1;
  if (openWindow) {
    (function () {
      var fixed = new Date('2026-11-28T17:00:00Z');
      var NativeDate = Date;
      function FakeDate() {
        if (!(this instanceof FakeDate)) return NativeDate.prototype.toString.call(fixed);
        if (arguments.length === 0) return new NativeDate(fixed.getTime());
        return new NativeDate(...arguments);
      }
      FakeDate.prototype = NativeDate.prototype;
      FakeDate.now = function () { return fixed.getTime(); };
      FakeDate.parse = NativeDate.parse;
      FakeDate.UTC = NativeDate.UTC;
      window.Date = FakeDate;
      sessionStorage.setItem('desanya_adj_v1', '1');
    })();
  } else {
    sessionStorage.setItem('desanya_adj_v1', '1');
  }
  localStorage.removeItem('desanya_cart_v1');
</script>
<script src="/assets/cart.js"></script>
<pre id="out"></pre>
<script>
  function paypalAmount(cart) {
    var items = cart.getPayableItems();
    var listTotal = Math.round(items.reduce(function (s, it) { return s + it.price * it.qty; }, 0) * 100) / 100;
    var discount = Math.min(cart.getDiscount(), listTotal);
    discount = Math.round(discount * 100) / 100;
    var total = Math.round((listTotal - discount) * 100) / 100;
    if (!items.length) return { mode: 'deposit', value: '1.00', payableNames: [] };
    return {
      mode: 'capture',
      value: total.toFixed(2),
      payable: total,
      discount: discount,
      payableNames: items.map(function (it) { return it.slug; })
    };
  }
  function run(label, setup) {
    window.DesanyaCart.clear();
    setup(window.DesanyaCart);
    var cart = window.DesanyaCart;
    return {
      label: label,
      total: cart.getTotal(),
      payable: cart.getPayableTotal(),
      discount: cart.getDiscount(),
      recurring: cart.hasRecurring(),
      paypal: paypalAmount(cart),
      windowOpen: cart.discountsAvailable()
    };
  }
  function publish() {
  var rows = [];
  if (!openWindow) {
    rows.push(run('one-time', function (c) { c.add('descriptions-basic', 2); }));
    rows.push(run('mixed', function (c) { c.add('website-basic'); c.add('monthly-care'); }));
    rows.push(run('monthly-only', function (c) { c.add('monthly-care'); }));
    rows.push(run('rush', function (c) { c.add('website-standard'); c.add('rush'); }));
    rows.push(run('discount-closed', function (c) {
      c.add('website-basic'); c.add('rush'); c.add('monthly-care');
    }));
  } else {
    rows.push(run('discount-open', function (c) {
      c.add('website-standard'); c.add('extra-page'); c.add('seo-managing');
    }));
    rows.push(run('discount-rush-monthly', function (c) {
      c.add('website-basic'); c.add('rush'); c.add('monthly-care');
    }));
    rows.push(run('discount-ineligible', function (c) {
      c.add('descriptions-basic'); c.add('monthly-care');
    }));
  }
  document.getElementById('out').textContent = JSON.stringify({
    openWindow: openWindow,
    prices: {
      descriptions: window.DesanyaCart.catalog['descriptions-basic'].price,
      websiteBasic: window.DesanyaCart.catalog['website-basic'].price,
      websiteStandard: window.DesanyaCart.catalog['website-standard'].price,
      websitePremium: window.DesanyaCart.catalog['website-premium'].price,
      monthlyCare: window.DesanyaCart.catalog['monthly-care'].price,
      seoManaging: window.DesanyaCart.catalog['seo-managing'].price,
      extraPage: window.DesanyaCart.catalog['extra-page'].price,
      extraRevision: window.DesanyaCart.catalog['extra-revision'].price
    },
    rows: rows
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', publish);
else publish();
</script>
</body></html>`;

function serve() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/harness.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(harness);
        return;
      }
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      const file = join(root, rel);
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const body = readFileSync(file);
        res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch (err) {
        res.writeHead(404);
        res.end('missing');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function expectEqual(name, actual, expected, failures) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) failures.push(name + ' expected ' + b + ' got ' + a);
  else console.log('OK  ', name, b);
}

const closedExpected = {
  'one-time': { total: 120, payable: 120, discount: 0, recurring: false, paypal: { mode: 'capture', value: '120.00', payable: 120, discount: 0, payableNames: ['descriptions-basic'] }, windowOpen: false },
  mixed: { total: 999, payable: 900, discount: 0, recurring: true, paypal: { mode: 'capture', value: '900.00', payable: 900, discount: 0, payableNames: ['website-basic'] }, windowOpen: false },
  'monthly-only': { total: 99, payable: 0, discount: 0, recurring: true, paypal: { mode: 'deposit', value: '1.00', payableNames: [] }, windowOpen: false },
  rush: { total: 2160, payable: 2160, discount: 0, recurring: false, paypal: { mode: 'capture', value: '2160.00', payable: 2160, discount: 0, payableNames: ['website-standard', 'rush'] }, windowOpen: false },
  'discount-closed': { total: 1314, payable: 1215, discount: 0, recurring: true, paypal: { mode: 'capture', value: '1215.00', payable: 1215, discount: 0, payableNames: ['website-basic', 'rush'] }, windowOpen: false }
};

const openExpected = {
  'discount-open': { total: 2090, payable: 1640, discount: 160, recurring: true, paypal: { mode: 'capture', value: '1640.00', payable: 1640, discount: 160, payableNames: ['website-standard', 'extra-page'] }, windowOpen: true },
  'discount-rush-monthly': { total: 1224, payable: 1125, discount: 90, recurring: true, paypal: { mode: 'capture', value: '1125.00', payable: 1125, discount: 90, payableNames: ['website-basic', 'rush'] }, windowOpen: true },
  'discount-ineligible': { total: 159, payable: 60, discount: 0, recurring: true, paypal: { mode: 'capture', value: '60.00', payable: 60, discount: 0, payableNames: ['descriptions-basic'] }, windowOpen: true }
};

const priceExpected = {
  descriptions: 60,
  websiteBasic: 900,
  websiteStandard: 1600,
  websitePremium: 2500,
  monthlyCare: 99,
  seoManaging: 450,
  extraPage: 200,
  extraRevision: 40
};

async function readCase(port, query) {
  const chrome = spawn('/usr/bin/google-chrome-stable', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--user-data-dir=/tmp/desanya-totals-${process.pid}-${query ? 'open' : 'closed'}`,
    '--virtual-time-budget=6000',
    '--dump-dom',
    `http://127.0.0.1:${port}/harness.html${query}`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let html = '';
  let err = '';
  chrome.stdout.on('data', (buf) => { html += buf; });
  chrome.stderr.on('data', (buf) => { err += buf; });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.kill('SIGKILL');
      resolve('timeout');
    }, 20000);
    chrome.on('close', (status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
  if (code !== 0) throw new Error('chrome exit ' + code + ' ' + err.slice(-400));
  const match = html.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!match) throw new Error('harness produced no result: ' + html.slice(0, 500));
  return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

function moneyText(n) {
  const v = Math.round(Number(n) * 100) / 100;
  const cents = Math.round(v * 100) % 100 !== 0;
  return '$' + v.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2
  });
}

const visibleClosed = {
  'one-time': { cart: { 'descriptions-basic': 2 }, due: '$120', later: null, list: null, placeholder: false, apiTotal: 120, capture: '120.00' },
  mixed: { cart: { 'website-basic': 1, 'monthly-care': 1 }, due: '$900', later: '$99', list: '$999', placeholder: false, apiTotal: 999, capture: '900.00' },
  'monthly-only': { cart: { 'monthly-care': 1 }, due: '$1', later: '$99', list: null, placeholder: true, apiTotal: 99, capture: '1.00' },
  rush: { cart: { 'website-standard': 1, rush: 1 }, due: '$2,160', later: null, list: null, placeholder: false, apiTotal: 2160, capture: '2160.00' },
  'discount-closed': { cart: { 'website-basic': 1, rush: 1, 'monthly-care': 1 }, due: '$1,215', later: '$99', list: '$1,314', placeholder: false, apiTotal: 1314, capture: '1215.00' }
};

const visibleOpen = {
  'discount-open': { cart: { 'website-standard': 1, 'extra-page': 1, 'seo-managing': 1 }, due: '$1,640', later: '$450', list: '$2,090', placeholder: false, apiTotal: 2090, capture: '1640.00' },
  'discount-rush-monthly': { cart: { 'website-basic': 1, rush: 1, 'monthly-care': 1 }, due: '$1,125', later: '$99', list: '$1,224', placeholder: false, apiTotal: 1224, capture: '1125.00' },
  'discount-ineligible': { cart: { 'descriptions-basic': 1, 'monthly-care': 1 }, due: '$60', later: '$99', list: '$159', placeholder: false, apiTotal: 159, capture: '60.00' }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkVisible(port, failures) {
  const debugPort = 9344 + (process.pid % 1000);
  const chrome = spawn('/usr/bin/google-chrome-stable', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/desanya-due-today-${process.pid}`,
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
      } catch (err) {
        await sleep(200);
      }
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('checkout display chrome did not open');
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
      }
    });
    function cdp(method, params = {}, sessionId) {
      const id = ++msgId;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('timeout ' + method));
        }, 20000);
        pending.set(id, { resolve, reject, timer });
      });
    }
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    await cdp('Page.enable', {}, sessionId);
    await cdp('Network.enable', {}, sessionId);
    await cdp('Network.setBlockedURLs', { urls: ['*://www.paypal.com/*', '*://www.paypalobjects.com/*'] }, sessionId);

    async function runSet(label, cases) {
      for (const [name, spec] of Object.entries(cases)) {
        await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/checkout.html` }, sessionId);
        await sleep(400);
        const result = await cdp('Runtime.evaluate', {
          expression: `localStorage.setItem('desanya_cart_v1', ${JSON.stringify(JSON.stringify(spec.cart))}); location.reload(); 'reloading'`,
          returnByValue: true
        }, sessionId);
        if (!result) throw new Error('reload failed ' + name);
        const view = await cdp('Runtime.evaluate', {
          expression: `new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
              const due = document.getElementById('checkout-total');
              const main = document.getElementById('checkout-main');
              const ready = due && main && !main.hidden && window.DesanyaCart && window.DesanyaCart.getCount() > 0;
              if (ready || Date.now() - start > 8000) {
                const later = document.getElementById('checkout-later');
                const list = document.getElementById('checkout-list');
                const note = document.getElementById('checkout-placeholder-note');
                const drawerDue = document.querySelector('[data-cart-total]');
                resolve({
                  due: due ? due.textContent : '',
                  laterHidden: later ? later.hidden : true,
                  later: document.getElementById('checkout-later-total') ? document.getElementById('checkout-later-total').textContent : '',
                  listHidden: list ? list.hidden : true,
                  list: document.getElementById('checkout-list-total') ? document.getElementById('checkout-list-total').textContent : '',
                  placeholderHidden: note ? note.hidden : true,
                  apiTotal: window.DesanyaCart ? window.DesanyaCart.getTotal() : null,
                  apiDue: window.DesanyaCart && window.DesanyaCart.amountDueToday ? window.DesanyaCart.amountDueToday() : null,
                  drawerDue: drawerDue ? drawerDue.textContent : ''
                });
              } else setTimeout(tick, 50);
            };
            tick();
          })`,
          awaitPromise: true,
          returnByValue: true
        }, sessionId);
        const got = view.result.value;
        const shown = {
          due: got.due,
          later: got.laterHidden ? null : got.later,
          list: got.listHidden ? null : got.list,
          placeholder: !got.placeholderHidden,
          apiTotal: got.apiTotal,
          capture: Number(got.apiDue).toFixed(2),
          drawerDue: got.drawerDue
        };
        const want = {
          due: spec.due,
          later: spec.later,
          list: spec.list,
          placeholder: spec.placeholder,
          apiTotal: spec.apiTotal,
          capture: spec.capture,
          drawerDue: spec.due
        };
        expectEqual(label + ' visible ' + name, shown, want, failures);
        if (shown.due !== moneyText(Number(spec.capture))) {
          failures.push(label + ' ' + name + ' due text ' + shown.due + ' != capture ' + spec.capture);
        }
      }
    }

    await runSet('closed', visibleClosed);
    await cdp('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
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
        try { sessionStorage.setItem('desanya_adj_v1', '1'); } catch (e) {}
      })();`
    }, sessionId);
    await runSet('open', visibleOpen);
  } finally {
    chrome.kill('SIGKILL');
  }
}

const server = await serve();
const port = server.address().port;
const failures = [];
try {
  for (const [query, expected] of [['', closedExpected], ['?window=open', openExpected]]) {
    const data = await readCase(port, query);
    expectEqual('prices ' + (query || 'closed'), data.prices, priceExpected, failures);
    for (const row of data.rows) {
      const want = expected[row.label];
      const got = {
        total: row.total,
        payable: row.payable,
        discount: row.discount,
        recurring: row.recurring,
        paypal: row.paypal,
        windowOpen: row.windowOpen
      };
      expectEqual(row.label, got, want, failures);
    }
  }
  await checkVisible(port, failures);
} finally {
  server.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('checkout total checks passed (no PayPal transaction)');
