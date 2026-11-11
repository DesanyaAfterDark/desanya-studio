/**
 * Build a static sandbox preview for http://localhost:8080.
 * The live checkout constants stay in the repository. This script only
 * writes a separate folder and zip. It does not call PayPal.
 */
import { CATALOG } from '../shared/catalog.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2];
const zipPath = process.argv[3];
if (!outDir || !zipPath) {
  console.error('usage: node tools/build-sandbox-preview.mjs <out-dir> <zip-path>');
  process.exit(1);
}

const ORDER_API = 'https://desanya-order-api-sandbox.desanya-studio.workers.dev';
const checkoutSource = readFileSync(join(root, 'checkout.html'), 'utf8');
const liveMatch = checkoutSource.match(/live:\s*'([^']+)'/);
if (!liveMatch) throw new Error('could not find the live client id marker to exclude it');
const liveId = liveMatch[1];
const liveHash = createHash('sha256').update(liveId).digest('hex');

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'shared'), { recursive: true });
mkdirSync(join(outDir, 'receipt'), { recursive: true });
mkdirSync(join(outDir, 'assets'), { recursive: true });

for (const file of ['site.js', 'chat-widget.js']) {
  cpSync(join(root, file), join(outDir, file));
}
for (const file of ['order-client.js', 'receipt-view.js']) {
  cpSync(join(root, 'shared', file), join(outDir, 'shared', file));
}
cpSync(join(root, 'assets'), join(outDir, 'assets'), { recursive: true });

function stripTrackers(html) {
  return html.replace(/<!-- Google tag \(gtag\.js\) -->[\s\S]*?gtag\('config', 'G-K3MKEG3RFH'\);\s*<\/script>/g, '');
}

let checkout = stripTrackers(checkoutSource);
const constants = `    var PAYPAL_MODE = 'live'; // 'sandbox' | 'live'
    var PAYPAL_CLIENT_IDS = {
      sandbox: 'sb',                       // PayPal sandbox placeholder — replace with sandbox client ID
      live: '${liveId}'
    };
    /* Production order Worker. Do not put a secret here. A non-empty value
       that fails does not fall back to a browser-calculated price. */
    var PAYPAL_ORDER_API = 'https://desanya-order-api.desanya-studio.workers.dev';`;
const sandboxConstants = `    var PAYPAL_MODE = 'sandbox';
    var PAYPAL_ORDER_API = (window.DESANYA_SANDBOX_PUBLIC && window.DESANYA_SANDBOX_PUBLIC.orderApi) || '${ORDER_API}';
    var PAYPAL_PUBLIC_CLIENT_ID = (window.DESANYA_SANDBOX_PUBLIC && window.DESANYA_SANDBOX_PUBLIC.paypalClientId) || '';`;
if (!checkout.includes(constants)) throw new Error('checkout constants block was not found');
checkout = checkout.replace(constants, sandboxConstants);
checkout = checkout.replace(
  '  <script>\n    /* ============================================================',
  '  <script src="sandbox-public-config.js"></script>\n  <script>\n    /* ============================================================'
);
const loader = `      var mode = (typeof PAYPAL_MODE !== 'undefined' && PAYPAL_MODE === 'live') ? 'live' : 'sandbox';
      var clientId = PAYPAL_CLIENT_IDS[mode] || 'sb';
      var s = document.createElement('script');
      s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(clientId) +
              '&currency=USD&intent=capture&components=buttons';
      s.defer = true;
      s.onload = initPayPal;
      document.head.appendChild(s);`;
const sandboxLoader = `      var clientId = String(PAYPAL_PUBLIC_CLIENT_ID || '').trim();
      var placeholder = !clientId || clientId === 'sb' || clientId === 'REPLACE_WITH_SANDBOX_CLIENT_ID';
      function showNotReady(message) {
        var err = document.getElementById('checkout-error');
        if (!err) return;
        err.hidden = false;
        err.textContent = message;
      }
      function startSdk(id) {
        if (PAYPAL_MODE !== 'sandbox') {
          showNotReady('NOT READY. This preview only runs with PAYPAL_MODE sandbox.');
          return;
        }
        var note = document.getElementById('sandbox-preview-status');
        if (note) note.hidden = true;
        var s = document.createElement('script');
        s.src = 'https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(id) +
                '&currency=USD&intent=capture&components=buttons';
        s.defer = true;
        s.onload = initPayPal;
        document.head.appendChild(s);
      }
      if (placeholder) {
        showNotReady('NOT READY. PayPal will not load until sandbox-public-config.js has Finance\\'s public sandbox client id. Do not paste the live website client id or the client secret.');
      } else {
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientId)).then(function (buf) {
          var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return b.toString(16).padStart(2, '0');
          }).join('');
          if (hex === '${liveHash}') {
            showNotReady('NOT READY. That value is the live website client id. Use the public sandbox client id from the same app as the worker. Do not paste the client secret.');
            return;
          }
          startSdk(clientId);
        });
      }`;
