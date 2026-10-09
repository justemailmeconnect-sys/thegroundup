/* looks.js: the two looks (Soft Glass, Bold Colour) and the switch between them.

   Two parts live here.

   GU.looks is the registry the looks plug into. A look is a stylesheet (css/look-<id>.css, enabled or disabled through its
   <link data-look-css>) plus an optional behaviour module (js/look-<id>.js) that registers itself:

     GU.looks.register('glass', { enable() { ...add observers, inject elements... }, disable() { ...remove everything enable() added... } });

   enable() runs after the app's first render (GU.looks.boot(), called by app.js) and again whenever the person switches to that
   look; disable() runs when they switch away. Both must be safe to call at any time, any number of times, in any order, and
   disable() must leave no trace (no injected elements, classes, listeners, observers, timers or inline styles).
     GU.looks.apply(id)   swaps stylesheet and behaviour (low level: it does not save anything)
     GU.looks.current()   the look that is showing, read from <html data-look>
     GU.looks.meta / list()   {id, label, tagline} for each look

   GU.look is what the rest of the app (and the person) uses:
     GU.look.get()            'glass' or 'bold' (the one asked for last, even while the cross-fade is still running)
     GU.look.set(id)          switches with a short cross-fade, saves it (settings.look, synced to your other devices, and
                              localStorage 'groundup.look' so the first paint is right), toasts its name. Not part of Undo.
     GU.look.toggle()         the other one
     GU.look.onChange(fn)     fn(id, previousId, {remote}) as a switch starts (the page changes a moment later, inside the cross-fade);
                              remote is true for a change that came from elsewhere. Returns a function that stops listening
     GU.look.list()           [{id, label, tagline}]
     GU.look.init()           called once by app.js after the data is loaded: picks settings.look, else localStorage, else 'glass'
   A change to settings.look that arrives from elsewhere (another device through sync, a restored backup) switches live.

   The switch controls (rail button, phone More menu, Settings cards) and the browser's bar colour (<meta name="theme-color">,
   read from the look's --look-bar custom property on :root, falling back to --bg) are wired here too.

   Colours (the accent palettes) sit on top of the looks: each look's stylesheet carries the same five palettes (ids below), so the choice is
   look-independent and survives a look switch. <html data-palette="ocean|blush|meadow|dusk"> picks one; the default palette has no attribute.
     GU.look.getPalette()        the id showing ('default' when none), even while the cross-fade is still running
     GU.look.setPalette(id)      applies it with the same short cross-fade, saves it (settings.palette, synced to your other devices, and
                                 localStorage 'groundup.palette' so the first paint is right), toasts its name. Not part of Undo.
     GU.look.palettes(lookId?)   [{id, label, hint}] with the names the given (or the showing) look uses
     GU.look.onPalette(fn)       fn(id, previousId, {remote}) as a change starts. Returns a function that stops listening
     GU.look.paletteRowHTML()    the "Colours" row of the Settings > Look panel (a radiogroup of five two-tone swatches)
   A change to settings.palette that arrives from elsewhere (another device through sync, a restored backup) applies live.

   To add a third look: add it to `meta` below, give it css/look-<id>.css (a <link data-look-css="<id>"> in index.html, plus the
   id in the one-line script in <head> that reads localStorage) and a js/look-<id>.js that registers itself. See README.md. */
