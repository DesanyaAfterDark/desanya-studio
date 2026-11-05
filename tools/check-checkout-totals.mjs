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
} finally {
  server.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('checkout total checks passed (no PayPal transaction)');