if (!checkout.includes(loader)) throw new Error('SDK loader block was not found');
checkout = checkout.replace(loader, sandboxLoader);
checkout = checkout.replace(
  '<main id="main">',
  '<main id="main">\n      <p id="sandbox-preview-status" role="status" style="margin:1rem auto;max-width:42rem;padding:1rem;border:2px solid #f5c04a;">NOT READY. PayPal will not load until sandbox-public-config.js has the public sandbox client id. Do not paste the live website client id or the client secret.</p>'
);
if (checkout.includes(liveId) || checkout.includes('PAYPAL_CLIENT_SECRET')) {
  throw new Error('checkout preview still contains a forbidden value');
}
if (!checkout.includes("var PAYPAL_MODE = 'sandbox';") || !checkout.includes(ORDER_API)) {
  throw new Error('checkout preview is missing sandbox settings');
}
if (!checkout.includes('order-client.js') || !checkout.includes('receiptPageHref')) {
  throw new Error('checkout preview lost the SDK handoff');
}
writeFileSync(join(outDir, 'checkout.html'), checkout);

let receipt = stripTrackers(readFileSync(join(root, 'receipt/index.html'), 'utf8'));
if (!receipt.includes("var api = 'https://desanya-order-api.desanya-studio.workers.dev';")) throw new Error('receipt api constant was not found');
receipt = receipt.replace(
  '<script type="module" src="/shared/receipt-view.js?v=3"></script>',
  '<script src="/sandbox-public-config.js"></script>\n  <script type="module" src="/shared/receipt-view.js?v=3"></script>'
);
receipt = receipt.replace(
  `    var api = 'https://desanya-order-api.desanya-studio.workers.dev';
    document.body.dataset.orderApi = api;`,
  `    var api = (window.DESANYA_SANDBOX_PUBLIC && window.DESANYA_SANDBOX_PUBLIC.orderApi) || '${ORDER_API}';
    document.body.dataset.orderApi = api;`
);
if (receipt.includes(liveId) || receipt.includes('PAYPAL_CLIENT_SECRET') || receipt.includes("var api = 'https://desanya-order-api.desanya-studio.workers.dev';")) {
  throw new Error('receipt preview is not sandbox-only');
}
writeFileSync(join(outDir, 'receipt/index.html'), receipt);

