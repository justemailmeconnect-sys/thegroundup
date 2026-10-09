/* The Ground Up: search everywhere. One box that looks through both Home and Work: bank lines, receipts and
   invoices, bills, debts, income, documents, tasks, home projects, section items, work notes and projects, plans,
   requests and Sorting hub items. Opens from the rail, the phone bar, / and Ctrl or Cmd + Shift + F. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, money, fmtDate, today, toDays, isISO, plural, MONTHS, MONTHS_LONG } = GU.util;
  const { icon } = GU.ui;
  const store = GU.store;

  const KINDS = [
    { id: 'bank', label: 'Bank: money in and out', icon: 'bank' },
    { id: 'paper', label: 'Receipts and invoices', icon: 'receipt' },
    { id: 'warranty', label: 'Warranties', icon: 'shield' },
    { id: 'workpaper', label: 'Work receipts', icon: 'coin' },
    { id: 'bill', label: 'Bills', icon: 'bills' },
    { id: 'debt', label: 'Debts', icon: 'card' },
    { id: 'income', label: 'Income', icon: 'in' },
    { id: 'doc', label: 'Documents', icon: 'folder' },
    { id: 'task', label: 'Tasks', icon: 'todo' },
    { id: 'hproject', label: 'Home projects', icon: 'star' },
    { id: 'item', label: 'Your categories', icon: 'star' },
    { id: 'note', label: 'Work notes and projects', icon: 'note' },
    { id: 'plan', label: 'Plans', icon: 'trend' },
    { id: 'request', label: 'To buy', icon: 'bag' },
    { id: 'hub', label: 'Sorting hub items', icon: 'funnel' },
  ];
  const KIND = {};
  KINDS.forEach((k, i) => (KIND[k.id] = Object.assign({ order: i }, k)));
  const PER_GROUP = 8;
  const HARD_CAP = 400; // most rows drawn in one group, however many match
  const RECENT_KEY = 'groundup.searches';

  /* ---------- what there is to search ---------- */
  const low = (v) => String(v == null ? '' : v).toLowerCase();
  const join = (list) => list.filter((x) => x != null && x !== '').join(' ');
  const fileNames = (r) => (r && Array.isArray(r.files) ? r.files.map((f) => f && f.name) : []);
  const shortDate = (iso) => (isISO(iso) ? fmtDate(iso, { short: true }) : '');

  /* The words a date can be searched by: '2026-10-06', '6 oct', '6 oct 2026', 'oct 2026', 'october', '06/10/2026'. */
  function dateHay(iso) {
    if (!isISO(iso)) return '';
    const [y, m, d] = iso.split('-');
    const mon = MONTHS[+m - 1].toLowerCase();
    return iso + ' ' + +d + ' ' + mon + ' ' + +d + ' ' + mon + ' ' + y + ' ' + mon + ' ' + y + ' ' + MONTHS_LONG[+m - 1].toLowerCase() + ' ' + d + '/' + m + '/' + y;
  }

  const stamp = (s) => (store.rev || 0) + ':' + ['transactions', 'paperwork', 'bills', 'debts', 'incomeSources', 'documents', 'tasks', 'sectionItems', 'sections', 'workNotes', 'projects', 'costIdeas', 'requests', 'inbox']
    .map((k) => (s[k] || []).length).join(',');
  let cache = { key: '', list: [] };

  function build(s) {
    const P = GU.parts;
    const F = GU.finance;
    const wm = GU.workMoney;
    const tabs = GU.tabs || {};
    const out = [];
    const label = (p) => (P && P.PARTS[p] ? P.PARTS[p].label : '');
    const tabName = (id) => (tabs[id] ? tabs[id].short || tabs[id].label : '');
    const pickTab = (id, fallback) => (tabs[id] ? id : fallback);
    const accounts = {};
    (s.accounts || []).forEach((a) => (accounts[a.id] = a.name));
    const today0 = toDays(today());
    /* o: k (kind), c (collection), rec, title, f1 (names, parties), f2 (notes, references, file names), date, amount,
       part ('home', 'work' or ''), tab (the page it lives on), where (that page's name), tail (ending of the context line),
       signed (show the sign of the amount), open (a GU.view.open editor exists), page (go to its page first, then open it) */
    const add = (o) => {
      const rec = o.rec;
      const title = String(o.title == null || o.title === '' ? 'Untitled' : o.title).replace(/\s+/g, ' ').trim();
      const date = isISO(o.date) ? o.date : '';
      const amount = Number.isFinite(Number(o.amount)) && o.amount !== null && o.amount !== '' ? Number(o.amount) : null;
      const ctx = [(o.part ? label(o.part) + ' › ' : '') + (o.where || ''), shortDate(date) ? (o.dateLead || '') + shortDate(date) : '', amount != null ? money(o.signed ? amount : Math.abs(amount)) : '', o.tail || '']
        .filter(Boolean).join(' · ');
      out.push({
        k: o.k, c: o.c, id: rec.id, part: o.part || '', tab: o.tab || '', open: o.open !== false, page: !!o.page,
        title, ctx, date,
        t: low(title), p: low(join(o.f1 || [])), n: low(join(o.f2 || [])).slice(0, 6000), d: dateHay(date),
        a: amount != null ? Math.abs(amount).toFixed(2) : '',
        r: date ? toDays(date) - today0 : null,
      });
    };

    for (const t of s.transactions || []) {
      const work = F && F.isWork && F.isWork(t);
      add({ k: 'bank', c: 'transactions', rec: t, title: t.description, f1: [t.category], f2: [t.notes, accounts[t.account]], date: t.date, amount: t.amount, signed: true,
        part: work ? 'work' : 'home', tab: work ? pickTab('work-back', 'work') : 'transactions', where: 'Bank' });
    }
    for (const p of s.paperwork || []) {
      const work = p.context === 'work';
      let tab = 'receipts';
      if (work) {
        const l = wm && wm.lane ? wm.lane(p, 'paperwork') : 'unsorted';
        tab = pickTab(l === 'back' && p.kind !== 'invoice-out' ? 'work-back' : l === 'ktk' || l === 'unsorted' ? 'work-ktk' : 'work', 'work');
      }
      // A warranty of your own is found on the Warranties page: its item, the shop and the serial number, and it opens there.
      if (!work && p.kind === 'warranty' && tabs.warranties) {
        add({ k: 'warranty', c: 'paperwork', rec: p, title: p.title || p.party, f1: [p.party], f2: [p.reference, p.notes, 'warranty guarantee', ...fileNames(p)],
          date: p.warrantyUntil || p.date, dateLead: p.warrantyUntil ? 'ends ' : '', amount: p.amount, part: 'home', tab: 'warranties', where: 'Warranties', page: true });
        continue;
      }
      add({ k: work ? 'workpaper' : 'paper', c: 'paperwork', rec: p, title: p.title || p.party, f1: [p.party, p.category], f2: [p.reference, p.notes, p.kind === 'warranty' ? 'warranty' : '', ...fileNames(p)],
        date: p.date || p.dueDate, amount: p.amount, part: work ? 'work' : 'home', tab, where: tabName(tab) || 'Receipts' });
    }
    for (const b of s.bills || []) {
      const work = P && P.isWorkBill(b);
      const tab = pickTab(work ? 'work-bills' : 'bills', work ? 'work' : 'today');
      add({ k: 'bill', c: 'bills', rec: b, title: b.name, f1: [b.payee, b.category], f2: [b.notes, ...fileNames(b)], date: b.nextDue, dateLead: 'next ', amount: b.amount,
        part: work ? 'work' : 'home', tab, where: 'Bills', tail: b.active === false ? 'paused' : '' });
    }
    for (const d of s.debts || []) {
      add({ k: 'debt', c: 'debts', rec: d, title: d.name, f1: [d.lender, d.type], f2: [d.notes, ...fileNames(d)], amount: d.balance, part: 'home', tab: 'debts', where: 'Debts', tail: 'balance' });
    }
    for (const i of s.incomeSources || []) {
      add({ k: 'income', c: 'incomeSources', rec: i, title: i.name, f1: [i.from], f2: [i.notes], date: i.nextDate, dateLead: 'next ', amount: i.amount, part: 'home', tab: 'incomings', where: 'Income' });
    }
    for (const d of s.documents || []) {
      const work = P && P.isWorkDoc(d);
      add({ k: 'doc', c: 'documents', rec: d, title: d.title, f1: [d.holder, d.type], f2: [d.reference, d.location, d.notes, ...fileNames(d)], date: d.expiryDate, dateLead: 'expires ',
        part: work ? 'work' : 'home', tab: pickTab(work ? 'work-docs' : 'documents', work ? 'work' : 'today'), where: 'Documents', tail: low(d.type) === low(d.title) ? '' : d.type });
    }
    for (const t of s.tasks || []) {
      const work = P && P.isWorkTask(s, t);
      add({ k: 'task', c: 'tasks', rec: t, title: t.title, f2: [t.notes], date: t.due, dateLead: 'due ', part: work ? 'work' : 'home',
        tab: pickTab(work ? 'work-tasks' : 'todos', work ? 'work' : 'today'), where: work ? 'Tasks' : 'To-do', tail: t.done ? 'done' : '' });
    }
    const sections = {};
    (s.sections || []).forEach((x) => (sections[x.id] = x));
    for (const i of s.sectionItems || []) {
      const sec = sections[i.sectionId];
      if (!sec) continue;
      add({ k: 'item', c: 'sectionItems', rec: i, title: i.title || i.party, f1: [i.party, i.group, sec.name], f2: [i.reference, i.notes, ...fileNames(i)], date: i.date || i.dueDate, amount: i.amount,
        part: sec.part === 'work' ? 'work' : 'home', tab: 's-' + sec.id, where: sec.name });
    }
    const TAB_OF = (GU.work && GU.work.TAB_OF) || {};
    for (const n of s.workNotes || []) {
      const area = n.area === 'costs' ? 'requests' : n.area; // notes from the old Cost forecast page sit on To buy
      const tab = pickTab(area && area !== 'general' && TAB_OF[area] ? TAB_OF[area] : 'work', 'work');
      add({ k: 'note', c: 'workNotes', rec: n, title: n.title || 'Note', f2: [n.body], date: n.updated || n.created, part: 'work', tab, where: 'Note · ' + (tabName(tab) || 'Overview') });
    }
    for (const p of s.projects || []) {
      // A project at home is a Home project; no mark means a work project.
      if (P && P.isHomeProject(p)) {
        add({ k: 'hproject', c: 'projects', rec: p, title: p.name, f1: [p.client, p.status], f2: [p.notes, ...fileNames(p)], date: p.deadline || p.start, dateLead: p.deadline ? 'due ' : 'starts ', amount: p.value, part: 'home',
          tab: pickTab('home-projects', 'today'), where: 'Home projects', tail: ['Done', 'Cancelled'].includes(p.status) ? low(p.status) : '' });
        continue;
      }
      add({ k: 'note', c: 'projects', rec: p, title: p.name, f1: [p.client, p.status], f2: [p.notes, ...fileNames(p)], date: p.deadline || p.start, amount: p.value, part: 'work',
        tab: pickTab('work-projects', 'work'), where: 'Projects' });
    }
    for (const i of s.costIdeas || []) {
      const part = P ? P.ideaPart(i) : 'work';
      if (part === 'work') {
        // Work ideas live on To buy now (until they're added there, in its list of old ideas): the page opens, the idea stays put.
        if (i.movedToRequest || i.status === 'done' || i.status === 'dropped') continue;
        add({ k: 'request', c: 'costIdeas', rec: i, title: i.name, f1: [i.status], f2: [i.notes], date: i.wantBy, dateLead: 'by ', amount: i.cost, part: 'work',
          tab: pickTab('work-requests', 'work'), where: tabName('work-requests') || 'To buy', tail: 'not added yet', open: false });
        continue;
      }
      add({ k: 'plan', c: 'costIdeas', rec: i, title: i.name, f1: [i.status], f2: [i.notes, ...fileNames(i)], date: i.wantBy || i.plannedDate, dateLead: 'by ', amount: i.cost, part,
        tab: pickTab('plans', 'today'), where: 'Plans' });
    }
    const RQ = { asked: 'to order', ordered: 'on its way', bought: 'bought', dropped: 'not needed' };
    for (const r of s.requests || []) {
      add({ k: 'request', c: 'requests', rec: r, title: r.title, f2: [r.note, r.link], date: r.needBy, dateLead: 'by ', amount: GU.requests && GU.requests.lineTotal ? GU.requests.lineTotal(r) || null : r.estimate, part: 'work', tab: pickTab('work-requests', 'work'),
        where: tabName('work-requests') || 'To buy', tail: RQ[r.status] || '', open: false });
    }
    for (const i of s.inbox || []) {
      const res = i.result || {};
      const part = res.context === 'work' ? 'work' : res.context === 'home' ? 'home' : '';
      add({ k: 'hub', c: 'inbox', rec: i, title: res.title || (i.files && i.files[0] && i.files[0].name) || String(i.note || '').slice(0, 80) || 'Something in the Sorting hub',
        f1: [res.party, res.summary], f2: [i.note, res.notes, res.reference, ...fileNames(i)], date: res.date, amount: res.amount, part, tab: 'hub', where: 'Sorting hub',
        tail: i.status === 'reading' ? 'reading it' : 'waiting to be sorted', open: false });
    }
    return out;
  }
  function index() {
    const s = store.state;
    if (!s) return [];
    const key = stamp(s);
    if (cache.key !== key) cache = { key, list: build(s) };
    return cache.list;
  }

  /* ---------- reading what was typed ---------- */
  const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const DAY_MON = new RegExp('\\s(\\d{1,2})(?:st|nd|rd|th)?\\s+' + MON + '(?:\\s+(\\d{4}))?(?=\\s)', 'g');
  const MON_YEAR = new RegExp('\\s' + MON + '\\s+(\\d{4})(?=\\s)', 'g');
  const AMOUNT = /^[£$€]?[-−]?(\d[\d,]*)(\.\d{1,2})?$/;
  const MONTH_WORD = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/;
  /* The query as a list of things that must all match: words, amounts ('42' or '£42.00') and dates ('6 oct', 'oct 2026'). */
  function parse(q) {
    let s = ' ' + low(q).replace(/\s+/g, ' ').trim() + ' ';
    const toks = [];
    s = s.replace(DAY_MON, (m, d, mon, y) => {
      toks.push({ s: +d + ' ' + mon.slice(0, 3) + (y ? ' ' + y : ''), date: true });
      return ' ';
    });
    s = s.replace(MON_YEAR, (m, mon, y) => {
      toks.push({ s: mon.slice(0, 3) + ' ' + y, date: true });
      return ' ';
    });
    for (const w of s.split(' ')) {
      if (!w) continue;
      const m = AMOUNT.exec(w);
      if (m) {
        const num = m[1].replace(/,/g, '') + (m[2] || '');
        toks.push({ s: num, num, dec: !!m[2], weak: !m[2] && num.length <= 2, raw: w.replace(/^[£$€]/, '') });
      } else {
        const word = w.replace(/^["“]|["”]$/g, '');
        // A month on its own ('oct') is about dates first: it must be a whole word to count in the text ('octopus' doesn't).
        toks.push(MONTH_WORD.test(word) ? { s: word, month: true, re: new RegExp('(^|[^a-z])' + word + '([^a-z]|$)') } : { s: word });
      }
    }
    return toks.filter((t) => t.s);
  }
  const isWord = (c) => /[a-z0-9]/.test(c || '');
  const weakRe = {};
  const weakHit = (hay, num) => (weakRe[num] || (weakRe[num] = new RegExp('(^|[^0-9])' + num + '([^0-9]|$)'))).test(hay);

  /* How well text s turns up in an entry: in its title, then its names, then its notes (0 when it doesn't). */
  function textScore(e, s) {
    let best = 0;
    const ti = e.t.indexOf(s);
    if (ti >= 0) best = ti === 0 ? 100 : !isWord(e.t[ti - 1]) ? 80 : 60;
    if (best < 55) {
      const pi = e.p.indexOf(s);
      if (pi >= 0) best = Math.max(best, pi === 0 ? 55 : !isWord(e.p[pi - 1]) ? 45 : 35);
    }
    if (best < 25 && e.n.indexOf(s) >= 0) best = 25;
    return best;
  }
  /* How well one entry matches every part of the query: 0 means it doesn't. Title beats names, names beat notes, an
     amount that's exactly right beats a number that merely appears somewhere, and a date match is the weakest. */
  function score(e, toks, whole) {
    let total = 0;
    for (const tk of toks) {
      let best = 0;
      if (tk.num && e.a) {
        if (tk.dec ? e.a.startsWith(tk.num) : e.a.startsWith(tk.num + '.')) best = tk.dec ? (tk.num.length - tk.num.indexOf('.') === 3 ? 95 : 85) : 70;
      }
      if (tk.weak) {
        if (best < 40 && (weakHit(e.t, tk.num) || weakHit(e.p, tk.num))) best = 40;
        else if (best < 20 && (weakHit(e.n, tk.num) || weakHit(e.d, tk.num))) best = 20;
      } else {
        let text = textScore(e, tk.s);
        if (tk.month && text && !(tk.re.test(e.t) || tk.re.test(e.p) || tk.re.test(e.n))) text = Math.min(text, 20);
        // An amount typed with a comma ('1,200') may be written that way in the text.
        if (tk.raw && tk.raw !== tk.s) text = Math.max(text, textScore(e, tk.raw));
        best = Math.max(best, text);
        // A date written as '6 oct' or 'oct 2026' matches a record dated then, and a title that says it in so many words.
        if (best < 60 && tk.month && e.d.indexOf(tk.s) >= 0) best = 60;
        else if (best < 30 && tk.date && e.d.indexOf(tk.s) >= 0) best = 30;
        else if (best < 12 && tk.s.length >= 3 && e.d.indexOf(tk.s) >= 0) best = 12;
      }
      if (!best) return 0;
      total += best;
    }
    if (whole && e.t === whole) total += 40;
    return total;
  }

  /* Matches grouped by kind, best group first. Each group holds its matches best first (newer breaks a tie). */
  function query(q) {
    const t0 = performance.now();
    const toks = parse(q);
    const res = { q, groups: [], total: 0, ms: 0 };
    if (!toks.length) return res;
    const whole = low(q).trim();
    const by = {};
    for (const e of index()) {
      const sc = score(e, toks, whole);
      if (!sc) continue;
      const rank = sc + (e.r == null ? 0 : 12 * Math.max(0, 1 - Math.abs(e.r) / 730)) - KIND[e.k].order * 0.01;
      (by[e.k] || (by[e.k] = [])).push({ e, rank });
    }
    for (const k of KINDS) {
      const list = by[k.id];
      if (!list) continue;
      list.sort((a, b) => b.rank - a.rank);
      res.groups.push({ kind: k, items: list, top: list[0].rank });
      res.total += list.length;
    }
    res.groups.sort((a, b) => b.top - a.top || a.kind.order - b.kind.order);
    res.ms = performance.now() - t0;
    return res;
  }

  /* ---------- recent searches (this device only) ---------- */
  function recents() {
    try {
      const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, 8) : [];
    } catch (e) {
      return [];
    }
  }
  function remember(q) {
    q = String(q || '').replace(/\s+/g, ' ').trim();
    // A long run of digits is probably an account or reference number: not worth keeping.
    if (q.length < 2 || /\d{6,}/.test(q.replace(/[\s-]/g, ''))) return;
    try {
      const list = [q].concat(recents().filter((x) => low(x) !== low(q))).slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (e) {
      /* not kept */
    }
  }
  function forget() {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch (e) {
      /* nothing to clear */
    }
  }

  /* ---------- the box ---------- */
  let dlg = null;
  let st = null; // {input, body, status, groups, rows, active, expanded, timer, q}

  const pill = (p) => (p === 'work' ? '<span class="pill pill--ktk">Work</span>' : p === 'home' ? '<span class="pill pill--mine">Home</span>' : '');
  /* The title with the words you typed picked out. */
  function mark(text, toks) {
    const words = toks.filter((t) => !t.date).map((t) => (t.raw || t.s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return esc(text);
    const re = new RegExp(words.sort((a, b) => b.length - a.length).join('|'), 'gi');
    let out = '';
    let at = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0]) break;
      out += esc(text.slice(at, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
      at = m.index + m[0].length;
    }
    return out + esc(text.slice(at));
  }
  const ROW_ICON = (e) => '<span class="gs-row__ico">' + icon(KIND[e.k].icon) + '</span>';

  function draw() {
    const q = st.input.value;
    const clean = q.replace(/\s/g, '');
    let html = '';
    st.rows = [];
    if (!clean) {
      const rec = recents();
      html = '<div class="gs-empty">' + (GU.art ? GU.art.block('search', { size: 'compact' }) : '') + '<p><b>Search everything in Home and Work.</b></p>' +
        '<p class="muted">Bank lines, receipts and invoices, bills, debts, documents, tasks, notes and the Sorting hub. Try a name, an amount like £42, or a month like oct.</p></div>';
      if (rec.length) {
        html += '<div class="gs-group" role="group" aria-label="Recent searches"><h3 class="gs-group__head"><span>Recent searches</span><button type="button" class="link link--btn" data-gs-clear>Clear</button></h3>' +
          rec.map((r) => {
            const i = st.rows.push({ type: 'recent', q: r }) - 1;
            return '<div class="gs-row gs-row--recent" role="option" id="gs-o-' + i + '" data-i="' + i + '" aria-selected="false"><span class="gs-row__ico">' + icon('clock') + '</span><span class="gs-row__text"><b>' + esc(r) + '</b></span></div>';
          }).join('') + '</div>';
      }
      st.status.textContent = '';
      st.groups = null;
    } else if (clean.length < 2) {
      html = '<div class="gs-empty"><p class="muted">Keep typing…</p></div>';
      st.status.textContent = '';
      st.groups = null;
    } else {
      const r = query(q);
      st.groups = r;
      const toks = parse(q);
      if (!r.total) {
        html = '<div class="gs-empty">' + (GU.art ? GU.art.block('search', { size: 'compact' }) : '') + '<p><b>No results for “' + esc(q.trim()) + '”.</b></p>' +
          '<p class="muted">Try fewer words, or part of a word. If it’s something you haven’t filed yet, drop it in the Sorting hub and I’ll sort it.</p>' +
          '<p><button type="button" class="btn btn--sm" data-gs-hub>' + icon('funnel') + 'Open the Sorting hub</button></p></div>';
        st.status.textContent = 'No results';
      } else {
        for (const g of r.groups) {
          const open = st.expanded.has(g.kind.id);
          const shown = open ? g.items.slice(0, HARD_CAP) : g.items.slice(0, PER_GROUP);
          html += '<div class="gs-group" role="group" aria-label="' + esc(g.kind.label) + '"><h3 class="gs-group__head"><span>' + esc(g.kind.label) + '</span><span class="gs-group__n">' + g.items.length + '</span></h3>' +
            shown.map(({ e }) => {
              const i = st.rows.push({ type: 'result', e }) - 1;
              return '<div class="gs-row" role="option" id="gs-o-' + i + '" data-i="' + i + '" aria-selected="false">' + ROW_ICON(e) +
                '<span class="gs-row__text"><b>' + mark(e.title, toks) + '</b><em>' + esc(e.ctx) + '</em></span>' + pill(e.part) + '</div>';
            }).join('');
          if (!open && g.items.length > PER_GROUP) {
            const i = st.rows.push({ type: 'more', kind: g.kind.id }) - 1;
            html += '<div class="gs-row gs-row--more" role="option" id="gs-o-' + i + '" data-i="' + i + '" aria-selected="false"><span class="gs-row__text"><b>Show all ' + g.items.length + '</b></span>' + icon('chevron') + '</div>';
          } else if (open && g.items.length > HARD_CAP) {
            html += '<p class="gs-cap muted">Showing the first ' + HARD_CAP + '. Add more words to narrow it down.</p>';
          }
          html += '</div>';
        }
        st.status.textContent = plural(r.total, 'result');
      }
    }
    st.body.innerHTML = html;
    st.active = st.rows.length ? Math.min(Math.max(st.active, 0), st.rows.length - 1) : -1;
    if (st.rows.length && st.active < 0) st.active = 0;
    paint(false);
  }
  /* Marks the active row (the one Enter opens). */
  function paint(scroll) {
    st.body.querySelectorAll('[aria-selected="true"]').forEach((r) => r.setAttribute('aria-selected', 'false'));
    const row = st.active >= 0 ? st.body.querySelector('[data-i="' + st.active + '"]') : null;
    if (row) {
      row.setAttribute('aria-selected', 'true');
      st.input.setAttribute('aria-activedescendant', row.id);
      if (scroll && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    } else st.input.removeAttribute('aria-activedescendant');
  }
  const timing = { last: 0, max: 0 }; // milliseconds the last keystroke took to work out and draw (for checking it stays quick)
  function update() {
    const t0 = performance.now();
    st.pending = false;
    st.active = 0;
    st.expanded = new Set();
    st.body.scrollTop = 0;
    draw();
    timing.last = performance.now() - t0;
    timing.max = Math.max(timing.max, timing.last);
  }
  function move(by) {
    if (!st.rows.length) return;
    st.active = (st.active + by + st.rows.length) % st.rows.length;
    paint(true);
  }
  function choose(i) {
    const row = st.rows[i];
    if (!row) return;
    if (row.type === 'recent') {
      st.input.value = row.q;
      st.input.focus();
      return update();
    }
    if (row.type === 'more') {
      // The first of the newly shown rows takes this one's place.
      st.expanded.add(row.kind);
      st.active = i;
      draw();
      paint(true);
      return;
    }
    openResult(row.e);
  }

  /* Goes to a result: its page first when it's in the other part, which flips the switch, then its editor. */
  function openResult(e) {
    const q = st ? st.input.value : '';
    close();
    remember(q);
    const tabs = GU.tabs || {};
    const here = location.hash.slice(1);
    const tab = e.tab && tabs[e.tab] ? e.tab : '';
    const flip = !!(e.part && GU.parts && e.part !== GU.parts.get());
    let moved = false;
    if (tab && here !== tab && (flip || !e.open || e.page)) {
      GU.view.go(tab);
      moved = true;
    }
    // Requests (the To buy page) open their own editor if that page has one; Sorting hub items just open their page.
    const rq = e.c === 'requests' && tabs['work-requests'] && typeof tabs['work-requests'].edit === 'function' ? tabs['work-requests'] : null;
    if (!e.open && !rq) return;
    setTimeout(() => {
      try {
        if (rq) rq.edit(e.id);
        else GU.view.open({ c: e.c, id: e.id });
      } catch (err) {
        console.error(err);
      }
    }, moved ? 80 : 0);
  }

  function open(o) {
    o = o || {};
    if (GU.lock && GU.lock.isLocked()) return false;
    if (dlg) {
      st.input.focus();
      st.input.select();
      return true;
    }
    if (GU.ui.closeMenu) GU.ui.closeMenu();
    dlg = document.createElement('dialog');
    dlg.className = 'search-ov';
    dlg.setAttribute('aria-label', 'Search');
    dlg.innerHTML = '<div class="search-ov__bar">' + icon('search') +
      '<input type="search" role="combobox" aria-expanded="true" aria-controls="gs-list" aria-autocomplete="list" aria-label="Search everything" placeholder="Search Home and Work" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
      '<button type="button" class="icon-btn" data-gs-close aria-label="Close search">' + icon('x') + '</button></div>' +
      '<div class="search-ov__body" id="gs-list" role="listbox" aria-label="Results"></div>' +
      '<p class="visually-hidden" role="status" aria-live="polite" data-gs-status></p>' +
      '<footer class="search-ov__foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></footer>';
    document.body.appendChild(dlg);
    st = { input: dlg.querySelector('input'), body: dlg.querySelector('.search-ov__body'), status: dlg.querySelector('[data-gs-status]'), rows: [], active: 0, expanded: new Set(), timer: null, groups: null };
    st.input.value = o.q || '';
    st.input.addEventListener('input', () => {
      st.pending = true;
      clearTimeout(st.timer);
      st.timer = setTimeout(update, st.input.value.length < 3 ? 0 : 50);
    });
    st.input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(st.timer);
        if (st.pending) update();
        choose(st.active);
      } else if (e.key === 'Escape') {
        // A search box would just clear itself; here Escape always closes.
        e.preventDefault();
        close();
      }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-gs-close]')) return close();
      if (e.target.closest('[data-gs-clear]')) {
        forget();
        return draw();
      }
      if (e.target.closest('[data-gs-hub]')) {
        remember(st.input.value);
        close();
        return GU.view.go('hub');
      }
      const row = e.target.closest('[data-i]');
      if (row) choose(+row.dataset.i);
    });
    dlg.addEventListener('pointermove', (e) => {
      const row = e.target.closest && e.target.closest('[data-i]');
      if (!row || +row.dataset.i === st.active) return;
      st.active = +row.dataset.i;
      paint(false);
    });
    // Escape closes it natively; this tidies up after that (close() has already done so when it was the one closing).
    const d = dlg;
    d.addEventListener('close', () => {
      if (dlg === d) {
        clearTimeout(st.timer);
        dlg = null;
        st = null;
      }
      d.remove();
    });
    try {
      dlg.showModal();
    } catch (e) {
      dlg.setAttribute('open', '');
    }
    update();
    st.input.focus();
    return true;
  }
  function close() {
    if (!dlg) return;
    const d = dlg;
    clearTimeout(st.timer);
    dlg = null;
    st = null;
    if (d.open) d.close();
    d.remove();
  }
  // Locking the app closes the box.
  document.addEventListener('gu:locked', close);

  /* ---------- ways in: the rail, the phone bar, / and Ctrl or Cmd + Shift + F ---------- */
  const railHTML = () => '<button type="button" class="rail__item rail__search" data-search-open aria-label="Search everything (press /)" title="Search (press /)"><span class="rail__ico">' + icon('search') + '</span><span class="rail__label">Search</span></button>';
  const barHTML = () => '<button type="button" class="partbar__tool partbar__search" data-search-open aria-label="Search everything">' + icon('search') + '</button>';
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-search-open]');
    if (!b) return;
    e.preventDefault();
    open();
  });
  const typing = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  const modalOpen = () => {
    try {
      return !!document.querySelector('dialog:modal');
    } catch (e) {
      return !!document.querySelector('dialog[open]');
    }
  };
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing || !e.key) return;
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target);
    const combo = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f';
    if (!slash && !combo) return;
    if (modalOpen() && !dlg) return; // a form or dialog is open: leave it alone
    e.preventDefault();
    open();
  });

  GU.search = { open, close, query, parse, index, recents, railHTML, barHTML, isOpen: () => !!dlg, timing, KINDS };
})();