(function () {
  'use strict';
  const GU = (window.GU = window.GU || {});
  const root = document.documentElement;
  const KEY = 'groundup.look';
  const meta = {
    glass: { id: 'glass', label: 'Soft Glass', tagline: 'Airy and frosted, with soft springy movement' },
    bold: { id: 'bold', label: 'Bold Colour', tagline: 'Rich colour blocks, heavy numbers, snappy movement' },
  };
  const IDS = Object.keys(meta);
  const known = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(meta, id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- the registry ---------- */
  const mods = {};
  let on = null;
  let booted = false;

  function current() {
    const a = root.getAttribute('data-look');
    return known(a) ? a : 'glass';
  }
  function swapCss(id) {
    document.querySelectorAll('[data-look-css]').forEach((l) => {
      l.disabled = l.getAttribute('data-look-css') !== id;
    });
  }
  /* A look's stylesheet that has never been switched on has no sheet yet (a disabled <link> is not parsed), and switching it on loads it a
     moment later. The switch waits for that (view transitions hold the old picture until then), so the page never shows the plain base
     look in between, and the browser bar colour is read once the sheet is in. */
  function sheetWait(id) {
    const link = document.querySelector('link[data-look-css="' + id + '"]');
    if (!link || link.disabled || link.sheet) return undefined;
    return new Promise((resolve) => {
      let t = 0;
      const done = () => {
        clearTimeout(t);
        link.removeEventListener('load', done);
        link.removeEventListener('error', done);
        try {
          GU.look.syncBar(true);
        } catch (e) {
          /* the bar keeps its colour */
        }
        resolve();
      };
      t = setTimeout(done, 1200);
      link.addEventListener('load', done);
      link.addEventListener('error', done);
    });
  }
  /* Quietly fetch the stylesheet of a look that is not showing (a twin <link> that applies to nothing, removed again when it has loaded), so
     the first switch to it finds it in the cache. Done once the app is up; a switch that comes sooner waits for it. */
  const warming = {};
  const warmed = {};
  function ensureWarm(id) {
    if (warmed[id]) return Promise.resolve();
    if (warming[id]) return warming[id];
    const l = document.querySelector('link[data-look-css="' + id + '"]');
    if (!l || !l.href || !l.disabled || l.sheet) {
      warmed[id] = true;
      return Promise.resolve();
    }
    warming[id] = new Promise((resolve) => {
      const twin = document.createElement('link');
      twin.rel = 'stylesheet';
      twin.media = 'not all';
      twin.href = l.href;
      twin.setAttribute('data-look-warm', '');
      let t = 0;
      const done = (ok) => {
        clearTimeout(t);
        if (twin.parentNode) twin.parentNode.removeChild(twin);
        if (ok) warmed[id] = true;
        delete warming[id];
        resolve();
      };
      twin.addEventListener('load', () => done(true));
      twin.addEventListener('error', () => done(false));
      t = setTimeout(() => done(false), 8000);
      document.head.appendChild(twin);
    });
    return warming[id];
  }
  function warm() {
    IDS.forEach((id) => {
      if (id !== current()) ensureWarm(id);
    });
  }
  function run(id, fn) {
    try {
      const m = mods[id];
      if (m && typeof m[fn] === 'function') m[fn]();
    } catch (e) {
      console.error('look ' + id + ' ' + fn, e);
    }
  }
  /* Whatever goes wrong inside a look, the switch itself finishes: the attribute and the stylesheet are always set. */
  function apply(id) {
    id = known(id) ? id : 'glass';
    if (on && on !== id) {
      const old = on;
      on = null;
      run(old, 'disable');
    }
    try {
      root.setAttribute('data-look', id);
      swapCss(id);
    } catch (e) {
      console.error('look ' + id + ' apply', e);
    }
    if (booted && on !== id) {
      on = id;
      run(id, 'enable');
    }
    return id;
  }
  function register(id, mod) {
    mods[id] = mod;
    if (booted && on === id) run(id, 'enable');
  }
  function boot() {
    if (booted) return;
    booted = true;
    on = current();
    run(on, 'enable');
    setTimeout(warm, 250);
  }
  GU.looks = { meta, register, apply, current, boot, list: () => IDS.map((id) => meta[id]), has: known };
  // app.js calls boot() after its first render; this is only a safety net should that never happen.
  window.addEventListener('load', () => setTimeout(boot, 5000));

  /* ---------- the person-facing switch ---------- */
  const listeners = new Set();
  let inflight = 0; // switches asked for whose cross-fade hasn't finished
  let want = null; // the look the last of them asked for
  let lastStored = null; // the last settings.look seen, so only a CHANGE to it switches anything
  let started = false;

  const readLS = () => {
    try {
      const v = localStorage.getItem(KEY);
      return known(v) ? v : null;
    } catch (e) {
      return null;
    }
  };
  const writeLS = (id) => {
    try {
      localStorage.setItem(KEY, id);
    } catch (e) {
      /* private window: the choice still lives in settings */
    }
  };
  const stored = () => {
    const s = GU.store && GU.store.state && GU.store.state.settings;
    return s && known(s.look) ? s.look : null;
  };
  const get = () => (inflight && want ? want : current());
  const nextOf = (id) => IDS[(IDS.indexOf(id) + 1) % IDS.length];
  const next = () => nextOf(get());
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* The icon, built the way GU.ui.icon() builds the others (24px stroke, currentColor): two overlapping swatches, one tinted. */
  const ICON = '<circle cx="9" cy="12" r="6" fill="currentColor" fill-opacity="0.3"/><circle cx="15" cy="12" r="6"/>';
  function icon(cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON + '</svg>';
  }
  const phrase = () => 'Switch look. Now ' + meta[get()].label + '. Tap for ' + meta[next()].label + '.';

  /* ----- the cross-fade ----- */
  let swaps = 0;
  const swapDone = () => {
    swaps = Math.max(0, swaps - 1);
    if (!swaps) root.classList.remove('look-swapping');
  };
  /* fn changes the look. It is called exactly once, whatever happens to the animation. */
  function transition(fn, cold) {
    // cold: a function that resolves when the new look's stylesheet is in the cache, or null when it already is
    let ran = false;
    const once = () => {
      if (ran) return;
      ran = true;
      try {
        return fn();
      } catch (e) {
        console.error('look switch', e);
      }
    };
    // Reduced motion switches at once, unless the new look's stylesheet has never been fetched: then the old look stays (nothing moves) until it is in.
    if (reduced() && cold && document.body && !document.hidden) {
      cold().then(once, once);
      setTimeout(once, 1500);
      return;
    }
    if (reduced() || !document.body || document.hidden) return once();
    if (typeof document.startViewTransition === 'function') {
      try {
        swaps++;
        root.classList.add('look-swapping');
        const t = document.startViewTransition(once);
        t.finished.then(swapDone, swapDone);
        setTimeout(once, 700); // never left half-switched
        return;
      } catch (e) {
        swapDone();
        return once();
      }
    }
    // No view transitions (older browsers): the page fades out for a moment, changes, and fades back in (under 250ms in all).
    const app = document.getElementById('app');
    if (!app || typeof app.animate !== 'function') return once();
    let out = null;
    const finish = () => {
      if (ran) return;
      once();
      try {
        if (out) out.cancel();
        app.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
      } catch (e) {
        /* it just shows */
      }
    };
    try {
      out = app.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'ease-in', fill: 'forwards' });
      out.onfinish = finish;
      setTimeout(finish, 220);
    } catch (e) {
      once();
    }
  }

  function show(id) {
    want = id;
    inflight++;
    let counted = true;
    const link = document.querySelector('link[data-look-css="' + id + '"]');
    transition(() => {
      try {
        GU.looks.apply(want);
      } catch (e) {
        console.error('look switch', e);
      } finally {
        if (counted) {
          counted = false;
          inflight = Math.max(0, inflight - 1);
        }
      }
      // Whatever apply() did or didn't manage, the page ends up in the look that was asked for.
      if (current() !== want) {
        try {
          root.setAttribute('data-look', want);
          swapCss(want);
        } catch (e) {
          /* nothing more to do */
        }
      }
      syncUI();
      syncBar();
      return sheetWait(want);
    }, link && link.disabled && !link.sheet && !warmed[id] ? () => ensureWarm(id) : null);
  }

  function fire(id, prev, remote) {
    listeners.forEach((fn) => {
      try {
        fn(id, prev, { remote: !!remote });
      } catch (e) {
        console.error(e);
      }
    });
  }
  function persist(id) {
    writeLS(id);
    lastStored = id;
    try {
      const s = GU.store;
      if (s && s.state && s.state.settings && s.state.settings.look !== id) s.commit((st) => { st.settings.look = id; }, { history: false });
    } catch (e) {
      console.error(e);
    }
  }
  function set(id) {
    if (!known(id)) return get();
    const prev = get();
    // The change is asked for first, so get() already answers with the new look while the page redraws for the save below.
    if (id !== prev || current() !== id) show(id);
    persist(id);
    if (id !== prev) {
      syncUI();
      fire(id, prev, false);
      if (GU.ui && GU.ui.toast) GU.ui.toast(meta[id].label);
    }
    return id;
  }
  const toggle = () => set(next());
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* settings.look changed by something other than this device's own switch (sync from another device, a restored backup). */
  function onStore() {
    onStorePalette();
    const v = stored();
    if (!v || v === lastStored) return;
    lastStored = v;
    writeLS(v);
    const prev = get();
    if (v === prev) return;
    show(v);
    syncUI();
    fire(v, prev, true);
    if (GU.ui && GU.ui.toast) GU.ui.toast('Switched to ' + meta[v].label + ' to match your other device');
  }

  /* ---------- colours: the accent palettes ---------- */
  /* Five palettes, the same ids in both looks (each look's stylesheet carries them all), so the choice is look-independent. A name may differ
     by look: the original colours are lilac and aqua in Soft Glass and plum and teal in Bold Colour. */
  const PKEY = 'groundup.palette';
  const PALS = [
    { id: 'default', label: { glass: 'Lilac and aqua (original)', bold: 'Plum and teal (original)' }, hint: { glass: 'Lilac for Home, aqua for Work', bold: 'Plum for Home, teal for Work' } },
    { id: 'ocean', label: 'Ocean', hint: 'Blue for Home, sea green for Work' },
    { id: 'blush', label: 'Blush', hint: 'Rose for Home, slate for Work' },
    { id: 'meadow', label: 'Meadow', hint: 'Green for Home, heather for Work' },
    { id: 'dusk', label: 'Dusk', hint: 'Indigo for Home, plum for Work' },
  ];
  const PIDS = PALS.map((p) => p.id);
  const pknown = (id) => typeof id === 'string' && PIDS.indexOf(id) >= 0;
  const named = (v, look) => (v && typeof v === 'object' ? v[look] || v.glass : v);
  /* [{id, label, hint}] with the names the given look (default: the one showing) uses. */
  function palettes(lookId) {
    const l = known(lookId) ? lookId : get();
    return PALS.map((p) => ({ id: p.id, label: named(p.label, l), hint: named(p.hint, l) }));
  }
  const palMeta = (id) => palettes().filter((p) => p.id === id)[0] || palettes()[0];

  const pListeners = new Set();
  let pInflight = 0; // palette changes asked for whose cross-fade hasn't finished
  let pWant = null; // the palette the last of them asked for
  let lastStoredPal = null; // the last settings.palette seen, so only a CHANGE to it applies anything
  const currentPalette = () => {
    const a = root.getAttribute('data-palette');
    return pknown(a) ? a : 'default';
  };
  const getPalette = () => (pInflight && pWant ? pWant : currentPalette());
  const readPalLS = () => {
    try {
      const v = localStorage.getItem(PKEY);
      return pknown(v) ? v : null;
    } catch (e) {
      return null;
    }
  };
  const writePalLS = (id) => {
    try {
      if (id === 'default') localStorage.removeItem(PKEY);
      else localStorage.setItem(PKEY, id);
    } catch (e) {
      /* private window: the choice still lives in settings */
    }
  };
  const storedPalette = () => {
    const s = GU.store && GU.store.state && GU.store.state.settings;
    return s && pknown(s.palette) ? s.palette : null;
  };
  /* The attribute is the whole switch: no attribute is the default palette. */
  function applyPalette(id) {
    id = pknown(id) ? id : 'default';
    if (id === 'default') root.removeAttribute('data-palette');
    else root.setAttribute('data-palette', id);
    return id;
  }
  function showPalette(id) {
    pWant = id;
    pInflight++;
    let counted = true;
    transition(() => {
      try {
        applyPalette(pWant);
      } catch (e) {
        console.error('palette', e);
      } finally {
        if (counted) {
          counted = false;
          pInflight = Math.max(0, pInflight - 1);
        }
      }
      syncPaletteUI();
      syncBar(true);
    }, null);
  }
  function firePalette(id, prev, remote) {
    pListeners.forEach((fn) => {
      try {
        fn(id, prev, { remote: !!remote });
      } catch (e) {
        console.error(e);
      }
    });
  }
  function persistPalette(id) {
    writePalLS(id);
    lastStoredPal = id;
    try {
      const s = GU.store;
      if (s && s.state && s.state.settings && s.state.settings.palette !== id) s.commit((st) => { st.settings.palette = id; }, { history: false });
    } catch (e) {
      console.error(e);
    }
  }
  function setPalette(id) {
    if (!pknown(id)) return getPalette();
    const prev = getPalette();
    // The change is asked for first, so getPalette() already answers with the new one while the page redraws for the save below.
    if (id !== prev || currentPalette() !== id) showPalette(id);
    persistPalette(id);
    if (id !== prev) {
      syncPaletteUI();
      firePalette(id, prev, false);
      if (GU.ui && GU.ui.toast) GU.ui.toast('Colours: ' + palMeta(id).label);
    }
    return id;
  }
  function onPalette(fn) {
    pListeners.add(fn);
    return () => pListeners.delete(fn);
  }
  /* settings.palette changed by something other than this device's own choice (sync from another device, a restored backup). */
  function onStorePalette() {
    const v = storedPalette();
    if (!v || v === lastStoredPal) return;
    lastStoredPal = v;
    writePalLS(v);
    const prev = getPalette();
    if (v === prev) return;
    showPalette(v);
    syncPaletteUI();
    firePalette(v, prev, true);
    if (GU.ui && GU.ui.toast) GU.ui.toast('Colours changed to ' + palMeta(v).label + ' to match your other device');
  }

  /* The "Colours" row for the Look panel in Settings: a radiogroup of five two-tone swatches (Home and Work, as the look showing draws them:
     the colours come from css/look-*.css, .pal-sw--<id>), the name under each, and a line saying the choice is for both parts. The radios are
     real ones (arrow keys move between them), covered by their label, so a tap anywhere on a swatch picks it. */
  function paletteRowHTML() {
    const now = getPalette();
    const list = palettes();
    const cur = list.filter((p) => p.id === now)[0] || list[0];
    const tick = '<svg class="pal__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 12.5 4 4 8-9"/></svg>';
    return '<div class="pal-row" data-pal-row>' +
      '<div class="pal-row__head"><span class="pal-row__title" id="pal-title">Colours</span><span class="muted pal-row__now" data-pal-now>Now: ' + esc(cur.label) + '</span></div>' +
      '<div class="pal-grid" role="radiogroup" aria-labelledby="pal-title">' + list.map((p) =>
        '<label class="pal"><input type="radio" name="palette" value="' + esc(p.id) + '"' + (p.id === now ? ' checked' : '') + ' aria-label="' + esc(p.label + '. ' + p.hint) + '">' +
        '<span class="pal__sw pal-sw--' + esc(p.id) + '" aria-hidden="true"><i class="pal__h"></i><i class="pal__w"></i></span>' + tick +
        '<span class="pal__name">' + esc(p.label) + '</span></label>').join('') + '</div>' +
      '<p class="muted pal-row__hint">These colours are for both Home and Work. Each set has its own shade for each, so you can still tell them apart.</p></div>';
  }
  /* Keeps any Colours row on the page in step: the one ticked, "Now: ...", and the names (the original colours are named after the look showing). */
  function syncPaletteUI() {
    const now = getPalette();
    const list = palettes();
    document.querySelectorAll('input[name="palette"]').forEach((r) => {
      if (r.checked !== (r.value === now)) r.checked = r.value === now;
      const p = list.filter((x) => x.id === r.value)[0];
      if (!p) return;
      const aria = p.label + '. ' + p.hint;
      if (r.getAttribute('aria-label') !== aria) r.setAttribute('aria-label', aria);
      const name = r.parentNode && r.parentNode.querySelector('.pal__name');
      if (name && name.textContent !== p.label) name.textContent = p.label;
    });
    const cur = list.filter((p) => p.id === now)[0] || list[0];
    document.querySelectorAll('[data-pal-now]').forEach((el) => {
      const t = 'Now: ' + cur.label;
      if (el.textContent !== t) el.textContent = t;
    });
  }
  // A swatch picked in Settings. The page redraws as the choice is saved, so the keyboard is put back on the swatch that was picked.
  document.addEventListener('change', (e) => {
    const r = e.target && e.target.closest ? e.target.closest('input[name="palette"]') : null;
    if (!r || !r.closest('[data-pal-row]')) return;
    const v = r.value;
    setPalette(v);
    const again = document.querySelector('[data-pal-row] input[value="' + v + '"]');
    if (again && again !== r) again.focus({ preventScroll: true });
  });

  /* ----- the controls ----- */
  /* Desktop: a button in the rail's foot, just above Settings. */
  function railHTML() {
    return '<button type="button" class="rail__item rail__look" data-look-toggle aria-label="' + esc(phrase()) + '" data-tip="Switch to ' + esc(meta[next()].label) + '">' +
      '<span class="rail__ico">' + icon() + '</span><span class="rail__label">Look</span></button>';
  }
  /* Phone: one More button in the top bar (where Undo and Redo used to be), opening Undo, Redo and Switch look. */
  function barHTML() {
    return '<button type="button" class="partbar__tool partbar__more" data-look-toggle="menu" aria-haspopup="menu" aria-label="More: undo, redo and switch look">' +
      (GU.ui ? GU.ui.icon('more') : '') + '</button>';
  }
  function openMenu(anchor) {
    const h = GU.history ? GU.history.status() : { canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' };
    const back = () => {
      if (anchor && anchor.isConnected && anchor.focus) anchor.focus({ preventScroll: true });
    };
    const items = [
      { icon: 'undo', label: 'Undo', hint: h.canUndo ? h.undoLabel || 'The latest change' : 'Nothing to undo', disabled: !h.canUndo, onClick: () => { GU.history.undo(); back(); } },
      { icon: 'redo', label: 'Redo', hint: h.canRedo ? h.redoLabel || 'The change you undid' : 'Nothing to redo', disabled: !h.canRedo, onClick: () => { GU.history.redo(); back(); } },
      { separator: true },
      { icon: 'info', label: 'Switch look', hint: 'Now ' + meta[get()].label + '. Tap for ' + meta[next()].label + '.', onClick: () => { toggle(); back(); } },
    ];
    const el = GU.ui.menu(anchor, items);
    const own = el && el.querySelector('button[data-i="3"]');
    if (own) {
      own.setAttribute('data-look-menu-item', '');
      const old = own.querySelector('svg');
      if (old) old.outerHTML = icon();
    }
    return el;
  }
  function syncUI() {
    const now = get();
    const label = phrase();
    const tip = 'Switch to ' + meta[next()].label;
    document.querySelectorAll('[data-look-toggle]').forEach((b) => {
      b.setAttribute('data-look-now', now);
      if (b.getAttribute('data-look-toggle') === 'menu') return;
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
      if (b.getAttribute('data-tip') !== tip) b.setAttribute('data-tip', tip);
    });
    syncPaletteUI();
  }

  /* ----- the browser's bar colour ----- */
  let canvas = null;
  /* Any CSS colour as #rrggbb, or null if it isn't one (the canvas is asked twice, on two backgrounds, to tell). */
  function toHex(css) {
    if (!css) return null;
    try {
      canvas = canvas || document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const read = (base) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = base;
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const p = ctx.getImageData(0, 0, 1, 1).data;
        return [p[0], p[1], p[2], p[3]];
      };
      const a = read('#000000');
      const b = read('#ffffff');
      if (a.join() !== b.join() || a[3] < 128) return null;
      return '#' + a.slice(0, 3).map((v) => ('0' + v.toString(16)).slice(-2)).join('');
    } catch (e) {
      return null;
    }
  }
  let barKey = '';
  function barMeta() {
    let m = document.head.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', 'theme-color');
      document.head.appendChild(m);
    }
    return m;
  }
  /* The look's own --look-bar for the colour scheme in use (it follows the palette and the part), else the page colour. Refreshed on look, palette, theme and part changes. */
  function syncBar(force) {
    try {
      const dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const key = [root.getAttribute('data-look'), root.getAttribute('data-palette'), root.getAttribute('data-theme'), root.getAttribute('data-part'), dark].join('|');
      if (!force && key === barKey) return;
      barKey = key;
      const cs = getComputedStyle(root);
      const hex = toHex((cs.getPropertyValue('--look-bar') || '').trim()) || toHex((cs.getPropertyValue('--bg') || '').trim());
      if (!hex) return;
      const m = barMeta();
      if (m.getAttribute('content') !== hex) m.setAttribute('content', hex);
    } catch (e) {
      /* the bar keeps its colour */
    }
  }
  let barTimer = 0;
  const scheduleBar = () => {
    clearTimeout(barTimer);
    barTimer = setTimeout(syncBar, 40);
  };

  function init() {
    if (started) return;
    started = true;
    lastStored = stored();
    const id = lastStored || readLS() || 'glass';
    GU.looks.apply(id); // before the first render: no behaviour yet, boot() adds it
    writeLS(id);
    lastStoredPal = storedPalette();
    const pid = lastStoredPal || readPalLS() || 'default';
    applyPalette(pid); // the first paint already had it (index.html reads localStorage); this settles an unknown or out-of-date value
    writePalLS(pid);
    syncBar(true);
    if (GU.store && GU.store.subscribe) GU.store.subscribe(onStore);
    try {
      new MutationObserver(scheduleBar).observe(root, { attributes: true, attributeFilter: ['data-look', 'data-palette', 'data-theme', 'data-part'] });
      if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleBar);
    } catch (e) {
      /* the bar colour then follows look switches only */
    }
  }

  GU.look = {
    get, set, toggle, onChange, init, next,
    list: () => IDS.map((id) => meta[id]),
    meta: (id) => meta[known(id) ? id : get()],
    icon, railHTML, barHTML, openMenu, syncUI, syncBar,
    getPalette, setPalette, palettes, onPalette, paletteRowHTML, syncPaletteUI,
  };
})();
