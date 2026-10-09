/* illustrations.js: GU.art, the small spot illustrations for empty states, and the shared loading placeholders.
   Presentation only. Nothing here reads or writes your data, changes any wording, or adds anything the app does.

   GU.art.svg(kind, opts)   -> an inline <svg> string (decorative: aria-hidden, no title), viewBox 160 x 120.
   GU.art.block(kind, opts) -> the wrapped markup: <div class="empty-art empty-art--full|compact" aria-hidden="true">...</div>
   GU.art.row(kind, html)   -> a short note with a small picture beside it, for an empty inside a panel.
   GU.art.kinds()           -> the names of the drawings.   GU.art.forIcon(iconName) -> the drawing that goes with a UI icon.
   GU.art.skeleton(n, opts) -> a few quiet placeholder lines (aria-hidden) for a busy state.   GU.art.phase() -> keeps a shimmer in step.

   One style for all of them: rounded shapes, a few layers, one accent. Every shape carries a role class (b backdrop, p paper,
   q back sheet, s soft tint, a accent, m text bar, w white, l/lw strokes, pop sparkles) and css/art.css decides what a role looks like,
   from the app's own tokens (--accent, --accent-soft, --ink, --line, --surface), so a look, a palette or dark mode recolours them.
   Hooks for look and palette CSS: --art-1 (accent), --art-2 (soft tint), --art-ink, --art-line, --art-paper. */
