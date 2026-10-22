/**
 * Desanya Studio — link config (the only place to edit these URLs)
 *
 * TODO: googleReviewUrl
 *   Paste the Google Business Profile “Ask for reviews” link, for example
 *   https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID
 *   Leave '' until that link exists. The review button stays hidden, and the
 *   “coming soon” line stays hidden, until a real https link is pasted here.
 *
 * TODO: social
 *   Paste full https profile URLs for Desanya Studio. Leave '' to hide that icon.
 *   Instagram is https://www.instagram.com/desanyastudio/ (@desanyastudio).
 *   Facebook is https://www.facebook.com/desanyastudio.
 *   Pinterest is https://www.pinterest.com/desanyastudio/.
 *   Threads is https://www.threads.com/@desanyastudio (@desanyastudio).
 *   TikTok is https://www.tiktok.com/@desanyastudio (@desanyastudio).
 *   X and LinkedIn stay hidden until a URL is pasted here.
 *   YouTube is https://www.youtube.com/@DesanyaStudio.
 *   Permanent channel ID, if the handle ever breaks: UCwcgZihQYLXfixWSYFdqEmw.
 *   Do not paste search-result pages or placeholder profiles.
 */
var DESANYA_LINKS = {
  googleReviewUrl: 'https://www.google.com/maps/search/?api=1&query=Desanya%27s+Web+Designs+Niota+TN&query_place_id=605467311094588',
  social: {
    facebook: 'https://www.facebook.com/desanyastudio',
    instagram: 'https://www.instagram.com/desanyastudio/',
    linkedin: '',
    pinterest: 'https://www.pinterest.com/desanyastudio/',
    threads: 'https://www.threads.com/@desanyastudio',
    tiktok: 'https://www.tiktok.com/@desanyastudio',
    x: '',
    // Permanent channel ID, if this handle ever breaks: UCwcgZihQYLXfixWSYFdqEmw
    youtube: 'https://www.youtube.com/@DesanyaStudio'
  }
};

/**
 * Desanya Studio — shared site behavior (all pages)
 * Mobile nav · footer year · order prefill · reviews · social · gallery lightbox
 */
