/* The Ground Up: privacy screen. An optional passcode that covers the app when it opens and after a while of
   no use. It is a screen cover, not encryption: nothing is scrambled except the passcode itself, which is kept
   (salted and hashed) in this browser only, under its own localStorage key. Each device has its own, and none
   of it is synced. There is no 'forgot' button and no way round it from inside the app. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, plural } = GU.util;
  const { icon } = GU.ui;

  const KEY = 'groundup.lock';
  const ITER = 120000; // PBKDF2 rounds
  const TRIES = 5; // wrong tries before the first wait
  const FIRST_WAIT = 30; // seconds, doubling with each wrong try after that
  const MAX_WAIT = 3600;
  const AFTER = [
    { value: 0, label: 'Never (only when the app opens)' },
    { value: 1, label: '1 minute of no use' },
    { value: 5, label: '5 minutes of no use' },
    { value: 15, label: '15 minutes of no use' },
  ];

  /* ---------- scrambling the passcode ---------- */
  /* PBKDF2 with HMAC-SHA-256, the same answer whether crypto.subtle does it or the plain-JS copy below does
     (crypto.subtle only exists on https and localhost, so a copy opened some other way still has to work). */
  const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  /* One SHA-256 round over the 16 words already in w[0..15]; st is updated in place. */
  function compress(st, w) {
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      w[i] = (w[i - 16] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 7] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) | 0;
    }
    let a = st[0], b = st[1], c = st[2], d = st[3], e = st[4], f = st[5], g = st[6], h = st[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    st[0] = (st[0] + a) | 0; st[1] = (st[1] + b) | 0; st[2] = (st[2] + c) | 0; st[3] = (st[3] + d) | 0;
    st[4] = (st[4] + e) | 0; st[5] = (st[5] + f) | 0; st[6] = (st[6] + g) | 0; st[7] = (st[7] + h) | 0;
  }
  /* PBKDF2-HMAC-SHA256, 32 bytes out. The salt is 16 bytes and the passcode at most 64, which is all this needs. */
  function pbkdf2Js(pass, salt, iter) {
    const w = new Uint32Array(64);
    const pad = (x) => {
      const st = Uint32Array.from(IV);
      for (let i = 0; i < 16; i++) {
        const o = i * 4;
        const b = (j) => (o + j < pass.length ? pass[o + j] : 0) ^ x;
        w[i] = ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
      }
      compress(st, w);
      return st;
    };
    const inner = pad(0x36);
    const outer = pad(0x5c);
    const st = new Uint32Array(8);
    const u = new Uint32Array(8);
    const t = new Uint32Array(8);
    /* The outer half of an HMAC: hash the 32-byte inner digest (in st) under the outer key. The answer lands in u. */
    const finish = () => {
      w.fill(0);
      for (let i = 0; i < 8; i++) w[i] = st[i];
      w[8] = 0x80000000;
      w[15] = (64 + 32) * 8;
      st.set(outer);
      compress(st, w);
      u.set(st);
    };
    // The first round hashes the salt plus a block counter of 1.
    const msg = new Uint8Array(salt.length + 4);
    msg.set(salt);
    msg[salt.length + 3] = 1;
    st.set(inner);
    w.fill(0);
    for (let i = 0; i < msg.length; i++) w[i >> 2] |= msg[i] << (24 - (i & 3) * 8);
    w[msg.length >> 2] |= 0x80 << (24 - (msg.length & 3) * 8);
    w[15] = (64 + msg.length) * 8;
    compress(st, w);
    finish();
    t.set(u);
    for (let r = 1; r < iter; r++) {
      st.set(inner);
      w.fill(0);
      for (let i = 0; i < 8; i++) w[i] = u[i];
      w[8] = 0x80000000;
      w[15] = (64 + 32) * 8;
      compress(st, w);
      finish();
      for (let i = 0; i < 8; i++) t[i] ^= u[i];
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = t[i] >>> 24;
      out[i * 4 + 1] = (t[i] >>> 16) & 255;
      out[i * 4 + 2] = (t[i] >>> 8) & 255;
      out[i * 4 + 3] = t[i] & 255;
    }
    return out;
  }
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (s) => Uint8Array.from((String(s).match(/../g) || []).map((x) => parseInt(x, 16)));
  function randomBytes(n) {
    const out = new Uint8Array(n);
    try {
      window.crypto.getRandomValues(out);
    } catch (e) {
      for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    }
    return out;
  }
  async function derive(code, salt, iter) {
    const pass = Uint8Array.from(String(code), (c) => c.charCodeAt(0) & 255);
    const sub = window.crypto && window.crypto.subtle;
    if (sub && sub.importKey && sub.deriveBits) {
      try {
        const key = await sub.importKey('raw', pass, 'PBKDF2', false, ['deriveBits']);
        return new Uint8Array(await sub.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
      } catch (e) {
        /* fall through to the plain-JS copy */
      }
    }
    await new Promise((r) => setTimeout(r, 20)); // let the screen paint: this version takes a moment
    return pbkdf2Js(pass, salt, iter);
  }
  const same = (a, b) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };

  /* ---------- this device's setting ---------- */
  let cfg = null; // {on, salt, hash, iter, len, after (minutes), fails, until (ms)} or null when it's off
  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!v || typeof v !== 'object' || !v.on || !v.salt || !v.hash) return null;
      const out = Object.assign({ iter: ITER, len: 4, after: 5, fails: 0, until: 0 }, v);
      out.len = Math.min(8, Math.max(4, Math.round(Number(out.len)) || 4));
      out.after = Number.isFinite(Number(out.after)) && Number(out.after) >= 0 ? Number(out.after) : 5;
      out.fails = Math.max(0, Math.round(Number(out.fails)) || 0);
      out.until = Number(out.until) || 0;
      return out;
    } catch (e) {
      return null;
    }
  }
  function save(c) {
    try {
      if (c) localStorage.setItem(KEY, JSON.stringify(c));
      else localStorage.removeItem(KEY);
      return true;
    } catch (e) {
      return false;
    }
  }
  const canSave = () => {
    try {
      localStorage.setItem(KEY + '.test', '1');
      localStorage.removeItem(KEY + '.test');
      return true;
    } catch (e) {
      return false;
    }
  };
  const enabled = () => !!cfg;
  /* Seconds to wait after this many wrong tries in a row: none for the first four, then 30, 60, 120… */
  const waitFor = (fails) => (fails < TRIES ? 0 : Math.min(MAX_WAIT, FIRST_WAIT * Math.pow(2, fails - TRIES)));
  const validCode = (c) => /^\d{4,8}$/.test(String(c));

  async function check(code) {
    if (!cfg || !validCode(code)) return false;
    const got = hex(await derive(code, unhex(cfg.salt), cfg.iter || ITER));
    return same(got, cfg.hash);
  }
  async function scramble(code, after, len) {
    const salt = randomBytes(16);
    return { on: true, salt: hex(salt), hash: hex(await derive(code, salt, ITER)), iter: ITER, len: len || String(code).length, after, fails: 0, until: 0 };
  }

  /* ---------- the cover ---------- */
  let cover = null; // {el, box, dots, msg, pad, entry, busy, tick}
  let prevFocus = null;
  let lastActive = Date.now();
  let timer = null;

  const appEl = () => document.getElementById('app');
  const fire = (name) => {
    try {
      document.dispatchEvent(new CustomEvent(name));
    } catch (e) {
      /* nothing is listening */
    }
  };
  const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'];
  /* The cover's markup holds no data at all: the app's name, some dots and a number pad. */
  function coverHTML(len) {
    return '<div class="lockscreen__box" tabindex="-1" autofocus>' +
      '<span class="lockscreen__logo" aria-hidden="true">G</span>' +
      '<h1 class="lockscreen__title">Locked</h1>' +
      '<p class="lockscreen__sub">Enter your passcode.</p>' +
      '<div class="lockscreen__dots" role="img" aria-label="0 of ' + len + ' numbers entered">' + '<i></i>'.repeat(len) + '</div>' +
      '<p class="lockscreen__msg" role="status" aria-live="polite"></p>' +
      '<div class="lockpad" role="group" aria-label="Number pad">' + PAD.map((k) => k === 'clear'
        ? '<button type="button" class="lockpad__key lockpad__key--act" data-act="clear" aria-label="Clear">Clear</button>'
        : k === 'del' ? '<button type="button" class="lockpad__key lockpad__key--act" data-act="del" aria-label="Delete the last number">Delete</button>'
        : '<button type="button" class="lockpad__key" data-d="' + k + '">' + k + '</button>').join('') + '</div></div>';
  }
  /* The tab's title says which page you're on, so it reads 'Locked' too while the cover is up. */
  const LOCKED_TITLE = 'Locked · The Ground Up';
  let realTitle = '';
  let titleWatch = null;
  function hideTitle() {
    realTitle = document.title === LOCKED_TITLE ? realTitle : document.title;
    document.title = LOCKED_TITLE;
    const t = document.querySelector('title');
    if (t && window.MutationObserver && !titleWatch) {
      titleWatch = new MutationObserver(() => {
        if (!cover || document.title === LOCKED_TITLE) return;
        realTitle = document.title; // the app changed it behind the cover: keep that for later
        document.title = LOCKED_TITLE;
      });
      titleWatch.observe(t, { childList: true, characterData: true, subtree: true });
    }
  }
  function showTitle() {
    if (titleWatch) titleWatch.disconnect();
    titleWatch = null;
    if (realTitle) document.title = realTitle;
  }
  function show() {
    if (cover || !cfg) return;
    if (!document.body) return;
    prevFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    document.documentElement.classList.add('is-locked');
    const app = appEl();
    if (app) {
      app.inert = true;
      app.setAttribute('aria-hidden', 'true');
    }
    try {
      if (GU.ui.closeMenu) GU.ui.closeMenu();
    } catch (e) {
      /* no menu */
    }
    const el = document.createElement('dialog');
    el.className = 'lockscreen';
    el.setAttribute('aria-label', 'The Ground Up is locked');
    // Enough styling to cover everything even before the stylesheet arrives.
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:var(--bg,#f5f2ec);color:var(--ink,#181b21)';
    el.innerHTML = coverHTML(cfg.len);
    document.body.appendChild(el);
    cover = { el, box: el.firstChild, dots: el.querySelector('.lockscreen__dots'), msg: el.querySelector('.lockscreen__msg'), entry: '', busy: false, tick: null };
    try {
      el.showModal();
    } catch (e) {
      el.setAttribute('open', '');
    }
    // Escape, or anything else that would close it, just puts it back.
    el.addEventListener('cancel', (e) => e.preventDefault());
    el.addEventListener('close', () => {
      if (cover && cover.el === el) setTimeout(() => cover && cover.el === el && !el.open && (el.showModal ? el.showModal() : el.setAttribute('open', '')), 0);
    });
    el.addEventListener('click', onPad);
    if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) cover.box.focus({ preventScroll: true });
    watchBody();
    hideTitle();
    waitMessage();
    fire('gu:locked');
  }
  function hide() {
    if (!cover) return;
    const c = cover;
    cover = null;
    clearInterval(c.tick);
    unwatchBody();
    showTitle();
    c.el.remove();
    document.documentElement.classList.remove('is-locked');
    const app = appEl();
    if (app) {
      app.inert = false;
      app.removeAttribute('aria-hidden');
    }
    if (prevFocus && prevFocus.isConnected && prevFocus.focus) {
      try {
        prevFocus.focus({ preventScroll: true });
      } catch (e) {
        /* it went away */
      }
    }
    prevFocus = null;
    fire('gu:unlocked');
  }
  /* If something opens a dialog while the cover is up, the cover goes back on top of it. */
  let bodyWatch = null;
  function watchBody() {
    if (bodyWatch || !window.MutationObserver) return;
    bodyWatch = new MutationObserver((list) => {
      if (!cover || !list.some((m) => Array.from(m.addedNodes).some((n) => n !== cover.el && n.nodeName === 'DIALOG'))) return;
      setTimeout(() => {
        if (!cover || !cover.el.showModal) return;
        try {
          cover.el.close();
          cover.el.showModal();
        } catch (e) {
          /* already closed */
        }
      }, 0);
    });
    bodyWatch.observe(document.body, { childList: true });
  }
  function unwatchBody() {
    if (bodyWatch) bodyWatch.disconnect();
    bodyWatch = null;
  }

  function dots() {
    if (!cover) return;
    cover.dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('is-on', i < cover.entry.length));
    cover.dots.setAttribute('aria-label', cover.entry.length + ' of ' + cfg.len + ' numbers entered');
  }
  const say = (t, bad) => {
    if (!cover) return;
    cover.msg.textContent = t || '';
    cover.msg.classList.toggle('is-bad', !!bad);
  };
  /* While waiting after too many wrong tries: the pad is off and the message counts down. */
  function waitMessage() {
    if (!cover || !cfg) return;
    clearInterval(cover.tick);
    const left = () => Math.ceil((cfg.until - Date.now()) / 1000);
    const lock = (on) => cover.el.querySelectorAll('.lockpad__key').forEach((b) => (b.disabled = on));
    if (left() <= 0) return lock(false);
    lock(true);
    const draw = () => {
      if (!cover) return;
      const n = left();
      if (n <= 0) {
        clearInterval(cover.tick);
        lock(false);
        say('You can try again now.');
        return;
      }
      say('Too many wrong tries. Try again in ' + (n >= 120 ? Math.ceil(n / 60) + ' minutes' : plural(n, 'second')) + '.', true);
    };
    draw();
    cover.tick = setInterval(draw, 500);
  }
  function add(d) {
    if (!cover || cover.busy || cfg.until > Date.now() || cover.entry.length >= cfg.len) return;
    cover.entry += d;
    say('');
    dots();
    if (cover.entry.length === cfg.len) submit();
  }
  function del() {
    if (!cover || cover.busy || !cover.entry) return;
    cover.entry = cover.entry.slice(0, -1);
    dots();
  }
  function clear() {
    if (!cover || cover.busy) return;
    cover.entry = '';
    dots();
  }
  async function submit() {
    if (!cover || cover.busy || !cfg) return;
    if (cfg.until > Date.now()) return waitMessage();
    if (cover.entry.length < cfg.len) return say('Enter all ' + cfg.len + ' numbers.', true);
    const c = cover;
    c.busy = true;
    const code = c.entry;
    let ok = false;
    try {
      ok = await check(code);
    } catch (e) {
      ok = false;
    }
    c.busy = false;
    if (cover !== c) return;
    if (ok) {
      if (cfg.fails || cfg.until) {
        cfg.fails = 0;
        cfg.until = 0;
        save(cfg);
      }
      lastActive = Date.now();
      hide();
      arm();
      return;
    }
    cfg.fails = (cfg.fails || 0) + 1;
    const wait = waitFor(cfg.fails);
    cfg.until = wait ? Date.now() + wait * 1000 : 0;
    save(cfg);
    c.entry = '';
    dots();
    c.box.classList.remove('is-shaking');
    void c.box.offsetWidth;
    c.box.classList.add('is-shaking');
    if (wait) waitMessage();
    else say('That isn’t right. ' + plural(TRIES - cfg.fails, 'try', 'tries') + ' left before a short wait.', true);
  }
  function onPad(e) {
    const b = e.target.closest && e.target.closest('button');
    if (!b || !cover) return;
    if (b.dataset.d) add(b.dataset.d);
    else if (b.dataset.act === 'del') del();
    else if (b.dataset.act === 'clear') clear();
    // After a mouse or finger tap, keep the keyboard working: focus goes back to the box, not the key just tapped.
    if (e.detail > 0 && cover.box) cover.box.focus({ preventScroll: true });
  }
  /* The keyboard, while the cover is up: numbers, Backspace, Enter and Escape. Nothing else gets through to the app. */
  window.addEventListener('keydown', (e) => {
    if (!cover) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (/^\d$/.test(k)) {
      e.preventDefault();
      add(k);
    } else if (k === 'Backspace') {
      e.preventDefault();
      del();
    } else if (k === 'Escape') {
      e.preventDefault();
      clear();
    } else if (k === 'Enter' && !(e.target && e.target.closest && e.target.closest('.lockpad__key'))) {
      e.preventDefault();
      submit();
    }
  }, true);

  /* ---------- locking after a while of no use ---------- */
  const used = () => {
    lastActive = Date.now();
  };
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((t) => window.addEventListener(t, used, { capture: true, passive: true }));
  let lastMove = 0;
  window.addEventListener('pointermove', () => {
    const n = Date.now();
    if (n - lastMove > 1000) {
      lastMove = n;
      lastActive = n;
    }
  }, { passive: true });
  /* Locks if it has been quiet for the whole period; otherwise looks again when it would be time. */
  function arm() {
    clearTimeout(timer);
    timer = null;
    if (!cfg || cover || !cfg.after) return;
    const ms = cfg.after * 60000;
    const left = ms - (Date.now() - lastActive);
    if (left <= 0) return lockNow();
    timer = setTimeout(arm, Math.max(200, left));
  }
  function lockNow() {
    if (!cfg) return false;
    show();
    return !!cover;
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) arm();
  });
  window.addEventListener('pageshow', arm);
  window.addEventListener('focus', arm);
  // Another tab turned it on, off or changed it.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const was = cfg;
    cfg = read();
    if (!cfg) {
      hide();
      clearTimeout(timer);
    } else {
      if (cover && (!was || was.len !== cfg.len)) {
        hide();
        show();
      }
      arm();
    }
    syncButtons();
    redrawPanel();
  });

  /* ---------- the buttons: Lock in the rail and the phone bar, shown only when it's on ---------- */
  const railHTML = () => (enabled() ? '<button type="button" class="rail__item rail__lock" data-lock-now aria-label="Lock the dashboard now" title="Lock now"><span class="rail__ico">' + icon('lock') + '</span><span class="rail__label">Lock</span></button>' : '');
  const barHTML = () => '<button type="button" class="partbar__tool partbar__lock" data-lock-now aria-label="Lock the dashboard now"' + (enabled() ? '' : ' hidden') + '>' + icon('lock') + '</button>';
  function syncButtons() {
    document.querySelectorAll('.partbar__lock').forEach((b) => (b.hidden = !enabled()));
    if (GU.render && document.querySelector('.rail__items')) {
      try {
        GU.render();
      } catch (e) {
        console.error(e);
      }
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-lock-now]');
    if (!b) return;
    e.preventDefault();
    lockNow();
  });

  /* ---------- Settings › Privacy screen ---------- */
  function panelInner() {
    const on = enabled();
    const saved = canSave();
    const sync = GU.sync && GU.sync.active && GU.sync.active();
    const note = '<p class="muted">There’s no ‘forgot’ button, on purpose. If you forget it, clear this site’s data in your browser: ' +
      (sync ? 'your dashboard comes back from sync.' : 'your dashboard comes back from sync. Sync isn’t on here, so export a backup first (below) so you can restore it.') + '</p>';
    return '<header class="panel__head"><h2>' + icon('lock') + 'Privacy screen</h2>' + GU.ui.pill(on ? 'On for this device' : 'Off', on ? 'good' : 'muted') + '</header>' +
      '<div class="panel__body stack"><p>Hides your dashboard on this device until you enter the passcode. It doesn’t encrypt your data.</p>' +
      '<p class="muted">It’s a screen cover for when you open the app or step away, so people nearby can’t see your money and paperwork. Anyone who knows how to look inside this browser can still reach your data, and backups aren’t covered. Each device has its own passcode, and only a scrambled copy is kept, on this device.</p>' +
      (on
        ? '<div class="field lock-after"><label class="field__label" for="lock-after">Lock after</label><select id="lock-after" data-lock-after>' +
          GU.ui.selectOptions(AFTER, AFTER.some((a) => a.value === cfg.after) ? cfg.after : 5) + '</select></div>' +
          '<div class="field--row"><button type="button" class="btn btn--primary" data-lock-now>' + icon('lock') + 'Lock now</button>' +
          '<button type="button" class="btn" data-lock-change>Change passcode</button>' +
          '<button type="button" class="btn btn--danger" data-lock-off>Turn off</button></div>' + note
        : '<div class="field--row"><button type="button" class="btn btn--primary" data-lock-setup' + (saved ? '' : ' disabled') + '>' + icon('lock') + 'Turn on</button>' +
          (saved ? '' : '<span class="muted">This browser isn’t letting me save settings, so it can’t be turned on here.</span>') + '</div>' +
          '<p class="muted">You’ll choose a passcode of 4 to 8 numbers. There’s no ‘forgot’ button, on purpose, so keep it somewhere you won’t lose it.</p>') +
      '</div>';
  }
  const panel = () => '<section class="panel" id="privacy" data-lock-panel>' + panelInner() + '</section>';
  function redrawPanel() {
    document.querySelectorAll('[data-lock-panel]').forEach((p) => (p.innerHTML = panelInner()));
  }

  /* The passcode boxes are plain text boxes with a number keypad on phones. */
  const numeric = (v, form) => {
    form.querySelectorAll('input[type=password]').forEach((el) => {
      el.inputMode = 'numeric';
      el.maxLength = 8;
      el.setAttribute('autocomplete', 'one-time-code');
    });
  };
  const complain = (form, name, msg) => {
    const el = form.elements[name];
    el.setCustomValidity(msg);
    el.reportValidity();
    return false;
  };
  function setupDialog() {
    let form = null;
    GU.ui.formDialog({
      title: 'Turn on the privacy screen',
      intro: 'It hides your dashboard on this device until you enter the passcode. It doesn’t encrypt your data, and there’s no way to reset it if you forget it.',
      fields: [
        { name: 'code', label: 'Choose a passcode', type: 'password', required: true, help: '4 to 8 numbers.' },
        { name: 'again', label: 'Type it again', type: 'password', required: true },
      ],
      submitLabel: 'Turn on',
      onChange: (v, f) => {
        form = f;
        numeric(v, f);
      },
      onSubmit: async (v) => {
        if (!validCode(v.code)) return complain(form, 'code', 'Use 4 to 8 numbers, with no spaces or letters.');
        if (v.code !== v.again) return complain(form, 'again', 'The two passcodes are different.');
        try {
          await enable(v.code);
        } catch (e) {
          GU.ui.toast(e && e.message ? e.message : 'Couldn’t turn it on.');
          return false;
        }
        GU.ui.toast('Privacy screen is on. It covers the app ' + (cfg.after ? 'after ' + plural(cfg.after, 'minute') + ' of no use' : 'when you open it') + '.');
      },
    });
  }
  function changeDialog() {
    let form = null;
    GU.ui.formDialog({
      title: 'Change your passcode',
      fields: [
        { name: 'old', label: 'Current passcode', type: 'password', required: true },
        { name: 'code', label: 'New passcode', type: 'password', required: true, help: '4 to 8 numbers.' },
        { name: 'again', label: 'Type the new one again', type: 'password', required: true },
      ],
      submitLabel: 'Change passcode',
      onChange: (v, f) => {
        form = f;
        numeric(v, f);
      },
      onSubmit: async (v) => {
        if (!(await check(v.old))) return complain(form, 'old', 'That isn’t your passcode.');
        if (!validCode(v.code)) return complain(form, 'code', 'Use 4 to 8 numbers, with no spaces or letters.');
        if (v.code !== v.again) return complain(form, 'again', 'The two passcodes are different.');
        try {
          await change(v.old, v.code);
        } catch (e) {
          GU.ui.toast(e && e.message ? e.message : 'Couldn’t change it.');
          return false;
        }
        GU.ui.toast('Passcode changed');
      },
    });
  }
  function offDialog() {
    let form = null;
    GU.ui.formDialog({
      title: 'Turn off the privacy screen',
      intro: 'Your dashboard will open without a passcode on this device.',
      fields: [{ name: 'old', label: 'Your passcode', type: 'password', required: true }],
      submitLabel: 'Turn off',
      onChange: (v, f) => {
        form = f;
        numeric(v, f);
      },
      onSubmit: async (v) => {
        if (!(await check(v.old))) return complain(form, 'old', 'That isn’t your passcode.');
        await disable(v.old);
        GU.ui.toast('Privacy screen is off');
      },
    });
  }
  /* Settings calls this after it draws the page. */
  function wirePanel(root) {
    const host = root.querySelector('[data-lock-panel]');
    if (!host) return;
    host.addEventListener('click', (e) => {
      const b = (sel) => e.target.closest(sel);
      if (b('[data-lock-setup]')) return setupDialog();
      if (b('[data-lock-change]')) return changeDialog();
      if (b('[data-lock-off]')) return offDialog();
    });
    host.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-lock-after]');
      if (!sel) return;
      setOptions({ after: Number(sel.value) });
      GU.ui.toast(cfg.after ? 'It will lock after ' + plural(cfg.after, 'minute') + ' of no use' : 'It will only lock when the app opens');
    });
  }

  /* ---------- the API ---------- */
  async function enable(code) {
    if (!validCode(code)) throw new Error('Use 4 to 8 numbers, with no spaces or letters.');
    const next = await scramble(code, cfg ? cfg.after : 5);
    if (!save(next)) throw new Error('This browser isn’t letting me save settings, so the privacy screen can’t be turned on here.');
    cfg = next;
    lastActive = Date.now();
    arm();
    syncButtons();
    redrawPanel();
    return true;
  }
  async function change(old, code) {
    if (!(await check(old))) throw new Error('That isn’t your passcode.');
    if (!validCode(code)) throw new Error('Use 4 to 8 numbers, with no spaces or letters.');
    const next = await scramble(code, cfg.after);
    if (!save(next)) throw new Error('This browser isn’t letting me save settings.');
    cfg = next;
    redrawPanel();
    return true;
  }
  async function disable(code) {
    if (!(await check(code))) throw new Error('That isn’t your passcode.');
    save(null);
    cfg = null;
    clearTimeout(timer);
    hide();
    syncButtons();
    redrawPanel();
    return true;
  }
  function setOptions(o) {
    if (!cfg || !o) return;
    if (o.after != null && Number.isFinite(Number(o.after)) && Number(o.after) >= 0) cfg.after = Number(o.after);
    save(cfg);
    arm();
    redrawPanel();
  }
  /* Called when the app starts: puts the cover on if it's on, and starts watching for no use. */
  function start() {
    cfg = read();
    lastActive = Date.now();
    if (cfg) show();
    arm();
    syncButtons();
  }

  GU.lock = {
    start, enabled, enable, change, disable, setOptions, check,
    isLocked: () => !!cover,
    lock: lockNow,
    status: () => ({ enabled: enabled(), locked: !!cover, after: cfg ? cfg.after : null, len: cfg ? cfg.len : null, fails: cfg ? cfg.fails : 0, until: cfg ? cfg.until : 0 }),
    panel, wirePanel, railHTML, barHTML, syncButtons,
  };

  // The cover goes up the moment this file runs, before the app has drawn anything.
  cfg = read();
  if (cfg) show();
})();
