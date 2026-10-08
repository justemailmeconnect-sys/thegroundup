/* look-bold.js: behaviour for the Bold Colour look (registers with GU.looks; see js/looks.js).
   Presentation only: nothing here reads or writes data, changes text, ids or data-* attributes, or touches what the app does.
   While Bold Colour is the active look, enable() adds three small motion helpers, and disable() removes every trace of them:

   1. Page entrance: when a page OPENS (a different page id from the one before), its top-level blocks get a class that plays a quick
      staggered pop. A background re-render of the same page (every state change redraws the page) never replays it, and enabling the
      look never plays it either.
   2. Sliding highlights: the page strip (Bank | Spending | ...), the Home | Work switch and the menu each get a colour block that
      glides to the item you are on, instead of jumping. (The CSS gives the current item its own colour block as well, so without this
      script the highlight simply jumps.)
   3. A tick you press draws its check once.

   Everything is skipped when the person asks for reduced motion. What enable() adds: one MutationObserver on #view, one on #app, one on
   the menu list, one ResizeObserver, window/document listeners (resize, change, fonts), the .rail__ind element, and these transient
   classes and inline custom properties: .gu-in .gu-pop .is-entering .just-ticked .has-ind .ind-hold, --i --e --ix --iy --iw --ih. */
(function () {
  'use strict';
  const GU = (window.GU = window.GU || {});
  if (!GU.looks || typeof GU.looks.register !== 'function') return;

  const STAGGER_MAX = 9; // steps, so the last block starts by ~340ms
  const CLEAN_MS = 1500; // entrance classes are removed afterwards, so nothing can replay or fight hover styles
  const CONTAINERS = '.subpage, .brief__feed, .brief__aside, .stack, .doors, .now, .now-cards, .ledger, .acct-strip, .wk-cards, .cols, .split';
  const POPS = '.now-card, .wk-card, .ledger > div, .acct';
  const TRANSIENT = '.gu-in, .gu-pop, .is-entering, .just-ticked, .has-ind, .ind-hold, .rail__ind';
  const PROPS = ['--i', '--e', '--ix', '--iy', '--iw', '--ih'];

  let st = null; // everything enable() set up; null while the look is off

  const reduced = () => {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  };
  const tabOf = (inner) => {
    const m = /(?:^|\s)view--(?!in-)(\S+)/.exec(inner.className || '');
    return m ? m[1] : '';
  };
  const boxOf = (inner) => {
    const m = /(?:^|\s)view--in-(\S+)/.exec(inner.className || '');
    return m ? m[1] : '';
  };
  /* Takes our custom properties off an element and drops the style attribute if that leaves it empty (so the DOM matches a fresh load). */
  function unstyle(el, props) {
    if (!el || !el.style) return;
    (props || PROPS).forEach((p) => el.style.removeProperty(p));
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
  function later(fn, ms) {
    const t = setTimeout(() => {
      st && st.timers.delete(t);
      fn();
    }, ms);
    st.timers.add(t);
    return t;
  }

  /* ---------- 1. page entrance ---------- */
  function enter(inner, sameBox, elapsed) {
    const vh = window.innerHeight || 800;
    const list = [];
    const seen = new Set();
    const add = (el) => {
      if (!el || seen.has(el) || el.hidden || el.tagName === 'DIALOG' || el.classList.contains('dropcover')) return;
      seen.add(el);
      list.push(el);
    };
    Array.prototype.forEach.call(inner.children, add);
    Array.prototype.forEach.call(inner.querySelectorAll(CONTAINERS), (c) => Array.prototype.forEach.call(c.children, add));
    // keep the leaves: a wrapper that holds other blocks is not animated itself
    const leaves = list.filter((el) => !list.some((o) => o !== el && el.contains(o)));
    let n = 0;
    leaves.forEach((el) => {
      if (sameBox && el.classList.contains('subtabs')) return;
      const r = el.getBoundingClientRect();
      if (r.top > vh * 1.05 || r.height === 0) return;
      el.classList.add('gu-in');
      if (el.matches(POPS)) el.classList.add('gu-pop');
      el.style.setProperty('--i', String(Math.min(n, STAGGER_MAX)));
      if (elapsed) el.style.setProperty('--e', Math.round(elapsed) + 'ms');
      n++;
    });
    inner.classList.add('is-entering');
    if (elapsed) inner.style.setProperty('--e', Math.round(elapsed) + 'ms');
    later(() => {
      inner.classList.remove('is-entering');
      unstyle(inner, ['--e']);
      Array.prototype.forEach.call(inner.querySelectorAll('.gu-in'), (el) => {
        el.classList.remove('gu-in', 'gu-pop');
        unstyle(el, ['--i', '--e']);
      });
    }, CLEAN_MS);
  }

  /* ---------- 3. a tick you pressed draws its check ---------- */
  function onChange(e) {
    const t = e.target;
    if (!st || !t || !t.classList || !t.classList.contains('tick') || !t.checked) return;
    const a = ['data-toggle', 'data-done', 'data-tick'].filter((k) => t.hasAttribute(k))[0];
    if (!a) return;
    st.ticked = { attr: a, val: t.getAttribute(a), at: Date.now() };
  }
  function markTick(host) {
    const k = st.ticked;
    st.ticked = null;
    if (!k || Date.now() - k.at > 900) return;
    const els = host.querySelectorAll('input.tick[' + k.attr + ']');
    for (let i = 0; i < els.length; i++) {
      if (els[i].getAttribute(k.attr) === k.val && els[i].checked) {
        const el = els[i];
        el.classList.add('just-ticked');
        later(() => el.classList.remove('just-ticked'), 700);
      }
    }
  }

  /* ---------- 2. sliding highlights ---------- */
  const stripKey = (strip) => Array.prototype.map.call(strip.querySelectorAll('.subtab'), (a) => a.textContent.replace(/\d+$/, '').trim()).join('|');
  /* Where item sits inside box, in the box's own pixels: unaffected by a transform on box (the page entrance scales the strip). */
  function within(box, item) {
    const s = box.getBoundingClientRect();
    const o = item.getBoundingClientRect();
    const k = box.offsetWidth ? s.width / box.offsetWidth : 1;
    return { x: (o.left - s.left) / k, y: (o.top - s.top) / k, w: o.width / k, h: o.height / k };
  }
  const px = (v) => Math.round(v * 10 + 0.001) / 10 + 'px'; // tenths of a pixel; the nudge keeps float noise from flipping a value that sits on a boundary
  function put(el, p) {
    el.style.setProperty('--ix', px(p.x));
    el.style.setProperty('--iy', px(p.y));
    el.style.setProperty('--iw', px(p.w));
    el.style.setProperty('--ih', px(p.h));
  }
  function placeStrip(strip, from) {
    const on = strip.querySelector('.subtab[aria-current="page"]');
    if (!on) return;
    const to = within(strip, on);
    strip.classList.add('has-ind');
    if (from && !reduced()) {
      strip.classList.add('ind-hold');
      put(strip, from);
      void strip.offsetWidth; // the highlight starts where it was...
      strip.classList.remove('ind-hold');
      st.raf2 = requestAnimationFrame(() => put(strip, to)); // ...and glides to where it is now
    } else put(strip, to);
    st.prevStrip = { key: stripKey(strip), rect: to };
  }
  function afterRender(inner) {
    const strip = inner.querySelector('.subtabs');
    if (strip) {
      // the same strip as on the page before (moving between Bank, Spending, Income...): the highlight glides from where it was
      const from = st.prevStrip && st.prevStrip.key === stripKey(strip) ? st.prevStrip.rect : null;
      placeStrip(strip, from);
    } else st.prevStrip = null;
  }
  function placeNav() {
    if (!st) return;
    // the part switch (computer menu and phone bar)
    document.querySelectorAll('.partswitch').forEach((sw) => {
      const on = sw.querySelector('.partswitch__btn[aria-pressed="true"]');
      if (!on || !on.offsetWidth) return;
      put(sw, within(sw, on));
      sw.classList.add('has-ind');
    });
    // the strip of pages keeps up when fonts or the window change its width
    document.querySelectorAll('.subtabs.has-ind').forEach((strip) => {
      const on = strip.querySelector('.subtab[aria-current="page"]');
      if (!on) return;
      put(strip, within(strip, on));
    });
    // the menu
    const host = document.querySelector('.rail__items');
    if (!host) return;
    let ind = host.querySelector('.rail__ind');
    const item = host.querySelector('.rail__item[aria-current="page"] .rail__ico');
    if (!item || !item.offsetWidth) {
      if (ind) ind.style.opacity = '0';
      return;
    }
    if (!ind) {
      ind = document.createElement('span');
      ind.className = 'rail__ind';
      ind.setAttribute('aria-hidden', 'true');
      host.insertBefore(ind, host.firstChild);
    }
    const h = host.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const first = !ind.hasAttribute('data-placed');
    if (first) ind.style.transition = 'none';
    ind.setAttribute('data-placed', '1');
    ind.style.opacity = '1';
    ind.style.width = r.width + 'px';
    ind.style.height = r.height + 'px';
    ind.style.transform = 'translate(' + (r.left - h.left + host.scrollLeft) + 'px,' + (r.top - h.top + host.scrollTop) + 'px)';
    host.classList.add('has-ind');
    if (first) {
      void ind.offsetWidth;
      ind.style.transition = '';
    }
  }
  function schedulePlaceNav() {
    if (!st) return;
    window.cancelAnimationFrame(st.raf);
    st.raf = requestAnimationFrame(placeNav);
  }

  /* ---------- the page was redrawn ---------- */
  function onView(muts) {
    if (!st) return;
    for (let i = 0; i < muts.length; i++) {
      const added = muts[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const n = added[j];
        if (!n.classList || !n.classList.contains('view__inner')) continue;
        const tab = tabOf(n);
        const box = boxOf(n);
        const now = Date.now();
        const last = st.last;
        const opened = tab !== last.tab;
        const cont = !opened && now - last.at < 700; // a second redraw straight after opening: carry on, don't restart
        if (!reduced() && (opened || cont)) enter(n, !!box && box === last.box && opened, cont ? now - last.at : 0);
        if (opened) st.last = { tab, box, at: now };
        markTick(n);
        afterRender(n);
      }
    }
    schedulePlaceNav();
  }

  /* The app draws its shell after the scripts have run (it opens its storage first). If enable() is called before that, wait for it. */
  let waiting = null;
  const ready = () => !!(document.getElementById('view') && document.querySelector('.rail__items'));
  function stopWaiting() {
    if (waiting) waiting.disconnect();
    waiting = null;
  }
  function enable() {
    if (st) {
      schedulePlaceNav(); // already on: just make sure the highlights are where they should be
      return;
    }
    if (!ready()) {
      const app = document.getElementById('app');
      if (!waiting && app && typeof MutationObserver === 'function') {
        waiting = new MutationObserver(() => {
          if (!ready()) return;
          stopWaiting();
          setup();
        });
        waiting.observe(app, { childList: true, subtree: true });
      }
      return;
    }
    setup();
  }

  function setup() {
    if (st) return;
    st = { observers: [], timers: new Set(), raf: 0, raf2: 0, last: { tab: null, box: null, at: 0 }, prevStrip: null, ticked: null, listeners: [] };
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      st.listeners.push(() => target.removeEventListener(type, fn, opts));
    };
    const observe = (Ctor, target, fn, opts) => {
      if (!target || typeof Ctor !== 'function') return;
      const o = new Ctor(fn);
      o.observe(target, opts);
      st.observers.push(o);
    };
    const view = document.getElementById('view');
    const app = document.getElementById('app');
    // the page that is already open is not "entering": remember it, and put its highlights in place without moving them
    const inner = view.querySelector('.view__inner');
    if (inner) {
      st.last = { tab: tabOf(inner), box: boxOf(inner), at: 0 };
      afterRender(inner);
    }
    observe(MutationObserver, view, onView, { childList: true });
    // the switch and the menu keep their elements, so watch their state instead
    observe(MutationObserver, app, schedulePlaceNav, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-current'] });
    observe(MutationObserver, document.querySelector('.rail__items'), schedulePlaceNav, { childList: true });
    if (typeof ResizeObserver === 'function') document.querySelectorAll('.rail__items, .partswitch').forEach((el) => observe(ResizeObserver, el, schedulePlaceNav));
    listen(document, 'change', onChange, true);
    listen(window, 'resize', schedulePlaceNav);
    if (document.fonts) {
      listen(document.fonts, 'loadingdone', schedulePlaceNav);
      if (document.fonts.ready) document.fonts.ready.then(schedulePlaceNav);
    }
    placeNav();
  }

  function disable() {
    stopWaiting();
    if (!st) return;
    const s = st;
    st = null; // anything still queued sees "off" and does nothing
    s.observers.forEach((o) => o.disconnect());
    s.listeners.forEach((off) => off());
    s.timers.forEach(clearTimeout);
    window.cancelAnimationFrame(s.raf);
    window.cancelAnimationFrame(s.raf2);
    document.querySelectorAll('.rail__ind').forEach((el) => el.remove());
    document.querySelectorAll(TRANSIENT).forEach((el) => {
      el.classList.remove('gu-in', 'gu-pop', 'is-entering', 'just-ticked', 'has-ind', 'ind-hold');
      unstyle(el);
    });
    document.querySelectorAll('.partswitch, .subtabs, .rail__items').forEach((el) => unstyle(el));
  }

  GU.looks.register('bold', { enable, disable });
})();
