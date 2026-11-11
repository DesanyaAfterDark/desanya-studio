/**
 * Receipt page authorization. No network, no PayPal capture, no email send.
 * Forged address values and session storage are not a receipt.
 */
import { readFileSync } from 'node:fs';
import {
  acceptServerReceipt,
  adoptReceiptCapability,
  applyReceiptView,
  formatPaidAt,
  loadReceiptPage,
  RECEIPT_CONTACT,
  receiptLookup,
  receiptPageHref,
  viewReceipt
} from '../shared/receipt-view.js';
import { RECEIPT_CONTACT as ledgerContact } from '../worker/src/ledger.js';

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

const forged = 'https://desanya.tech/receipt/?order=FAKEORDER&amount=0.01&status=COMPLETED&capture=FAKECAP&items=Website&email=buyer@example.com&date=1999-01-01#not-a-token';
const lookup = receiptLookup(forged);
expectEqual('forged address keeps only a valid order id', lookup, { orderId: 'FAKEORDER', token: '' });
expectEqual('forged amount is not part of the lookup', JSON.stringify(lookup).includes('0.01'), false);

const blocked = viewReceipt({
  apiConfigured: false,
  lookup,
  serverBody: { amount: '0.01', status: 'COMPLETED', orderId: 'FAKEORDER', captureId: 'FAKECAP' },
  serverError: false
});
expectEqual('inactive api does not render a forged receipt', blocked, { state: 'unavailable' });

const server = {
  orderId: 'TESTORDER1',
  captureId: 'TESTCAPTURE1',
  paidAt: '2026-11-05T22:00:00.000Z',
  currency: 'USD',
  amount: '900.00',
  lines: [{ name: 'Website — Basic', quantity: '1', unitAmount: '900.00' }],
  businessName: 'Desanya Studio',
  contactEmail: 'desanyaafterdark@gmail.com',
  payer: { email_address: 'buyer@example.com' },
  status: 'COMPLETED'
};
const accepted = acceptServerReceipt(server);
expectEqual('server receipt drops the payer and keeps the catalog amount', {
  amount: accepted && accepted.amount,
  item: accepted && accepted.lines[0].name,
  contact: accepted && accepted.contactEmail,
  payer: accepted && accepted.payer || null
}, { amount: '900.00', item: 'Website — Basic', contact: 'desanyaafterdark@gmail.com', payer: null });
expectEqual('paid date is America/New_York', formatPaidAt(server.paidAt).includes('2026') && formatPaidAt(server.paidAt).includes('EST'), true);
expectEqual('wrong business contact is rejected', acceptServerReceipt({ ...server, contactEmail: 'buyer@example.com' }), null);
expectEqual('pending status is rejected', acceptServerReceipt({ ...server, status: 'PENDING', amount: '900.00' }), null);

const token = 'ab'.repeat(32);
expectEqual('receipt link keeps the token out of the query', receiptPageHref('TESTORDER1', token), 'receipt/?order=TESTORDER1#' + token);
expectEqual('bad token does not build a link', receiptPageHref('TESTORDER1', 'short'), '');

const shown = viewReceipt({
  apiConfigured: true,
  lookup: { orderId: 'TESTORDER1', token },
  serverBody: server,
  serverError: false
});
expectEqual('verified model uses the server amount', shown.state === 'receipt' && shown.receipt.amount, '900.00');
const failed = viewReceipt({
  apiConfigured: true,
  lookup: { orderId: 'TESTORDER1', token },
  serverBody: null,
  serverError: true
});
expectEqual('a failed receipt fetch has no amount', failed, { state: 'error' });
const mixedModel = viewReceipt({
  apiConfigured: true,
  lookup: { orderId: 'MIXEDORD01', token },
  serverBody: {
    ...server,
    orderId: 'MIXEDORD01',
    captureId: 'CAPMIXED01',
    amount: '900.00',
    lines: [{ name: 'Website — Basic', quantity: '1', unitAmount: '900.00' }],
    laterRecurring: '99.00',
    requested: [
      { slug: 'monthly-care', name: 'Monthly care — Basic', quantity: '1', catalogUnitAmount: '99.00', recurring: true },
      { slug: 'website-basic', name: 'Website — Basic', quantity: '1', catalogUnitAmount: '900.00', recurring: false }
    ]
  },
  serverError: false
});
expectEqual('later monthly is not added to the amount paid', {
  amount: mixedModel.receipt && mixedModel.receipt.amount,
  later: mixedModel.receipt && mixedModel.receipt.laterRecurring
}, { amount: '900.00', later: '99.00' });

function node(id) {
  return {
    id,
    hidden: false,
    textContent: '',
    dataset: {},
    children: [],
    setAttribute() {},
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    addEventListener(type, fn) {
      this.listeners = this.listeners || {};
      this.listeners[type] = fn;
    }
  };
}
function fakeDocument() {
  const nodes = {};
  for (const id of ['receipt-status', 'receipt-sheet', 'page-heading', 'receipt-business', 'receipt-contact', 'receipt-order', 'receipt-capture', 'receipt-date', 'receipt-amount', 'receipt-lines', 'receipt-screen-note', 'receipt-print', 'receipt-retry']) {
    nodes[id] = node(id);
  }
  return {
    title: '',
    body: { dataset: { orderApi: 'https://orders.example.com' } },
    getElementById(id) { return nodes[id]; },
    createElement() { return node(''); },
    createTextNode(text) { return { textContent: String(text), children: [] }; }
  };
}

