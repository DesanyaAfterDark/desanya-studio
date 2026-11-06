/**
 * Branded receipt page model.
 * The page address and session storage are not a payment.
 * A receipt renders only from a server body this module accepts.
 * Nothing here sends email.
 */

export const RECEIPT_BUSINESS = 'Desanya Studio';
export const RECEIPT_CONTACT = 'desanyaafterdark@gmail.com';

export function receiptLookup(href) {
  const url = new URL(href);
  const orderParam = url.searchParams.get('order') || '';
  const orderId = /^[A-Z0-9]+$/.test(orderParam) && orderParam.length <= 36 ? orderParam : '';
  const token = decodeURIComponent((url.hash || '').replace(/^#/, ''));
  return {
    orderId,
    token: /^[0-9a-f]{64}$/i.test(token) ? token : ''
  };
}

export function adoptReceiptCapability(storage, location, history) {
  const lookup = receiptLookup(location.href);
  let token = lookup.token;
  if (lookup.orderId && token && storage) {
    try { storage.setItem('desanya_receipt_' + lookup.orderId, token); } catch { /* private mode */ }
  }
  if (!token && lookup.orderId && storage) {
    try {
      const saved = storage.getItem('desanya_receipt_' + lookup.orderId) || '';
      if (/^[0-9a-f]{64}$/i.test(saved)) token = saved;
    } catch { /* private mode */ }
  }
  if (lookup.token && history && typeof history.replaceState === 'function') {
    const url = new URL(location.href);
    url.hash = '';
    history.replaceState(null, '', url.pathname + url.search);
  }
  return { orderId: lookup.orderId, token: token || '' };
}

export function receiptPageHref(orderId, token) {
  if (!/^[A-Z0-9]+$/.test(String(orderId || '')) || !/^[0-9a-f]{64}$/i.test(String(token || ''))) return '';
  return 'receipt/?order=' + encodeURIComponent(orderId) + '#' + token;
}

export function formatPaidAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

export function acceptServerReceipt(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.businessName !== RECEIPT_BUSINESS || body.contactEmail !== RECEIPT_CONTACT) return null;
  if (body.currency !== 'USD' || body.status === 'PENDING' || body.status === 'APPROVED' || body.status === 'VOIDED') return null;
  const orderId = String(body.orderId || '');
  const captureId = String(body.captureId || '');
  const amount = String(body.amount || '');
  const paidAt = String(body.paidAt || '');
  if (!/^[A-Z0-9]+$/.test(orderId) || !/^[A-Z0-9]+$/.test(captureId)) return null;
  if (!/^\d+\.\d{2}$/.test(amount) || Number(amount) <= 0) return null;
  const when = formatPaidAt(paidAt);
  if (!when) return null;
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 20) return null;
  const lines = [];
  for (const line of body.lines) {
    if (!line || typeof line !== 'object') return null;
    const name = String(line.name || '');
    const quantity = String(line.quantity || '');
    const unitAmount = String(line.unitAmount || '');
    if (!name || name.length > 127 || !/^\d+$/.test(quantity) || !/^\d+\.\d{2}$/.test(unitAmount)) return null;
    lines.push({ name, quantity, unitAmount });
  }
  let requested = null;
  if (body.requested != null) {
    if (!Array.isArray(body.requested) || body.requested.length < 1 || body.requested.length > 30) return null;
    requested = [];
    for (const line of body.requested) {
      if (!line || typeof line !== 'object' || typeof line.recurring !== 'boolean') return null;
      const name = String(line.name || '');
      const quantity = String(line.quantity || '');
      const catalogUnitAmount = String(line.catalogUnitAmount || '');
      if (!/^[a-z0-9-]+$/.test(String(line.slug || '')) || !name || name.length > 127) return null;
      if (!/^\d+$/.test(quantity) || !/^\d+\.\d{2}$/.test(catalogUnitAmount)) return null;
      requested.push({
        slug: String(line.slug),
        name,
        quantity,
        catalogUnitAmount,
        recurring: line.recurring
      });
    }
  }
  let laterRecurring = '';
  if (body.laterRecurring != null && body.laterRecurring !== '') {
    laterRecurring = String(body.laterRecurring);
    if (!/^\d+\.\d{2}$/.test(laterRecurring) || Number(laterRecurring) <= 0) return null;
  }
  return {
    orderId,
    captureId,
    paidAt,
    paidAtLabel: when,
    currency: 'USD',
    amount,
    lines,
    requested,
    laterRecurring,
    businessName: RECEIPT_BUSINESS,
    contactEmail: RECEIPT_CONTACT
  };
}

export function viewReceipt({ apiConfigured, lookup, serverBody, serverError }) {
  if (!apiConfigured) return { state: 'unavailable' };
  if (!lookup || !lookup.orderId || !lookup.token) return { state: 'needs_link' };
  if (serverError || !serverBody) return { state: 'error' };
  const receipt = acceptServerReceipt(serverBody);
  if (!receipt) return { state: 'error' };
  return { state: 'receipt', receipt };
}

