/* look-glass.js: behaviour for the Soft Glass look (registered with GU.looks, see js/looks.js). Three small, purely visual helpers; no
   text, data, id or behaviour of the app is touched, and disable() takes every trace away again:
     1. Page entrance: when the person OPENS a page (its page id changes) the blocks on it float up in a short stagger. Moving between
        the pages of one menu item only floats the page body, not the strip of tabs. A background redraw of the same page never replays
        it (one redrawn within its first second carries on from where it was, so nothing flickers).
     2. The gliding pill: one pill per rail / dock / Home|Work switch / sub-tab strip that glides to the current item.
     3. The pop: a tick, or a chosen segment, springs when you touch it (only the one you touched, not every redraw).
   Added by enable() and removed by disable(): the .gu-pill elements, .has-pill / .gu-in / .gu-pop classes, the --i / --el properties,
   the observers, the listeners and the timers. */
(function () {
  'use strict';
  const GU = (window.GU = window.GU || {});
  if (!GU.looks || !GU.looks.register) return;
  let live = null; // what enable() set up, until disable() takes it down

  function start() {
    const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    const observers = [];
    const timers = new Set();
    const entering = new Set(); // blocks carrying .gu-in
    const popped = new Set(); // controls carrying .gu-pop
    const pills = new Set();
    const hosts = new Set(); // elements carrying .has-pill
    const placed = new WeakMap();
    let alive = true;
    let raf = 0;
    let shellOn = false;

    const later = (fn, ms) => {
      const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
      timers.add(id);
    };
    const watch = (target, opts, fn) => {
      const o = new MutationObserver(fn);
      o.observe(target, opts);
      observers.push(o);
      return o;
    };

    /* ---------- 1. page entrance ---------- */
    let lastKey = null;
    let lastBox = '';
    let startedAt = 0;
    let useSub = false;
    function blocks(root) {
      const out = [];
      (function walk(el, depth) {
        Array.prototype.forEach.call(el.children, (c) => {
          if (c.nodeType !== 1 || c.hidden || c.tagName === 'SCRIPT') return;
          if (depth < 3 && c.matches('.brief, .brief__feed, .brief__aside, .cols, .stack, .doors, .split, .subpage')) walk(c, depth + 1);
          else out.push(c);
        });
      })(root, 0);
      return out;
    }
    function settle(list) {
      list.forEach((el) => { el.classList.remove('gu-in'); el.style.removeProperty('--i'); el.style.removeProperty('--el'); entering.delete(el); });
    }
    function enter(inner, seed) {
      const cls = inner.className.split(/\s+/);
      const key = cls.filter((c) => /^view--(?!in-)/.test(c))[0] || '';
      const box = cls.filter((c) => /^view--in-/.test(c))[0] || '';
      const changed = key !== lastKey;
      const sameBox = box && box === lastBox;
      const now = Date.now();
      const first = lastKey === null;
      lastKey = key;
      lastBox = box;
      if (seed || first || reduce.matches) return; // the page you load on, or are already on, is not "opened"
      let elapsed = 0;
      if (changed) { startedAt = now; useSub = !!sameBox; }
      else if (startedAt && now - startedAt < 1000) elapsed = now - startedAt; // redrawn mid-entrance: carry on from where it was
      else return;
      let root = inner;
      if (useSub) { const sp = inner.querySelector('.subpage'); if (sp) root = sp; }
      let list = blocks(root);
      // only what can be seen on the first screen floats in; a long page does not animate what is far below the fold
      const vh = window.innerHeight || 800;
      const seen = list.filter((el) => el.getBoundingClientRect().top <= vh * 1.05);
      if (seen.length) list = seen;
      if (!list.length) list = [root];
      list.forEach((el, i) => {
        el.style.setProperty('--i', Math.min(i, 9));
        if (elapsed) el.style.setProperty('--el', elapsed + 'ms');
        el.classList.add('gu-in');
        entering.add(el);
      });
      later(() => settle(list), 1100 - elapsed);
    }

    /* ---------- 2. the gliding pill ---------- */
    function ensurePill(host) {
      let p = host.querySelector(':scope > .gu-pill');
      if (!p) {
        p = document.createElement('i');
        p.className = 'gu-pill';
        p.setAttribute('aria-hidden', 'true');
        host.insertBefore(p, host.firstChild);
        pills.add(p);
      }
      return p;
    }
    const mark = (el, on) => { el.classList.toggle('has-pill', on); if (on) hosts.add(el); };
    const hide = (pill) => { pill.classList.remove('is-on'); pill.removeAttribute('style'); };
    /* Where `target` sits inside `host`, in the host's own pixels. A block that is mid-entrance is scaled, so the scale is divided out. */
    function metrics(host, target) {
      const hr = host.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      if (!tr.width || !hr.width) return null;
      let k = host.offsetWidth ? hr.width / host.offsetWidth : 1;
      if (Math.abs(k - 1) < 0.005) k = 1;
      return {
        x: (tr.left - hr.left) / k + host.scrollLeft - host.clientLeft,
        y: (tr.top - hr.top) / k + host.scrollTop - host.clientTop,
        w: tr.width / k, h: tr.height / k,
      };
    }
    function place(host, target, pill, instant) {
      const m = metrics(host, target);
      if (!m) { hide(pill); return false; }
      const snap = instant || reduce.matches;
      if (snap) pill.style.transition = 'none';
      pill.style.width = m.w + 'px';
      pill.style.height = m.h + 'px';
      pill.style.transform = 'translate(' + m.x + 'px,' + m.y + 'px)';
      pill.classList.add('is-on');
      if (snap) { void pill.offsetWidth; pill.style.transition = ''; }
      return true;
    }
    function sync(host, sel, owner) {
      const target = host.querySelector(sel);
      const pill = ensurePill(host);
      // Settings sits in the pinned footer of the desktop rail: it can't share a scrolling pill, so it keeps its own soft tile.
      const foot = target && target.closest('.rail__foot');
      if (!target || (foot && getComputedStyle(foot).position === 'sticky')) { hide(pill); mark(owner || host, false); return; }
      const fresh = !pill.style.transform; // a pill that has just been made appears in place instead of flying in
      if (place(host, target, pill, fresh || !placed.get(host))) { placed.set(host, true); mark(owner || host, true); }
      else mark(owner || host, false);
    }
    function syncAll() {
      raf = 0;
      const items = document.querySelector('.rail__items');
      if (items) sync(items, '.rail__item[aria-current="page"]', document.querySelector('.rail'));
      document.querySelectorAll('.partswitch').forEach((sw) => sync(sw, '.partswitch__btn[aria-pressed="true"]'));
      if (withStrip) { withStrip = false; stripNow(false); }
    }
    let withStrip = false; // a resize or a late font also re-places the sub-tab pill (a page change does it itself, with its glide)
    function queue(strips) {
      if (strips === true) withStrip = true;
      if (raf || !alive) return;
      raf = requestAnimationFrame(() => { if (alive) syncAll(); });
    }
    const relayout = () => queue(true);

    /* Sub-tab strips are redrawn with every page change, so the pill is re-made at the OLD tab's place and glides to the new one. */
    let lastSub = null;
    function stripNow(glide) {
      const strip = document.querySelector('#view .subtabs');
      if (!strip) { lastSub = null; return; }
      const cur = strip.querySelector('.subtab[aria-current="page"]');
      if (!cur) return;
      const pill = ensurePill(strip);
      const m = metrics(strip, cur);
      if (!m) return;
      const to = { x: m.x, y: m.y };
      const inner = document.querySelector('#view > .view__inner');
      const id = inner ? (inner.className.match(/view--in-\S+/) || [''])[0] : '';
      const from = glide && id && lastSub && lastSub.id === id && !reduce.matches ? lastSub : to;
      pill.style.transition = 'none';
      pill.style.width = m.w + 'px';
      pill.style.height = m.h + 'px';
      pill.style.transform = 'translate(' + from.x + 'px,' + from.y + 'px)';
      pill.classList.add('is-on');
      mark(strip, true);
      void pill.offsetWidth;
      pill.style.transition = '';
      pill.style.transform = 'translate(' + to.x + 'px,' + to.y + 'px)';
      lastSub = { id, x: to.x, y: to.y };
    }

    /* ---------- 3. the pop ---------- */
    let pending = null; // the tick just touched, so the redraw it causes can pop the new copy of it
    function pop(el) {
      if (!el || reduce.matches) return;
      el.classList.remove('gu-pop');
      void el.offsetWidth;
      el.classList.add('gu-pop');
      popped.add(el);
      later(() => { el.classList.remove('gu-pop'); popped.delete(el); }, 500);
    }
    function onChange(e) {
      const t = e.target;
      if (!t || t.nodeType !== 1 || !t.matches || !t.checked) return;
      pending = null;
      if (t.matches('input.tick')) {
        pop(t);
        const a = Array.prototype.find.call(t.attributes, (x) => /^data-/.test(x.name));
        if (a) pending = { sel: 'input.tick[' + a.name + '="' + String(a.value).replace(/["\\]/g, '\\$&') + '"]', at: Date.now() };
      } else if (t.matches('.seg input')) pop(t.nextElementSibling);
    }
    function popPending(view) {
      if (!pending) return;
      const p = pending;
      pending = null;
      if (Date.now() - p.at > 700) return;
      let el = null;
      try { el = view.querySelector(p.sel); } catch (err) { /* an odd attribute value: no pop */ }
      if (el && el.checked) pop(el);
    }

    /* ---------- wiring ---------- */
    function onView(view) {
      const inner = view.querySelector(':scope > .view__inner');
      if (inner) enter(inner, false);
      stripNow(true);
      popPending(view);
    }
    function wireShell() {
      const view = document.getElementById('view');
      const rail = document.querySelector('.rail');
      const bar = document.querySelector('.partbar');
      if (shellOn || !view || !rail) return false;
      shellOn = true;
      const first = view.querySelector(':scope > .view__inner');
      if (first) enter(first, true);
      watch(view, { childList: true }, () => onView(view));
      const o = watch(rail, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'aria-pressed'] }, queue);
      if (bar) o.observe(bar, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(relayout);
        ro.observe(rail);
        if (bar) ro.observe(bar);
        observers.push(ro);
      }
      stripNow(false);
      queue();
      return true;
    }
    document.addEventListener('change', onChange, true);
    window.addEventListener('resize', relayout);
    window.addEventListener('load', relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    if (!wireShell()) {
      const app = document.getElementById('app');
      if (app) {
        const wait = watch(app, { childList: true, subtree: true }, () => { if (wireShell()) wait.disconnect(); });
      }
    }

    return function stop() {
      alive = false;
      observers.forEach((o) => o.disconnect());
      timers.forEach((id) => clearTimeout(id));
      if (raf) window.cancelAnimationFrame(raf);
      document.removeEventListener('change', onChange, true);
      window.removeEventListener('resize', relayout);
      window.removeEventListener('load', relayout);
      settle(Array.from(entering));
      popped.forEach((el) => el.classList.remove('gu-pop'));
      pills.forEach((p) => p.remove());
      document.querySelectorAll('.gu-pill').forEach((p) => p.remove());
      hosts.forEach((h) => h.classList.remove('has-pill'));
      document.querySelectorAll('.has-pill').forEach((h) => h.classList.remove('has-pill'));
    };
  }

  GU.looks.register('glass', {
    enable() { if (!live) live = start(); },
    disable() { if (live) { const stop = live; live = null; stop(); } },
  });
})();
