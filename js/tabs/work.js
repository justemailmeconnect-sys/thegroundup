/* The Ground Up: Work. One portal for everything to do with work: tasks, invoices, upcoming projects,
   bills and contracts. Each has its own folders and notes, and the overview shows what needs doing. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, addDays, daysUntil, fmtDate, relDays, money, plural, sum, debounce } = GU.util;
  const { icon, pill, emptyState, formDialog, toast, menu, thumbHTML, viewFiles } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const AREAS = [
    { id: 'tasks', label: 'Tasks', icon: 'todo', one: 'task' },
    { id: 'invoices', label: 'Invoices', icon: 'receipt', one: 'invoice' },
    { id: 'projects', label: 'Upcoming projects', icon: 'star', one: 'project' },
    { id: 'bills', label: 'Bills', icon: 'bills', one: 'bill' },
    { id: 'contracts', label: 'Contracts', icon: 'file', one: 'contract' },
    { id: 'costs', label: 'Cost forecast', icon: 'trend', one: 'idea' },
  ];
  const COLL = { tasks: 'tasks', invoices: 'paperwork', projects: 'projects', bills: 'bills', contracts: 'documents', costs: 'costIdeas' };
  const AREA_OF = { tasks: 'tasks', paperwork: 'invoices', projects: 'projects', bills: 'bills', documents: 'contracts', costIdeas: 'costs' };
  const PRIORITIES = [{ value: 'must', label: 'Must have' }, { value: 'should', label: 'Should have' }, { value: 'could', label: 'Nice to have' }];
  const STATUSES = ['Idea', 'Planned', 'Booked', 'In progress', 'Done', 'Cancelled'];
  const CLOSED = ['Done', 'Cancelled'];
  const CONTRACT = 'Contract or agreement';
  const ui = { area: 'overview', folder: 'all', q: '', inv: 'open', showDone: false };

  /* ---------- what counts as work ---------- */
  const labelOf = (area) => ((store.state.settings.workLabels || {})[area] || (AREAS.find((a) => a.id === area) || {}).label || 'General');
  function workListId(s) {
    const l = s.todoLists.find((x) => x.id === 'list-work') || s.todoLists.find((x) => /^work$/i.test(x.name));
    return l ? l.id : null;
  }
  /* The Work to-do list, made if it isn't there. Call inside a commit. */
  function ensureWorkList(s) {
    let id = workListId(s);
    if (!id) {
      id = 'list-work';
      s.todoLists.push({ id, name: 'Work' });
    }
    return id;
  }
  const isWorkBill = (b) => b.context === 'work' || (!b.context && b.category === 'Work expenses');
  function itemsOf(s, area) {
    if (area === 'tasks') {
      const wl = workListId(s);
      return s.tasks.filter((t) => t.context === 'work' || (wl && t.listId === wl && t.context !== 'home'));
    }
    if (area === 'invoices') return s.paperwork.filter((p) => p.context === 'work');
    if (area === 'projects') return s.projects || [];
    if (area === 'bills') return s.bills.filter(isWorkBill);
    if (area === 'contracts') return s.documents.filter((d) => d.context === 'work');
    if (area === 'costs') return s.costIdeas || [];
    return [];
  }
  const NAMED = ['bills', 'projects', 'workFolders', 'costIdeas'];
  const nameOf = (c, r) => (NAMED.includes(c) ? r.name : r.title) || '';
  const foldersOf = (s, area) => (s.workFolders || []).filter((f) => f.area === area).sort((a, b) => a.name.localeCompare(b.name));
  /* The folder a record sits in, if that folder still exists. */
  const folderOf = (s, rec, area) => (rec.workFolder && (s.workFolders || []).some((f) => f.id === rec.workFolder && f.area === area) ? rec.workFolder : '');
  const notesOf = (s, area) => (s.workNotes || []).filter((n) => (n.area || 'general') === area);

  /* ---------- what needs doing ---------- */
  /* Everything at work that needs a look, worst first: the overview's checklist and the tab's badge. */
  function checks(s) {
    const t = today();
    const out = [];
    const add = (level, area, title, detail, ref) => out.push({ level, area, title, detail, ref });
    for (const k of itemsOf(s, 'tasks')) {
      if (k.done || !k.due) continue;
      const n = daysUntil(k.due);
      if (n < 0) add('crit', 'tasks', k.title, 'Task, ' + relDays(k.due).replace(' ago', ' late'), { c: 'tasks', id: k.id });
      else if (n === 0) add('warn', 'tasks', k.title, 'Task due today', { c: 'tasks', id: k.id });
    }
    for (const p of itemsOf(s, 'invoices')) {
      if (p.kind === 'invoice-out' && p.status !== 'paid' && p.dueDate && F.outstanding(p) > 0) {
        const n = daysUntil(p.dueDate);
        if (n < 0) add('crit', 'invoices', (p.party || p.title) + ' is late paying you ' + money(F.outstanding(p)), 'Was due ' + fmtDate(p.dueDate, { short: true }) + ', ' + -n + (n === -1 ? ' day' : ' days') + ' ago. Chase it up.', { c: 'paperwork', id: p.id });
        else if (n <= 7) add('info', 'invoices', (p.party || p.title) + ' should pay you ' + money(F.outstanding(p)), 'Due ' + relDays(p.dueDate), { c: 'paperwork', id: p.id });
      }
      if (p.kind === 'invoice-in' && p.status !== 'paid') {
        const n = p.dueDate ? daysUntil(p.dueDate) : null;
        if (n != null && n < 0) add('crit', 'invoices', 'Pay ' + p.title + (p.amount != null ? ' (' + money(p.amount) + ')' : ''), 'Overdue since ' + fmtDate(p.dueDate, { short: true }), { c: 'paperwork', id: p.id });
        else if (n != null && n <= 7) add('warn', 'invoices', 'Pay ' + p.title + (p.amount != null ? ' (' + money(p.amount) + ')' : ''), 'Due ' + relDays(p.dueDate), { c: 'paperwork', id: p.id });
        else if (n == null) add('info', 'invoices', 'Pay ' + p.title + (p.amount != null ? ' (' + money(p.amount) + ')' : ''), 'Invoice to pay, no due date', { c: 'paperwork', id: p.id });
      }
    }
    const claims = F.toClaim(s).filter((x) => x.p.context === 'work');
    if (claims.length) {
      const oldest = claims.find((x) => x.p.date);
      const age = oldest ? -daysUntil(oldest.p.date) : 0;
      add(age > 30 ? 'warn' : 'info', 'invoices', plural(claims.length, 'expense') + ' to claim back, ' + money(sum(claims, (x) => x.amount)), oldest ? 'Oldest from ' + fmtDate(oldest.p.date, { short: true }) + ' (' + age + ' days)' : 'Not claimed yet', null);
    }
    for (const p of itemsOf(s, 'projects')) {
      if (CLOSED.includes(p.status)) continue;
      if (p.deadline && daysUntil(p.deadline) < 0) add('crit', 'projects', p.name + ' was due ' + fmtDate(p.deadline, { short: true }), 'Past its deadline and not marked done', { c: 'projects', id: p.id });
      else if (p.deadline && daysUntil(p.deadline) <= 7) add('warn', 'projects', p.name + ' is due ' + relDays(p.deadline), p.client || 'Deadline', { c: 'projects', id: p.id });
      if (p.start && daysUntil(p.start) >= 0 && daysUntil(p.start) <= 14 && p.status !== 'In progress') add('info', 'projects', p.name + ' starts ' + relDays(p.start), (p.client ? p.client + ' · ' : '') + p.status, { c: 'projects', id: p.id });
    }
    for (const b of itemsOf(s, 'bills')) {
      if (b.active === false || !b.nextDue) continue;
      const n = daysUntil(b.nextDue);
      if (!b.autopay && n < 0) add('crit', 'bills', 'Pay ' + b.name + ' (' + money(b.amount) + ')', 'Overdue since ' + fmtDate(b.nextDue, { short: true }), { c: 'bills', id: b.id });
      else if (!b.autopay && n <= 7) add('warn', 'bills', 'Pay ' + b.name + ' (' + money(b.amount) + ')', 'Due ' + relDays(b.nextDue) + ', pay by hand', { c: 'bills', id: b.id });
    }
    for (const d of itemsOf(s, 'contracts')) {
      if (!d.expiryDate) continue;
      const n = daysUntil(d.expiryDate);
      if (n < 0 && n >= -60) add('crit', 'contracts', d.title + ' ended ' + fmtDate(d.expiryDate, { short: true }), 'Renew it, replace it or mark it finished', { c: 'documents', id: d.id });
      else if (n >= 0 && n <= 60) add(n <= 30 ? 'warn' : 'info', 'contracts', d.title + ' ends ' + relDays(d.expiryDate), 'Check the notice period and decide whether to renew', { c: 'documents', id: d.id });
    }
    if ((s.costIdeas || []).some(GU.costs.isOpen)) {
      const plan = GU.costs.schedule(s);
      for (const r of plan.results) {
        const i = r.idea;
        const ref = { c: 'costIdeas', id: i.id };
        if (r.fixed && r.short > 0) add('warn', 'costs', i.name + ' on ' + fmtDate(r.date, { short: true }) + ' would leave you ' + money(r.short) + ' short', 'Booked date · move it later or free up money first', ref);
        else if (!r.date && i.wantBy) add('warn', 'costs', i.name + ' can’t be afforded by ' + fmtDate(i.wantBy, { short: true }), 'About ' + money(r.shortfall, { whole: true }) + ' short in the time ahead', ref);
        else if (r.date && r.onTime === false) add('info', 'costs', i.name + ': earliest ' + fmtDate(r.date, { short: true }), r.lateDays + ' days after you wanted it', ref);
      }
      const now = plan.results.filter((r) => r.date && !r.fixed && daysUntil(r.date) <= 0);
      if (now.length) add('info', 'costs', now.length === 1 ? 'You can afford ' + now[0].idea.name + ' now' : 'You can afford ' + plural(now.length, 'idea') + ' now', now.map((r) => r.idea.name + ' (' + money(r.cost, { whole: true }) + (r.account ? ', from ' + r.account : '') + ')').join(', '), now.length === 1 ? { c: 'costIdeas', id: now[0].idea.id } : null);
    }
    const rank = { crit: 0, warn: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  /* Upcoming project dates for the timeline on Home. */
  function dates(s, to) {
    const out = [];
    const t = today();
    for (const p of s.projects || []) {
      if (CLOSED.includes(p.status)) continue;
      if (p.start && p.start >= t && p.start <= to) out.push({ date: p.start, title: p.name + ' starts', meta: [p.client, 'Work project'].filter(Boolean).join(' · '), ref: { c: 'projects', id: p.id } });
      if (p.deadline && p.deadline <= to) out.push({ date: p.deadline, title: p.name + ' due', meta: [p.client, 'Work project'].filter(Boolean).join(' · '), ref: { c: 'projects', id: p.id } });
    }
    return out;
  }

  /* ---------- figures for each area ---------- */
  function figures(s, area) {
    const items = itemsOf(s, area);
    const t = today();
    if (area === 'tasks') {
      const open = items.filter((k) => !k.done);
      const late = open.filter((k) => k.due && k.due < t).length;
      const week = open.filter((k) => k.due && k.due >= t && daysUntil(k.due) <= 7).length;
      return { big: String(open.length), unit: open.length === 1 ? 'open task' : 'open tasks', lines: [late ? late + ' overdue' : 'nothing overdue', week ? week + ' due this week' : 'nothing due this week'], bad: late > 0 };
    }
    if (area === 'invoices') {
      const owed = sum(items.filter((p) => p.kind === 'invoice-out' && p.status !== 'paid'), (p) => F.outstanding(p));
      const toPay = sum(items.filter((p) => p.kind === 'invoice-in' && p.status !== 'paid'), (p) => Number(p.amount) || 0);
      const claim = sum(F.toClaim(s).filter((x) => x.p.context === 'work'), (x) => x.amount);
      return { big: money(owed), unit: 'owed to you', lines: [money(toPay) + ' to pay', money(claim) + ' to claim back'], good: owed > 0 };
    }
    if (area === 'projects') {
      const live = items.filter((p) => !CLOSED.includes(p.status));
      const next = live.filter((p) => p.start && p.start >= t).sort((a, b) => a.start.localeCompare(b.start))[0];
      const value = sum(live, (p) => Number(p.value) || 0);
      return { big: String(live.length), unit: live.length === 1 ? 'project on the go' : 'projects on the go', lines: [next ? 'Next: ' + next.name + ', ' + fmtDate(next.start, { short: true }) : 'nothing booked to start', value ? money(value, { whole: true }) + ' expected' : 'no fees added yet'] };
    }
    if (area === 'bills') {
      const live = items.filter((b) => b.active !== false);
      const monthly = sum(live, (b) => F.monthlyEquivalent(b.amount, b.frequency));
      const next = live.filter((b) => b.nextDue).sort((a, b) => a.nextDue.localeCompare(b.nextDue))[0];
      return { big: money(monthly), unit: 'a month', lines: [plural(live.length, 'bill'), next ? 'Next: ' + next.name + ', ' + fmtDate(next.nextDue, { short: true }) : 'none due'] };
    }
    if (area === 'contracts') {
      const ending = items.filter((d) => d.expiryDate && daysUntil(d.expiryDate) >= 0 && daysUntil(d.expiryDate) <= 90);
      const next = items.filter((d) => d.expiryDate && d.expiryDate >= t).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0];
      return { big: String(items.length), unit: items.length === 1 ? 'contract' : 'contracts', lines: [ending.length ? ending.length + ' ending in 90 days' : 'none ending soon', next ? 'Next ends ' + fmtDate(next.expiryDate, { short: true }) : 'no end dates'], bad: ending.some((d) => daysUntil(d.expiryDate) <= 30) };
    }
    if (area === 'costs') {
      const open = items.filter(GU.costs.isOpen);
      if (!open.length) return { big: money(0), unit: 'of ideas to fund', lines: ['Add ideas and what they’ll cost', 'and I’ll find when you can afford them'] };
      const plan = GU.costs.schedule(s);
      const next = plan.results.filter((r) => r.date).sort((a, b) => a.date.localeCompare(b.date))[0];
      return { big: money(plan.outstanding, { whole: true }), unit: 'of ideas to fund', lines: [next ? 'Next: ' + next.idea.name + ', ' + (daysUntil(next.date) <= 0 ? 'now' : fmtDate(next.date, { short: true })) : 'none fit yet', plan.notFitting ? plural(plan.notFitting, 'idea') + ' don’t fit in ' + plan.base.cfg.months + ' months' : plan.allBy ? 'All done by ' + fmtDate(plan.allBy, { short: true }) : ''], bad: plan.notFitting > 0 };
    }
    return {};
  }

  /* ---------- rows ---------- */
  function folderChip(s, rec, area) {
    if (ui.folder !== 'all') return '';
    const f = folderOf(s, rec, area);
    const fo = f && (s.workFolders || []).find((x) => x.id === f);
    return fo ? pill(fo.name, 'muted', 'folder') : '';
  }
  const moreBtn = (c, r) => '<button type="button" class="icon-btn" data-more="' + esc(c + ':' + r.id) + '" aria-label="More for ' + esc(nameOf(c, r)) + '">' + icon('more') + '</button>';

  function rowHTML(s, area, r) {
    const c = COLL[area];
    const chipF = folderChip(s, r, area);
    if (area === 'tasks') {
      const n = r.due ? daysUntil(r.due) : null;
      const due = r.due && !r.done ? pill(n < 0 ? relDays(r.due).replace(' ago', ' late') : n <= 1 ? relDays(r.due) : fmtDate(r.due, { weekday: true }), n < 0 ? 'crit' : n === 0 ? 'warn' : 'muted', 'clock') : '';
      return '<li class="wk-row' + (r.done ? ' is-done' : '') + '"><span class="wk-row__lead"><input type="checkbox" class="tick" data-done="' + esc(r.id) + '"' + (r.done ? ' checked' : '') + ' aria-label="Mark ' + esc(r.title) + ' as done"></span>' +
        '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.title) + '</b>' + (r.notes ? '<em>' + esc(r.notes.length > 100 ? r.notes.slice(0, 100) + '…' : r.notes) + '</em>' : '') +
        '<span class="wk-row__chips">' + (r.priority === 'high' ? pill('High', 'crit', 'flag') : '') + due + chipF + '</span></button>' +
        '<span class="wk-row__end"></span><span class="wk-row__act">' + moreBtn(c, r) + '</span></li>';
    }
    if (area === 'invoices') {
      const kind = { receipt: 'Receipt', 'invoice-in': 'Invoice to pay', 'invoice-out': 'Sent invoice', warranty: 'Warranty' }[r.kind] || 'Item';
      let status = '';
      let act = '';
      if (r.kind === 'invoice-out') {
        const left = F.outstanding(r);
        status = r.status === 'paid' ? pill('Paid to you', 'good', 'check') : r.dueDate && r.dueDate < today() ? pill('Late ' + -daysUntil(r.dueDate) + 'd', 'crit', 'alert') : r.dueDate ? pill('Due ' + fmtDate(r.dueDate, { short: true }), 'muted', 'clock') : pill('Not paid yet', 'warn');
        if (r.status !== 'paid') act = '<button type="button" class="btn btn--sm btn--soft" data-paid="' + esc(r.id) + '">' + icon('check') + 'Got paid</button>';
        if (r.status !== 'paid' && (r.payments || []).length) status += pill(money(left) + ' still to come', 'info');
      } else if (r.kind === 'invoice-in') {
        status = r.status === 'paid' ? pill('Paid', 'good', 'check') : r.dueDate && r.dueDate < today() ? pill('Overdue', 'crit', 'alert') : r.dueDate ? pill('Due ' + fmtDate(r.dueDate, { short: true }), daysUntil(r.dueDate) <= 7 ? 'warn' : 'muted', 'clock') : pill('To pay', 'warn');
        if (r.status !== 'paid') act = '<button type="button" class="btn btn--sm btn--soft" data-paid="' + esc(r.id) + '">' + icon('check') + 'Paid</button>';
      }
      if (r.claim && !r.claimed) {
        status += pill('Claim back', 'info', 'flag');
        act += '<button type="button" class="btn btn--sm btn--soft" data-claimed="' + esc(r.id) + '">' + icon('check') + 'Claimed</button>';
      } else if (r.claim && r.claimed) status += pill('Claimed', 'good', 'check');
      return '<li class="wk-row"><button type="button" class="wk-row__lead doc-row__thumb" data-files="' + esc(c + ':' + r.id) + '" aria-label="' + ((r.files || []).length ? 'View files for ' : 'Add a file to ') + esc(r.title) + '">' + thumbHTML(r.files) + '</button>' +
        '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.title) + '</b><em>' + esc([r.party, fmtDate(r.date, { short: true }), r.reference].filter(Boolean).join(' · ')) + '</em>' +
        '<span class="wk-row__chips">' + pill(kind, 'kind-' + r.kind) + status + chipF + '</span></button>' +
        '<span class="wk-row__end">' + (r.amount != null ? '<b class="' + (r.kind === 'invoice-out' ? 'is-in' : '') + '">' + esc(money(r.amount)) + '</b>' : '') + '</span>' +
        '<span class="wk-row__act">' + act + GU.ui.dlButton(r.files, r.title) + moreBtn(c, r) + '</span></li>';
    }
    if (area === 'projects') {
      const late = r.deadline && !CLOSED.includes(r.status) && daysUntil(r.deadline) < 0;
      const tone = { Idea: 'muted', Planned: 'info', Booked: 'info', 'In progress': 'warn', Done: 'good', Cancelled: 'muted' }[r.status] || 'muted';
      const when = [r.start ? (r.start >= today() ? 'Starts ' : 'Started ') + fmtDate(r.start, { short: true }) : '', r.deadline ? 'due ' + fmtDate(r.deadline, { short: true }) : ''].filter(Boolean).join(', ');
      return '<li class="wk-row"><span class="wk-row__lead wk-row__ico">' + icon('star') + '</span>' +
        '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.name) + '</b><em>' + esc([r.client, when].filter(Boolean).join(' · ')) + '</em>' +
        '<span class="wk-row__chips">' + pill(r.status || 'Idea', tone) + (late ? pill('Past deadline', 'crit', 'alert') : '') + chipF + '</span></button>' +
        '<span class="wk-row__end">' + (Number(r.value) > 0 ? '<b class="is-in">' + esc(money(r.value)) + '</b>' : '') + '</span>' +
        '<span class="wk-row__act">' + GU.ui.dlButton(r.files, r.name) + moreBtn(c, r) + '</span></li>';
    }
    if (area === 'bills') {
      const stopped = r.active === false;
      const n = r.nextDue ? daysUntil(r.nextDue) : null;
      const due = stopped ? pill('Stopped', 'muted') : r.nextDue ? pill((n < 0 && !r.autopay ? 'Overdue ' : 'Next ') + fmtDate(r.nextDue, { short: true }), n < 0 && !r.autopay ? 'crit' : n <= 7 ? 'warn' : 'muted', 'clock') : '';
      return '<li class="wk-row' + (stopped ? ' is-done' : '') + '"><span class="wk-row__lead wk-row__ico">' + icon(r.autopay ? 'repeat' : 'bills') + '</span>' +
        '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.name) + '</b><em>' + esc([r.payee, F.freqLabel(r.frequency), r.autopay ? r.method || 'Automatic' : 'Pay by hand'].filter(Boolean).join(' · ')) + '</em>' +
        '<span class="wk-row__chips">' + due + chipF + '</span></button>' +
        '<span class="wk-row__end"><b>' + esc(money(r.amount)) + '</b></span>' +
        '<span class="wk-row__act">' + (!stopped && !r.autopay ? '<button type="button" class="btn btn--sm btn--soft" data-billpaid="' + esc(r.id) + '">' + icon('check') + 'Paid</button>' : '') + GU.ui.dlButton(r.files, r.name) + moreBtn(c, r) + '</span></li>';
    }
    if (area === 'costs') {
      const plan = GU.costs.schedule(s);
      const x = plan.results.find((y) => y.idea.id === r.id);
      const pr = PRIORITIES.find((p) => p.value === (r.priority || 'should'));
      const proj = r.projectId && (s.projects || []).find((p) => p.id === r.projectId);
      let when = '';
      if (r.status === 'done') when = pill('Done' + (r.doneDate ? ' ' + fmtDate(r.doneDate, { short: true }) : ''), 'good', 'check');
      else if (r.status === 'dropped') when = pill('Dropped', 'muted');
      else if (x && x.date) {
        when = x.fixed ? pill('Booked ' + fmtDate(x.date, { short: true }), x.short > 0 ? 'crit' : 'info', 'clock') + (x.short > 0 ? pill(money(x.short, { whole: true }) + ' short', 'crit', 'alert') : '')
          : pill(daysUntil(x.date) <= 0 ? 'You can afford it now' : 'Earliest ' + fmtDate(x.date, { short: true }), daysUntil(x.date) <= 0 ? 'good' : 'info', 'clock');
        if (x.account) when += pill('from ' + x.account, 'muted', 'bank');
        if (r.wantBy) when += x.onTime ? pill('In time for ' + fmtDate(r.wantBy, { short: true }), 'good', 'check') : pill(x.lateDays + ' days after you wanted', 'warn', 'alert');
      } else if (x) when = pill('Not in the next ' + plan.base.cfg.months + ' months', 'crit', 'alert') + (x.shortfall ? pill('about ' + money(x.shortfall, { whole: true }) + ' short', 'warn') : '');
      return '<li class="wk-row' + (GU.costs.isOpen(r) ? '' : ' is-done') + '"><span class="wk-row__lead wk-row__ico">' + icon('coin') + '</span>' +
        '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.name) + '</b><em>' +
        esc([pr ? pr.label : '', proj ? 'for ' + proj.name : '', r.notBefore ? 'not before ' + fmtDate(r.notBefore, { short: true }) : '', r.wantBy ? 'wanted by ' + fmtDate(r.wantBy, { short: true }) : ''].filter(Boolean).join(' · ')) + '</em>' +
        '<span class="wk-row__chips">' + when + chipF + '</span></button>' +
        '<span class="wk-row__end"><b>' + esc(money(r.cost)) + '</b>' + (Number(r.monthly) > 0 ? '<em>+ ' + esc(money(r.monthly)) + ' a month</em>' : '') + '</span>' +
        '<span class="wk-row__act">' + (GU.costs.isOpen(r) ? '<button type="button" class="btn btn--sm btn--soft" data-idea-done="' + esc(r.id) + '">' + icon('check') + 'Done</button>' : '') + GU.ui.dlButton(r.files, r.name) + moreBtn(c, r) + '</span></li>';
    }
    // contracts
    const n = r.expiryDate ? daysUntil(r.expiryDate) : null;
    const end = r.expiryDate ? (n < 0 ? pill('Ended ' + fmtDate(r.expiryDate, { short: true }), 'muted') : pill('Ends ' + fmtDate(r.expiryDate, { short: true }), n <= 30 ? 'crit' : n <= 90 ? 'warn' : 'good', 'clock')) : pill('No end date', 'muted');
    return '<li class="wk-row"><button type="button" class="wk-row__lead doc-row__thumb" data-files="' + esc(c + ':' + r.id) + '" aria-label="' + ((r.files || []).length ? 'View ' : 'Add a scan to ') + esc(r.title) + '">' + thumbHTML(r.files) + '</button>' +
      '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.title) + '</b><em>' + esc([r.holder, r.issueDate ? 'from ' + fmtDate(r.issueDate, { short: true }) : '', r.type !== CONTRACT ? r.type : ''].filter(Boolean).join(' · ')) + '</em>' +
      '<span class="wk-row__chips">' + end + chipF + '</span></button>' +
      '<span class="wk-row__end"></span><span class="wk-row__act">' + GU.ui.dlButton(r.files, r.title) + moreBtn(c, r) + '</span></li>';
  }

  function noteHTML(s, n, showArea) {
    const fo = n.folder && (s.workFolders || []).find((x) => x.id === n.folder);
    return '<li class="wk-note"><button type="button" class="wk-note__main" data-open="' + esc('workNotes:' + n.id) + '"><b>' + esc(n.title || 'Note') + '</b>' +
      (n.body ? '<span>' + esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body) + '</span>' : '') +
      '<em>' + esc([showArea ? labelOf(n.area || 'general') : '', fo ? fo.name : '', 'updated ' + fmtDate(n.updated || n.created, { short: true })].filter(Boolean).join(' · ')) + '</em></button>' +
      moreBtn('workNotes', n) + '</li>';
  }

  /* ---------- the overview ---------- */
  function overviewHTML(s) {
    const list = checks(s);
    const crit = list.filter((x) => x.level === 'crit').length;
    const notes = (s.workNotes || []).slice().sort((a, b) => (b.updated || b.created || '').localeCompare(a.updated || a.created || '')).slice(0, 6);
    return '<section class="panel wk-check"><header class="panel__head"><h2>' + icon(list.length ? 'alert' : 'check') + 'What needs doing</h2>' +
      '<span class="muted">' + esc(list.length ? plural(list.length, 'thing') + (crit ? ', ' + crit + ' overdue or late' : '') : 'all up to date') + '</span></header>' +
      (list.length ? '<ul class="wk-check__list">' + list.map((x, i) => '<li class="is-' + x.level + '"><button type="button" data-check="' + i + '"><span class="dot dot--' + x.level + '">' + icon(x.level === 'info' ? 'info' : 'alert') + '</span>' +
        '<span><b>' + esc(x.title) + '</b><em>' + esc(labelOf(x.area) + ' · ' + x.detail) + '</em></span>' + icon('chevron') + '</button></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="wk-allgood">' + icon('check') + '<span>Everything at work is managed. Nothing is late, overdue or about to end.</span></p></div>') + '</section>' +
      '<div class="wk-cards">' + AREAS.map((a) => {
        const f = figures(s, a.id);
        const n = itemsOf(s, a.id).length;
        return '<button type="button" class="wk-card" data-area="' + a.id + '"><span class="wk-card__head">' + icon(a.icon) + esc(labelOf(a.id)) + '</span>' +
          '<b class="' + (f.bad ? 'is-crit' : f.good ? 'is-in' : '') + '">' + esc(f.big) + '</b><em>' + esc(f.unit) + '</em>' +
          '<span class="wk-card__lines">' + f.lines.map((l) => '<span>' + esc(l) + '</span>').join('') + '</span>' +
          '<span class="wk-card__foot">' + esc(plural(n, 'item') + (foldersOf(s, a.id).length ? ' · ' + plural(foldersOf(s, a.id).length, 'folder') : '')) + icon('chevron') + '</span></button>';
      }).join('') + '</div>' +
      '<section class="panel"><header class="panel__head"><h2>' + icon('note') + 'Notes</h2><button type="button" class="btn btn--sm" data-new-note>' + icon('plus') + 'New note</button></header>' +
      (notes.length ? '<ul class="wk-notes">' + notes.map((n) => noteHTML(s, n, true)).join('') + '</ul>' : '<div class="panel__body"><p class="muted">Jot down anything for work: meeting notes, ideas, who to call. Each category has its own notes too.</p></div>') + '</section>';
  }

  /* ---------- one area ---------- */
  function filtered(s, area) {
    let list = itemsOf(s, area);
    if (ui.folder === 'none') list = list.filter((r) => !folderOf(s, r, area));
    else if (ui.folder !== 'all') list = list.filter((r) => folderOf(s, r, area) === ui.folder);
    const q = ui.q.trim().toLowerCase();
    if (q) list = list.filter((r) => [r.title, r.name, r.party, r.payee, r.client, r.holder, r.reference, r.notes, r.category, r.status].join(' ').toLowerCase().includes(q));
    return list;
  }

  function invoiceFilter(list, t) {
    if (t === 'open') return list.filter((p) => (p.kind === 'invoice-out' || p.kind === 'invoice-in') ? p.status !== 'paid' : p.claim && !p.claimed);
    if (t === 'sent') return list.filter((p) => p.kind === 'invoice-out');
    if (t === 'to-pay') return list.filter((p) => p.kind === 'invoice-in');
    if (t === 'expenses') return list.filter((p) => p.kind === 'receipt' || p.kind === 'warranty');
    if (t === 'paid') return list.filter((p) => (p.kind === 'invoice-out' || p.kind === 'invoice-in') && p.status === 'paid');
    return list;
  }

  function areaBody(s, area) {
    const list = filtered(s, area);
    let extra = '';
    let groups;
    if (area === 'tasks') {
      const open = list.filter((k) => !k.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      const done = list.filter((k) => k.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 30);
      extra = '<form class="task-add wk-add" data-quick><input type="text" name="title" id="wk-task" placeholder="Add a work task, like “Send quote to Acme on Friday”" aria-label="New work task" autocomplete="off">' +
        '<input type="date" name="due" aria-label="Due date"><button type="submit" class="btn btn--primary">' + icon('plus') + 'Add</button></form>';
      groups = [{ title: 'To do', items: open }];
      if (done.length) groups.push({ title: 'Done', items: done, closed: true });
    } else if (area === 'invoices') {
      const opts = [['open', 'Needs action'], ['sent', 'Sent'], ['to-pay', 'To pay'], ['expenses', 'Receipts & expenses'], ['paid', 'Paid'], ['all', 'All']];
      extra = '<div class="toolbar">' + GU.ui.chips('inv', opts.map(([value, label]) => ({ value, label, count: invoiceFilter(list, value).length })), ui.inv) + '</div>';
      groups = [{ title: '', items: invoiceFilter(list, ui.inv).sort((a, b) => (b.date || '').localeCompare(a.date || '')) }];
    } else if (area === 'projects') {
      const order = (p) => (p.start || p.deadline || '9999');
      const by = (st) => list.filter((p) => st.includes(p.status || 'Idea')).sort((a, b) => order(a).localeCompare(order(b)));
      groups = [{ title: 'In progress', items: by(['In progress']) }, { title: 'Coming up', items: by(['Booked', 'Planned']) }, { title: 'Ideas', items: by(['Idea']) }, { title: 'Done or cancelled', items: by(CLOSED), closed: true }];
    } else if (area === 'bills') {
      groups = [{ title: '', items: list.filter((b) => b.active !== false).sort((a, b) => (a.nextDue || '9').localeCompare(b.nextDue || '9')) }, { title: 'Stopped', items: list.filter((b) => b.active === false), closed: true }];
    } else if (area === 'costs') {
      extra = forecastHTML(s);
      const plan = GU.costs.schedule(s);
      const at = (i) => (plan.results.find((r) => r.idea.id === i.id) || {}).date || '9999';
      const open = list.filter(GU.costs.isOpen);
      groups = [{ title: 'Can be done', items: open.filter((i) => at(i) !== '9999').sort((a, b) => at(a).localeCompare(at(b))) },
        { title: 'Doesn’t fit yet', items: open.filter((i) => at(i) === '9999') },
        { title: 'Done or dropped', items: list.filter((i) => !GU.costs.isOpen(i)).sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || '')), closed: true }];
    } else {
      groups = [{ title: '', items: list.sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999')) }];
    }
    groups = groups.filter((g) => g.items.length);
    const empty = !groups.length;
    return extra + '<section class="panel">' +
      (empty ? emptyState({ icon: AREAS.find((a) => a.id === area).icon, title: ui.q ? 'Nothing matches' : ui.folder !== 'all' ? 'Nothing in this folder yet' : 'No ' + labelOf(area).toLowerCase() + ' yet', text: ui.q ? 'Try another search.' : 'Add one with the button above' + (area === 'tasks' ? ', or type it in the box.' : ui.folder !== 'all' ? ', or move something here from its ⋯ menu.' : '.') })
        : groups.map((g) => (g.closed ? '<details class="wk-group"' + (ui.showDone ? ' open' : '') + '><summary>' + esc(g.title) + ' (' + g.items.length + ')</summary>' : g.title ? '<h3 class="wk-group__title">' + esc(g.title) + '</h3>' : '') +
          '<ul class="wk-rows">' + g.items.map((r) => rowHTML(s, area, r)).join('') + '</ul>' + (g.closed ? '</details>' : '')).join('')) + '</section>';
  }

  function areaHTML(s, area) {
    const a = AREAS.find((x) => x.id === area);
    const folders = foldersOf(s, area);
    const all = itemsOf(s, area);
    if (ui.folder !== 'all' && ui.folder !== 'none' && !folders.some((f) => f.id === ui.folder)) ui.folder = 'all';
    const inFolder = (id) => all.filter((r) => folderOf(s, r, area) === id).length + notesOf(s, area).filter((n) => n.folder === id).length;
    const unfiled = all.filter((r) => !folderOf(s, r, area)).length;
    const cur = folders.find((f) => f.id === ui.folder);
    const notes = notesOf(s, area).filter((n) => ui.folder === 'all' || (ui.folder === 'none' ? !n.folder || !folders.some((f) => f.id === n.folder) : n.folder === ui.folder))
      .sort((x, y) => (y.updated || y.created || '').localeCompare(x.updated || x.created || ''));
    const f = figures(s, area);
    return '<div class="wk-area__head"><div><p class="eyebrow">Work</p><h2 class="wk-area__title">' + icon(a.icon) + esc(labelOf(area)) +
      '<button type="button" class="icon-btn icon-btn--sm" data-rename-area="' + area + '" aria-label="Rename ' + esc(labelOf(area)) + '" data-tip="Rename">' + icon('edit') + '</button></h2>' +
      '<p class="muted">' + esc(f.big + ' ' + f.unit + ' · ' + f.lines.join(' · ')) + '</p></div>' +
      '<div class="wk-area__actions">' + addButtons(area) + '</div></div>' +
      '<div class="wk-folders" role="group" aria-label="Folders">' +
      '<button type="button" class="chip" data-folder="all" aria-pressed="' + (ui.folder === 'all') + '">' + icon('list') + 'All <span class="chip__n">' + all.length + '</span></button>' +
      folders.map((fo) => '<button type="button" class="chip" data-folder="' + esc(fo.id) + '" aria-pressed="' + (ui.folder === fo.id) + '">' + icon('folder') + esc(fo.name) + ' <span class="chip__n">' + inFolder(fo.id) + '</span></button>').join('') +
      (folders.length ? '<button type="button" class="chip" data-folder="none" aria-pressed="' + (ui.folder === 'none') + '">Not in a folder <span class="chip__n">' + unfiled + '</span></button>' : '') +
      '<button type="button" class="chip chip--add" data-new-folder>' + icon('plus') + 'New folder</button>' +
      '<label class="search wk-search">' + icon('search') + '<input type="search" id="wk-q" placeholder="Search ' + esc(labelOf(area).toLowerCase()) + '" value="' + esc(ui.q) + '" aria-label="Search"></label></div>' +
      (cur ? '<div class="wk-folderbar">' + icon('folder') + '<b>' + esc(cur.name) + '</b><span class="spacer"></span><button type="button" class="btn btn--sm btn--ghost" data-rename-folder="' + esc(cur.id) + '">' + icon('edit') + 'Rename</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-delete-folder="' + esc(cur.id) + '">' + icon('trash') + 'Delete folder</button></div>' : '') +
      (['invoices', 'bills', 'contracts'].includes(area) ? GU.ui.dropbar('Drop ' + (area === 'invoices' ? 'invoices or receipts' : area === 'bills' ? 'bills' : 'contracts') + ' here' + (cur ? ' to file them in ' + cur.name : ''), 'Photos and PDFs. I’ll read each one and file it under Work.') : '') +
      '<div id="wk-body">' + areaBody(s, area) + '</div>' +
      '<section class="panel"><header class="panel__head"><h2>' + icon('note') + 'Notes' + (cur ? ' in ' + esc(cur.name) : '') + '</h2><button type="button" class="btn btn--sm" data-new-note>' + icon('plus') + 'New note</button></header>' +
      (notes.length ? '<ul class="wk-notes">' + notes.map((n) => noteHTML(s, n, false)).join('') + '</ul>' : '<div class="panel__body"><p class="muted">No notes here yet.</p></div>') + '</section>';
  }

  function addButtons(area) {
    if (area === 'tasks') return '<button type="button" class="btn btn--primary" data-add="tasks">' + icon('plus') + 'New task</button>';
    if (area === 'invoices') return '<button type="button" class="btn" data-add="invoices" data-kind="receipt">' + icon('receipt') + 'Receipt or expense</button><button type="button" class="btn" data-add="invoices" data-kind="invoice-in">' + icon('out') + 'Invoice to pay</button>' +
      '<button type="button" class="btn btn--primary" data-add="invoices" data-kind="invoice-out">' + icon('in') + 'Invoice I’ve sent</button>';
    if (area === 'projects') return '<button type="button" class="btn btn--primary" data-add="projects">' + icon('plus') + 'New project</button>';
    if (area === 'costs') return '<button type="button" class="btn" data-cf-settings>' + icon('settings') + 'Forecast settings</button><button type="button" class="btn btn--primary" data-add="costs">' + icon('plus') + 'New idea</button>';
    if (area === 'bills') return '<button type="button" class="btn" data-bring="bills">' + icon('list') + 'Choose from your bills</button><button type="button" class="btn btn--primary" data-add="bills">' + icon('plus') + 'New bill</button>';
    return '<button type="button" class="btn" data-bring="contracts">' + icon('list') + 'Choose from your documents</button><button type="button" class="btn btn--primary" data-add="contracts">' + icon('plus') + 'New contract</button>';
  }

  /* ---------- the page ---------- */
  function render(root) {
    const s = store.state;
    if (ui.area !== 'overview' && !AREAS.some((a) => a.id === ui.area)) ui.area = 'overview';
    const n = checks(s).filter((x) => x.level !== 'info');
    const count = (area) => n.filter((x) => x.area === area).length;
    root.innerHTML = GU.view.head({
      eyebrow: 'Work',
      title: 'Work',
      text: 'Everything for work in one place: tasks, invoices, upcoming projects, bills and contracts. Make folders, keep notes and rename anything to suit you.',
      actions: '<button type="button" class="btn btn--primary" data-add-menu>' + icon('plus') + 'Add</button>',
    }) +
      '<div class="split wk">' +
      '<nav class="lists" aria-label="Work sections">' +
      '<button type="button" class="lists__item" data-area="overview" aria-current="' + (ui.area === 'overview') + '">' + icon('today') + '<span>Overview</span><b>' + (n.length || '') + '</b></button>' +
      AREAS.map((a) => '<button type="button" class="lists__item" data-area="' + a.id + '" aria-current="' + (ui.area === a.id) + '">' + icon(a.icon) + '<span>' + esc(labelOf(a.id)) + '</span><b class="' + (count(a.id) ? 'is-crit' : '') + '">' + (count(a.id) || itemsOf(s, a.id).length || '') + '</b></button>').join('') +
      '</nav><div class="stack">' + (ui.area === 'overview' ? overviewHTML(s) : areaHTML(s, ui.area)) + '</div></div>';

    const q = root.querySelector('#wk-q');
    if (q) {
      q.addEventListener('input', debounce((e) => {
        ui.q = e.target.value;
        const body = root.querySelector('#wk-body');
        if (body) {
          body.innerHTML = areaBody(store.state, ui.area);
          GU.ui.hydrate(body);
        }
      }, 150));
    }
    const quick = root.querySelector('[data-quick]');
    if (quick) {
      quick.addEventListener('submit', (e) => {
        e.preventDefault();
        const raw = quick.elements.title.value.trim();
        if (!raw) return;
        const parsed = GU.tabs.today.parseQuickTask ? GU.tabs.today.parseQuickTask(raw) : { title: raw };
        store.commit((st) => {
          const listId = ensureWorkList(st);
          st.tasks.push({ id: 'k-' + uid(), listId, context: 'work', workFolder: ui.folder !== 'all' && ui.folder !== 'none' ? ui.folder : '', title: parsed.title || raw, due: parsed.due || quick.elements.due.value, priority: 'normal', notes: '', done: false, created: today() });
        });
        setTimeout(() => {
          const el = document.getElementById('wk-task');
          if (el) el.focus();
        }, 0);
      });
    }
    root.querySelectorAll('.wk-group').forEach((d) => d.addEventListener('toggle', () => (ui.showDone = d.open)));
    if (ui.area !== 'overview') GU.ui.wireDropbar(root, (files) => upload(files));
    root.addEventListener('change', (e) => {
      const d = e.target.closest('[data-done]');
      if (d) GU.tabs.todos.complete(d.dataset.done, d.checked);
    });
    root.addEventListener('click', onClick);
  }

  function onClick(e) {
    const s = store.state;
    const b = (sel) => e.target.closest(sel);
    let el;
    if ((el = b('[data-area]'))) {
      ui.area = el.dataset.area;
      ui.folder = 'all';
      ui.q = '';
      return GU.render();
    }
    if ((el = b('[data-folder]'))) {
      ui.folder = el.dataset.folder;
      return GU.render();
    }
    if ((el = b('[data-chip="inv"]'))) {
      ui.inv = el.dataset.value;
      return GU.render();
    }
    if ((el = b('[data-check]'))) {
      const x = checks(s)[+el.dataset.check];
      if (!x) return;
      if (x.ref) return GU.view.open(x.ref);
      ui.area = x.area;
      ui.folder = 'all';
      if (x.area === 'invoices') ui.inv = 'open';
      return GU.render();
    }
    if (b('[data-add-menu]')) return addMenu(b('[data-add-menu]'));
    if ((el = b('[data-add]'))) return add(el.dataset.add, el.dataset.kind);
    if ((el = b('[data-bring]'))) return bringIn(el.dataset.bring);
    if (b('[data-new-folder]')) return newFolder(ui.area);
    if ((el = b('[data-rename-folder]'))) return rename('workFolders', el.dataset.renameFolder);
    if ((el = b('[data-delete-folder]'))) return deleteFolder(el.dataset.deleteFolder);
    if ((el = b('[data-rename-area]'))) return renameArea(el.dataset.renameArea);
    if (b('[data-new-note]')) return editNote(null, { area: ui.area === 'overview' ? 'general' : ui.area, folder: ui.folder !== 'all' && ui.folder !== 'none' ? ui.folder : '' });
    if ((el = b('[data-more]'))) {
      const [c, id] = el.dataset.more.split(':');
      return moreMenu(el, c, id);
    }
    if (b('[data-cf-settings]')) return forecastSettings();
    if (b('[data-balances]')) return GU.tabs.transactions.updateBalances();
    if ((el = b('[data-idea-done]'))) return ideaStatus(el.dataset.ideaDone, 'done');
    if ((el = b('[data-paid]'))) return GU.tabs.receipts.markPaid(el.dataset.paid);
    if ((el = b('[data-claimed]'))) return GU.tabs.receipts.markClaimed([el.dataset.claimed]);
    if ((el = b('[data-billpaid]'))) return GU.tabs.bills.markPaid(el.dataset.billpaid);
    if ((el = b('[data-files]'))) {
      const [c, id] = el.dataset.files.split(':');
      const r = store.find(c, id);
      if (r && (r.files || []).length) return viewFiles(r.files, 0, nameOf(c, r));
      return GU.view.open({ c, id });
    }
    if ((el = b('[data-open]'))) {
      const [c, id] = el.dataset.open.split(':');
      return GU.view.open({ c, id });
    }
  }

  /* ---------- adding ---------- */
  const curFolder = () => (ui.folder !== 'all' && ui.folder !== 'none' ? ui.folder : '');
  /* Marks a record made by another tab's form as work, in the folder you're looking at. */
  function tag(c, id, folder) {
    store.commit((s) => {
      const r = (s[c] || []).find((x) => x.id === id);
      if (!r) return;
      r.context = 'work';
      if (folder !== undefined) r.workFolder = folder;
      if (c === 'tasks') r.listId = ensureWorkList(s);
    });
  }

  function add(area, kind) {
    const folder = curFolder();
    if (area === 'tasks') {
      if (!workListId(store.state)) store.commit((s) => ensureWorkList(s));
      return GU.tabs.todos.create({ listId: workListId(store.state) }, { onSaved: (r) => tag('tasks', r.id, folder) });
    }
    if (area === 'invoices') return GU.tabs.receipts.create({ values: { kind: kind || 'invoice-out', context: 'work', date: today(), status: 'unpaid', claim: kind === 'receipt' }, onSaved: (r) => tag('paperwork', r.id, folder) });
    if (area === 'projects') return editProject(null, { folder });
    if (area === 'costs') return editIdea(null, { folder });
    if (area === 'bills') return GU.tabs.bills.create({ category: 'Work expenses' }, { onSaved: (r) => tag('bills', r.id, folder) });
    if (area === 'contracts') return GU.tabs.documents.create({ type: CONTRACT, title: '' }, { onSaved: (r) => tag('documents', r.id, folder) });
    if (area === 'note') return editNote(null, { area: ui.area === 'overview' ? 'general' : ui.area, folder });
    if (area === 'folder') return newFolder(ui.area === 'overview' ? null : ui.area);
  }

  function addMenu(anchor) {
    menu(anchor, [
      { icon: 'todo', label: 'Task', hint: labelOf('tasks'), onClick: () => add('tasks') },
      { icon: 'in', label: 'Invoice I’ve sent', hint: 'Someone owes you', onClick: () => add('invoices', 'invoice-out') },
      { icon: 'out', label: 'Invoice to pay', hint: 'You owe someone', onClick: () => add('invoices', 'invoice-in') },
      { icon: 'receipt', label: 'Receipt or expense', hint: 'To claim back', onClick: () => add('invoices', 'receipt') },
      { icon: 'star', label: 'Project', hint: labelOf('projects'), onClick: () => add('projects') },
      { icon: 'bills', label: 'Bill', hint: 'A regular work cost', onClick: () => add('bills') },
      { icon: 'file', label: 'Contract', hint: 'With its start and end dates', onClick: () => add('contracts') },
      { icon: 'trend', label: 'Idea to cost', hint: 'I’ll work out when you can afford it', onClick: () => add('costs') },
      { icon: 'note', label: 'Note', hint: 'Anything to remember', onClick: () => add('note') },
      { icon: 'folder', label: 'Folder', hint: 'To group things in a category', onClick: () => add('folder') },
      { icon: 'upload', label: 'Upload files', hint: 'I’ll read them and file them under Work', onClick: async () => {
        const files = await GU.ui.pickFiles();
        if (files.length) upload(files);
      } },
    ]);
  }

  /* Files dropped or picked here are read by the assistant and filed under Work, in this area and folder. */
  function upload(files) {
    const area = ui.area === 'overview' ? null : ui.area;
    const folder = curFolder();
    const fo = folder && (store.state.workFolders || []).find((x) => x.id === folder);
    GU.inbox.add({ files, scope: { kind: 'work', area, folderId: folder, name: 'Work' + (area ? ' › ' + labelOf(area) : '') + (fo ? ' › ' + fo.name : '') } });
  }

  /* Puts things from elsewhere (your bills, documents…) under Work. */
  function bringIn(area) {
    const s = store.state;
    const c = COLL[area];
    const pool = area === 'bills' ? s.bills.filter((b) => !isWorkBill(b) && b.active !== false) : s.documents.filter((d) => d.context !== 'work');
    if (!pool.length) return toast(area === 'bills' ? 'All your bills are already under Work.' : 'There are no other documents to choose from.');
    const folder = curFolder();
    const d = GU.ui.openDialog({
      title: area === 'bills' ? 'Which bills are for work?' : 'Which documents are work contracts?',
      body: '<p class="dlg__intro">Tick the ones to show under Work. They stay where they are too.</p><label class="search wk-pick__search">' + icon('search') + '<input type="search" data-pick-q placeholder="Search" aria-label="Search"></label><ul class="wk-pick" data-pick></ul>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary">Add to Work</button>',
    });
    const box = d.body.querySelector('[data-pick]');
    const chosen = new Set();
    const draw = (q) => {
      const ql = (q || '').toLowerCase();
      const list = pool.filter((r) => !ql || [nameOf(c, r), r.payee, r.type, r.holder, r.category].join(' ').toLowerCase().includes(ql)).slice(0, 150);
      box.innerHTML = list.map((r) => '<li><label class="check"><input type="checkbox" value="' + esc(r.id) + '"' + (chosen.has(r.id) ? ' checked' : '') + '><span><b>' + esc(nameOf(c, r)) + '</b> <em class="muted">' +
        esc(area === 'bills' ? money(r.amount) + ' · ' + F.freqLabel(r.frequency) + (r.category ? ' · ' + r.category : '') : [r.type, r.expiryDate ? 'ends ' + fmtDate(r.expiryDate, { short: true }) : ''].filter(Boolean).join(' · ')) + '</em></span></label></li>').join('') || '<li class="muted">Nothing matches.</li>';
    };
    draw('');
    box.addEventListener('change', (e) => {
      if (e.target.checked) chosen.add(e.target.value);
      else chosen.delete(e.target.value);
    });
    d.body.querySelector('[data-pick-q]').addEventListener('input', (e) => draw(e.target.value));
    d.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!chosen.size) return d.close();
      const ids = Array.from(chosen);
      store.commit((st) => {
        for (const r of st[c]) {
          if (!ids.includes(r.id)) continue;
          r.context = 'work';
          if (folder) r.workFolder = folder;
          if (area === 'contracts' && (!r.type || r.type === 'Other')) r.type = CONTRACT;
        }
      });
      d.close();
      toast('Added ' + plural(ids.length, area === 'bills' ? 'bill' : 'document') + ' to Work', { action: 'Undo', onAction: () => store.commit((st) => {
        for (const r of st[c]) if (ids.includes(r.id)) delete r.context;
      }) });
    });
  }

  /* ---------- projects ---------- */
  function projectFields(area) {
    const s = store.state;
    return [
      { name: 'name', label: 'Project', required: true, placeholder: 'e.g. Website for Acme, Pharmacy shop launch' },
      { name: 'client', label: 'Client or who it’s for', half: true, optional: true },
      { name: 'status', label: 'Where it’s at', type: 'select', options: STATUSES, default: 'Planned', half: true },
      { name: 'start', label: 'Starts', type: 'date', half: true, optional: true },
      { name: 'deadline', label: 'Due or finishes', type: 'date', half: true, optional: true },
      { name: 'value', label: 'Expected fee or value', type: 'money', half: true, optional: true },
      { name: 'workFolder', label: 'Folder', type: 'select', options: [{ value: '', label: 'No folder' }].concat(foldersOf(s, area || 'projects').map((f) => ({ value: f.id, label: f.name }))), half: true },
      { name: 'files', label: 'Files', type: 'files', dropLabel: 'Add briefs, quotes, plans or photos' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 4, optional: true, placeholder: 'What’s involved, who to talk to, next steps…' },
    ];
  }
  function editProject(id, opts) {
    const p = id ? store.find('projects', id) : null;
    formDialog({
      title: p ? 'Edit project' : 'New project',
      fields: projectFields('projects'),
      values: p || { status: 'Planned', workFolder: (opts && opts.folder) || '' },
      submitLabel: p ? 'Save' : 'Add project',
      onSubmit: (v) => {
        const rec = Object.assign(p ? Object.assign({}, p) : { id: 'pj-' + uid(), created: today() }, v, { updated: today() });
        store.upsert('projects', rec);
        if (!p) toast('Added ' + rec.name);
      },
      onDelete: p ? () => store.remove('projects', p.id, p.name) : null,
      deleteMessage: 'This deletes the project and its files. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
  }

  /* ---------- cost forecast ---------- */
  function forecastHTML(s) {
    const plan = GU.costs.schedule(s);
    const b = plan.base;
    if (!b.known) {
      return '<section class="panel"><div class="panel__body cf-empty">' + icon('bank') + '<p>Put in what’s in your accounts first, and I’ll work out when you can afford each idea.</p><button type="button" class="btn btn--primary" data-balances>Add your balances</button></div></section>';
    }
    const n = b.dates.length;
    // Four month labels, with the year once it changes.
    const step = Math.max(1, Math.round(n / 4));
    const labels = [];
    for (let i = 0; i < n - step / 2; i += step) labels.push({ i, text: GU.util.monthLabel(b.dates[i].slice(0, 7)) + (b.dates[i].slice(0, 4) !== today().slice(0, 4) ? ' ' + b.dates[i].slice(2, 4) : '') });
    const marks = plan.results.filter((r) => r.date).map((r) => ({ i: b.dates.indexOf(r.date), tip: r.idea.name + ': ' + money(r.cost, { whole: true }) + ', ' + fmtDate(r.date, { short: true }) + (r.account ? ' from ' + r.account : '') })).filter((m) => m.i >= 0);
    const keep = b.cfg.buffer ? money(b.cfg.buffer, { whole: true }) : '£0';
    const floorLabel = 'Keep ' + keep + (b.cfg.overdraft ? ', using your overdraft' : '');
    const spareTone = plan.spare < 0 ? 'is-crit' : 'is-in';
    const room = plan.months.slice(0, b.cfg.months);
    return '<section class="panel cf"><header class="panel__head"><h2>' + icon('trend') + 'When you can afford things</h2><span class="muted">next ' + b.cfg.months + ' months</span></header>' +
      '<div class="tally__sum">' +
      '<div><span>Spare each month</span><b class="' + spareTone + '">' + esc(money(plan.spare, { whole: true })) + '</b><em>' + esc(plan.spare < 0 ? 'more goes out than comes in' : 'on average, after bills, debts and everyday spending') + '</em></div>' +
      '<div><span>You could spend now</span><b>' + esc(money(plan.freeNow, { whole: true })) + '</b><em>' + esc('and never drop below ' + keep + (b.cfg.overdraft ? ' (with overdraft)' : '')) + '</em></div>' +
      '<div><span>Ideas to fund</span><b>' + esc(money(plan.outstanding, { whole: true })) + '</b><em>' + esc(plural(plan.results.length, 'idea') + ' on the list') + '</em></div>' +
      '<div><span>' + (plan.notFitting ? 'Don’t fit yet' : 'All done by') + '</span><b class="' + (plan.notFitting ? 'is-crit' : '') + '">' + esc(plan.notFitting ? String(plan.notFitting) : plan.allBy ? fmtDate(plan.allBy, { short: true }) : '–') + '</b><em>' + esc(plan.notFitting ? 'not affordable in ' + b.cfg.months + ' months at this rate' : plan.results.length ? 'at the earliest' : 'add an idea below') + '</em></div>' +
      '</div>' +
      '<div class="panel__body cf-chart">' + GU.charts.line(plan.after.map((v, i) => ({ value: v, tip: fmtDate(b.dates[i], { weekday: true }) + ': ' + money(v) + (plan.after[i] !== b.total[i] ? ' (' + money(b.total[i]) + ' before your ideas)' : '') })),
        { height: 170, labels, base: plan.results.some((r) => r.date) ? b.total : null, floor: { value: b.floor, label: floorLabel }, marks }) +
      '<p class="cf-legend"><span><i class="cf-key cf-key--after"></i>With your ideas</span><span><i class="cf-key cf-key--base"></i>Before them</span><span><i class="cf-key cf-key--mark"></i>When each idea happens</span></p></div>' +
      '<div class="cf-room"><h3>Room to spend, month by month</h3><p class="muted">The most you could spend from the start of each month, after the ideas above, without dropping below ' + esc(keep) + ' later on.</p><ol>' +
      room.map((m) => '<li class="' + (m.room > 0 ? 'is-room' : '') + '"><span>' + esc(GU.util.monthLabel(m.key) + (m.key.slice(0, 4) !== today().slice(0, 4) ? ' ' + m.key.slice(0, 4) : '')) + '</span><b>' + esc(money(m.room, { whole: true })) + '</b></li>').join('') + '</ol></div>' +
      '<footer class="panel__foot cf-note">' + icon('info') + '<span>' + esc('Starts from ' + money(b.plan.start) + ' across your accounts. Counts your income, bills, debt and instalment payments and invoices due, plus about ' + money(b.everyday, { whole: true }) + ' a month of everyday spending' +
        (b.cfg.everyday != null && b.cfg.everyday !== '' ? ' (your figure)' : b.est ? ' (from your last ' + plural(b.est.months.length, 'month') + ' of statements)' : '') + '. It keeps at least ' + keep + ' in your accounts' + (b.cfg.overdraft ? ', counting your overdraft' : '') + '. Must-haves are planned first. ') + '<button type="button" class="link link--btn" data-cf-settings>Change these</button></span></footer></section>';
  }

  function editIdea(id, opts) {
    const s = store.state;
    const i = id ? store.find('costIdeas', id) : null;
    formDialog({
      title: i ? 'Edit idea' : 'New idea to cost',
      intro: i ? null : 'Add what it is and what it’ll cost. I’ll find the earliest date you can afford it without dropping below what you keep, and which account it could come from.',
      fields: [
        { name: 'name', label: 'What is it?', required: true, placeholder: 'e.g. New laptop, Shop signage, Marketing campaign' },
        { name: 'cost', label: 'What it’ll cost', type: 'money', required: true, half: true },
        { name: 'monthly', label: 'Ongoing cost a month', type: 'money', optional: true, half: true, help: 'For things that keep costing, like software or rent.' },
        { name: 'priority', label: 'How important', type: 'segmented', options: PRIORITIES, default: 'should' },
        { name: 'notBefore', label: 'Not before', type: 'date', optional: true, half: true },
        { name: 'wantBy', label: 'Want it by', type: 'date', optional: true, half: true },
        { name: 'plannedDate', label: 'Already booked for', type: 'date', optional: true, half: true, help: 'Leave empty and I’ll find the earliest date you can afford it.' },
        { name: 'projectId', label: 'For project', type: 'select', options: [{ value: '', label: 'None' }].concat((s.projects || []).map((p) => ({ value: p.id, label: p.name }))), half: true },
        { name: 'status', label: 'Status', type: 'segmented', options: [{ value: 'open', label: 'To do' }, { value: 'done', label: 'Done' }, { value: 'dropped', label: 'Dropped' }], default: 'open' },
        { name: 'workFolder', label: 'Folder', type: 'select', options: [{ value: '', label: 'No folder' }].concat(foldersOf(s, 'costs').map((f) => ({ value: f.id, label: f.name }))), half: true },
        { name: 'files', label: 'Quotes or files', type: 'files', dropLabel: 'Add quotes, links saved as PDFs or photos' },
        { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, optional: true },
      ],
      values: i ? Object.assign({ status: 'open' }, i) : { priority: 'should', status: 'open', workFolder: (opts && opts.folder) || '' },
      submitLabel: i ? 'Save' : 'Add idea',
      onSubmit: (v) => {
        const rec = Object.assign(i ? Object.assign({}, i) : { id: 'ci-' + uid(), created: today() }, v, { updated: today() });
        if (rec.status === 'done' && !rec.doneDate) rec.doneDate = today();
        if (rec.status !== 'done') delete rec.doneDate;
        store.upsert('costIdeas', rec);
        if (!i) {
          const r = GU.costs.schedule(store.state).results.find((x) => x.idea.id === rec.id);
          toast(r && r.date ? rec.name + ': ' + (daysUntil(r.date) <= 0 ? 'you can afford it now' : 'earliest ' + fmtDate(r.date, { short: true })) + (r.account ? ', from ' + r.account : '') : rec.name + ' doesn’t fit in the time ahead yet');
        }
      },
      onDelete: i ? () => store.remove('costIdeas', i.id, i.name) : null,
      deleteMessage: 'This deletes the idea. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
  }

  function ideaStatus(id, status) {
    const before = Object.assign({}, store.find('costIdeas', id));
    store.commit((s) => {
      const i = s.costIdeas.find((x) => x.id === id);
      if (!i) return;
      i.status = status;
      if (status === 'done') i.doneDate = today();
      else delete i.doneDate;
    });
    toast(status === 'done' ? 'Marked done' : status === 'dropped' ? 'Dropped from the plan' : 'Back in the plan', { action: 'Undo', onAction: () => store.upsert('costIdeas', before) });
  }

  function forecastSettings() {
    const s = store.state;
    const cfg = GU.costs.settings(s);
    const est = GU.costs.everydayEstimate(s);
    formDialog({
      title: 'Forecast settings',
      fields: [
        { name: 'buffer', label: 'Always keep at least', type: 'money', half: true, help: 'A safety cushion the plan won’t dip into.' },
        { name: 'months', label: 'Look ahead', type: 'select', options: [{ value: '6', label: '6 months' }, { value: '12', label: '12 months' }, { value: '18', label: '18 months' }, { value: '24', label: '2 years' }], half: true },
        { name: 'everyday', label: 'Everyday spending a month', type: 'money', optional: true, placeholder: est ? est.monthly.toFixed(2) : '0.00', help: 'Food, fuel, shopping and the like, on top of bills and debts. Leave empty to use your statements' + (est ? ': about ' + money(est.monthly, { whole: true }) + ' a month.' : '.') },
        { name: 'overdraft', label: 'Overdraft', type: 'checkbox', checkLabel: 'Count my overdraft as money I can use' },
      ],
      values: { buffer: cfg.buffer, months: String(cfg.months), everyday: cfg.everyday, overdraft: cfg.overdraft },
      onSubmit: (v) => store.commit((st) => {
        st.settings.costForecast = { buffer: v.buffer || 0, months: Number(v.months) || 12, everyday: v.everyday == null ? null : v.everyday, overdraft: !!v.overdraft };
      }),
    });
  }

  /* ---------- notes ---------- */
  function editNote(id, opts) {
    const s = store.state;
    const n = id ? store.find('workNotes', id) : null;
    const area = n ? n.area || 'general' : opts.area || 'general';
    const folderOpts = (a) => [{ value: '', label: 'No folder' }].concat(foldersOf(s, a).map((f) => ({ value: f.id, label: f.name })));
    formDialog({
      title: n ? 'Note' : 'New note',
      wide: true,
      fields: [
        { name: 'title', label: 'Title', required: true, placeholder: 'e.g. Call with Acme, Ideas for the shop' },
        { name: 'area', label: 'Category', type: 'select', options: [{ value: 'general', label: 'General' }].concat(AREAS.map((a) => ({ value: a.id, label: labelOf(a.id) }))), half: true },
        { name: 'folder', label: 'Folder', type: 'select', options: folderOpts(area), half: true, help: 'Folders belong to a category. Save, then reopen to pick a folder after changing the category.' },
        { name: 'body', label: 'Note', type: 'textarea', rows: 10 },
      ],
      values: n || { area, folder: opts.folder || '', title: '', body: '' },
      submitLabel: n ? 'Save' : 'Save note',
      onSubmit: (v) => {
        const keepFolder = v.area === area ? v.folder : '';
        const rec = Object.assign(n ? Object.assign({}, n) : { id: 'wn-' + uid(), created: today() }, v, { folder: keepFolder, updated: today() });
        store.upsert('workNotes', rec);
      },
      onDelete: n ? () => store.remove('workNotes', n.id, n.title || 'Note') : null,
      deleteMessage: 'This deletes the note. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
  }

  /* ---------- folders and names ---------- */
  function newFolder(area, then) {
    const s = store.state;
    formDialog({
      title: 'New folder',
      fields: [{ name: 'name', label: 'Folder name', required: true, placeholder: 'e.g. Acme Ltd, 2026, Subscriptions' }].concat(area ? [] : [{ name: 'area', label: 'In', type: 'select', options: AREAS.map((a) => ({ value: a.id, label: labelOf(a.id) })) }]),
      values: { area: 'tasks' },
      submitLabel: 'Create folder',
      onSubmit: (v) => {
        const a = area || v.area;
        const name = v.name.trim();
        if (foldersOf(s, a).some((f) => f.name.toLowerCase() === name.toLowerCase())) {
          toast('There’s already a folder called ' + name + ' in ' + labelOf(a) + '.');
          return false;
        }
        const rec = { id: 'wf-' + uid(), area: a, name, created: today() };
        store.upsert('workFolders', rec);
        if (then) then(rec);
        else {
          ui.area = a;
          ui.folder = rec.id;
          GU.render();
        }
      },
    });
  }
  function deleteFolder(id) {
    const fo = store.find('workFolders', id);
    if (!fo) return;
    // Things in it stay where they are, just out of the folder; Undo puts the folder (and them) back.
    store.remove('workFolders', id, fo.name + ' folder');
    ui.folder = 'all';
    GU.render();
  }
  function rename(c, id) {
    const r = store.find(c, id);
    if (!r) return;
    const field = c === 'bills' || c === 'projects' || c === 'workFolders' ? 'name' : 'title';
    formDialog({
      title: 'Rename',
      fields: [{ name: 'name', label: 'Name', required: true }],
      values: { name: r[field] || '' },
      submitLabel: 'Rename',
      onSubmit: (v) => store.commit((s) => {
        const x = s[c].find((y) => y.id === id);
        if (x) x[field] = v.name.trim();
      }),
    });
  }
  function renameArea(area) {
    const def = AREAS.find((a) => a.id === area).label;
    formDialog({
      title: 'Rename ' + labelOf(area),
      fields: [{ name: 'name', label: 'Call it', required: true, help: 'Leave it as “' + def + '” to keep the usual name.' }],
      values: { name: labelOf(area) },
      submitLabel: 'Rename',
      onSubmit: (v) => store.commit((s) => {
        s.settings.workLabels = Object.assign({}, s.settings.workLabels);
        if (!v.name.trim() || v.name.trim() === def) delete s.settings.workLabels[area];
        else s.settings.workLabels[area] = v.name.trim();
      }),
    });
  }

  /* Move to a folder (or a new one), rename, edit, take out of Work or delete. */
  function moreMenu(anchor, c, id) {
    const s = store.state;
    const r = store.find(c, id);
    if (!r) return;
    if (c === 'workNotes') {
      return menu(anchor, [
        { icon: 'edit', label: 'Open', onClick: () => editNote(id) },
        { icon: 'edit', label: 'Rename', onClick: () => rename(c, id) },
        { icon: 'folder', label: 'Move to…', hint: 'Another folder or category', onClick: () => moveNote(anchor, id) },
        { icon: 'trash', label: 'Delete', onClick: () => store.remove('workNotes', id, r.title || 'Note') },
      ]);
    }
    const area = AREA_OF[c];
    const items = [
      { icon: 'edit', label: 'Open and edit', onClick: () => GU.view.open({ c, id }) },
      { icon: 'edit', label: 'Rename', onClick: () => rename(c, id) },
      { icon: 'folder', label: 'Move to folder…', hint: folderOf(s, r, area) ? 'Now in ' + ((s.workFolders || []).find((f) => f.id === r.workFolder) || {}).name : 'Not in a folder', onClick: () => moveMenu(anchor, c, id) },
    ];
    if (c === 'costIdeas') {
      if (GU.costs.isOpen(r)) {
        items.push({ icon: 'check', label: 'Mark done', onClick: () => ideaStatus(id, 'done') });
        items.push({ icon: 'x', label: 'Drop it', hint: 'Keeps it, but stops planning for it', onClick: () => ideaStatus(id, 'dropped') });
      } else items.push({ icon: 'repeat', label: 'Back to the plan', onClick: () => ideaStatus(id, 'open') });
      items.push({ icon: 'trash', label: 'Delete', onClick: () => store.remove('costIdeas', id, r.name) });
    } else if (c === 'projects') {
      for (const st of ['In progress', 'Done'].filter((x) => x !== r.status)) items.push({ icon: st === 'Done' ? 'check' : 'clock', label: 'Mark ' + st.toLowerCase(), onClick: () => store.commit((x) => (x.projects.find((p) => p.id === id).status = st)) });
      items.push({ icon: 'trash', label: 'Delete', onClick: () => store.remove('projects', id, r.name) });
    } else {
      items.push({ icon: 'x', label: 'Take out of Work', hint: 'It stays in ' + { tasks: 'To-do', paperwork: 'Receipts & invoices', bills: 'Bills', documents: 'Documents' }[c], onClick: () => takeOut(c, id) });
      items.push({ icon: 'trash', label: 'Delete', onClick: () => store.remove(c, id, nameOf(c, r)) });
    }
    menu(anchor, items);
  }
  function moveMenu(anchor, c, id) {
    const s = store.state;
    const area = AREA_OF[c];
    const set = (folder) => store.commit((st) => {
      const r = st[c].find((x) => x.id === id);
      if (r) r.workFolder = folder;
    });
    menu(anchor, [{ icon: 'x', label: 'No folder', onClick: () => set('') }]
      .concat(foldersOf(s, area).map((f) => ({ icon: 'folder', label: f.name, onClick: () => set(f.id) })))
      .concat([{ icon: 'plus', label: 'New folder…', onClick: () => newFolder(area, (f) => set(f.id)) }]));
  }
  function moveNote(anchor, id) {
    const s = store.state;
    const opts = [{ area: 'general', folder: '', label: 'General' }];
    for (const a of AREAS) {
      opts.push({ area: a.id, folder: '', label: labelOf(a.id) });
      for (const f of foldersOf(s, a.id)) opts.push({ area: a.id, folder: f.id, label: labelOf(a.id) + ' › ' + f.name });
    }
    menu(anchor, opts.map((o) => ({ icon: o.folder ? 'folder' : 'list', label: o.label, onClick: () => store.commit((st) => {
      const n = st.workNotes.find((x) => x.id === id);
      if (n) Object.assign(n, { area: o.area, folder: o.folder, updated: today() });
    }) })));
  }
  function takeOut(c, id) {
    const before = Object.assign({}, store.find(c, id));
    store.commit((s) => {
      const r = s[c].find((x) => x.id === id);
      if (!r) return;
      if (c === 'tasks') {
        r.context = 'home';
        const wl = workListId(s);
        if (r.listId === wl) r.listId = (s.todoLists.find((l) => l.id !== wl) || {}).id || r.listId;
      } else r.context = 'home';
      delete r.workFolder;
    });
    toast('Taken out of Work', { action: 'Undo', onAction: () => store.upsert(c, before) });
  }

  /* Opens a project or note (from anywhere, e.g. Home's timeline). */
  function edit(id, c) {
    if (c === 'workNotes') return editNote(id);
    if (c === 'costIdeas') return editIdea(id);
    return editProject(id);
  }
  /* Opens Work on one area. */
  function show(area) {
    ui.area = area || 'overview';
    ui.folder = 'all';
    GU.view.go('work');
  }

  GU.work = { AREAS, itemsOf, checks, dates, figures, workListId, ensureWorkList, isWorkBill, CONTRACT };
  GU.tabs.work = { label: 'Work', short: 'Work', icon: 'briefcase', render, edit, show, editProject, editNote };
})();