const doc = fakeDocument();
const urls = [];
let failOnce = true;
globalThis.window = { print() { globalThis.window.printed = (globalThis.window.printed || 0) + 1; } };
await loadReceiptPage(doc, new URL('https://desanya.tech/receipt/?order=TESTORDER1&amount=0.01#' + token), {
  apiConfigured: true,
  fetchImpl(url, init) {
    urls.push({ url, method: init.method, token: init.headers['receipt-token'] });
    if (failOnce) {
      failOnce = false;
      return Promise.reject(new Error('down'));
    }
    return Promise.resolve(new Response(JSON.stringify(server), { status: 200 }));
  }
});
expectEqual('first fetch failure shows no forged amount', {
  status: doc.getElementById('receipt-status').textContent.includes('0.01'),
  sheet: doc.getElementById('receipt-sheet').hidden,
  retry: doc.getElementById('receipt-retry').hidden,
  calls: urls.map((item) => item.method + ' ' + item.url)
}, { status: false, sheet: true, retry: false, calls: ['GET https://orders.example.com/v1/orders/TESTORDER1/receipt'] });
await doc.getElementById('receipt-retry').listeners.click();
expectEqual('retry checks the receipt and does not capture', {
  methods: urls.map((item) => item.method),
  capture: urls.some((item) => item.url.includes('/capture')),
  amount: doc.getElementById('receipt-amount').textContent
}, { methods: ['GET', 'GET'], capture: false, amount: 'USD 900.00' });
doc.getElementById('receipt-print').listeners.click();
expectEqual('print button calls window.print', globalThis.window.printed, 1);
const paidCell = doc.getElementById('receipt-lines').children[0].children[0];
expectEqual('each paid cell names its field', paidCell.children[0].textContent, 'Item');

const capability = 'cd'.repeat(32);
const stored = new Map();
const memory = {
  setItem(key, value) { stored.set(key, value); },
  getItem(key) { return stored.has(key) ? stored.get(key) : null; }
};
let address = 'http://localhost:8080/receipt/?order=ORDER123&amount=0.01#' + capability;
const history = { replaceState(_state, _title, next) { address = 'http://localhost:8080' + next; } };
const location = { get href() { return address; } };
const adopted = adoptReceiptCapability(memory, location, history);
expectEqual('token leaves the address and stays available for reload', {
  token: adopted.token,
  addressHasToken: address.includes(capability),
  address: address
}, {
  token: capability,
  addressHasToken: false,
  address: 'http://localhost:8080/receipt/?order=ORDER123&amount=0.01'
});
const reloaded = adoptReceiptCapability(memory, { href: address }, history);
expectEqual('reload without the token in the address still finds it', reloaded.token, capability);
const privacy = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
const footer = readFileSync(new URL('../partials/footer.html', import.meta.url), 'utf8');
expectEqual('receipt contact matches the public studio address', {
  page: RECEIPT_CONTACT,
  ledger: ledgerContact,
  privacy: privacy.includes('mailto:' + RECEIPT_CONTACT),
  footer: footer.includes('mailto:' + RECEIPT_CONTACT)
}, { page: 'desanyaafterdark@gmail.com', ledger: 'desanyaafterdark@gmail.com', privacy: true, footer: true });

const page = readFileSync(new URL('../receipt/index.html', import.meta.url), 'utf8');
const checkout = readFileSync(new URL('../checkout.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/receipt.css', import.meta.url), 'utf8');
expectEqual('receipt page does not read the browser payment note', page.includes('desanya_last_order'), false);
expectEqual('receipt page keeps the capability out of the printed address', page.includes('adoptReceiptCapability'), true);
expectEqual('receipt api points at the production worker', page.includes("var api = 'https://desanya-order-api.desanya-studio.workers.dev';"), true);
expectEqual('print control is a button', page.includes('id="receipt-print"') && page.includes('type="button"'), true);
expectEqual('print css hides the site chrome', css.includes('@media print') && css.includes('.desanya-chat') && css.includes('window.print') === false, true);
expectEqual('browser checkout still uses the thanks note', checkout.includes("window.location.href = 'thanks/#receipt'"), true);
expectEqual('server checkout hands off to the receipt page', checkout.includes('receiptPageHref'), true);
expectEqual('checkout api points at the production worker', checkout.includes("var PAYPAL_ORDER_API = 'https://desanya-order-api.desanya-studio.workers.dev';"), true);
expectEqual('order and receipt modules are cache-busted', checkout.includes('shared/order-client.js?v=4') && checkout.includes('shared/receipt-view.js?v=3') && page.includes('/shared/receipt-view.js?v=3'), true);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('receipt page checks passed (no PayPal capture, no email send)');