const serviceItems = Object.entries(CATALOG).sort((a, b) => a[1].name < b[1].name ? -1 : 1);
const serviceList = serviceItems.map(([slug, item]) => {
  const price = item.recurring ? '$' + item.price + '/mo' : '$' + item.price;
  const safeName = String(item.name).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  return `<li><button type="button" data-add-to-cart="${slug}">Add ${safeName}</button> <span>${price}</span></li>`;
}).join('\n');
mkdirSync(join(outDir, 'services'), { recursive: true });
writeFileSync(join(outDir, 'services/index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sandbox services — Desanya Studio</title>
  <meta name="robots" content="noindex">
  <link rel="stylesheet" href="/assets/site.min.css?v=39">
</head>
<body>
  <main id="main" class="container" style="padding:2rem 1rem 6rem">
    <p class="eyebrow">Sandbox preview</p>
    <h1>Services</h1>
    <p>This page is only for the localhost sandbox preview. It uses the same catalog and cart as checkout. It is not desanya.tech.</p>
    <p><a class="btn btn-primary" href="/checkout.html">Go to checkout</a> <button type="button" class="btn btn-secondary" data-cart-open>Open cart</button></p>
    <ul>
${serviceList}
    </ul>
  </main>
  <script src="/assets/cart.js?v=10"></script>
</body>
</html>
`);

writeFileSync(join(outDir, 'sandbox-public-config.js'), `/* Public sandbox settings for this preview only.
   Edit this file in the unzipped folder. Do not edit the git repository.
   paypalClientId is the public client id of Finance's sandbox REST app.
   It must be the same public id as the worker's PAYPAL_CLIENT_ID.
   Leave it empty until that id is supplied. The preview will not load PayPal
   while it is empty.
   Do not put PAYPAL_CLIENT_SECRET in this file.
   Do not put the live desanya.tech client id in this file.
*/
window.DESANYA_SANDBOX_PUBLIC = {
  paypalClientId: "",
  orderApi: "${ORDER_API}"
};
`);

writeFileSync(join(outDir, 'README.md'), `# Desanya sandbox preview

Static files for http://localhost:8080. This folder is not a git checkout.
It does not contain the PayPal client secret. It does not contain the live website client id.

The PayPal button is NOT READY until \`sandbox-public-config.js\` has the public sandbox client id.

Worker expected with this preview: commit 72528fa4d4a1b69c215b901237b97aa47a2a9667.
Bundle SHA256 6cdd57a97b1ce1c4d62b1b736d25a34a104c83ee585af1e668fa8238fb6cab00.
This preview was packed from git ${commit}. It does not deploy the worker.

## Supply the public client id

1. Open \`sandbox-public-config.js\` in this folder.
2. Set \`paypalClientId\` to the public client id Finance holds for the sandbox REST app.
3. Save the file. Do not commit it and do not paste the client secret.
4. \`orderApi\` is already \`https://desanya-order-api-sandbox.desanya-studio.workers.dev\`.

The checkout page reads that file in the browser. While \`paypalClientId\` is empty, the page says NOT READY and does not load the PayPal script.

A new cart create does not send an owner secret. The worker returns one once. A later create for a cart this worker already accepted sends the secret stored for that cart, or tries the owner secrets already saved in this browser after a 401. The idempotency key is not replaced. If none of those secrets match, the result stays 401 and no second PayPal order is started.

## Worker settings this browser needs

On the isolated sandbox worker, not the live site:

- \`PAYPAL_API_BASE\` = \`https://api-m.sandbox.paypal.com\`
- \`PAYPAL_CLIENT_ID\` = the same public sandbox client id as \`paypalClientId\`
- \`PAYPAL_CLIENT_SECRET\` stays in the worker secret store only
- \`ALLOWED_ORIGINS\` includes \`http://localhost:8080\`
- \`ORDER_BINDING_SECRET\` stays in the worker secret store

## Launch

From this folder:

\`\`\`
python3 -m http.server 8080 --bind 127.0.0.1
\`\`\`

Open http://localhost:8080/services/ to add a catalog service, then http://localhost:8080/checkout.html

There is no separate cart helper. \`services/index.html\` is the storefront entry.

The button uses PayPal's JavaScript SDK. Approval stays in the SDK popup and returns through \`onApprove\`. This preview does not add \`return_url\`. After a completed worker capture, the page opens the receipt with the receipt token in the address hash. The owner secret stays in session storage and is sent only as the \`order-owner\` header.

A reload in the same browser can show the receipt again because the token is stored in session storage. This package does not audit PayPal for a duplicate capture on reload. Do not describe a repeated receipt display as proof that PayPal was not called again.

The receipt page removes the token from the address after storing it. Printing then uses an address without the token. Browsers can still print the remaining address in their own header or footer. Page CSS cannot turn that browser setting off.

A successful SDK payment, worker capture, and receipt page in this browser was reported separately by Finance for three sandbox orders. This package does not repeat that test.

## What this is not

Not a live cutover. \`desanya.tech\` checkout is unchanged. Do not point production at this worker.
`);

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === '.git') throw new Error('.git was copied');
    if (statSync(path).isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

const files = walk(outDir);
for (const file of files) {
  if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.webp') || file.endsWith('.ico') || file.endsWith('.woff2')) continue;
  const text = readFileSync(file, 'utf8');
  if (text.includes(liveId) || text.includes('sandbox-test-secret')) {
    throw new Error(relative(outDir, file) + ' contains a forbidden value');
  }
  if (/PAYPAL_CLIENT_SECRET\s*[:=]\s*['"][^'"]+['"]/.test(text)) {
    throw new Error(relative(outDir, file) + ' assigns a client secret');
  }
}
const configText = readFileSync(join(outDir, 'sandbox-public-config.js'), 'utf8');
if (!configText.includes('paypalClientId: ""') || !configText.includes(ORDER_API)) {
  throw new Error('config injection point is missing');
}
const client = readFileSync(join(outDir, 'shared/order-client.js'), 'utf8');
if (!client.includes('order-owner') || !client.includes('desanya_owner_')) {
  throw new Error('owner header plumbing missing');
}

const tmpZip = '/tmp/desanya-sandbox-preview-pack.zip';
rmSync(tmpZip, { force: true });
execFileSync('zip', ['-r', '-X', tmpZip, '.'], { cwd: outDir });
mkdirSync(dirname(zipPath), { recursive: true });
cpSync(tmpZip, zipPath);
const zipHash = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
writeFileSync(zipPath + '.sha256', zipHash + '  ' + zipPath.split('/').pop() + '\n');
console.log('preview files', files.length);
console.log('ZIP_SHA256', zipHash);
console.log('ZIP', zipPath);
console.log('SOURCE', commit);