const COPY = {
  unavailable: 'A server receipt is not available from this page yet. Checkout is not using the order service. A note saved in this browser is not this receipt.',
  needs_link: 'This page needs a receipt link from a confirmed payment. The address alone is not a receipt.',
  error: 'The order service did not confirm this receipt. Nothing on this page was paid from the address or from saved browser data. Paying again will not retry from here.',
  screenNote: 'PayPal may send its own payment notification. That message is separate from this page. This page does not email a receipt, and it does not guarantee that an email arrives. To keep a file, use Print or save as PDF and choose Save as PDF in the print dialog. This page removes the receipt token from the address after it is stored in this browser, so a later print of that address does not include the token. The browser’s own header and footer are outside this page: styles cannot turn them off. The order id can still be printed there. Reloading this browser still uses the stored token. The printed address alone is not enough to open the receipt.'
};

export function applyReceiptView(doc, model) {
  const status = doc.getElementById('receipt-status');
  const sheet = doc.getElementById('receipt-sheet');
  const heading = doc.getElementById('page-heading');
  if (!status || !sheet || !heading) return;
  const retry = doc.getElementById('receipt-retry');
  sheet.hidden = model.state !== 'receipt';
  status.hidden = model.state === 'receipt';
  if (retry) retry.hidden = model.state !== 'error';
  if (model.state !== 'receipt') {
    status.textContent = COPY[model.state] || COPY.error;
    heading.textContent = 'Receipt unavailable';
    doc.title = 'Receipt unavailable — Desanya Studio';
    return;
  }
  const receipt = model.receipt;
  heading.textContent = 'Receipt';
  doc.title = 'Receipt — Desanya Studio';
  doc.getElementById('receipt-business').textContent = receipt.businessName;
  doc.getElementById('receipt-contact').textContent = receipt.contactEmail;
  doc.getElementById('receipt-contact').setAttribute('href', 'mailto:' + receipt.contactEmail);
  doc.getElementById('receipt-order').textContent = receipt.orderId;
  doc.getElementById('receipt-capture').textContent = receipt.captureId;
  doc.getElementById('receipt-date').textContent = receipt.paidAtLabel;
  doc.getElementById('receipt-amount').textContent = 'USD ' + receipt.amount;
  const future = doc.getElementById('receipt-future');
  const later = doc.getElementById('receipt-later');
  const futureLines = doc.getElementById('receipt-future-lines');
  if (future && later && futureLines) {
    const recurring = (receipt.requested || []).filter((line) => line.recurring);
    if (receipt.laterRecurring && recurring.length) {
      future.hidden = false;
      later.textContent = 'USD ' + receipt.laterRecurring + ' is billed later and is not included in the amount paid.';
      futureLines.replaceChildren();
      for (const line of recurring) {
        futureLines.appendChild(labeledRow(doc, [
          ['Requested service', line.name],
          ['Qty', line.quantity],
          ['Catalog price', 'USD ' + line.catalogUnitAmount]
        ]));
      }
    } else {
      future.hidden = true;
      later.textContent = '';
      futureLines.replaceChildren();
    }
  }
  const body = doc.getElementById('receipt-lines');
  body.replaceChildren();
  for (const line of receipt.lines) {
    body.appendChild(labeledRow(doc, [
      ['Item', line.name],
      ['Qty', line.quantity],
      ['Unit price', 'USD ' + line.unitAmount]
    ]));
  }
  doc.getElementById('receipt-screen-note').textContent = COPY.screenNote;
}

function labeledRow(doc, pairs) {
  const row = doc.createElement('tr');
  for (const [label, value] of pairs) {
    const cell = doc.createElement('td');
    const name = doc.createElement('span');
    name.className = 'receipt-cell-label';
    name.textContent = label;
    cell.appendChild(name);
    cell.appendChild(doc.createTextNode(value));
    row.appendChild(cell);
  }
  return row;
}

export function loadReceiptPage(doc, location, { apiConfigured, fetchImpl, token }) {
  const fromAddress = receiptLookup(location.href);
  const lookup = { orderId: fromAddress.orderId, token: fromAddress.token || token || '' };
  const printButton = doc.getElementById('receipt-print');
  if (printButton && !printButton.dataset.bound) {
    printButton.dataset.bound = '1';
    printButton.addEventListener('click', () => window.print());
  }
  const retry = doc.getElementById('receipt-retry');
  if (retry && !retry.dataset.bound) {
    retry.dataset.bound = '1';
    retry.addEventListener('click', () => loadReceiptPage(doc, location, { apiConfigured, fetchImpl, token: lookup.token }));
  }
  if (!apiConfigured || !lookup.orderId || !lookup.token) {
    applyReceiptView(doc, viewReceipt({ apiConfigured, lookup, serverBody: null, serverError: false }));
    return Promise.resolve();
  }
  const endpoint = String(doc.body.dataset.orderApi || '').replace(/\/$/, '') + '/v1/orders/' + encodeURIComponent(lookup.orderId) + '/receipt';
  return Promise.resolve(fetchImpl(endpoint, {
    method: 'GET',
    credentials: 'omit',
    headers: { 'receipt-token': lookup.token }
  })).then(async (response) => {
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    applyReceiptView(doc, viewReceipt({
      apiConfigured: true,
      lookup,
      serverBody: response.ok ? body : null,
      serverError: !response.ok
    }));
  }).catch(() => {
    applyReceiptView(doc, viewReceipt({ apiConfigured: true, lookup, serverBody: null, serverError: true }));
  });
}

if (typeof window !== 'undefined') {
  window.DesanyaReceipt = {
    receiptPageHref,
    receiptLookup,
    adoptReceiptCapability,
    acceptServerReceipt,
    viewReceipt,
    applyReceiptView,
    loadReceiptPage
  };
}
