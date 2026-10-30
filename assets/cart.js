/**
 * Desanya Studio — Cart
 * Slide-out cart drawer + localStorage persistence.
 * Exposed as window.DesanyaCart.
 *
 * Usage:
 *   DesanyaCart.add('website');            // add by catalog slug
 *   DesanyaCart.add('website', 2);         // add 2
 *   DesanyaCart.remove('website');
 *   DesanyaCart.setQty('website', 3);
 *   DesanyaCart.clear();
 *   DesanyaCart.getItems();  // [{slug,name,price,qty,recurring}, ...]
 *   DesanyaCart.getTotal();  // number
 *   DesanyaCart.getCount();  // total quantity
 *   DesanyaCart.open(); DesanyaCart.close();
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'desanya_cart_v1';

  /* ------------------------------------------------------------------ */
  /* Service catalog — mirrors the order form on contact.html            */
  /* recurring: true  => billed monthly; arranged after checkout        */
  /* ------------------------------------------------------------------ */
  var CATALOG = {
    'ad-landing-basic':       { name: 'Ad landing page — Basic', price: 400, recurring: false },
    'ad-landing-standard':    { name: 'Ad landing page — Standard', price: 600, recurring: false },
    'ad-landing-premium':     { name: 'Ad landing page — Premium', price: 900, recurring: false },
    'ai-setup-basic':         { name: 'AI setup — Basic', price: 400, recurring: false },
    'ai-setup-standard':      { name: 'AI setup — Standard', price: 750, recurring: false },
    'ai-setup-premium':       { name: 'AI setup — Premium', price: 1200, recurring: false },
    'ai-managing-basic':      { name: 'AI managing — Basic', price: 150, recurring: true },
    'ai-managing-standard':   { name: 'AI managing — Standard', price: 200, recurring: true },
    'ai-managing-premium':    { name: 'AI managing — Premium', price: 250, recurring: true },
    'ai-search-basic':        { name: 'AI search & site audit — Basic', price: 150, recurring: false },
    'ai-search-standard':     { name: 'AI search & site audit — Standard', price: 300, recurring: false },
    'ai-search-premium':      { name: 'AI search & site audit — Premium', price: 500, recurring: false },
    'blog-basic':             { name: 'Blog writing — Basic', price: 120, recurring: false },
    'blog-standard':          { name: 'Blog writing — Standard', price: 200, recurring: false },
    'blog-monthly':           { name: 'Blog writing — Premium (monthly)', price: 700, recurring: true },
    'brand-refresh':          { name: 'Brand refresh kit', price: 450, recurring: false },
    'canva-basic':            { name: 'Canva social template pack — Basic', price: 150, recurring: false },
    'canva-standard':         { name: 'Canva social template pack — Standard', price: 275, recurring: false },
    'canva-premium':          { name: 'Canva social template pack — Premium', price: 400, recurring: false },
    'email-basic':            { name: 'Email newsletter template — Basic', price: 125, recurring: false },
    'email-standard':         { name: 'Email newsletter template — Standard', price: 350, recurring: false },
    'email-premium':          { name: 'Email newsletter template — Premium', price: 600, recurring: false },
    'extra-page':             { name: 'Extra page', price: 200, recurring: false },
    'extra-revision':         { name: 'Extra revision round', price: 40, recurring: false },
    'gbp-basic':              { name: 'Google Business Profile tune-up — Basic', price: 150, recurring: false },
    'gbp-standard':           { name: 'Google Business Profile tune-up — Standard', price: 250, recurring: false },
    'gbp-premium':            { name: 'Google Business Profile tune-up — Premium', price: 400, recurring: false },
    'monthly-care':           { name: 'Monthly care — Basic', price: 99, recurring: true },
    'monthly-care-plus':      { name: 'Monthly care — Plus', price: 179, recurring: true },
    'photo-basic':            { name: 'Photo & gallery polish — Basic', price: 150, recurring: false },
    'photo-standard':         { name: 'Photo & gallery polish — Standard', price: 300, recurring: false },
    'deck-basic':             { name: 'Pitch deck — Basic', price: 150, recurring: false },
    'deck-standard':          { name: 'Pitch deck — Standard', price: 300, recurring: false },
    'deck-premium':           { name: 'Pitch deck — Premium', price: 500, recurring: false },
    'descriptions-basic':     { name: 'Product & service descriptions — Basic', price: 60, recurring: false },
    'descriptions-standard':  { name: 'Product & service descriptions — Standard', price: 150, recurring: false },
    'descriptions-premium':   { name: 'Product & service descriptions — Premium', price: 275, recurring: false },
    'reels-basic':            { name: 'Reels pack — Basic', price: 75, recurring: false },
    'reels-standard':         { name: 'Reels pack — Standard', price: 300, recurring: false },
    'reels-premium':          { name: 'Reels pack — Premium', price: 550, recurring: false },
    'review-generation-kit':  { name: 'Review generation kit', price: 200, recurring: false },
    'rush':                   { name: 'Rush delivery', price: 0, recurring: false, rush: true },
    'seo-setup':              { name: 'SEO & Google setup', price: 550, recurring: false },
    'seo-managing':           { name: 'SEO & Google managing', price: 450, recurring: true },
    'training-basic':         { name: 'Site update training — Basic', price: 125, recurring: false },
    'training-standard':      { name: 'Site update training — Standard', price: 225, recurring: false },
    'ad-copy-basic':          { name: 'Social ad copy pack — Basic', price: 100, recurring: false },
    'ad-copy-standard':       { name: 'Social ad copy pack — Standard', price: 200, recurring: false },
    'ad-copy-premium':        { name: 'Social ad copy pack — Premium', price: 350, recurring: false },
    'social-setup':           { name: 'Social setup', price: 550, recurring: false },
    'social-managing-basic':  { name: 'Social managing — Basic', price: 350, recurring: true },
    'social-managing-standard': { name: 'Social managing — Standard', price: 600, recurring: true },
    'social-managing-premium':  { name: 'Social managing — Premium', price: 850, recurring: true },
    'website-basic':          { name: 'Website — Basic', price: 900, recurring: false },
    'website-standard':       { name: 'Website — Standard', price: 1600, recurring: false },
    'website-premium':        { name: 'Website — Premium', price: 2500, recurring: false },
    'copy-basic':             { name: 'Website copywriting — Basic', price: 150, recurring: false },
    'copy-standard':          { name: 'Website copywriting — Standard', price: 400, recurring: false }
  };

  /* Older links and saved carts map to the tier that kept the previous price. */
  var ALIASES = {
    'website': 'website-standard',
    'ad-landing-page': 'ad-landing-standard',
    'ai-setup': 'ai-setup-standard',
    'ai-managing': 'ai-managing-standard',
    'blog-post': 'blog-standard',
    'blog': 'blog-standard',
    'brand-starter-kit': 'brand-refresh',
    'content': 'copy-standard',
    'photo-gallery-polish': 'photo-standard',
    'site-update-training': 'training-basic',
    'social-managing': 'social-managing-premium'
  };

  function resolve(slug) {
    return ALIASES[slug] || slug;
  }

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  var cart = {}; // slug -> qty

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          Object.keys(data).forEach(function (key) {
            var slug = resolve(key);
            var c = CATALOG[slug];
            if (c && data[key] > 0) cart[slug] = c.rush ? 1 : Math.min(99, Math.floor(data[key]));
          });
        }
      }
    } catch (e) { /* private mode etc. — cart just won't persist */ }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); }
    catch (e) { /* ignore */ }
  }

  function money(n) {
    var v = Math.round(Number(n) * 100) / 100;
    var cents = Math.round(v * 100) % 100 !== 0;
    return '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  function rushAmount() {
    var base = 0;
    Object.keys(cart).forEach(function (slug) {
      var c = CATALOG[slug];
      if (!c || c.rush || c.recurring) return;
      base += c.price * cart[slug];
    });
    return Math.round(base * 0.35 * 100) / 100;
  }

  function linePrice(slug) {
    var c = CATALOG[slug];
    return c && c.rush ? rushAmount() : c.price;
  }

  /* ------------------------------------------------------------------ */
  /* Optional checkout code                                              */
  /* Master switch. true shows the field only inside the window.        */
  /* Window: 2026-11-27 00:00 through 2026-11-30 23:59 America/New_York. */
  /* 10% off one-time brand refresh, review kit, SEO setup, and the     */
  /* three website tiers. List prices are never changed.                */
  /* ------------------------------------------------------------------ */
  var DISCOUNTS_ENABLED = true;
  var DISCOUNT_RATE = 0.1;
  var DISCOUNT_CODE_SHA256 = '047e03726eed8fdaa6cc1eb557bc8dfe20ed547a82b9a9f14fe1c9389d7867f6';
  var DISCOUNT_SLUGS = {
    'brand-refresh': true,
    'review-generation-kit': true,
    'seo-setup': true,
    'website-basic': true,
    'website-standard': true,
    'website-premium': true
  };
  var DISCOUNT_FLAG_KEY = 'desanya_adj_v1';
  var codeApplied = false;

  function discountsEnabled() {
    return DISCOUNTS_ENABLED === true;
  }

  function nyStamp(date) {
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    var parts = {};
    fmt.formatToParts(date).forEach(function (p) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    });
    var hour = parts.hour === '24' ? '00' : parts.hour;
    return parts.year + parts.month + parts.day + hour + parts.minute;
  }

  function discountWindowOpen(date) {
    var stamp = nyStamp(date || new Date());
    return stamp >= '202611270000' && stamp <= '202611302359';
  }

  function discountLive() {
    return discountsEnabled() && discountWindowOpen();
  }

  function saveDiscountFlag() {
    try {
      if (codeApplied) sessionStorage.setItem(DISCOUNT_FLAG_KEY, '1');
      else sessionStorage.removeItem(DISCOUNT_FLAG_KEY);
    } catch (e) { /* ignore */ }
  }

  function loadDiscountFlag() {
    codeApplied = false;
    if (!discountLive()) return;
    try {
      if (sessionStorage.getItem(DISCOUNT_FLAG_KEY) === '1') codeApplied = true;
    } catch (e) { /* ignore */ }
  }

  function eligibleAmount() {
    var base = 0;
    Object.keys(cart).forEach(function (slug) {
      var c = CATALOG[slug];
      if (!c || c.recurring || c.rush || !DISCOUNT_SLUGS[slug]) return;
      base += c.price * cart[slug];
    });
    return base;
  }

  function discountAmount() {
    if (!codeApplied || !discountLive()) return 0;
    return Math.round(eligibleAmount() * DISCOUNT_RATE * 100) / 100;
  }

  function sha256Hex(text) {
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) {
      return Promise.resolve('');
    }
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  function applyDiscount(raw) {
    if (!discountLive()) {
      codeApplied = false;
      saveDiscountFlag();
      render();
      return Promise.resolve({ ok: false, reason: 'inactive' });
    }
    var code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    return sha256Hex(code).then(function (hex) {
      if (!hex || hex !== DISCOUNT_CODE_SHA256) {
        return { ok: false, reason: 'invalid' };
      }
      if (eligibleAmount() <= 0) {
        return { ok: false, reason: 'ineligible' };
      }
      codeApplied = true;
      saveDiscountFlag();
      render();
      return { ok: true };
    });
  }

  function clearDiscount() {
    codeApplied = false;
    saveDiscountFlag();
    render();
  }

  function syncDiscountField() {
    var grand = document.querySelector('.checkout-grand');
    var existing = document.getElementById('co-discount-wrap');
    if (!discountLive()) {
      if (existing) existing.remove();
      if (codeApplied) {
        codeApplied = false;
        saveDiscountFlag();
      }
      return;
    }
    if (!grand) return;
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'co-discount-wrap';
      existing.className = 'checkout-discount';
      existing.innerHTML =
        '<div class="checkout-field">' +
          '<label for="co-discount">Discount code</label>' +
          '<div class="checkout-discount-row">' +
            '<input id="co-discount" type="text" autocomplete="off" spellcheck="false" maxlength="40">' +
            '<button type="button" class="btn btn-secondary btn-small" data-discount-apply>Apply</button>' +
          '</div>' +
          '<p class="checkout-discount-msg" data-discount-msg hidden></p>' +
          '<button type="button" class="btn btn-ghost btn-small checkout-discount-clear" data-discount-clear hidden>Remove code</button>' +
        '</div>';
      grand.parentNode.insertBefore(existing, grand);
      existing.addEventListener('click', function (e) {
        if (e.target.closest('[data-discount-apply]')) submitDiscountField();
        else if (e.target.closest('[data-discount-clear]')) clearDiscount();
      });
      var input = existing.querySelector('#co-discount');
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitDiscountField();
        }
      });
    }
    var msg = existing.querySelector('[data-discount-msg]');
    var clearBtn = existing.querySelector('[data-discount-clear]');
    if (codeApplied) {
      msg.hidden = false;
      msg.textContent = 'Code applied.';
      clearBtn.hidden = false;
    } else {
      clearBtn.hidden = true;
    }
  }

  function submitDiscountField() {
    var input = document.getElementById('co-discount');
    var wrap = document.getElementById('co-discount-wrap');
    if (!input || !wrap) return;
    applyDiscount(input.value).then(function (res) {
      var msg = wrap.querySelector('[data-discount-msg]');
      if (!msg) return;
      msg.hidden = false;
      if (res.ok) {
        input.value = '';
        msg.textContent = 'Code applied.';
      } else if (res.reason === 'ineligible') {
        msg.textContent = "That code doesn't apply to this order.";
      } else {
        msg.textContent = "That code isn't valid.";
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  function add(slug, qty) {
    slug = resolve(slug);
    if (!CATALOG[slug]) return false;
    if (CATALOG[slug].rush) cart[slug] = 1;
    else {
      qty = qty == null ? 1 : Math.max(1, Math.floor(qty));
      cart[slug] = Math.min(99, (cart[slug] || 0) + qty);
    }
    save(); render();
    return true;
  }

  function remove(slug) {
    delete cart[slug];
    save(); render();
  }

  function setQty(slug, qty) {
    slug = resolve(slug);
    if (!CATALOG[slug]) return;
    qty = Math.floor(qty);
    if (qty <= 0) delete cart[slug];
    else cart[slug] = CATALOG[slug].rush ? 1 : Math.min(99, qty);
    save(); render();
  }

  function clear() {
    cart = {};
    save(); render();
  }

  function getItems() {
    return Object.keys(cart).map(function (slug) {
      var c = CATALOG[slug];
      return { slug: slug, name: c.name, price: linePrice(slug), recurring: !!c.recurring, rush: !!c.rush, qty: cart[slug] };
    });
  }

  function getPayableItems() {
    return getItems().filter(function (it) { return !it.recurring && it.price > 0; });
  }

  function getTotal() {
    var list = getItems().reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
    return Math.round((list - discountAmount()) * 100) / 100;
  }

  function getPayableTotal() {
    var list = getPayableItems().reduce(function (sum, it) { return sum + it.price * it.qty; }, 0);
    return Math.round((list - discountAmount()) * 100) / 100;
  }

  function getCount() {
    return Object.keys(cart).reduce(function (sum, slug) { return sum + cart[slug]; }, 0);
  }

  function hasRecurring() {
    return getItems().some(function (it) { return it.recurring; });
  }

  /* ------------------------------------------------------------------ */
  /* Drawer UI                                                           */
  /* ------------------------------------------------------------------ */
  var els = {};

  function buildDrawer() {
    if (document.getElementById('ds-cart-root')) return;

    var root = document.createElement('div');
    root.id = 'ds-cart-root';
    root.innerHTML =
      '<div class="ds-cart-scrim" data-cart-close aria-hidden="true"></div>' +
      '<aside class="ds-cart-drawer" role="dialog" aria-modal="true" aria-label="Shopping cart" aria-hidden="true" inert>' +
        '<div class="ds-cart-head">' +
          '<h2>Your cart</h2>' +
          '<button type="button" class="ds-cart-close" data-cart-close aria-label="Close cart">&times;</button>' +
        '</div>' +
        '<div class="ds-cart-items" data-cart-items></div>' +
        '<div class="ds-cart-foot" data-cart-foot>' +
          '<div class="ds-cart-discount" data-cart-discount hidden></div>' +
          '<div class="ds-cart-total"><span>Subtotal</span><strong data-cart-total>$0</strong></div>' +
          '<p class="ds-cart-note" data-cart-recurring-note hidden>Monthly services are billed separately after checkout — you\u2019ll only pay one-time items today.</p>' +
          '<a class="btn btn-primary ds-cart-checkout" href="/checkout.html">Checkout</a>' +
          '<button type="button" class="btn btn-ghost ds-cart-continue" data-cart-close>Continue browsing</button>' +
        '</div>' +
      '</aside>';

    document.body.appendChild(root);

    els.root = root;
    els.drawer = root.querySelector('.ds-cart-drawer');
    els.items = root.querySelector('[data-cart-items]');
    els.foot = root.querySelector('[data-cart-foot]');
    els.total = root.querySelector('[data-cart-total]');
    els.discount = root.querySelector('[data-cart-discount]');
    els.recurringNote = root.querySelector('[data-cart-recurring-note]');

    root.addEventListener('click', function (e) {
      var closeBtn = e.target.closest('[data-cart-close]');
      if (closeBtn) { close(); return; }
      var qtyBtn = e.target.closest('[data-cart-qty]');
      if (qtyBtn) {
        var slug = qtyBtn.getAttribute('data-cart-qty');
        var delta = parseInt(qtyBtn.getAttribute('data-delta'), 10) || 0;
        setQty(slug, (cart[slug] || 0) + delta);
        return;
      }
      var rmBtn = e.target.closest('[data-cart-remove]');
      if (rmBtn) { remove(rmBtn.getAttribute('data-cart-remove')); return; }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('open')) close();
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render() {
    if (!els.root) buildDrawer();
    var items = getItems();

    // Header badge
    var badges = document.querySelectorAll('[data-cart-count]');
    badges.forEach(function (b) {
      var n = getCount();
      b.textContent = n;
      b.hidden = n === 0;
    });

    // Drawer items
    if (!items.length) {
      els.items.innerHTML =
        '<div class="ds-cart-empty">' +
          '<p>No services in your cart yet.</p>' +
          '<a class="btn btn-secondary btn-small" href="/services.html">Browse services</a>' +
        '</div>';
      els.foot.style.display = 'none';
    } else {
      els.foot.style.display = '';
      els.items.innerHTML = items.map(function (it) {
        return '<div class="ds-cart-item">' +
          '<div class="ds-cart-item-info">' +
            '<strong>' + esc(it.name) + '</strong>' +
            '<span class="ds-cart-item-price">' + money(it.price) + (it.recurring ? ' /mo' : '') + '</span>' +
            (it.recurring ? '<span class="ds-cart-item-tag">billed monthly</span>' : '') +
            (it.rush ? '<span class="ds-cart-item-tag">35% of one-time items</span>' : '') +
          '</div>' +
          '<div class="ds-cart-item-qty">' +
            '<button type="button" data-cart-qty="' + esc(it.slug) + '" data-delta="-1" aria-label="Decrease quantity">&minus;</button>' +
            '<span>' + it.qty + '</span>' +
            '<button type="button" data-cart-qty="' + esc(it.slug) + '" data-delta="1" aria-label="Increase quantity">+</button>' +
          '</div>' +
          '<button type="button" class="ds-cart-item-remove" data-cart-remove="' + esc(it.slug) + '" aria-label="Remove ' + esc(it.name) + '">&times;</button>' +
        '</div>';
      }).join('');
      els.total.textContent = money(getTotal());
      els.recurringNote.hidden = !hasRecurring();
      var off = discountAmount();
      if (els.discount) {
        if (off > 0) {
          els.discount.hidden = false;
          els.discount.innerHTML = '<span>Discount</span><strong>−' + money(off) + '</strong>';
        } else {
          els.discount.hidden = true;
          els.discount.innerHTML = '';
        }
      }
    }
    syncDiscountField();
    try { document.dispatchEvent(new CustomEvent('desanya-cart-change')); }
    catch (e) { /* ignore */ }
  }

  function open() {
    if (!els.root) buildDrawer();
    render();
    els.root.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    els.drawer.removeAttribute('inert');
    document.body.classList.add('ds-cart-lock');
  }

  function close() {
    if (!els.root) return;
    els.root.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.drawer.setAttribute('inert', '');
    document.body.classList.remove('ds-cart-lock');
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */
  function placeCart() {
    var btn = document.querySelector('.ds-cart-btn');
    var nav = document.querySelector('.site-nav');
    if (!btn || !nav) return;
    if (window.innerWidth < 1160) {
      btn.style.position = '';
      btn.style.top = '';
      btn.style.right = '';
      btn.style.left = '';
      btn.style.zIndex = '';
      return;
    }
    var nr = nav.getBoundingClientRect();
    btn.style.position = 'fixed';
    btn.style.zIndex = '120';
    btn.style.top = Math.max(0, (nr.height - btn.offsetHeight) / 2) + 'px';
    btn.style.left = 'auto';
    btn.style.right = (window.innerWidth - nr.left + 12) + 'px';
  }

  function init() {
    load();
    loadDiscountFlag();
    buildDrawer();
    render();
    placeCart();
    window.addEventListener('resize', placeCart);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeCart);

    try {
      document.dispatchEvent(new CustomEvent('desanya-cart-ready'));
    } catch (e) {}

    // Open drawer from any [data-cart-open] trigger
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-cart-open]')) { open(); return; }
      // Add-to-cart buttons: <button data-add-to-cart="website">
      var addBtn = e.target.closest('[data-add-to-cart]');
      if (addBtn) {
        var slug = addBtn.getAttribute('data-add-to-cart');
        if (add(slug)) {
          open();
          if (window.gtag) {
            try { window.gtag('event', 'add_to_cart', { items: [{ item_id: slug }] }); } catch (err) {}
          }
        }
      }
    });
  }

  window.DesanyaCart = {
    catalog: CATALOG,
    add: add,
    remove: remove,
    setQty: setQty,
    clear: clear,
    getItems: getItems,
    getPayableItems: getPayableItems,
    getPayableTotal: getPayableTotal,
    getTotal: getTotal,
    getCount: getCount,
    hasRecurring: hasRecurring,
    open: open,
    close: close,
    money: money,
    getDiscount: discountAmount,
    discountsAvailable: discountLive,
    applyDiscount: applyDiscount,
    clearDiscount: clearDiscount,
    syncDiscountField: syncDiscountField
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