(function () {
  'use strict';
  const GU = (window.GU = window.GU || {});

  /* ---------- little builders ---------- */
  const f = (n) => String(Math.round(n * 100) / 100);
  const R = (cls, x, y, w, h, r, x2) => '<rect class="' + cls + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (r == null ? 3 : r) + '"' + (x2 || '') + '/>';
  const C = (cls, cx, cy, r) => '<circle class="' + cls + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>';
  const P = (cls, d, x2) => '<path class="' + cls + '" d="' + d + '"' + (x2 || '') + '/>';
  const G = (attrs, inner) => '<g' + (attrs ? ' ' + attrs : '') + '>' + inner + '</g>';
  const bar = (x, y, w, cls) => R(cls || 'm', x, y, w, 4, 2);
  /* A four-point sparkle centred on x, y with reach r. */
  const spark = (x, y, r, cls) => {
    const k = r * 0.2;
    return P(cls || 'pop', 'M' + f(x) + ' ' + f(y - r) + 'Q' + f(x + k) + ' ' + f(y - k) + ' ' + f(x + r) + ' ' + f(y) + 'Q' + f(x + k) + ' ' + f(y + k) + ' ' + f(x) + ' ' + f(y + r) +
      'Q' + f(x - k) + ' ' + f(y + k) + ' ' + f(x - r) + ' ' + f(y) + 'Q' + f(x - k) + ' ' + f(y - k) + ' ' + f(x) + ' ' + f(y - r) + 'Z');
  };
  const dot = (x, y, r, cls) => C(cls || 'pop', x, y, r);
  /* A zig-zag edge (a torn receipt), from x1 across to x0 at height y, n teeth of depth d. Starts and ends on the line. */
  const zig = (x1, x0, y, n, d) => {
    const w = (x1 - x0) / n;
    let s = '';
    for (let i = 0; i < n; i++) s += 'l' + f(-w / 2) + ' ' + d + 'l' + f(-w / 2) + ' ' + -d;
    return s;
  };

  /* ---------- the drawings ----------
     Each returns the main layer (what the drawing is about). Everything sits inside x 36..124, y 14..98 so the same drawing can
     be cropped for the small tile. The backdrop, shadow and sparkles are added around it by svg(). */
  const DRAW = {
    /* receipts and invoices: a receipt with a torn edge, a sheet behind it, a "filed" tick */
    paperwork() {
      return R('q', 42, 27, 50, 62, 7, ' transform="rotate(-9 67 58)"') +
        P('p', 'M67 21h36a5 5 0 0 1 5 5V89' + zig(108, 62, 89, 7, 3.4) + 'V26a5 5 0 0 1 5-5z') +
        bar(70, 32, 24) + bar(70, 41, 32) + bar(70, 50, 20) +
        P('dash', 'M70 61h31') + bar(70, 68, 12) + R('a', 86, 67, 15, 6, 3) +
        C('a', 107, 80, 12) + P('lw', 'M101.5 80.5l4 4 7.5-8');
    },
    /* documents: a folder with two sheets standing up in it */
    documents() {
      return P('s', 'M42 38a6 6 0 0 1 6-6h17a6 6 0 0 1 4.6 2.1L76 40h36a6 6 0 0 1 6 6v40a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6z') +
        R('q', 60, 26, 42, 50, 5, ' transform="rotate(7 81 51)"') +
        G('transform="rotate(-6 74 52)"', R('p', 52, 24, 42, 52, 5) + bar(59, 33, 20) + bar(59, 42, 28) + bar(59, 51, 24) + R('a', 59, 61, 15, 5, 2.5)) +
        P('p', 'M42 55a6 6 0 0 1 6-6h64a6 6 0 0 1 6 6v31a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6z') +
        bar(53, 62, 36) + R('a', 53, 74, 20, 6, 3) + C('s', 106, 77, 5);
    },
    /* warranties: a shield with a tick, and the receipt it came with */
    warranty() {
      return R('q', 38, 33, 42, 56, 6, ' transform="rotate(-10 59 61)"') +
        G('transform="rotate(-10 59 61)"', bar(45, 44, 22) + bar(45, 53, 28) + bar(45, 62, 18)) +
        P('p', 'M89 20l27 9.5v22c0 17.5-11.5 30.5-27 38-15.5-7.5-27-20.5-27-38v-22z') +
        P('a', 'M89 30.5l18 6.4v15.6c0 11.6-7.5 20.6-18 26.2-10.5-5.6-18-14.6-18-26.2V36.9z') +
        P('lw', 'M80 54l6.5 6.5L99 47') +
        C('p', 54, 82, 9) + P('l', 'M54 76.5V82l3.6 2.4', ' stroke-width="2.4"');
    },
    /* money and the bank: a columned bank with a coin beside it */
    money() {
      return P('a', 'M37 42L72 20l35 22z', ' stroke-linejoin="round"') +
        C('w', 72, 33, 4) +
        R('p', 46, 50, 10, 31, 3) + R('p', 60, 50, 10, 31, 3) + R('p', 74, 50, 10, 31, 3) + R('p', 88, 50, 10, 31, 3) +
        R('p', 39, 81, 66, 8, 3.5) + R('q', 34, 89, 76, 8, 4) +
        C('a', 114, 78, 13) + C('lwr', 114, 78, 8) + P('lw', 'M111 78h6M114 73.5v9', ' stroke-width="2.4"');
    },
    /* bills: a calendar with one day picked out */
    bills() {
      return R('p', 42, 26, 76, 68, 10) +
        P('a', 'M42 36a10 10 0 0 1 10-10h56a10 10 0 0 1 10 10v10H42z') +
        R('q', 57, 19, 7, 15, 3.5) + R('q', 96, 19, 7, 15, 3.5) +
        R('m', 54, 56, 9, 9, 3) + R('m', 69, 56, 9, 9, 3) + R('m', 84, 56, 9, 9, 3) + R('m', 99, 56, 9, 9, 3) +
        R('m', 54, 71, 9, 9, 3) + R('a', 66, 68, 15, 15, 5) + R('m', 84, 71, 9, 9, 3) + R('m', 99, 71, 9, 9, 3) +
        P('lw', 'M70 75.5l3.4 3.4 5.6-6.4', ' stroke-width="2.6"');
    },
    /* debts and paying them off: a card, and a ring that is nearly full */
    debts() {
      return G('transform="rotate(-11 66 62)"', R('q', 36, 40, 64, 42, 7) + R('a', 36, 50, 64, 9, 0) + R('m', 44, 66, 22, 4, 2) + R('m', 44, 73, 14, 4, 2) + R('s', 82, 66, 11, 8, 3)) +
        C('p', 100, 70, 25) + C('track', 100, 70, 16.5) + P('arc', 'M100 53.5a16.5 16.5 0 1 1-16.5 16.5', ' stroke-linecap="round"') +
        P('l', 'M92.5 70.5l5.5 5.5 10-11', ' stroke-width="3.4"');
    },
    /* to-dos: a clipboard with a short list, the first two ticked */
    todo() {
      return R('p', 46, 24, 66, 72, 9) + R('a', 65, 17, 28, 13, 6.5) + C('w', 79, 23.5, 2.6) +
        R('a', 56, 40, 13, 13, 4) + P('lw', 'M59 46.5l3 3 5-6', ' stroke-width="2.4"') + bar(76, 44, 26) +
        R('a', 56, 60, 13, 13, 4) + P('lw', 'M59 66.5l3 3 5-6', ' stroke-width="2.4"') + bar(76, 64, 20) +
        R('q', 56, 80, 13, 13, 4) + bar(76, 84, 24) +
        G('transform="rotate(38 112 74)"', R('a', 107, 52, 10, 34, 3.5) + P('k', 'M107 86h10l-5 10z') + R('s', 107, 52, 10, 7, 3.5));
    },
    /* the Sorting hub: an in-tray with two sheets going in */
    hub() {
      return R('q', 56, 18, 34, 44, 5, ' transform="rotate(-8 73 40)"') +
        G('transform="rotate(7 90 38)"', R('p', 72, 14, 34, 44, 5) + bar(79, 24, 18) + bar(79, 33, 22) + bar(79, 42, 14)) +
        P('p', 'M40 64l8-23a6 6 0 0 1 5.7-4h52.6a6 6 0 0 1 5.7 4l8 23v22a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6z') +
        P('lk', 'M40 64h22a4 4 0 0 1 3.6 2.2l2.6 5.2a5 5 0 0 0 4.5 2.8h14.6a5 5 0 0 0 4.5-2.8l2.6-5.2a4 4 0 0 1 3.6-2.2h22') +
        C('a', 112, 57, 12) + spark(112, 57, 6.5, 'w') +
        R('m', 54, 80, 26, 4, 2) + R('s', 86, 80, 16, 4, 2);
    },
    /* search: a magnifying glass over a sheet */
    search() {
      return R('q', 40, 26, 46, 60, 6, ' transform="rotate(-7 63 56)"') +
        G('transform="rotate(-7 63 56)"', bar(47, 36, 20) + bar(47, 45, 28)) +
        P('hand', 'M91 76l18 18', ' stroke-linecap="round"') +
        C('p', 77, 52, 26) + C('lens', 77, 52, 26) +
        bar(62, 44, 30) + bar(62, 53, 22) + R('a', 62, 62, 14, 5, 2.5) +
        P('shine', 'M60 40a19 19 0 0 1 11-9', ' stroke-linecap="round"');
    },
    /* work: a briefcase */
    work() {
      return P('hl', 'M64 42v-8a6 6 0 0 1 6-6h20a6 6 0 0 1 6 6v8', ' stroke-linecap="round" stroke-linejoin="round"') +
        R('p', 40, 40, 80, 52, 10) +
        P('s', 'M40 50a10 10 0 0 1 10-10h60a10 10 0 0 1 10 10v14H40z') +
        P('lk', 'M40 64h80') +
        R('a', 71, 57, 18, 15, 5) + C('w', 80, 64.5, 2.6) +
        R('m', 50, 78, 22, 4, 2) + R('m', 88, 78, 22, 4, 2);
    },
    /* getting paid back: a receipt, an arrow round, and the coin that comes back */
    payback() {
      return R('p', 34, 36, 42, 54, 6) + bar(41, 46, 20) + bar(41, 55, 26) + bar(41, 64, 16) + R('a', 41, 74, 18, 6, 3) +
        P('arrow', 'M60 33c14-13 40-12 50 8', ' stroke-linecap="round"') + P('head', 'M112 30.5l.4 13-12.5-3.6') +
        C('s', 112, 82, 17) + C('a', 108, 78, 17) + C('lwr', 108, 78, 11) +
        P('lw', 'M112 71.2c-1.6-1.9-4.7-2.2-6.6-.4-2.3 2.1-1.9 5.7-1.4 8.3.4 2.2-.7 4.2-2.8 5.4h12.8M100.4 78h9.2', ' stroke-width="2.4"');
    },
    /* home projects: a house with its roof and a hammer */
    projects() {
      return R('p', 44, 52, 60, 42, 5) + P('a', 'M38 56L74 24l36 32z', ' stroke-linejoin="round"') +
        R('s', 91, 30, 9, 16, 2.5) + R('s', 64, 68, 15, 26, 4) + C('w', 75.5, 82, 1.8) +
        R('q', 87, 64, 12, 12, 3) + P('lk', 'M93 64v12M87 70h12', ' stroke-width="1.6"') +
        G('transform="rotate(38 111 72)"', R('s', 107.5, 50, 7, 40, 3.5) + R('a', 99, 46, 24, 12, 4));
    },
    /* things to get: a shopping bag with one thing ticked off */
    bag() {
      return R('q', 36, 48, 38, 46, 6, ' transform="rotate(-9 55 71)"') + bar(42, 64, 20) +
        P('hl', 'M72 58V46a12 12 0 0 1 24 0v12', ' stroke-linecap="round"') +
        P('p', 'M60 52h48l5 41a6 6 0 0 1-6 6.5H61a6 6 0 0 1-6-6.5z') +
        bar(68, 62, 32) + C('a', 84, 82, 11) + P('lw', 'M78.5 82.5l4 4 7.5-8') +
        C('s', 70, 52.5, 2.2) + C('s', 98, 52.5, 2.2);
    },
    /* a project board: three columns of cards */
    board() {
      return R('q', 38, 28, 26, 62, 6) + R('q', 67, 28, 26, 62, 6) + R('q', 96, 28, 26, 62, 6) +
        R('p', 42, 34, 18, 14, 4) + R('p', 42, 52, 18, 14, 4) + R('p', 42, 70, 18, 14, 4) +
        R('a', 71, 34, 18, 18, 4) + bar(74, 40, 12, 'lwb') + bar(74, 46, 8, 'lwb') + R('p', 71, 56, 18, 14, 4) +
        R('p', 100, 34, 18, 14, 4) + R('s', 100, 52, 18, 14, 4) +
        P('lw', 'M104 59l3 3 5-6', ' stroke-width="2.2"') +
        bar(45, 40, 12) + bar(45, 58, 8) + bar(45, 76, 12) + bar(103, 40, 12) + bar(74, 62, 11);
    },
    /* recently deleted: a bin, and the arrow that brings things back */
    trash() {
      return P('p', 'M50 46h60l-4.6 43a6 6 0 0 1-6 5.4H60.6a6 6 0 0 1-6-5.4z') +
        P('lk', 'M67 55v28M80 55v28M93 55v28', ' stroke-linecap="round"') +
        G('transform="rotate(-9 80 40)"', R('a', 43, 34, 74, 10, 5) + R('a', 68, 26, 24, 9, 4.5)) +
        C('a', 112, 80, 13) + P('lw', 'M117.5 76.5a6.6 6.6 0 1 0 .6 6.2', ' stroke-linecap="round" stroke-width="2.6"') + P('lw', 'M118.6 71.4v6h-6', ' stroke-width="2.6"');
    },
    /* Ask Claude: two speech bubbles, one with the spark */
    chat() {
      return P('p', 'M40 32a10 10 0 0 1 10-10h38a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10H62l-13 11V64h-1a10 10 0 0 1-8-10z') +
        bar(51, 35, 34) + bar(51, 44, 24) +
        P('a', 'M72 58a10 10 0 0 1 10-10h30a10 10 0 0 1 10 10v20a10 10 0 0 1-10 10h-4v10l-13-10H82a10 10 0 0 1-10-10z') +
        spark(97, 68, 10, 'w') + spark(113, 56, 3.4, 'w');
    },
    /* recent changes: a clock with an arrow running back round it */
    history() {
      return C('p', 82, 58, 29) + C('rim', 82, 58, 29) +
        P('l', 'M82 41v17.5l11 6.5', ' stroke-width="4"') + C('a', 82, 58, 3.4) +
        P('arrow', 'M50.5 38A37 37 0 0 1 112 32', ' stroke-linecap="round"') + P('head', 'M47 28.5l.6 13.5 13-3.6') +
        R('m', 112, 70, 16, 4, 2) + R('s', 108, 79, 16, 4, 2) + R('m', 104, 88, 16, 4, 2);
    },
    /* anything else: an open box with something dotted where it will go */
    generic() {
      return P('dashbox', 'M62 24h36a6 6 0 0 1 6 6v20H56V30a6 6 0 0 1 6-6z') +
        P('s', 'M40 56l9-14h62l9 14z') +
        R('p', 40, 56, 80, 38, 8) + R('a', 66, 64, 28, 6, 3) + bar(52, 78, 24) + R('m', 84, 78, 24, 4, 2) +
        P('lk', 'M40 56h80');
    },
  };
  /* The names that mean the same drawing. */
  const ALIAS = { receipts: 'paperwork', receipt: 'paperwork', invoices: 'paperwork', docs: 'documents', document: 'documents', folder: 'documents', warranties: 'warranty', shield: 'warranty',
    bank: 'money', coin: 'money', transactions: 'money', shopping: 'bag', basket: 'bag', buy: 'bag', bill: 'bills', calendar: 'bills', debt: 'debts', card: 'debts', tasks: 'todo', todos: 'todo', check: 'todo', inbox: 'hub', funnel: 'hub',
    briefcase: 'work', claims: 'payback', home: 'projects', house: 'projects', kanban: 'board', bin: 'trash', deleted: 'trash', claude: 'chat', spark: 'chat', undo: 'history', clock: 'history', changes: 'history' };
  /* A UI icon name (the one an empty state already carries) to the drawing that goes with it. */
  const FOR_ICON = { receipt: 'paperwork', folder: 'documents', file: 'documents', shield: 'warranty', bank: 'money', in: 'money', out: 'money', coin: 'money', bills: 'bills', card: 'debts',
    todo: 'todo', check: 'todo', list: 'todo', funnel: 'hub', inbox: 'hub', sort: 'hub', search: 'search', briefcase: 'work', star: 'projects', home: 'projects', trash: 'trash',
    spark: 'chat', send: 'chat', undo: 'history', redo: 'history', clock: 'history', note: 'documents', bag: 'bag', repeat: 'payback' };

  function kindOf(kind) {
    const k = String(kind || '').toLowerCase();
    if (DRAW[k]) return k;
    return ALIAS[k] && DRAW[ALIAS[k]] ? ALIAS[k] : 'generic';
  }
  function forIcon(name) {
    return FOR_ICON[name] || 'generic';
  }

  /* ---------- the svg ---------- */
  /* Two soft gradients (the backdrop's glow and the sheen on paper) are shared: one hidden <svg> holds them for every drawing,
     so the drawings carry no ids of their own. Only Soft Glass uses them (css/art.css); the stops are coloured there. */
  function defs() {
    if (!document.body || document.getElementById('gu-art-defs')) return;
    document.body.insertAdjacentHTML('beforeend', '<svg id="gu-art-defs" class="gu-art-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">' +
      '<defs><linearGradient id="gu-art-gb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="gs0"/><stop offset="1" class="gs1"/></linearGradient>' +
      '<linearGradient id="gu-art-gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="gp0"/><stop offset="1" class="gp1"/></linearGradient></defs></svg>');
  }
  /* The common backdrop: a soft disc, a smaller one beside it, a shadow on the ground and a few sparkles. */
  function backdrop() {
    return G('class="ar-bg"', '<ellipse class="g" cx="80" cy="102" rx="44" ry="6"/>' + C('b', 80, 58, 47) + C('b2', 124, 34, 14) + C('b2', 34, 84, 8)) +
      G('class="ar-pops"', spark(43, 31, 7) + spark(122, 26, 5) + dot(124, 90, 3.4) + dot(30, 62, 2.4) + dot(130, 60, 2.2, 'pop pop--soft'));
  }
  /* kind: a name from kinds(). opts: {compact: true for the small-tile crop, size: width in px, cls: extra class(es)}. */
  function svg(kind, opts) {
    opts = opts || {};
    const k = kindOf(kind);
    const compact = !!opts.compact;
    const w = Math.max(24, Math.min(480, Number(opts.size) || (compact ? 56 : 160)));
    const h = compact ? w : Math.round(w * 0.75);
    return '<svg class="art art--' + k + (compact ? ' art--c' : '') + (opts.cls ? ' ' + opts.cls : '') + '" viewBox="' + (compact ? '32 10 96 96' : '0 0 160 120') + '" width="' + w + '" height="' + h + '"' +
      ' fill="none" focusable="false" aria-hidden="true">' + (compact ? '' : backdrop()) + G('class="ar-main ar-float"', DRAW[k]()) + '</svg>';
  }
  /* The wrapped block. opts.size: 'full' (default, a page's main empty state) or 'compact' (a small tinted tile for an empty inside a panel). */
  function block(kind, opts) {
    opts = opts || {};
    const compact = opts.size === 'compact' || opts.compact === true;
    return '<div class="empty-art empty-art--' + (compact ? 'compact' : 'full') + (opts.cls ? ' ' + opts.cls : '') + '" aria-hidden="true">' + svg(kind, { compact, size: opts.px }) + '</div>';
  }

  /* A short note with its small picture beside it, for an empty inside a panel: row('trash', '<p class="muted">…</p>').
     The note's own markup goes inside untouched. */
  function row(kind, inner) {
    return '<div class="empty-row">' + block(kind, { size: 'compact' }) + '<div class="empty-row__text">' + inner + '</div></div>';
  }

  /* ---------- loading ---------- */
  const SHIM_MS = 1600; // the length of one sweep (--shim-t in css/art.css is the same)
  /* Where in its sweep a shimmer is right now, as an inline custom property. A busy line that is redrawn while it waits would
     otherwise start its sweep again at every redraw; with this it carries on from where it was. */
  function phase() {
    return '--shim-d:-' + (Date.now() % SHIM_MS) + 'ms';
  }
  /* A few quiet placeholder lines for a busy state: GU.art.skeleton(3) or skeleton(2, {cls: 'skel--card'}). Decorative. */
  function skeleton(n, opts) {
    opts = opts || {};
    const count = Math.max(1, Math.min(5, Number(n) || 2));
    let lines = '';
    for (let i = 0; i < count; i++) lines += '<i class="shimmer"></i>';
    return '<span class="skel' + (opts.cls ? ' ' + opts.cls : '') + '" aria-hidden="true" style="' + phase() + '">' + lines + '</span>';
  }

  /* ---------- the slow float only runs while an illustration is on screen ---------- */
  let io = null;
  function seen(el) {
    if (!io || !el || el.__art) return;
    el.__art = true;
    io.observe(el);
  }
  function unseen(el) {
    if (io && el && el.__art) {
      el.__art = false;
      io.unobserve(el);
    }
  }
  function each(node, fn) {
    if (!node || node.nodeType !== 1) return;
    if (node.classList.contains('empty-art')) fn(node);
    else if (node.firstElementChild) node.querySelectorAll('.empty-art').forEach(fn);
  }
  function watch() {
    if (io || !('IntersectionObserver' in window) || !('MutationObserver' in window) || !document.body) return;
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch (e) {
      /* carry on */
    }
    io = new IntersectionObserver((list) => list.forEach((e) => e.target.classList.toggle('is-on', e.isIntersecting)), { threshold: 0.15 });
    new MutationObserver((list) => {
      for (const m of list) {
        m.removedNodes.forEach((n) => each(n, unseen));
        m.addedNodes.forEach((n) => each(n, seen));
      }
    }).observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll('.empty-art').forEach(seen);
  }
  defs();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();

  GU.art = { svg, block, row, skeleton, phase, forIcon, kindOf, kinds: () => Object.keys(DRAW), has: (k) => !!DRAW[String(k || '').toLowerCase()], aliases: () => Object.assign({}, ALIAS) };
})();