(function () {
  'use strict';

  var SOCIAL_ICONS = [
    {
      key: 'facebook',
      label: 'Desanya Studio on Facebook',
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.2 8.4V6.9c0-.7.2-1.1 1.2-1.1H16.6V3.4h-1.8C12.4 3.4 11.3 4.6 11.3 6.6v1.8H9.5v2.4h1.8V20.6h2.9v-9.8h2l.3-2.4h-2.3z"/></svg>'
    },
    {
      key: 'instagram',
      label: 'Desanya Studio on Instagram',
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17.2" cy="6.8" r="0.9" fill="currentColor"/></svg>'
    },
    {
      key: 'linkedin',
      label: 'Desanya Studio on LinkedIn',
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.4 9.1H4v10.4h2.4V9.1zM5.2 4.2c-.9 0-1.5.6-1.5 1.4s.6 1.4 1.5 1.4 1.5-.6 1.5-1.4-.6-1.4-1.5-1.4zM20 19.5h-2.4v-5.4c0-1.4-.5-2.3-1.7-2.3-.9 0-1.5.6-1.7 1.2-.1.2-.1.5-.1.8v5.7H11.7V9.1h2.3v1.4c.4-.7 1.2-1.7 2.9-1.7 2.1 0 3.1 1.4 3.1 4.1v6.6z"/></svg>'
    },
    {
      key: 'pinterest',
      label: 'Desanya Studio on Pinterest',
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.402.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.951-7.252 4.173 0 7.41 2.967 7.41 6.923 0 4.133-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24.001 12.017 24.001c6.624 0 11.99-5.367 11.99-11.988C24.007 5.367 18.641.001 12.017.001z"/></svg>'
    },
    {
      key: 'threads',
      label: 'Threads',
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.2 3.8c2.8 0 4.7 1.6 5 4l-1.9.3c-.2-1.4-1.4-2.2-3.1-2.2-2 0-3.3 1.3-3.3 3.2 0 .4.1.8.2 1.2-1.3.3-2.1 1.3-2.1 2.6 0 1.6 1.3 2.8 3.2 2.8 1.3 0 2.2-.5 2.7-1.5.3.1.6.1.9.1 1 0 1.8-.6 2-1.6h1.8c-.3 1.9-1.8 3.1-3.8 3.1-.5 0-.9-.1-1.3-.2-.7 1.2-2 1.9-3.6 1.9-2.5 0-4.3-1.7-4.3-4 0-1.7 1-3 2.6-3.5-.1-.4-.2-.8-.2-1.3 0-3 2.3-5.2 5.4-5.2zm.2 9c0 .8-.6 1.3-1.5 1.3s-1.5-.5-1.5-1.3.6-1.3 1.5-1.3 1.5.5 1.5 1.3z"/></svg>'
    },
    {
      key: 'tiktok',
      label: 'Desanya Studio on TikTok',
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.2 3h2.2a5.2 5.2 0 0 0 3.4 3.2v2.3a7.4 7.4 0 0 1-3.4-1v6.7a5.7 5.7 0 1 1-5.7-5.7c.3 0 .6 0 .9.1v2.5a3.2 3.2 0 1 0 2.2 3.1V3z"/></svg>'
    },
    {
      key: 'x',
      label: 'Desanya Studio on X',
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.6 10.4 21 3.2h-1.5l-5.6 6.2L9.4 3.2H3.8l6.7 9.7-6.7 7.9h1.5l5.9-6.9 4.7 6.9h5.6l-7-10.4zm-2.1 2.3-.7-1L6.4 4.6h2.3l4.4 6.2.7 1 5.8 8.1h-2.3l-4.8-6.2z"/></svg>'
    },
    {
      key: 'youtube',
      label: 'Desanya Studio on YouTube',
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M22.5 12.2s0-3-.4-4.3c-.2-.8-.9-1.5-1.7-1.7C18.9 5.8 12 5.8 12 5.8s-6.9 0-8.4.4c-.8.2-1.5.9-1.7 1.7C1.5 9.2 1.5 12.2 1.5 12.2s0 3 .4 4.3c.2.8.9 1.5 1.7 1.7 1.5.4 8.4.4 8.4.4s6.9 0 8.4-.4c.8-.2 1.5-.9 1.7-1.7.4-1.3.4-4.3.4-4.3zM9.9 15.3V9.1l5.8 3.1-5.8 3.1z"/></svg>'
    }
  ];

  function configuredUrl(value) {
    var url = String(value || '').trim();
    if (!url || url === '#') return '';
    if (!/^https?:\/\//i.test(url)) return '';
    return url;
  }

  /* ---------- Mobile nav ---------- */
  function initNav() {
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('siteNav');
    if (!toggle || !nav) return;

    var scrollY = 0;
    var scrollCaptured = false;
    var mobileQuery = window.matchMedia('(max-width: 820px)');

    function currentScroll() {
      return window.scrollY || window.pageYOffset || 0;
    }

    // Capture before focus. html scroll-padding plus a sticky header makes Safari
    // nudge the page when the toggle receives focus, which would lock the wrong offset.
    toggle.addEventListener('pointerdown', function () {
      if (!document.body.classList.contains('nav-open')) {
        scrollY = currentScroll();
        scrollCaptured = true;
      }
    });

    function setOpen(open) {
      var mobile = mobileQuery.matches;
      if (open && !mobile) open = false;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      nav.classList.toggle('is-open', open);
      if (mobile && !open) nav.setAttribute('aria-hidden', 'true');
      else nav.removeAttribute('aria-hidden');
      if (open) {
        if (!scrollCaptured) scrollY = currentScroll();
        scrollCaptured = false;
        document.body.style.top = '-' + scrollY + 'px';
        document.body.classList.add('nav-open');
      } else if (document.body.classList.contains('nav-open')) {
        document.body.classList.remove('nav-open');
        document.body.style.top = '';
        // html uses scroll-behavior: smooth; an animated restore flashes the top of the page.
        var root = document.documentElement;
        var previous = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(0, scrollY);
        root.style.scrollBehavior = previous;
      }
    }

    if (mobileQuery.matches) nav.setAttribute('aria-hidden', 'true');

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () { setOpen(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        toggle.focus({ preventScroll: true });
      }
    });
    mobileQuery.addEventListener('change', function () {
      setOpen(false);
    });
  }

  /* ---------- Footer year ---------- */
  function initYear() {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* ---------- Contact + order forms (FormSubmit) ---------- */
  function initUtm() {
    var params = new URLSearchParams(window.location.search);
    var form = document.getElementById('orderForm');
    if (!form) return;
    ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (key) {
      var value = String(params.get(key) || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200);
      var input = form.querySelector('input[name="' + key + '"]');
      if (input) input.value = value;
    });
  }

  function initContact() {
    var params = new URLSearchParams(window.location.search);
    var orderForm = document.getElementById('orderForm');
    var orderSelect = document.getElementById('orderService');
    if (!orderForm || !orderSelect) return;

    function orderSubject() {
      var subject = orderForm.querySelector('[data-order-subject]');
      var chosen = orderSelect.value;
      if (subject) subject.value = 'New ORDER: ' + (chosen || 'service') + ' — desanya.tech';
    }

    var slug = params.get('service');
    if (slug) {
      Array.prototype.forEach.call(orderSelect.options, function (opt) {
        if (opt.getAttribute('data-slug') === slug) orderSelect.value = opt.value;
      });
    }
    orderSelect.addEventListener('change', orderSubject);
    orderForm.addEventListener('submit', orderSubject);
    orderSubject();
  }

  /* ---------- Booking ---------- */
  function initBooking() {
    var card = document.querySelector('[data-booking-url]');
    if (!card) return;

    // A real scheduler URL turns the placeholder into a link. Anything else stays hidden, with no href.
    var url = (card.getAttribute('data-booking-url') || '').trim();
    var link = card.querySelector('[data-booking-link]');
    if (!link) return;
    if (/^https?:\/\//i.test(url)) {
      link.href = url;
      link.hidden = false;
    } else {
      link.removeAttribute('href');
      link.hidden = true;
    }

  }

  /* ---------- Google review link ---------- */
  function initReviews() {
    var reviewUrl = configuredUrl(DESANYA_LINKS.googleReviewUrl);
    document.querySelectorAll('[data-google-review]').forEach(function (block) {
      var link = block.querySelector('[data-google-review-link]');
      var pending = block.querySelector('[data-google-review-pending]');
      if (reviewUrl && link) {
        link.href = reviewUrl;
        link.hidden = false;
        if (pending) pending.hidden = true;
      } else if (link) {
        link.hidden = true;
        link.removeAttribute('href');
        if (pending) pending.hidden = true;
      }
    });

  }

  /* ---------- Social icons (only platforms with a real URL) ---------- */
  function initSocial() {
    var items = SOCIAL_ICONS.filter(function (item) {
      return configuredUrl(DESANYA_LINKS.social && DESANYA_LINKS.social[item.key]);
    });

    document.querySelectorAll('[data-social-block]').forEach(function (block) {
      var list = block.querySelector('[data-social-links]');
      if (!list) return;
      list.replaceChildren();
      if (!items.length) {
        block.hidden = true;
        return;
      }
      items.forEach(function (item) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        var url = configuredUrl(DESANYA_LINKS.social[item.key]);
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', item.label + ' (opens in a new tab)');
        a.innerHTML = item.svg;
        li.appendChild(a);
        list.appendChild(li);
      });
      block.hidden = false;
    });

    var note = document.querySelector('[data-linkedin-note]');
    var noteLink = note && note.querySelector('[data-linkedin-link]');
    var linkedin = configuredUrl(DESANYA_LINKS.social && DESANYA_LINKS.social.linkedin);
    if (note && noteLink) {
      if (linkedin) {
        noteLink.href = linkedin;
        note.hidden = false;
      } else {
        note.hidden = true;
        noteLink.removeAttribute('href');
      }
    }
  }

  /* ---------- Gallery lightbox ---------- */
  function initLightbox() {
    var dialog = document.getElementById('lightbox');
    var links = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
    if (!dialog || !links.length || typeof dialog.showModal !== 'function') return;

    var img = dialog.querySelector('[data-lb-img]');
    var cap = dialog.querySelector('[data-lb-caption]');
    var count = dialog.querySelector('[data-lb-count]');
    var prev = dialog.querySelector('[data-lb-prev]');
    var next = dialog.querySelector('[data-lb-next]');
    var index = 0;
    var opener = null;
    var active = links;
    var touchX = 0;
    var touchY = 0;
    var tracking = false;

    function ensureImg() {
      if (img) return img;
      img = document.createElement('img');
      img.className = 'lightbox-img';
      img.alt = '';
      img.decoding = 'async';
      var fig = dialog.querySelector('.lightbox-figure');
      fig.insertBefore(img, cap);
      return img;
    }

    function slideSrc(a) {
      return a.getAttribute('data-webp') || a.getAttribute('href');
    }

    function preload(i) {
      if (active.length < 2) return;
      var a = active[(i + active.length) % active.length];
      var src = slideSrc(a);
      if (!src) return;
      var ahead = new Image();
      ahead.decoding = 'async';
      ahead.src = src;
    }

    function show(i) {
      index = (i + active.length) % active.length;
      var a = active[index];
      var thumb = a.querySelector('img');
      var el = ensureImg();
      el.src = slideSrc(a);
      el.alt = (thumb && thumb.alt) || a.getAttribute('data-alt') || '';
      cap.textContent = a.getAttribute('data-caption') || '';
      if (count) count.textContent = (index + 1) + ' of ' + active.length;
      preload(index + 1);
    }

    function openSet(a) {
      var set = a.getAttribute('data-lb-set');
      active = set
        ? links.filter(function (el) { return el.getAttribute('data-lb-set') === set; })
        : links.filter(function (el) { return !el.getAttribute('data-lb-set'); });
      if (active.indexOf(a) === -1) active = [a];
      var single = active.length < 2;
      prev.hidden = single;
      next.hidden = single;
      opener = a;
      show(active.indexOf(a));
      dialog.showModal();
      document.body.classList.add('lightbox-open');
    }

    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        openSet(a);
      });
    });

    prev.addEventListener('click', function () { show(index - 1); });
    next.addEventListener('click', function () { show(index + 1); });
    dialog.querySelector('[data-lb-close]').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog || e.target.classList.contains('lightbox-inner')) dialog.close();
    });
    dialog.addEventListener('keydown', function (e) {
      if (active.length < 2) return;
      if (e.key === 'ArrowLeft') show(index - 1);
      if (e.key === 'ArrowRight') show(index + 1);
    });
    dialog.addEventListener('close', function () {
      document.body.classList.remove('lightbox-open');
      if (opener) opener.focus();
    });

    dialog.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    dialog.addEventListener('touchend', function (e) {
      if (!tracking || !e.changedTouches.length) return;
      tracking = false;
      if (active.length < 2) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - touchX;
      var dy = t.clientY - touchY;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
      show(index + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  function initGalleryFilters() {
    var bar = document.querySelector('[data-gallery-filters]');
    if (!bar) return;
    var buttons = Array.prototype.slice.call(bar.querySelectorAll('[data-filter]'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('[data-gallery-group]'));
    var live = document.querySelector('[data-gallery-live]');
    var ids = {};
    groups.forEach(function (group) {
      ids[group.getAttribute('data-gallery-group')] = true;
    });

    function hashId() {
      var raw = (location.hash || '').replace(/^#/, '');
      try { raw = decodeURIComponent(raw); } catch (err) { raw = ''; }
      return ids[raw] ? raw : 'all';
    }

    function apply(id, announce) {
      if (id !== 'all' && !ids[id]) id = 'all';
      buttons.forEach(function (btn) {
        btn.setAttribute('aria-pressed', btn.getAttribute('data-filter') === id ? 'true' : 'false');
      });
      groups.forEach(function (group) {
        group.hidden = id !== 'all' && group.getAttribute('data-gallery-group') !== id;
      });
      var pressed = bar.querySelector('[aria-pressed="true"]');
      // Scroll the chip inside the bar only. scrollIntoView also scrolls the
      // page, which on load slid the hero up under the sticky header.
      if (pressed) {
        var pad = 8;
        var left = pressed.offsetLeft - pad;
        var right = pressed.offsetLeft + pressed.offsetWidth + pad;
        var viewLeft = bar.scrollLeft;
        var viewRight = viewLeft + bar.clientWidth;
        var next = viewLeft;
        if (left < viewLeft) next = Math.max(0, left);
        else if (right > viewRight) next = right - bar.clientWidth;
        if (Math.abs(next - viewLeft) > 1) {
          var motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (typeof bar.scrollTo === 'function') {
            bar.scrollTo({ left: next, behavior: motion ? 'auto' : 'smooth' });
          } else {
            bar.scrollLeft = next;
          }
        }
      }
      if (live && announce) {
        live.textContent = id === 'all'
          ? 'Showing every group, A to Z'
          : 'Showing ' + (pressed ? pressed.textContent.trim() : id);
      }
    }

    function writeHash(id) {
      var next = id === 'all'
        ? location.pathname + location.search
        : location.pathname + location.search + '#' + id;
      var current = location.pathname + location.search + location.hash;
      if (current !== next) history.pushState(null, '', next);
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-filter');
        writeHash(id);
        apply(id, true);
      });
    });

    window.addEventListener('hashchange', function () {
      apply(hashId(), true);
    });
    window.addEventListener('popstate', function () {
      apply(hashId(), true);
    });

    apply(hashId(), false);
  }

  /* ---------- Best-of coverflow ---------- */
  function initCoverflow() {
    var stage = document.querySelector('[data-cover]');
    if (!stage) return;
    var cards = Array.prototype.slice.call(stage.querySelectorAll('[data-cover-card]'));
    if (!cards.length) return;
    var live = document.querySelector('[data-cover-live]');
    var coverIndex = 0;
    var timer = 0;
    var onScreen = true;
    var announced = false;
    var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    var phoneQuery = window.matchMedia('(max-width: 700px)');

    function reduced() {
      return motionQuery.matches;
    }

    function arm(img) {
      if (!img) return;
      var pending = img.getAttribute('data-src');
      if (!pending) return;
      img.src = pending;
      img.removeAttribute('data-src');
    }

    function offsetOf(i) {
      var n = cards.length;
      var offset = i - coverIndex;
      if (offset > n / 2) offset -= n;
      if (offset < -n / 2) offset += n;
      return offset;
    }

    function layout() {
      var flat = reduced();
      cards.forEach(function (card, i) {
        var offset = offsetOf(i);
        var abs = Math.abs(offset);
        card.dataset.offset = String(offset);
        card.style.zIndex = String(30 - abs);
        card.style.opacity = abs > 2 ? '0' : (abs === 0 ? '1' : abs === 1 ? '0.95' : '0.4');
        card.style.pointerEvents = abs > 1 ? 'none' : 'auto';
        card.tabIndex = -1;
        card.setAttribute('aria-hidden', offset === 0 ? 'false' : 'true');
        if (flat) {
          card.style.transform = 'translate(-50%, -50%) translateX(' + (offset * 110) + '%) scale(' + (offset === 0 ? '1' : '0.92') + ')';
        } else {
          var shift = offset * 46;
          var turn = offset * -52;
          var depth = offset === 0 ? 160 : -120;
          var scale = offset === 0 ? 1.12 : 0.78;
          card.style.transform = 'translate(-50%, -50%) translateX(' + shift + '%) rotateY(' + turn + 'deg) translateZ(' + depth + 'px) scale(' + scale + ')';
        }
        if (abs <= 2) arm(card.querySelector('img'));
      });
      if (live) {
        var title = (cards[coverIndex].querySelector('span') || {}).textContent || '';
        title = title.replace(/\s+/g, ' ').trim();
        var message = title + ', ' + (coverIndex + 1) + ' of ' + cards.length;
        if (announced) live.textContent = message;
        announced = true;
      }
    }

    function canPlay() {
      var dialog = document.getElementById('lightbox');
      if (reduced() || phoneQuery.matches || document.hidden || !onScreen) return false;
      if (dialog && dialog.open) return false;
      if (stage.matches(':hover') || stage.contains(document.activeElement)) return false;
      return true;
    }

    function queue() {
      window.clearInterval(timer);
      timer = 0;
      if (!canPlay()) return;
      timer = window.setInterval(function () { step(1); }, 5000);
    }

    function step(delta) {
      coverIndex = (coverIndex + delta + cards.length) % cards.length;
      layout();
    }

    stage.querySelector('[data-cover-prev]').addEventListener('click', function () {
      step(-1);
      queue();
    });
    stage.querySelector('[data-cover-next]').addEventListener('click', function () {
      step(1);
      queue();
    });

    stage.addEventListener('click', function (e) {
      var card = e.target.closest('[data-cover-card]');
      if (!card) return;
      var index = cards.indexOf(card);
      if (offsetOf(index) !== 0) {
        e.preventDefault();
        e.stopPropagation();
        coverIndex = index;
        layout();
        queue();
        return;
      }
      window.clearInterval(timer);
      timer = 0;
    }, true);

    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        step(-1);
        queue();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        step(1);
        queue();
      } else if ((e.key === 'Enter' || e.key === ' ') && e.target === stage) {
        e.preventDefault();
        cards[coverIndex].click();
      }
    });

    var touchX = 0;
    var touchY = 0;
    var tracking = false;
    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (!tracking || !e.changedTouches.length) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - touchX;
      var dy = t.clientY - touchY;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
      step(dx < 0 ? 1 : -1);
      queue();
    }, { passive: true });

    stage.addEventListener('mouseenter', function () { window.clearInterval(timer); timer = 0; });
    stage.addEventListener('mouseleave', queue);
    stage.addEventListener('focusin', function () { window.clearInterval(timer); timer = 0; });
    stage.addEventListener('focusout', queue);
    document.addEventListener('visibilitychange', queue);
    if (phoneQuery.addEventListener) phoneQuery.addEventListener('change', queue);
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', function () {
        layout();
        queue();
      });
    }
    var dialog = document.getElementById('lightbox');
    if (dialog) dialog.addEventListener('close', queue);
    if ('IntersectionObserver' in window) {
      var watcher = new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        queue();
      }, { threshold: 0.35 });
      watcher.observe(stage);
    }
    layout();
    queue();
  }

  /* ---------- GA4 conversion events (existing gtag only) ---------- */
  function track(name, params) {
    if (typeof window.gtag !== 'function') return;
    var data = { transport_type: 'beacon' };
    if (params) {
      for (var key in params) {
        if (Object.prototype.hasOwnProperty.call(params, key) && params[key] != null && params[key] !== '') {
          data[key] = params[key];
        }
      }
    }
    try { window.gtag('event', name, data); } catch (err) {}
  }

  function formName(form) {
    if (form.hasAttribute('data-review-form')) return 'review';
    if (form.id === 'orderForm') return 'order';
    if (form.hasAttribute('data-booking-form') || form.id === 'bookingForm') return 'booking';
    return 'contact';
  }

  function isFormSubmit(form) {
    var action = (form.getAttribute('action') || form.action || '').toLowerCase();
    return action.indexOf('formsubmit.co') !== -1;
  }

  function platformFromUrl(href) {
    var host = '';
    try {
      host = new URL(href, window.location.href).hostname.replace(/^www\./, '').toLowerCase();
    } catch (err) {
      return '';
    }
    if (host === 'facebook.com' || host === 'fb.com' || host === 'm.facebook.com') return 'facebook';
    if (host === 'instagram.com') return 'instagram';
    if (host === 'pinterest.com') return 'pinterest';
    if (host === 'threads.com' || host === 'threads.net') return 'threads';
    if (host === 'tiktok.com') return 'tiktok';
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'youtube';
    if (host === 'linkedin.com' || host.slice(-13) === '.linkedin.com') return 'linkedin';
    if (host === 'x.com' || host === 'twitter.com') return 'x';
    return '';
  }

  function isSocialProfile(anchor) {
    if (anchor.closest('[data-social-links], [data-linkedin-note]')) return true;
    var href = (anchor.href || '').replace(/\/$/, '');
    var social = DESANYA_LINKS.social || {};
    var keys = Object.keys(social);
    for (var i = 0; i < keys.length; i++) {
      var url = configuredUrl(social[keys[i]]);
      if (url && href === url.replace(/\/$/, '')) return true;
    }
    return false;
  }

  function paypalItemName() {
    try {
      var cart = window.DesanyaCart;
      if (cart && typeof cart.getItems === 'function') {
        var names = cart.getItems().map(function (item) { return item && item.name; }).filter(Boolean);
        if (names.length) return names.join(', ');
      }
    } catch (err) {}
    var path = (window.location.pathname || '').split('/').filter(Boolean).pop();
    return path || 'home';
  }

  function onTrackedClick(event) {
    if (event.button && event.button !== 0) return;
    var node = event.target;
    if (!node || node.nodeType !== 1) node = node && node.parentElement;
    if (!node || !node.closest) return;
    var anchor = node.closest('a');
    if (!anchor) {
      if (node.closest('#paypal-buttons')) track('paypal_click', { item_name: paypalItemName() });
      return;
    }
    var href = anchor.getAttribute('href') || '';
    if (/^tel:/i.test(href)) {
      track('phone_click');
      return;
    }
    if (/^mailto:/i.test(href)) {
      track('email_click');
      return;
    }
    if (/calendly\.com/i.test(anchor.href || href)) {
      track('calendly_click');
      return;
    }
    if (/paypal\.(com|me)/i.test(anchor.href || href)) {
      var label = (anchor.getAttribute('data-item-name') || anchor.textContent || '').replace(/\s+/g, ' ').trim();
      track('paypal_click', { item_name: label || paypalItemName() });
      return;
    }
    if (isSocialProfile(anchor)) {
      var platform = platformFromUrl(anchor.href);
      if (platform) track('social_click', { platform: platform });
    }
  }

  function initAnalytics() {
    window.desanyaTrack = track;
    document.addEventListener('submit', function (event) {
      var form = event.target;
      if (!form || form.tagName !== 'FORM' || !isFormSubmit(form)) return;
      track('generate_lead', { form_name: formName(form) });
    });
    document.addEventListener('click', onTrackedClick, true);
  }

  function init() {
    initNav();
    initYear();
    initContact();
    initUtm();
    initBooking();
    initReviews();
    initSocial();
    initLightbox();
    initCoverflow();
    initGalleryFilters();
    initAnalytics();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
