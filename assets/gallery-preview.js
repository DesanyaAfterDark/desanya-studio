/* Vanilla behavior for the three gallery style previews. */
(function () {
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

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

  var dialog = document.querySelector('[data-pv-lightbox]');
  var lbImg = dialog && dialog.querySelector('img');
  var lbCap = dialog && dialog.querySelector('[data-pv-cap]');
  var lbCount = dialog && dialog.querySelector('[data-pv-count]');
  var lbIndex = 0;
  var lbSet = [];
  var touchX = 0;
  var touchY = 0;
  var tracking = false;

  function lbSrc(el) {
    return el.getAttribute('data-pv-src');
  }

  function preloadLb(i) {
    if (lbSet.length < 2) return;
    var el = lbSet[(i + lbSet.length) % lbSet.length];
    var src = lbSrc(el);
    if (!src) return;
    var ahead = new Image();
    ahead.decoding = 'async';
    ahead.src = src;
  }

  function showLb(i) {
    if (!lbSet.length) return;
    lbIndex = (i + lbSet.length) % lbSet.length;
    var el = lbSet[lbIndex];
    lbImg.src = lbSrc(el);
    lbImg.alt = el.getAttribute('data-pv-alt') || '';
    lbCap.textContent = el.getAttribute('data-pv-caption') || '';
    lbCount.textContent = (lbIndex + 1) + ' of ' + lbSet.length;
    preloadLb(lbIndex + 1);
  }

  function openLb(el) {
    if (!dialog || typeof dialog.showModal !== 'function') return;
    var setName = el.getAttribute('data-pv-set') || '';
    lbSet = Array.prototype.filter.call(
      document.querySelectorAll('[data-pv-open]'),
      function (node) {
        return (node.getAttribute('data-pv-set') || '') === setName;
      }
    );
    if (lbSet.indexOf(el) === -1) lbSet = [el];
    var single = lbSet.length < 2;
    dialog.querySelector('[data-pv-prev]').hidden = single;
    dialog.querySelector('[data-pv-next]').hidden = single;
    showLb(lbSet.indexOf(el));
    dialog.showModal();
  }

  if (dialog) {
    dialog.querySelector('[data-pv-close]').addEventListener('click', function () {
      dialog.close();
    });
    dialog.querySelector('[data-pv-prev]').addEventListener('click', function () {
      showLb(lbIndex - 1);
    });
    dialog.querySelector('[data-pv-next]').addEventListener('click', function () {
      showLb(lbIndex + 1);
    });
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });
    dialog.addEventListener('keydown', function (e) {
      if (lbSet.length < 2) return;
      if (e.key === 'ArrowLeft') showLb(lbIndex - 1);
      if (e.key === 'ArrowRight') showLb(lbIndex + 1);
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
      if (lbSet.length < 2) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - touchX;
      var dy = t.clientY - touchY;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
      showLb(lbIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-pv-open]');
    if (!opener || opener.closest('[data-cover]')) return;
    if (opener.classList.contains('masonry-hit')) {
      var coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;
      var card = opener.closest('.masonry-card');
      if (coarse && card && !card.classList.contains('is-open')) {
        document.querySelectorAll('.masonry-card.is-open').forEach(function (other) {
          other.classList.remove('is-open');
        });
        card.classList.add('is-open');
        return;
      }
    }
    openLb(opener);
  });

  document.addEventListener('click', function (e) {
    if (e.target.closest('.masonry-card')) return;
    document.querySelectorAll('.masonry-card.is-open').forEach(function (card) {
      card.classList.remove('is-open');
    });
  });

  function bindSwipe(node, onLeft, onRight) {
    var x = 0;
    var y = 0;
    var live = false;
    node.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
      live = true;
    }, { passive: true });
    node.addEventListener('touchend', function (e) {
      if (!live || !e.changedTouches.length) return;
      live = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - x;
      var dy = t.clientY - y;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) onLeft();
      else onRight();
    }, { passive: true });
  }

  var hero = document.querySelector('[data-showcase]');
  if (hero) {
    var slides = Array.prototype.slice.call(hero.querySelectorAll('[data-hero-slide]'));
    var tabs = Array.prototype.slice.call(hero.querySelectorAll('[data-hero-tab]'));
    var heroIndex = 0;
    var timer = 0;

    function showHero(n) {
      heroIndex = (n + slides.length) % slides.length;
      slides.forEach(function (slide, idx) {
        var on = idx === heroIndex;
        slide.hidden = !on;
        if (on || idx === (heroIndex + 1) % slides.length) arm(slide.querySelector('img'));
      });
      var upcoming = slides[(heroIndex + 1) % slides.length].querySelector('img');
      arm(upcoming);
      tabs.forEach(function (tab, idx) {
        var on = idx === heroIndex;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) tab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      });
    }

    function queue() {
      window.clearInterval(timer);
      timer = 0;
      if (reduced() || document.hidden) return;
      timer = window.setInterval(function () { showHero(heroIndex + 1); }, 5000);
    }

    hero.querySelector('[data-hero-prev]').addEventListener('click', function () {
      showHero(heroIndex - 1);
      queue();
    });
    hero.querySelector('[data-hero-next]').addEventListener('click', function () {
      showHero(heroIndex + 1);
      queue();
    });
    tabs.forEach(function (tab, idx) {
      tab.addEventListener('click', function () {
        showHero(idx);
        queue();
      });
    });
    hero.addEventListener('mouseenter', function () { window.clearInterval(timer); });
    hero.addEventListener('mouseleave', queue);
    hero.addEventListener('focusin', function () { window.clearInterval(timer); });
    hero.addEventListener('focusout', queue);
    document.addEventListener('visibilitychange', queue);
    hero.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') showHero(heroIndex - 1);
      if (e.key === 'ArrowRight') showHero(heroIndex + 1);
    });
    bindSwipe(hero.querySelector('.pv-hero-stage'), function () {
      showHero(heroIndex + 1);
      queue();
    }, function () {
      showHero(heroIndex - 1);
      queue();
    });
    showHero(0);
    queue();
  }

  var stage = document.querySelector('[data-cover]');
  if (stage) {
    var cards = Array.prototype.slice.call(stage.querySelectorAll('[data-cover-card]'));
    var coverIndex = 0;

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
    }

    function step(delta) {
      coverIndex = (coverIndex + delta + cards.length) % cards.length;
      layout();
    }

    stage.querySelector('[data-cover-prev]').addEventListener('click', function () { step(-1); });
    stage.querySelector('[data-cover-next]').addEventListener('click', function () { step(1); });
    cards.forEach(function (card, i) {
      card.addEventListener('click', function () {
        if (offsetOf(i) !== 0) {
          coverIndex = i;
          layout();
          return;
        }
        openLb(card);
      });
    });
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
    bindSwipe(stage, function () { step(1); }, function () { step(-1); });
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', layout);
    }
    layout();
  }
})();
