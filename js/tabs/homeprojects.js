/* The Ground Up: Home › Home projects. Jobs and projects you've been asked to do outside the business (by your dad,
   say), and your own: what it is, who asked, when it's due, what it should cost, and tick it off when it's done.
   They are the same records as Work › Projects (state.projects), marked context 'home'; no mark means work. The rows,
   lanes, form, ⋯ menu and Move to Work/Home come from GU.work (js/tabs/work.js), so both pages look and behave alike.
   This file adds the page, its summary, the quick-add line, the spreadsheet, and what the rest of the site asks for:
   dates for the Home timeline, checks for Needs attention, and a way to add one (GU.homeProjects.add). */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, daysUntil, fmtDate, relDays, money, plural, sum, round2, isISO } = GU.util;
  const { icon, emptyState, toast } = GU.ui;
  const store = GU.store;

  const TAB = 'home-projects';
  const SOON = 7; // days before the deadline it needs attention
  const CLOSED = ['Done', 'Cancelled'];
  const FALLBACK_STATUSES = ['Idea', 'Planned', 'Booked', 'In progress', 'Done', 'Cancelled'];
  const ui = { showDone: false };

  /* ---------- small helpers ---------- */
  const work = () => GU.work || {};
  const statuses = () => work().STATUSES || FALLBACK_STATUSES;
  const short = (iso) => fmtDate(iso, { short: true });
  const dateOf = (v) => (isISO(v) ? v : '');
  const clip = (t, n) => {
    t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1).trim() + '…' : t;
  };
  const isHome = (p) => !!p && p.context === 'home';
  const isOpen = (p) => !CLOSED.includes(p.status || 'Idea');
  /* Every home project. */
  const list = (s) => ((s || store.state).projects || []).filter((p) => p && p.id && isHome(p));

  /* ---------- making one ---------- */
  /* A home project from the fields given (a name, who asked, where it's at, start, deadline, budget, notes), tidied.
     Throws, in words, when something can't be used: no name, an unknown status, or a budget that isn't an amount. */
  function make(f) {
    f = f || {};
    const name = clip(f.name, 120);
    if (!name) throw new Error('A name is needed');
    let status = 'Planned';
    if (f.status != null && f.status !== '') {
      status = statuses().find((x) => x.toLowerCase() === String(f.status).trim().toLowerCase());
      if (!status) throw new Error('status must be one of: ' + statuses().join(', '));
    }
    const price = GU.requests && GU.requests.readPrice ? GU.requests.readPrice(f.value) : { value: Number(f.value) > 0 ? round2(Number(f.value)) : null };
    if (price.error) throw new Error(price.error.replace(/^That price/, 'That budget').replace(/^A price/, 'A budget'));
    const rec = { id: 'pj-' + uid(), name, client: clip(f.client, 80), status, start: dateOf(f.start), deadline: dateOf(f.deadline), notes: String(f.notes == null ? '' : f.notes).trim().slice(0, 2000), files: [], context: 'home', created: today(), updated: today() };
    if (price.value != null) rec.value = price.value;
    return rec;
  }
  /* Adds one. Returns {rec, undo}: undo takes it out again. */
  function add(f) {
    const rec = make(f);
    store.commit((s) => {
      s.projects = s.projects || [];
      s.projects.push(rec);
    });
    return {
      rec,
      undo() {
        store.commit((s) => (s.projects = (s.projects || []).filter((x) => x.id !== rec.id)));
        return true;
      },
    };
  }

  /* ---------- reading what you type ---------- */
  /* 'Paint the garage by 20 Nov, about £150' → {name, deadline, value}. The cost is read like a price on To buy (£150,
     about £150, 150 quid) and the date like a to-do's (by Friday, tomorrow, 20 Nov); what's left is the name. */
  function parseLine(raw) {
    let t = String(raw == null ? '' : raw).replace(/^[\s\-–—•*·>]+|^\d{1,2}[.)]\s+/, '').replace(/\s+/g, ' ').trim();
    const out = { name: '', deadline: '', value: null };
    const re = GU.requests && GU.requests.PRICE_RE;
    const am = re ? re.exec(t) : null;
    if (am) {
      const v = parseFloat((am[1] || am[2]).replace(/,/g, ''));
      if (Number.isFinite(v) && v > 0 && v < 1e6) out.value = round2(v);
      t = t.slice(0, am.index) + ' ' + t.slice(am.index + am[0].length);
    }
    const when = GU.tabs.today && GU.tabs.today.parseQuickTask ? GU.tabs.today.parseQuickTask(t) : { title: t, due: '' };
    out.deadline = when.due || '';
    let name = when.title.replace(/\s+/g, ' ');
    name = name.replace(/(?:[\s,;:–—-]+(?:and|or|for|at|by|on|about|around|roughly|approx|circa|maybe|up to|under|max|is|are|costs?|costing|budget(?: of)?))+[\s,;:.–—-]*$/i, '')
      .replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, '');
    name = clip(name.replace(/\s+,/g, ',').replace(/,(?:\s*,)+/g, ','), 120);
    out.name = name.charAt(0).toUpperCase() + name.slice(1);
    return out;
  }
  /* 'Adds: Paint the garage · due Fri 20 Nov · budget £150.00': what the line you're typing will become. */
  function previewLine(raw) {
    const p = parseLine(raw);
    if (!p.name) return 'Say what it is first.';
    return 'Adds: ' + [p.name, p.deadline ? 'due ' + fmtDate(p.deadline, { weekday: true }) : 'no date yet', p.value ? 'budget ' + money(p.value) : ''].filter(Boolean).join(' · ');
  }

  /* ---------- the sums ---------- */
  function totals(s) {
    const all = list(s);
    const open = all.filter(isOpen);
    const t = today();
    const dated = open.filter((p) => dateOf(p.deadline));
    const budgeted = open.filter((p) => Number(p.value) > 0);
    return {
      all, open,
      doing: open.filter((p) => p.status === 'In progress'),
      next: dated.filter((p) => p.deadline >= t).sort((a, b) => a.deadline.localeCompare(b.deadline))[0] || null,
      late: dated.filter((p) => p.deadline < t),
      budgeted, budget: round2(sum(budgeted, (p) => Number(p.value))),
    };
  }
  function tallyHTML(T) {
    const boxes = [
      ['Open projects', String(T.open.length), T.doing.length ? T.doing.length + ' in progress' : T.open.length ? 'none started yet' : 'nothing to do'],
      ['Next deadline', T.next ? short(T.next.deadline) : '–', T.next ? clip(T.next.name, 30) : T.late.length ? 'nothing coming up' : 'no dates set'],
      ['Budget', money(T.budget), T.budgeted.length ? 'across ' + plural(T.budgeted.length, 'open project') : 'none added yet'],
    ];
    if (T.late.length) boxes.push(['Past deadline', String(T.late.length), 'not marked done yet', 'is-crit']);
    return '<section class="panel tally wk-tally" aria-label="Summary"><div class="tally__sum">' +
      boxes.map((b) => '<div><span>' + esc(b[0]) + '</span><b class="' + (b[3] || '') + '">' + esc(b[1]) + '</b><em>' + esc(b[2]) + '</em></div>').join('') + '</div></section>';
  }

  /* ---------- what the rest of the site asks for ---------- */
  /* Dates for the Home timeline: when each open project starts (still to come) and when it's due. Same shape as GU.work.dates. */
  function dates(s, to) {
    const out = [];
    const t = today();
    for (const p of list(s)) {
      if (!isOpen(p)) continue;
      const meta = [p.client ? 'Asked by ' + p.client : '', Number(p.value) > 0 ? 'budget ' + money(p.value) : ''].filter(Boolean).join(' · ');
      const ref = { c: 'projects', id: p.id };
      if (dateOf(p.start) && p.start >= t && p.start <= to) out.push({ date: p.start, title: p.name + ' starts', meta, ref });
      if (dateOf(p.deadline) && p.deadline <= to) out.push({ date: p.deadline, title: p.name + ' due', meta, ref });
    }
    return out;
  }
  /* 'Needs attention' on Home Overview (same shape as GU.agenda.attention): a project that's late, or due within a week.
     One line each, however many dates it has. */
  function checks(s) {
    const out = [];
    for (const p of list(s)) {
      if (!isOpen(p) || !dateOf(p.deadline)) continue;
      const n = daysUntil(p.deadline);
      const by = p.client ? 'Asked by ' + p.client : '';
      const ref = { c: 'projects', id: p.id };
      if (n < 0) out.push({ level: 'crit', tab: TAB, title: p.name + ' was due ' + short(p.deadline), detail: ['Past its deadline and not marked done', by].filter(Boolean).join(' · '), ref });
      else if (n <= SOON) out.push({ level: 'warn', tab: TAB, title: p.name + ' is due ' + relDays(p.deadline), detail: [by, short(p.deadline)].filter(Boolean).join(' · '), ref });
    }
    return out;
  }

  /* ---------- download ---------- */
  const BOM = String.fromCharCode(0xfeff); // so spreadsheet apps read it as UTF-8 (the £ sign)
  const csvCell = (v) => GU.requests.csvCell(v);
  /* Every home project, in the page's order, with a total row for what the open ones should cost. */
  function csvRows(s) {
    const all = list(s);
    const T = totals(s);
    const lanes = work().projectLanes ? work().projectLanes(all).flatMap((g) => g.items) : all;
    const rows = [['Project', 'Asked by', 'Where it’s at', 'Starts', 'Due', 'Budget', 'Files', 'Notes']]
      .concat(lanes.map((p) => [p.name, p.client || '', p.status || 'Idea', p.start || '', p.deadline || '', Number(p.value) > 0 ? Number(p.value).toFixed(2) : '', (p.files || []).length || '', p.notes || '']))
      .concat([['Budget of the ' + plural(T.open.length, 'open project'), '', '', '', '', T.budget.toFixed(2), '', '']]);
    return { all, rows };
  }
  async function download() {
    const { all, rows } = csvRows(store.state);
    if (!all.length) return toast('There are no home projects to download yet.');
    const text = BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const ok = await GU.ui.saveFile(new Blob([text], { type: 'text/csv' }), 'home-projects-' + today() + '.csv');
    if (ok) toast('Saved your list of ' + plural(all.length, 'project') + '.');
  }

  /* ---------- the page ---------- */
  const HINT = 'Like “Paint the garage by 20 Nov, about £150”. I’ll pick out the date and the cost.';
  /* The form for a new one (optionally with some fields filled in). */
  function create(values) {
    return work().editProject ? work().editProject(null, { context: 'home', values: values && typeof values === 'object' ? values : null }) : null;
  }
  function edit(id) {
    return work().editProject ? work().editProject(id) : null;
  }

  function quickAdd(e) {
    e.preventDefault();
    const box = e.target.elements.line;
    const raw = box.value.trim();
    if (!raw) return;
    const p = parseLine(raw);
    if (!p.name) {
      toast('Say what it is, like “Paint the garage by 20 Nov, about £150”.');
      return;
    }
    let res;
    try {
      res = add(p);
    } catch (err) {
      toast(err && err.message ? err.message : 'That didn’t work.');
      return;
    }
    const bits = [res.rec.deadline ? 'due ' + fmtDate(res.rec.deadline, { weekday: true }) : '', res.rec.value ? 'budget ' + money(res.rec.value) : ''].filter(Boolean);
    toast('Added “' + clip(res.rec.name, 40) + '”' + (bits.length ? ' (' + bits.join(', ') + ')' : ''), { action: 'Undo', onAction: res.undo });
    setTimeout(() => {
      const el = document.getElementById('hp-line');
      if (el) el.focus();
    }, 0);
  }

  function render(root) {
    const s = store.state;
    const T = totals(s);
    const W = work();
    const quick = '<form class="rq-quick" data-quick><div class="task-add wk-add">' +
      '<input type="text" name="line" id="hp-line" data-keep-focus placeholder="Paint the garage by 20 Nov, about £150" aria-label="Add a home project" autocomplete="off">' +
      '<button type="submit" class="btn btn--primary">' + icon('plus') + 'Add</button></div>' +
      '<p class="rq-hint" data-hp-hint>' + esc(HINT) + '</p></form>';
    const body = T.all.length
      ? '<section class="panel">' + W.groupsHTML(s, 'projects', W.projectLanes(T.all), ui.showDone) + '</section>'
      : '<section class="panel">' + emptyState({ icon: 'star', title: 'No home projects yet', text: esc('When someone asks you to do a job at home, or you plan one of your own, put it here with the date it’s due and what it should cost. Type it in the box above to start.') }) + '</section>';
    root.innerHTML = GU.view.head({
      eyebrow: 'Projects',
      title: 'Home projects',
      text: esc('Projects your dad has asked you to do, and your own. Say what it is, when it’s due and what it should cost, and tick it off when it’s done.'),
      actions: (T.all.length ? '<button type="button" class="btn" data-download>' + icon('download') + 'Download CSV</button>' : '') +
        '<button type="button" class="btn btn--primary" data-new>' + icon('plus') + 'New project</button>',
    }) + '<div class="stack hp">' + (T.all.length ? tallyHTML(T) : '') + quick + body + '</div>';

    root.querySelectorAll('.wk-group').forEach((d) => d.addEventListener('toggle', () => (ui.showDone = d.open)));
    const form = root.querySelector('[data-quick]');
    form.addEventListener('submit', quickAdd);
    // As you type, a line under the box says how it will be added.
    const box = form.elements.line;
    const note = form.querySelector('[data-hp-hint]');
    box.addEventListener('input', () => {
      note.textContent = box.value.trim() ? previewLine(box.value) : HINT;
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) return create();
      if (e.target.closest('[data-download]')) return download();
      // The rows' own buttons (open, files, ⋯ menu) are GU.work's.
      return typeof W.rowClick === 'function' ? W.rowClick(e) : undefined;
    });
  }

  GU.homeProjects = { TAB, list, isOpen, make, add, parseLine, previewLine, totals, dates, checks, csvRows, create };
  GU.tabs[TAB] = { label: 'Home projects', short: 'Projects', icon: 'star', part: 'home', render, create, edit };
})();
