/**
 * Authoritative cart quote. Prices come from shared/catalog.js.
 * Caller-supplied prices are ignored because this module never reads them.
 */
import { ALIASES, CATALOG, DISCOUNT } from './catalog.js';

export function resolveSlug(slug) {
  const key = String(slug || '');
  return ALIASES[key] || key;
}

export function nyStamp(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: DISCOUNT.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = {};
  fmt.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
  });
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return parts.year + parts.month + parts.day + hour + parts.minute;
}

export function discountWindowOpen(date) {
  const stamp = nyStamp(date);
  return stamp >= DISCOUNT.windowStart && stamp <= DISCOUNT.windowEnd;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function money(cents) {
  return (cents / 100).toFixed(2);
}

function fail(error) {
  return { ok: false, error };
}

/**
 * lines: [{ slug, qty }] only. Extra fields on a line must already have been rejected.
 * now: Date used for the discount window.
 * discountCode: raw string, or empty.
 */
export async function quoteCart(lines, { now = new Date(), discountCode = '' } = {}) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 30) return fail('invalid_items');
  const qtyBySlug = new Map();
  for (const line of lines) {
    if (!line || typeof line.slug !== 'string' || !/^[a-z0-9-]+$/.test(line.slug)) return fail('invalid_slug');
    const qty = line.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return fail('invalid_qty');
    const slug = resolveSlug(line.slug);
    const item = CATALOG[slug];
    if (!item) return fail('unknown_slug');
    const next = (qtyBySlug.get(slug) || 0) + qty;
    qtyBySlug.set(slug, item.rush ? 1 : Math.min(99, next));
  }

  let oneTimeCents = 0;
  let eligibleCents = 0;
  let recurring = false;
  for (const [slug, qty] of qtyBySlug) {
    const item = CATALOG[slug];
    if (item.rush) continue;
    if (item.recurring) {
      recurring = true;
      continue;
    }
    const lineCents = Math.round(item.price * 100) * qty;
    oneTimeCents += lineCents;
    if (DISCOUNT.slugs.includes(slug)) eligibleCents += lineCents;
  }
  const rushCents = qtyBySlug.has('rush') ? Math.round(oneTimeCents * 35 / 100) : 0;

  const normalized = String(discountCode || '').trim().toUpperCase().replace(/\s+/g, '');
  let discountCents = 0;
  if (normalized) {
    if (!DISCOUNT.enabled || !discountWindowOpen(now)) return fail('discount_inactive');
    const hex = await sha256Hex(normalized);
    if (hex !== DISCOUNT.codeSha256) return fail('discount_invalid');
    if (eligibleCents <= 0) return fail('discount_ineligible');
    discountCents = Math.round(eligibleCents * DISCOUNT.rate);
  }

  const payableCents = oneTimeCents + rushCents;
  if (payableCents <= 0 && !recurring) return fail('nothing_to_charge');

  const chargeCents = payableCents > 0 ? Math.max(0, payableCents - discountCents) : 100;
  const mode = payableCents > 0 ? 'capture' : 'deposit';
  const paypalItems = [];
  if (mode === 'deposit') {
    const names = [...qtyBySlug.keys()].map((slug) => CATALOG[slug].name).join(', ').slice(0, 100);
    paypalItems.push({ slug: 'deposit', name: ('Deposit — ' + names).slice(0, 127), unitAmount: '1.00', quantity: '1' });
  } else {
    for (const [slug, qty] of [...qtyBySlug.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
      const item = CATALOG[slug];
      if (item.recurring) continue;
      const unitCents = item.rush ? rushCents : Math.round(item.price * 100);
      if (unitCents <= 0) continue;
      paypalItems.push({
        slug,
        name: item.name.slice(0, 127),
        unitAmount: money(unitCents),
        quantity: String(item.rush ? 1 : qty)
      });
    }
  }

  const itemTotalCents = mode === 'deposit'
    ? 100
    : paypalItems.reduce((sum, item) => sum + Math.round(Number(item.unitAmount) * 100) * Number(item.quantity), 0);
  const appliedDiscount = mode === 'deposit' ? 0 : Math.min(discountCents, itemTotalCents);
  const valueCents = itemTotalCents - appliedDiscount;
  if (valueCents !== chargeCents && mode === 'capture') return fail('quote_mismatch');

  const requested = [];
  let laterRecurringCents = 0;
  for (const [slug, qty] of [...qtyBySlug.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    const item = CATALOG[slug];
    const quantity = item.rush ? 1 : qty;
    const unitCents = Math.round(Number(item.price) * 100);
    if (item.recurring) laterRecurringCents += unitCents * quantity;
    requested.push({
      slug,
      name: String(item.name).slice(0, 127),
      quantity: String(quantity),
      catalogUnitAmount: money(unitCents),
      recurring: item.recurring === true
    });
  }
  const laterRecurring = money(laterRecurringCents);
  const canonical = JSON.stringify({
    currency: 'USD',
    mode,
    value: money(valueCents),
    discount: money(appliedDiscount),
    laterRecurring,
    charge: paypalItems.map((item) => ({ slug: item.slug, quantity: item.quantity, unitAmount: item.unitAmount })),
    requested: requested.map((item) => ({
      slug: item.slug,
      quantity: item.quantity,
      catalogUnitAmount: item.catalogUnitAmount,
      recurring: item.recurring
    }))
  });
  const cartHash = await sha256Hex(canonical);
  return {
    ok: true,
    currency: 'USD',
    value: money(valueCents),
    mode,
    cartHash,
    itemTotal: money(itemTotalCents),
    discount: money(appliedDiscount),
    laterRecurring,
    requested,
    items: paypalItems
  };
}
