/* The Ground Up: Work. Everything for the business you work for, each area its own page in the Work part:
   what the business pays for (its own money), Bills, Tasks, Projects and Contracts & documents. To buy (what the
   business has asked you to get, and what it will cost) is js/tabs/requests.js. Get paid back (your own money) is
   in js/tabs/payback.js. The cost-idea rows, form and forecast here are for Home › Plans (your own things). Each page has its own folders and search, and notes
   (a panel once there are some, a small '+ Note' button before). The Overview shows what needs attention, then a card
   for each page in two groups (Money, Running it), then the one-off tidy-up from the Home/Work split (js/refile.js).
   The business's name comes from Settings, never from here. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, daysUntil, fmtDate, relDays, money, plural, sum, round2, debounce, monthLabel } = GU.util;
  const { icon, pill, emptyState, formDialog, toast, menu, thumbHTML, viewFiles } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  /* The internal area ids are kept from before, so folders and notes stay where they are. */
  const AREAS = [
    { id: 'invoices', get label() { return paysLabel(); }, icon: 'receipt', one: 'item' },
    { id: 'bills', label: 'Bills', icon: 'bills', one: 'bill' },
    { id: 'tasks', label: 'Tasks', icon: 'todo', one: 'task' },
    { id: 'projects', label: 'Projects', icon: 'star', one: 'project' },
    { id: 'contracts', label: 'Contracts & documents', icon: 'file', one: 'document' },
  ];
  /* The page each area lives on. 'back' is Get paid back (js/tabs/payback.js). */
  const TAB_OF = { tasks: 'work-tasks', invoices: 'work-ktk', projects: 'work-projects', bills: 'work-bills', contracts: 'work-docs', back: 'work-back', requests: 'work-requests' };
  // 'costs' is only the row kind Home › Plans asks for (its own ideas): there's no Work page for it.
  const COLL = { tasks: 'tasks', invoices: 'paperwork', projects: 'projects', bills: 'bills', contracts: 'documents', costs: 'costIdeas' };
  const AREA_OF = { tasks: 'tasks', paperwork: 'invoices', projects: 'projects', bills: 'bills', documents: 'contracts' };
  const PRIORITIES = [{ value: 'must', label: 'Must have' }, { value: 'should', label: 'Should have' }, { value: 'could', label: 'Nice to have' }];
  const STATUSES = ['Idea', 'Planned', 'Booked', 'In progress', 'Done', 'Cancelled'];
  const CLOSED = ['Done', 'Cancelled'];
  const CONTRACT = 'Contract or agreement';
  const ui = { area: 'overview', folder: 'all', q: '', inv: null, showDone: false, moreChecks: false };

  /* ---------- names and whose money ---------- */
  const wm = () => GU.workMoney || null;
  const parts = () => GU.parts;
  /* The business's short name ('the company' with none set); cap for the start of a sentence. */
  const co = (cap) => parts().co(store.state, cap);
  /* Its name without 'Limited' for eyebrows ('' with none set). */
  const coName = () => (wm() && wm().employer(store.state).set ? parts().coName(store.state) : '');
  const paysLabel = () => parts().paysLabel(store.state);
  const short = (iso) => fmtDate(iso, { short: true });
  const amt = (p) => (p.amount != null && p.amount !== '' ? ' (' + money(p.amount) + ')' : '');

  const isWorkBill = (b) => parts().isWorkBill(b);
  const isWorkTask = (s, t) => parts().isWorkTask(s, t);
  const isWorkDoc = (d) => parts().isWorkDoc(d);
  const ideaPart = (i) => parts().ideaPart(i);
  /* 'ktk' (the business's money), 'back' (yours, get it back), 'unsorted' or 'home'. */
  function laneOf(p, c) {
    const W = wm();
    if (W) return W.lane(p, c || 'paperwork');
    return p && p.context === 'work' ? (p.claim ? 'back' : 'unsorted') : 'home';
  }
  /* For a work bill: 'me' (out of your account, paid back) or 'company'. */
  const billPayer = (b) => (wm() ? wm().payerOf(b, 'bills') : b.payer === 'company' ? 'company' : 'me');
  /* An invoice the business still has to pay. */
  const isWaiting = (p) => p.kind === 'invoice-in' && p.status !== 'paid' && laneOf(p) === 'ktk';
  /* An older work invoice you sent the business (for your own spending): not a claim yet, so it waits under
     Not sorted here, with one tap to put it in Get paid back, rather than showing nowhere. */
  const looseOut = (p) => !!p && p.context === 'work' && p.kind === 'invoice-out' && laneOf(p) === 'back';
  /* Work paperwork waiting for you to sort: nobody has said whose money it is, or an invoice like that. */
  const needsSort = (p) => laneOf(p) === 'unsorted' || looseOut(p);
  /* When the business paid it: a receipt is paid already; an invoice once it's marked paid. */
  const paidOn = (p) => (p.kind === 'invoice-in' || p.kind === 'invoice-out' ? (p.status === 'paid' ? p.paidDate || p.date || '' : '') : p.date || '');
  function dueBack(s) {
    try {
      return wm() ? wm().dueBack(s) : null;
    } catch (e) {
      return null;
    }
  }

  /* Pills for whose money it is, the same on every page. */
  const coPill = (text) => pill(text || co(true) + '’s money', 'ktk');
  const minePill = (text) => pill(text || 'Your money · get it back', 'mine');
  const whoPill = (text) => pill(text || 'Who paid?', 'warn', 'alert');

  /* ---------- what counts as work ---------- */
  /* An area's name: your own name for it from Settings, or the usual one. What the business pays keeps its
     usual name, because the area means something new now. */
  function labelOf(area) {
    if (area === 'back') return 'Get paid back';
    if (area === 'requests' || area === 'costs') return 'To buy'; // notes from the old Cost forecast page now sit on To buy
    if (area === 'general' || area === 'overview') return 'Overview';
    if (area === 'invoices') return paysLabel();
    return ((store.state.settings.workLabels || {})[area]) || (AREAS.find((a) => a.id === area) || {}).label || 'General';
  }
  const workListId = (s) => parts().workListId(s);
  /* The Work to-do list, made if it isn't there. Call inside a commit. */
  function ensureWorkList(s) {
    let id = workListId(s);
    if (!id) {
      id = 'list-work';
      s.todoLists.push({ id, name: 'Work' });
    }
    return id;
  }
  function itemsOf(s, area) {
    if (area === 'tasks') return s.tasks.filter((t) => isWorkTask(s, t));
    if (area === 'invoices') return s.paperwork.filter((p) => p.context === 'work' && (['ktk', 'unsorted'].includes(laneOf(p)) || looseOut(p)));
    if (area === 'back') return wm() ? s.paperwork.filter(wm().isClaim) : [];
    // Home projects (Home › Home projects) share the records but not the page: no context means work.
    if (area === 'projects') return (s.projects || []).filter((p) => !parts().isHomeProject(p));
    if (area === 'bills') return s.bills.filter(isWorkBill);
    if (area === 'contracts') return s.documents.filter(isWorkDoc);
    return [];
  }
  const NAMED = ['bills', 'projects', 'workFolders', 'costIdeas'];
  const nameOf = (c, r) => (NAMED.includes(c) ? r.name : r.title) || '';
  const foldersOf = (s, area) => (s.workFolders || []).filter((f) => f.area === area).sort((a, b) => a.name.localeCompare(b.name));
  /* The folder a record sits in, if that folder still exists. */
  const folderOf = (s, rec, area) => (rec.workFolder && (s.workFolders || []).some((f) => f.id === rec.workFolder && f.area === area) ? rec.workFolder : '');
  const noteArea = (n) => (n.area === 'costs' ? 'requests' : n.area || 'general');
  const notesOf = (s, area) => (s.workNotes || []).filter((n) => noteArea(n) === area);

  /* ---------- what needs doing ---------- */
  /* Everything at work that needs a look, worst first: the Overview's 'Needs attention' list and the pages' badges.
     Each is {level, area, title, detail, ref?, go?, inv?, tidy?, acts?}. One line per real action: the re-sort's
     questions are one line that opens the tidy-up block. */
  function checks(s) {
    const out = [];
    const add = (level, area, title, detail, ref, more) => out.push(Object.assign({ level, area, title, detail, ref: ref || null }, more || {}));
    const c = co();
    const C = co(true);
    for (const k of itemsOf(s, 'tasks')) {
      if (k.done || !k.due) continue;
      const n = daysUntil(k.due);
      if (n < 0) add('crit', 'tasks', k.title, 'Task, ' + relDays(k.due).replace(' ago', ' late'), { c: 'tasks', id: k.id });
      else if (n === 0) add('warn', 'tasks', k.title, 'Task due today', { c: 'tasks', id: k.id });
    }

    // What the business pays: its invoices still to pay, and work paperwork nobody has said who paid.
    const unsorted = [];
    // An invoice you sent that the re-sort's 'Check these' is asking about is asked there, not twice.
    const asked = new Set(GU.refile && GU.refile.questions ? GU.refile.questions(s).map((q) => q.key) : []);
    let asks = 0;
    try {
      asks = GU.refile && GU.refile.count ? GU.refile.count(s) : 0;
    } catch (err) {
      asks = 0;
    }
    for (const p of itemsOf(s, 'invoices')) {
      if (needsSort(p)) {
        if (!(looseOut(p) && asked.has('merge:' + p.id))) unsorted.push(p);
        continue;
      }
      if (!isWaiting(p)) continue;
      const n = p.dueDate ? daysUntil(p.dueDate) : null;
      const what = C + ' still to pay ' + p.title + amt(p);
      const handed = p.handedDate ? ' · with ' + c + ' since ' + short(p.handedDate) : ' · not sent to ' + c + ' yet';
      const ref = { c: 'paperwork', id: p.id };
      if (n != null && n < 0) add('crit', 'invoices', what, 'Overdue since ' + short(p.dueDate) + handed, ref);
      else if (n != null && n <= 7) add('warn', 'invoices', what, 'Due ' + relDays(p.dueDate) + handed, ref);
      else if (n == null) add('info', 'invoices', what, 'No due date' + handed, ref);
    }
    if (unsorted.length) {
      const one = unsorted.length === 1 ? unsorted[0] : null;
      add('warn', 'invoices', one ? (looseOut(one) ? 'Your invoice ' + one.title + amt(one) + ' isn’t in Get paid back' : 'Who paid for ' + one.title + amt(one) + '?') : 'Who paid? ' + unsorted.length + ' work items aren’t sorted',
        one ? (looseOut(one) ? 'Add it, so you can see when ' + c + ' pays it' : C + '’s money, or yours to get back?') : 'Tell me for each one: ' + c + '’s money, or yours to get back', null,
        { go: TAB_OF.invoices, acts: one ? payerActs(one.id) : null });
    }

    // Your money: things to send, packs to chase, repayments to confirm.
    const W = wm();
    const d = dueBack(s);
    if (W && d) {
      const e = W.employer(s);
      if (d.toSend.length) {
        const o = d.oldest;
        add(d.nudge ? 'warn' : 'info', 'back', plural(d.toSend.length, 'thing') + ' to send to ' + c + ', ' + money(d.toSendTotal),
          o ? 'Oldest ' + short(o.date) + ', ' + (o.days ? plural(o.days, 'day') + ' ago' : 'today') : 'Not sent yet', null, { go: TAB_OF.back });
      }
      for (const x of d.unpaid || []) {
        const p = x.p;
        const n = p.dueDate ? daysUntil(p.dueDate) : null;
        const ref = { c: 'paperwork', id: p.id };
        const title = 'Pay ' + p.title + amt(p) + ', then send it to ' + c;
        if (n != null && n < 0) add('crit', 'back', title, 'Overdue since ' + short(p.dueDate) + ' · you pay it, ' + c + ' pays you back', ref);
        else if (n != null && n <= 7) add('warn', 'back', title, 'Due ' + relDays(p.dueDate) + ' · you pay it, ' + c + ' pays you back', ref);
        else add('info', 'back', title, 'You pay it, ' + c + ' pays you back', ref);
      }
      for (const pk of d.packs || []) {
        if (pk.chase) add('warn', 'back', C + ' hasn’t paid back ' + money(pk.left) + ' you sent on ' + short(pk.date), plural(pk.days, 'day') + ' ago. Remind ' + c + ' from Get paid back', null, { go: TAB_OF.back });
        else if (pk.late) add('info', 'back', 'Waiting for ' + c + ' to pay back ' + money(pk.left), 'Sent ' + short(pk.date) + ', longer than the usual ' + plural(e.repayDays, 'day'), null, { go: TAB_OF.back });
      }
      let pr = null;
      try {
        pr = W.prompts(s);
      } catch (err) {
        pr = null;
      }
      if (pr) {
        for (const r of (pr.repayments || []).slice(0, 3)) {
          const list = r.claims || [];
          const what = list.length === 1 ? list[0].title || list[0].party || 'something you paid for' : list.length ? plural(list.length, 'thing') + ' you sent together' : 'something you paid for';
          add('warn', 'back', 'Confirm: ' + money(r.tx.amount) + ' from ' + c + ' looks like ' + what, 'Came in ' + short(r.tx.date) + '. Say yes or no on Get paid back', null, { go: TAB_OF.back });
        }
        if ((pr.repayments || []).length > 3) add('warn', 'back', plural(pr.repayments.length - 3, 'more payment') + ' from ' + c + ' to confirm', 'On Get paid back', null, { go: TAB_OF.back });
        if ((pr.purchases || []).length) add('info', 'back', 'Check the bank payment for ' + plural(pr.purchases.length, 'thing') + ' you paid for', 'I found payments that might be them', null, { go: TAB_OF.back });
        if ((pr.noClaimCredits || []).length) add('info', 'back', plural(pr.noClaimCredits.length, 'payment') + ' from ' + c + ' I couldn’t match', 'Pick what each was for, or say it’s fine', null, { go: TAB_OF.back });
      }
    }

    for (const p of itemsOf(s, 'projects')) {
      if (CLOSED.includes(p.status)) continue;
      if (p.deadline && daysUntil(p.deadline) < 0) add('crit', 'projects', p.name + ' was due ' + short(p.deadline), 'Past its deadline and not marked done', { c: 'projects', id: p.id });
      else if (p.deadline && daysUntil(p.deadline) <= 7) add('warn', 'projects', p.name + ' is due ' + relDays(p.deadline), p.client || 'Deadline', { c: 'projects', id: p.id });
      if (p.start && daysUntil(p.start) >= 0 && daysUntil(p.start) <= 14 && p.status !== 'In progress') add('info', 'projects', p.name + ' starts ' + relDays(p.start), (p.client ? p.client + ' · ' : '') + p.status, { c: 'projects', id: p.id });
    }

    // Bills, worded by who pays.
    for (const b of itemsOf(s, 'bills')) {
      if (b.active === false || !b.nextDue) continue;
      const n = daysUntil(b.nextDue);
      const ref = { c: 'bills', id: b.id };
      const name = b.name + ' (' + money(b.amount) + ')';
      if (billPayer(b) === 'company') {
        if (!b.autopay && n < 0) add('warn', 'bills', C + ' still to pay ' + name, 'Was due ' + short(b.nextDue), ref);
        else if (!b.autopay && n <= 7) add('info', 'bills', C + ' pays ' + name + ' ' + relDays(b.nextDue), 'Paid by ' + c + ', not from your account', ref);
      } else if (b.autopay) {
        if (n >= 0 && n <= 31) add('info', 'bills', b.name + ' ' + money(b.amount) + ' leaves your account ' + (n <= 1 ? relDays(b.nextDue) : 'on ' + short(b.nextDue)), 'It’ll be added to Get paid back', ref);
      } else if (n < 0) add('crit', 'bills', 'Pay ' + name, 'Overdue since ' + short(b.nextDue) + ' · then it’s added to Get paid back', ref);
      else if (n <= 7) add('warn', 'bills', 'Pay ' + name, 'Due ' + relDays(b.nextDue) + ', pay by hand · then it’s added to Get paid back', ref);
    }

    for (const d2 of itemsOf(s, 'contracts')) {
      if (!d2.expiryDate) continue;
      const n = daysUntil(d2.expiryDate);
      if (n < 0 && n >= -60) add('crit', 'contracts', d2.title + ' ended ' + short(d2.expiryDate), 'Renew it, replace it or mark it finished', { c: 'documents', id: d2.id });
      else if (n >= 0 && n <= 60) add(n <= 30 ? 'warn' : 'info', 'contracts', d2.title + ' ends ' + relDays(d2.expiryDate), 'Check the notice period and decide whether to renew', { c: 'documents', id: d2.id });
    }

    // The one-off re-sort's questions: one line, which opens the tidy-up block on the Overview.
    if (asks) add('info', 'overview', plural(asks, 'thing') + ' to check from the Home/Work split', 'One tap each, in the tidy-up below', null, { tidy: true });

    // Things you've been asked to get and haven't ordered (Work › To buy, js/tabs/requests.js).
    try {
      if (GU.requests && GU.requests.checks) out.push(...GU.requests.checks(s));
    } catch (err) {
      console.error(err);
    }

    // The last day to return something you bought for work.
    try {
      if (GU.returns) out.push(...GU.returns.checks(s));
    } catch (err) {
      console.error(err);
    }

    const rank = { crit: 0, warn: 1, info: 2 };
    // Worst first; the one-off tidy-up line comes after the real actions of its level.
    return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.tidy ? 1 : 0) - (b.tidy ? 1 : 0));
  }
  /* The two answers to 'Who paid?' for a piece of paperwork. */
  function payerActs(id) {
    // An invoice you sent: it's your money, so the one question is putting it in Get paid back. While the re-sort
    // is asking whether it's the same money as a claim there, its answers are offered here too.
    if (looseOut(store.find('paperwork', id))) {
      const q = GU.refile && GU.refile.questions ? GU.refile.questions(store.state).find((x) => x.key === 'merge:' + id) : null;
      if (q) return q.options.map((o) => ({ label: o.label, attr: 'data-refile-key="' + esc(q.key) + '" data-refile-opt="' + esc(o.id) + '"', suggested: !!o.suggested }));
      return [{ label: 'Add to Get paid back', attr: 'data-payer="paperwork:' + esc(id) + ':me"', suggested: true }];
    }
    return [
      { label: co(true) + '’s money', attr: 'data-payer="paperwork:' + esc(id) + ':company"' },
      { label: 'Mine, get it back', attr: 'data-payer="paperwork:' + esc(id) + ':me"' },
    ];
  }

  /* Upcoming project dates for the timeline on Home. */
  function dates(s, to) {
    const out = [];
    const t = today();
    for (const p of itemsOf(s, 'projects')) {
      if (CLOSED.includes(p.status)) continue;
      if (p.start && p.start >= t && p.start <= to) out.push({ date: p.start, title: p.name + ' starts', meta: [p.client, 'Work project'].filter(Boolean).join(' · '), ref: { c: 'projects', id: p.id } });
      if (p.deadline && p.deadline <= to) out.push({ date: p.deadline, title: p.name + ' due', meta: [p.client, 'Work project'].filter(Boolean).join(' · '), ref: { c: 'projects', id: p.id } });
    }
    return out;
  }

  /* ---------- figures for each area ---------- */
  /* The money the business pays: waiting, overdue, paid this month and not sorted. */
  function ktkTotals(s) {
    const items = itemsOf(s, 'invoices');
    const t = today();
    const month = t.slice(0, 7);
    const waiting = items.filter(isWaiting);
    const paid = items.filter((p) => laneOf(p) === 'ktk' && !isWaiting(p) && paidOn(p).slice(0, 7) === month);
    return {
      waiting, waitTotal: sum(waiting, (p) => Number(p.amount) || 0),
      overdue: waiting.filter((p) => p.dueDate && p.dueDate < t).length,
      paid, paidTotal: sum(paid, (p) => Number(p.amount) || 0),
      unsorted: items.filter(needsSort),
    };
  }
  /* Work bills a month, split by who pays. */
  function billTotals(s) {
    const live = itemsOf(s, 'bills').filter((b) => b.active !== false);
    const mo = (list) => sum(list, (b) => F.monthlyEquivalent(b.amount, b.frequency));
    const me = live.filter((b) => billPayer(b) !== 'company');
    const them = live.filter((b) => billPayer(b) === 'company');
    return { live, me, them, monthly: mo(live), meMonthly: mo(me), themMonthly: mo(them) };
  }
  /* The card for each area on the Overview: {big, unit, line, lines, bad?, good?, warn?}. The card shows the figure and
     its one line; the other lines are for the Projects and Contracts pages' summary. */
  function figures(s, area) {
    const items = itemsOf(s, area);
    const t = today();
    const c = co();
    if (area === 'back') {
      const d = dueBack(s);
      if (!d) return { big: money(0), unit: 'due back from ' + c, line: 'things you paid for ' + c, lines: ['Things you paid for ' + c, 'with your own money'] };
      const o = d.oldest;
      const l1 = money(d.toSendTotal) + ' not sent · ' + money(d.sentTotal) + ' waiting';
      const l2 = o ? 'Oldest ' + short(o.date) + ', ' + plural(o.days, 'day') : d.count ? plural(d.count, 'thing') + ' to come back' : 'Nothing to send';
      return { big: money(d.total), unit: 'due back from ' + c, line: d.count ? l1 : 'nothing to send', lines: [l1, l2], good: d.total > 0 && !d.nudge, warn: d.nudge };
    }
    if (area === 'tasks') {
      const open = items.filter((k) => !k.done);
      const late = open.filter((k) => k.due && k.due < t).length;
      const week = open.filter((k) => k.due && k.due >= t && daysUntil(k.due) <= 7).length;
      return { big: String(open.length), unit: open.length === 1 ? 'open task' : 'open tasks', line: late ? late + ' overdue' + (week ? ' · ' + week + ' due this week' : '') : week ? week + ' due this week' : 'nothing due this week',
        lines: [late ? late + ' overdue' : 'nothing overdue', week ? week + ' due this week' : 'nothing due this week'], bad: late > 0 };
    }
    if (area === 'invoices') {
      const k = ktkTotals(s);
      const l1 = k.unsorted.length ? plural(k.unsorted.length, 'item') + ' not sorted yet' : k.overdue ? k.overdue + ' overdue' : plural(k.waiting.length, 'invoice') + ' waiting';
      return { big: money(k.waitTotal), unit: 'waiting for ' + c, line: l1,
        lines: [l1, plural(k.paid.length, 'thing') + ' paid by ' + c + ' this month'],
        bad: k.overdue > 0, warn: !k.overdue && k.unsorted.length > 0 };
    }
    if (area === 'projects') {
      const live = items.filter((p) => !CLOSED.includes(p.status));
      const next = live.filter((p) => p.start && p.start >= t).sort((a, b) => a.start.localeCompare(b.start))[0];
      const value = sum(live, (p) => Number(p.value) || 0);
      const l1 = next ? 'Next: ' + next.name + ', ' + short(next.start) : 'nothing booked to start';
      return { big: String(live.length), unit: live.length === 1 ? 'project on the go' : 'projects on the go', line: l1, lines: [l1, value ? money(value, { whole: true }) + ' expected' : 'no fees added yet'] };
    }
    if (area === 'bills') {
      const b = billTotals(s);
      const next = b.live.filter((x) => x.nextDue).sort((x, y) => x.nextDue.localeCompare(y.nextDue))[0];
      const l1 = money(b.meMonthly) + ' you pay, ' + c + ' pays you back · ' + money(b.themMonthly) + ' ' + c + ' pays';
      return { big: money(b.monthly), unit: 'a month', line: l1, lines: [l1, next ? 'Next: ' + next.name + ', ' + short(next.nextDue) : plural(b.live.length, 'bill')] };
    }
    if (area === 'contracts') {
      const ending = items.filter((d) => d.expiryDate && daysUntil(d.expiryDate) >= 0 && daysUntil(d.expiryDate) <= 90);
      const next = items.filter((d) => d.expiryDate && d.expiryDate >= t).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0];
      const l1 = ending.length ? ending.length + ' ending in 90 days' : 'none ending soon';
      return { big: String(items.length), unit: items.length === 1 ? 'contract or document' : 'contracts and documents', line: l1, lines: [l1, next ? 'Next ends ' + short(next.expiryDate) : 'no end dates'], bad: ending.some((d) => daysUntil(d.expiryDate) <= 30) };
    }
    return { big: '', unit: '', lines: [] };
  }

  /* The summary boxes at the top of each page. */
  function tallyHTML(s, area) {
    const c = co();
    const t = today();
    let boxes = [];
    if (area === 'invoices') {
      const k = ktkTotals(s);
      boxes = [
        ['Waiting for ' + c, money(k.waitTotal), plural(k.waiting.length, 'invoice') + (k.overdue ? ', ' + k.overdue + ' overdue' : ''), k.overdue ? 'is-crit' : ''],
        ['Paid by ' + c + ' this month', money(k.paidTotal), plural(k.paid.length, 'thing')],
      ];
      // Things nobody has said who paid for are in the 'Who paid?' strip below, so a count here would say it twice.
      if (k.unsorted.length > WHO_MAX) boxes.push(['Who paid?', String(k.unsorted.length), 'not sorted yet, see the tabs below', 'is-warn']);
    } else if (area === 'bills') {
      const b = billTotals(s);
      boxes = [
        ['A month in all', money(b.monthly), plural(b.live.length, 'bill')],
        ['You pay, ' + c + ' pays you back', money(b.meMonthly), 'a month'],
        [paysLabel(), money(b.themMonthly), 'a month, not from your account'],
      ];
    } else if (area === 'tasks') {
      const open = itemsOf(s, 'tasks').filter((k) => !k.done);
      const late = open.filter((k) => k.due && k.due < t).length;
      boxes = [
        ['To do', String(open.length), 'open, not done yet'],
        ['Overdue', String(late), late ? 'past their date' : 'nothing late', late ? 'is-crit' : ''],
        ['Due this week', String(open.filter((k) => k.due && k.due >= t && daysUntil(k.due) <= 7).length), 'in the next 7 days'],
      ];
    } else {
      // Projects and contracts: one line is enough.
      const f = figures(s, area);
      return '<p class="wk-figline">' + esc([f.big + ' ' + f.unit].concat(f.lines).filter(Boolean).join(' · ')) + '</p>';
    }
    return '<section class="panel tally wk-tally" aria-label="Summary"><div class="tally__sum">' + boxes.map((b) => '<div><span>' + esc(b[0]) + '</span><b class="' + (b[3] || '') + '">' + esc(b[1]) + '</b><em>' + esc(b[2]) + '</em></div>').join('') + '</div></section>';
  }

  /* ---------- rows ---------- */
  function folderChip(s, rec, area) {
    if (ui.folder !== 'all') return '';
    const f = folderOf(s, rec, area);
    const fo = f && (s.workFolders || []).find((x) => x.id === f);
    return fo ? pill(fo.name, 'muted', 'folder') : '';
  }
  const moreBtn = (c, r) => '<button type="button" class="icon-btn" data-more="' + esc(c + ':' + r.id) + '" aria-label="More for ' + esc(nameOf(c, r)) + '">' + icon('more') + '</button>';
  const actBtn = (attr, label, ico, cls) => '<button type="button" class="btn btn--sm ' + (cls || 'btn--soft') + '" ' + attr + '>' + (ico ? icon(ico) : '') + esc(label) + '</button>';

  /* One row. Also used by Home › Plans for your own ideas (area 'costs'). */
  function rowHTML(s, area, r) {
    s = s || store.state;
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
      const ln = laneOf(r);
      const kind = { receipt: 'Receipt', 'invoice-in': 'Invoice', 'invoice-out': 'Invoice sent', warranty: 'Warranty' }[r.kind] || 'Item';
      let status = '';
      let act = '';
      if (looseOut(r)) {
        status = pill('Sent to ' + co() + ', not in Get paid back', 'warn', 'send');
        act = payerActs(r.id).map((a, i) => actBtn(a.attr, a.label, i ? '' : 'coin', i ? '' : 'btn--soft')).join('');
      } else if (ln === 'unsorted') {
        status = whoPill();
        act = payerActs(r.id).map((a, i) => actBtn(a.attr, a.label, i ? 'coin' : 'briefcase', i ? '' : 'btn--soft')).join('');
      } else {
        status = coPill();
        if (isWaiting(r)) {
          const n = r.dueDate ? daysUntil(r.dueDate) : null;
          status += n != null && n < 0 ? pill('Overdue ' + -n + 'd', 'crit', 'alert') : r.dueDate ? pill('Due ' + short(r.dueDate), n <= 7 ? 'warn' : 'muted', 'clock') : pill('To pay', 'warn');
          if (r.handedDate) status += pill('With ' + co() + ' since ' + short(r.handedDate), 'info', 'send');
          act = actBtn('data-send-co="' + esc(r.id) + '"', r.handedDate ? 'Send again' : 'Send to ' + co(), 'send', 'btn--soft') + actBtn('data-ktkpaid="' + esc(r.id) + '"', 'Paid by ' + co(), 'check', '');
        } else {
          const when = paidOn(r);
          status += pill('Paid by ' + co() + (when ? ' ' + short(when) : ''), 'good', 'check');
        }
      }
      return '<li class="wk-row' + (act ? ' wk-row--acts' : '') + '"><button type="button" class="wk-row__lead doc-row__thumb" data-files="' + esc(c + ':' + r.id) + '" aria-label="' + ((r.files || []).length ? 'View files for ' : 'Add a file to ') + esc(r.title) + '">' + thumbHTML(r.files) + '</button>' +
        '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.title) + '</b><em>' + esc([r.party, short(r.date), r.reference].filter(Boolean).join(' · ')) + '</em>' +
        '<span class="wk-row__chips">' + pill(kind, 'kind-' + r.kind) + status + (GU.returns ? GU.returns.pill(r) : '') + chipF + '</span></button>' +
        '<span class="wk-row__end">' + (r.amount != null && r.amount !== '' ? '<b>' + esc(money(r.amount)) + '</b>' : '') + '</span>' +
        '<span class="wk-row__act">' + act + GU.ui.dlButton(r.files, r.title) + moreBtn(c, r) + '</span></li>';
    }
    if (area === 'projects') {
      const home = parts().isHomeProject(r);
      const late = r.deadline && !CLOSED.includes(r.status) && daysUntil(r.deadline) < 0;
      const tone = { Idea: 'muted', Planned: 'info', Booked: 'info', 'In progress': 'warn', Done: 'good', Cancelled: 'muted' }[r.status] || 'muted';
      const when = [r.start ? (r.start >= today() ? 'Starts ' : 'Started ') + short(r.start) : '', r.deadline ? 'due ' + short(r.deadline) : ''].filter(Boolean).join(', ');
      // A home project's fee is what it should cost, not money coming in: plain figure with 'budget' under it.
      const worth = Number(r.value) > 0 ? (home ? '<b>' + esc(money(r.value)) + '</b><em>budget</em>' : '<b class="is-in">' + esc(money(r.value)) + '</b>') : '';
      return '<li class="wk-row"><span class="wk-row__lead wk-row__ico">' + icon('star') + '</span>' +
        '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.name) + '</b><em>' + esc([r.client ? (home ? 'Asked by ' : '') + r.client : '', when].filter(Boolean).join(' · ')) + '</em>' +
        '<span class="wk-row__chips">' + pill(r.status || 'Idea', tone) + (late ? pill('Past deadline', 'crit', 'alert') : '') + chipF + '</span></button>' +
        '<span class="wk-row__end">' + worth + '</span>' +
        '<span class="wk-row__act">' + GU.ui.dlButton(r.files, r.name) + moreBtn(c, r) + '</span></li>';
    }
    if (area === 'bills') {
      const stopped = r.active === false;
      const them = billPayer(r) === 'company';
      const n = r.nextDue ? daysUntil(r.nextDue) : null;
      const due = stopped ? pill('Stopped', 'muted') : r.nextDue ? pill((n < 0 && !r.autopay ? 'Overdue ' : 'Next ') + short(r.nextDue), n < 0 && !r.autopay ? (them ? 'warn' : 'crit') : n <= 7 ? 'warn' : 'muted', 'clock') : '';
      const who = them ? coPill(paysLabel()) : minePill('You pay · ' + co() + ' pays you back');
      // Found in your bank statements and not checked yet: keep it with one tap (⋯ › Stop it if it isn't one).
      const found = !stopped && r.review;
      return '<li class="wk-row' + (stopped ? ' is-done' : '') + (found ? ' wk-row--acts' : '') + '"><span class="wk-row__lead wk-row__ico">' + icon(r.autopay ? 'repeat' : 'bills') + '</span>' +
        '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.name) + '</b><em>' + esc([r.payee, F.freqLabel(r.frequency), r.autopay ? r.method || 'Automatic' : 'Pay by hand'].filter(Boolean).join(' · ')) + '</em>' +
        '<span class="wk-row__chips">' + who + due + (found ? pill('Found in your statements', 'info', 'search') : '') + chipF + '</span></button>' +
        '<span class="wk-row__end"><b>' + esc(money(r.amount)) + '</b></span>' +
        '<span class="wk-row__act">' + (found ? actBtn('data-bill-keep="' + esc(r.id) + '"', 'Keep', 'check', 'btn--soft') : '') +
        (!stopped && !r.autopay ? actBtn('data-billpaid="' + esc(r.id) + '"', them ? co() + ' paid' : 'Paid', 'check') : '') + GU.ui.dlButton(r.files, r.name) + moreBtn(c, r) + '</span></li>';
    }
    if (area === 'costs') return ideaRowHTML(s, r, chipF);
    // contracts and documents
    const n = r.expiryDate ? daysUntil(r.expiryDate) : null;
    const end = r.expiryDate ? (n < 0 ? pill('Ended ' + short(r.expiryDate), 'muted') : pill('Ends ' + short(r.expiryDate), n <= 30 ? 'crit' : n <= 90 ? 'warn' : 'good', 'clock')) : pill('No end date', 'muted');
    return '<li class="wk-row"><button type="button" class="wk-row__lead doc-row__thumb" data-files="' + esc(c + ':' + r.id) + '" aria-label="' + ((r.files || []).length ? 'View ' : 'Add a scan to ') + esc(r.title) + '">' + thumbHTML(r.files) + '</button>' +
      '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.title) + '</b><em>' + esc([r.holder, r.issueDate ? 'from ' + short(r.issueDate) : '', r.type !== CONTRACT ? r.type : ''].filter(Boolean).join(' · ')) + '</em>' +
      '<span class="wk-row__chips">' + end + chipF + '</span></button>' +
      '<span class="wk-row__end"></span><span class="wk-row__act">' + GU.ui.dlButton(r.files, r.title) + moreBtn(c, r) + '</span></li>';
  }

  /* A cost idea of your own (Home › Plans): when you could afford it, and which account it could come from. */
  function ideaRowHTML(s, r, chipF) {
    const c = 'costIdeas';
    const open = GU.costs.isOpen(r);
    const pr = PRIORITIES.find((p) => p.value === (r.priority || 'should'));
    let when = '';
    if (r.status === 'done') when = pill('Done' + (r.doneDate ? ' ' + short(r.doneDate) : ''), 'good', 'check');
    else if (r.status === 'dropped') when = pill('Dropped', 'muted');
    else {
      const plan = GU.costs.schedule(s);
      const x = plan.results.find((y) => y.idea.id === r.id);
      if (x && x.date) {
        when = x.fixed ? pill('Booked ' + short(x.date), x.short > 0 ? 'crit' : 'info', 'clock') + (x.short > 0 ? pill(money(x.short, { whole: true }) + ' short', 'crit', 'alert') : '')
          : pill(daysUntil(x.date) <= 0 ? 'You can afford it now' : 'Earliest ' + short(x.date), daysUntil(x.date) <= 0 ? 'good' : 'info', 'clock');
        if (x.account) when += pill('from ' + x.account, 'muted', 'bank');
        if (r.wantBy) when += x.onTime ? pill('In time for ' + short(r.wantBy), 'good', 'check') : pill(x.lateDays + ' days after you wanted', 'warn', 'alert');
      } else if (x) when = pill('Not in the next ' + plan.base.cfg.months + ' months', 'crit', 'alert') + (x.shortfall ? pill('about ' + money(x.shortfall, { whole: true }) + ' short', 'warn') : '');
    }
    return '<li class="wk-row' + (open ? '' : ' is-done') + '"><span class="wk-row__lead wk-row__ico">' + icon('coin') + '</span>' +
      '<button type="button" class="wk-row__main" data-open="' + esc(c + ':' + r.id) + '"><b>' + esc(r.name) + '</b><em>' +
      esc([pr ? pr.label : '', r.notBefore ? 'not before ' + short(r.notBefore) : '', r.wantBy ? 'wanted by ' + short(r.wantBy) : ''].filter(Boolean).join(' · ')) + '</em>' +
      '<span class="wk-row__chips">' + when + (chipF || '') + '</span></button>' +
      '<span class="wk-row__end"><b>' + esc(money(r.cost)) + '</b>' + (Number(r.monthly) > 0 ? '<em>+ ' + esc(money(r.monthly)) + ' a month</em>' : '') + '</span>' +
      '<span class="wk-row__act">' + (open ? actBtn('data-idea-done="' + esc(r.id) + '"', 'Done', 'check') : '') + GU.ui.dlButton(r.files, r.name) + moreBtn(c, r) + '</span></li>';
  }

  function noteHTML(s, n, showArea) {
    const fo = n.folder && (s.workFolders || []).find((x) => x.id === n.folder);
    return '<li class="wk-note"><button type="button" class="wk-note__main" data-open="' + esc('workNotes:' + n.id) + '"><b>' + esc(n.title || 'Note') + '</b>' +
      (n.body ? '<span>' + esc(n.body.length > 220 ? n.body.slice(0, 220) + '…' : n.body) + '</span>' : '') +
      '<em>' + esc([showArea ? labelOf(n.area || 'general') : '', fo ? fo.name : '', 'updated ' + short(n.updated || n.created)].filter(Boolean).join(' · ')) + '</em></button>' +
      moreBtn('workNotes', n) + '</li>';
  }

  /* ---------- the overview ---------- */
  /* The cards, in two groups: the money, then running the place. To buy's card comes from js/tabs/requests.js. */
  const CARD_GROUPS = [
    { title: 'Money', cards: ['requests', 'back', 'invoices', 'bills'] },
    { title: 'Running it', cards: ['tasks', 'projects', 'contracts'] },
  ];
  const ICON_OF = { back: 'coin' };
  const SHOW_CHECKS = 5; // how many lines of 'Needs attention' show before '+ n more'
  /* One card: its figure and ONE line, amber when it needs action. o: {tab, ico, label, big, unit, line, warn, cls}. */
  function cardBtn(o) {
    return '<button type="button" class="wk-card' + (o.warn ? ' is-warn' : '') + '" data-go="' + esc(o.tab) + '"><span class="wk-card__head">' + icon(o.ico) + '<span>' + esc(o.label) + '</span>' + icon('chevron') + '</span>' +
      '<b class="' + (o.cls || '') + '">' + esc(o.big) + '</b><em>' + esc(o.unit) + '</em>' +
      (o.line ? '<span class="wk-card__line">' + esc(o.line) + '</span>' : '') + '</button>';
  }
  function areaCard(s, a) {
    if (a === 'requests') return GU.requests && GU.requests.cardHTML ? GU.requests.cardHTML(s) : '';
    const f = figures(s, a);
    return cardBtn({ tab: TAB_OF[a], ico: ICON_OF[a] || (AREAS.find((x) => x.id === a) || {}).icon, label: labelOf(a), big: f.big, unit: f.unit, line: f.line || f.lines[0],
      warn: f.warn && !f.bad, cls: f.bad ? 'is-crit' : f.warn ? 'is-warn' : f.good ? 'is-in' : '' });
  }

  /* The Overview's header over its checks. Late or due soon ones are 'to do', as in the Work door and the switch's
     count; the rest are 'to look at', so all three agree. */
  function attentionText(list, crit) {
    if (!list.length) return 'all up to date';
    const todo = list.filter((x) => x.level === 'crit' || x.level === 'warn').length;
    const look = list.length - todo;
    return (todo ? plural(todo, 'thing') + ' to do' + (crit ? ', ' + crit + ' overdue or late' : '') : 'nothing urgent') + (look ? ' · ' + look + ' to look at' : '');
  }

  function overviewHTML(s) {
    const list = checks(s);
    const crit = list.filter((x) => x.level === 'crit').length;
    const notes = (s.workNotes || []).slice().sort((a, b) => (b.updated || b.created || '').localeCompare(a.updated || a.created || '')).slice(0, 6);
    const c = co();
    // The one-off tidy-up from the Home/Work split: its questions, then what the re-sort changed, in one closed block.
    let tidy = '';
    try {
      tidy = GU.refile && GU.refile.tidyHTML ? GU.refile.tidyHTML(s) : '';
    } catch (e) {
      tidy = '';
    }
    const checkLi = (x, i) => '<li class="is-' + x.level + (x.acts ? ' has-acts' : '') + '"><button type="button" data-check="' + i + '"><span class="dot dot--' + x.level + '">' + icon(x.level === 'info' ? 'info' : 'alert') + '</span>' +
      '<span><b>' + esc(x.title) + '</b><em>' + esc((x.area === 'overview' ? '' : labelOf(x.area) + ' · ') + x.detail) + '</em></span>' + icon('chevron') + '</button>' +
      (x.acts ? '<div class="wk-check__acts">' + x.acts.map((a, k) => actBtn(a.attr, a.label, a.icon !== undefined ? a.icon : k ? 'coin' : 'briefcase', k ? '' : 'btn--soft')).join('') + '</div>' : '') + '</li>';
    const lis = list.map(checkLi);
    const more = lis.slice(SHOW_CHECKS);
    const wages = wm() && wm().wageSource ? wm().wageSource(s) : null;
    return '<form class="capture wk-tell" data-tell>' +
      '<label class="capture__field">' + icon('briefcase') + '<input type="text" name="note" id="wk-tell" autocomplete="off" placeholder="' + esc('Tell me anything for ' + c + ', e.g. Paid £18 for printer paper') + '" aria-label="' + esc('Tell me anything for ' + c) + '"></label>' +
      '<div class="capture__btns"><button type="submit" class="btn btn--soft">Add</button>' +
      '<button type="button" class="btn btn--primary" data-upload>' + icon('camera') + 'Upload</button></div></form>' +
      '<section class="panel wk-check"><header class="panel__head"><h2>' + icon(list.length ? 'alert' : 'check') + 'Needs attention</h2>' +
      '<span class="muted">' + esc(attentionText(list, crit)) + '</span></header>' +
      (list.length ? '<ul class="wk-check__list">' + lis.slice(0, SHOW_CHECKS).join('') + '</ul>' +
        (more.length ? '<details class="wk-check__more"' + (ui.moreChecks ? ' open' : '') + '><summary><span class="wk-check__more-open">+ ' + more.length + ' more</span><span class="wk-check__more-close">Show fewer</span>' + icon('chevron') + '</summary>' +
          '<ul class="wk-check__list">' + more.join('') + '</ul></details>' : '')
        : '<div class="panel__body"><p class="wk-allgood">' + icon('check') + '<span>Everything at work is managed. Nothing is late, overdue or about to end.</span></p></div>') + '</section>' +
      CARD_GROUPS.map((g) => '<section class="wk-cardgroup" aria-label="' + esc(g.title) + '"><h2 class="wk-sub">' + esc(g.title) + '</h2><div class="wk-cards">' + g.cards.map((a) => areaCard(s, a)).join('') + '</div></section>').join('') +
      tidy +
      '<section class="panel"><header class="panel__head"><h2>' + icon('note') + 'Notes</h2><button type="button" class="btn btn--sm" data-new-note>' + icon('plus') + 'New note</button></header>' +
      (notes.length ? '<ul class="wk-notes">' + notes.map((n) => noteHTML(s, n, true)).join('') + '</ul>' : '<div class="panel__body"><p class="muted">Jot down anything for work: meeting notes, ideas, who to call.</p></div>') + '</section>' +
      '<p class="wk-footnote">' + icon('info') + '<span>' + esc('Your wages' + (wm() && wm().employer(s).set ? ' from ' + c : '') + ' are your own money, so they’re in Home › Income' + (wages ? ' as ' + (wages.name || 'your pay') : '') + '.') +
      ' <a class="link" href="#incomings">Open Income</a></span></p>' +
      '<div class="dropcover" hidden><div>' + icon('upload') + '<b>' + esc('Drop to file it under Work') + '</b></div></div>';
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

  /* The chips on the page for what the business pays. */
  const INV = [['waiting', () => 'Waiting for ' + co()], ['paid', () => 'Paid by ' + co()], ['unsorted', () => 'Not sorted'], ['all', () => 'All']];
  function invoiceFilter(list, t) {
    if (t === 'waiting') return list.filter(isWaiting);
    if (t === 'paid') return list.filter((p) => laneOf(p) === 'ktk' && !isWaiting(p));
    if (t === 'unsorted') return list.filter(needsSort);
    return list;
  }
  /* The chip to show: the one you chose, or waiting (when there's anything waiting) and otherwise all. */
  function invView(list) {
    if (ui.inv && INV.some((x) => x[0] === ui.inv)) return ui.inv;
    return invoiceFilter(list, 'waiting').length ? 'waiting' : 'all';
  }
  /* Paid things grouped by the month they were paid, newest first. */
  function byMonth(list, prefix) {
    const groups = [];
    for (const p of list.slice().sort((a, b) => (paidOn(b) || '').localeCompare(paidOn(a) || ''))) {
      const key = (paidOn(p) || '').slice(0, 7);
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push((g = { key, title: (prefix || '') + (key ? monthLabel(key, true) : 'No date'), items: [] }));
      g.items.push(p);
    }
    return groups;
  }
  const groupTotal = (items, fn) => money(sum(items, fn));

  /* A project list in its lanes, soonest first: on the go, coming up, ideas, and done or cancelled (folded). Work › Projects
     and Home › Home projects both use it. */
  function projectLanes(list) {
    const order = (p) => (p.start || p.deadline || '9999');
    const by = (st) => list.filter((p) => st.includes(p.status || 'Idea')).sort((a, b) => order(a).localeCompare(order(b)));
    return [{ title: 'In progress', items: by(['In progress']) }, { title: 'Coming up', items: by(['Booked', 'Planned']) }, { title: 'Ideas', items: by(['Idea']) }, { title: 'Done or cancelled', items: by(CLOSED), closed: true }];
  }
  /* Groups of rows as lanes (a title, a note, the rows; a closed group is a fold). open: whether the folds start open. */
  function groupsHTML(s, area, groups, open) {
    return groups.filter((g) => g.items.length).map((g) => (g.closed ? '<details class="wk-group"' + (open ? ' open' : '') + '><summary>' + esc(g.title) + ' (' + g.items.length + ')</summary>' : g.title ? '<h3 class="wk-group__title">' + esc(g.title) + '</h3>' : '') +
      (g.note ? '<p class="wk-group__note">' + esc(g.note) + '</p>' : '') +
      '<ul class="wk-rows">' + g.items.map((r) => rowHTML(s, area, r)).join('') + '</ul>' + (g.closed ? '</details>' : '')).join('');
  }

  function areaBody(s, area) {
    const list = filtered(s, area);
    const c = co();
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
      const view = invView(list);
      // Things nobody has said who paid for are in the 'Who paid?' strip above, unless there are too many for it.
      const strip = invoiceFilter(itemsOf(s, 'invoices'), 'unsorted').length <= WHO_MAX;
      const opts = INV.filter(([value]) => value !== 'unsorted' || view === 'unsorted' || (!strip && invoiceFilter(list, 'unsorted').length));
      extra = '<div class="toolbar">' + GU.ui.chips('inv', opts.map(([value, label]) => ({ value, label: label(), count: invoiceFilter(list, value).length })), view) + '</div>';
      const waiting = invoiceFilter(list, 'waiting').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.date || '').localeCompare(b.date || ''));
      const unsorted = invoiceFilter(list, 'unsorted').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const paid = invoiceFilter(list, 'paid');
      const amount = (p) => Number(p.amount) || 0;
      if (view === 'waiting') groups = [{ title: '', items: waiting }];
      else if (view === 'paid') groups = byMonth(paid).map((g) => Object.assign(g, { title: g.title + ' · ' + groupTotal(g.items, amount) }));
      else if (view === 'unsorted') groups = [{ title: '', items: unsorted }];
      else {
        groups = [{ title: 'Waiting for ' + c + ' · ' + groupTotal(waiting, amount), items: waiting }, { title: 'Not sorted yet', items: strip ? [] : unsorted }]
          .concat(byMonth(paid, 'Paid by ' + c + ' · ').map((g) => Object.assign(g, { title: g.title + ' · ' + groupTotal(g.items, amount) })));
      }
    } else if (area === 'projects') {
      groups = projectLanes(list);
    } else if (area === 'bills') {
      const live = list.filter((b) => b.active !== false).sort((a, b) => (a.nextDue || '9').localeCompare(b.nextDue || '9'));
      const mo = (items) => money(sum(items, (b) => F.monthlyEquivalent(b.amount, b.frequency))) + ' a month';
      const me = live.filter((b) => billPayer(b) !== 'company');
      const them = live.filter((b) => billPayer(b) === 'company');
      groups = [
        { title: 'You pay, ' + c + ' pays you back · ' + mo(me), items: me },
        { title: paysLabel() + ' · ' + mo(them), note: c.charAt(0).toUpperCase() + c.slice(1) + ' pays these itself, so they’re never in your Money ahead.', items: them },
        { title: 'Stopped', items: list.filter((b) => b.active === false), closed: true },
      ];
    } else {
      groups = [{ title: '', items: list.sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999')) }];
    }
    groups = groups.filter((g) => g.items.length);
    const empty = !groups.length;
    const a = AREAS.find((x) => x.id === area);
    let emptyTitle = ui.q ? 'Nothing matches' : ui.folder !== 'all' ? 'Nothing in this folder yet' : 'No ' + (a ? a.one + 's' : 'items') + ' yet';
    let emptyText = ui.q ? 'Try another search.' : 'Add one with the button above' + (area === 'tasks' ? ', or type it in the box.' : ui.folder !== 'all' ? ', or move something here from its ⋯ menu.' : '.');
    if (area === 'invoices' && !ui.q) {
      const view = invView(list);
      if (view === 'waiting') emptyTitle = 'Nothing waiting for ' + c;
      else if (view === 'paid') emptyTitle = 'Nothing paid by ' + c + ' yet';
      else if (list.length) emptyTitle = 'Nothing else here yet';
      else if (!ui.folder || ui.folder === 'all') emptyTitle = 'Nothing for ' + c + ' to pay yet';
      if (list.length) emptyText = view === 'all' ? 'Say who paid for the things above, or add something ' + c + ' is paying.' : 'Try another tab above.';
      else emptyText = 'Add an order, invoice or receipt ' + c + ' is paying for, or drop the files above.';
    }
    // Nothing in this tab but things in the others: one quiet line, not a big empty box.
    if (empty && area === 'invoices' && list.length && !ui.q) return extra + '<p class="wk-quiet">' + esc(emptyTitle + '. ' + emptyText) + '</p>';
    return extra + '<section class="panel">' +
      (empty ? emptyState({ icon: a.icon, title: emptyTitle, text: esc(emptyText) })
        : groupsHTML(s, area, groups, ui.showDone)) + '</section>';
  }

  const WHO_MAX = 12;
  /* 'Who paid?': work paperwork with no payer yet, one tap each. A bank payment of the same amount from
     your own account suggests it was yours. */
  function whoHTML(s) {
    const list = itemsOf(s, 'invoices').filter(needsSort).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!list.length) return '';
    const W = wm();
    const C = co(true);
    const rows = list.slice(0, WHO_MAX).map((p) => {
      let hint = null;
      try {
        hint = W && W.purchaseFor ? W.purchaseFor(s, p) : null;
      } catch (e) {
        hint = null;
      }
      const loose = looseOut(p);
      const mine = !loose && !!(hint && hint.sure && hint.tx);
      const acts = payerActs(p.id);
      // An invoice you sent: say what it is, and what the re-sort thinks it's the same money as.
      const q = loose && GU.refile && GU.refile.questions ? GU.refile.questions(s).find((x) => x.key === 'merge:' + p.id) : null;
      const what = loose ? (q ? q.title : 'An invoice you sent ' + co() + ' for your own spending. Add it to Get paid back to see when it’s paid.') : '';
      return '<li class="ask-card__item"><div class="ask-card__q"><b>' + esc(p.title + amt(p)) + '</b><em>' +
        esc(loose ? what : [p.party, short(p.date)].filter(Boolean).join(' · ') + (mine ? (p.party || p.date ? ' · ' : '') + 'your bank shows a payment of this amount on ' + short(hint.tx.date) : '')) + '</em></div>' +
        '<div class="ask-card__opts">' + acts.map((a, k) => '<button type="button" class="btn btn--sm' + ((a.suggested != null ? a.suggested : k === 1 && mine) ? ' is-suggested' : '') + '" ' + a.attr + '>' + esc(a.label) + '</button>').join('') + '</div></li>';
    }).join('');
    return '<section class="ask-card wk-who" aria-label="Who paid?"><header class="ask-card__head"><h2>' + icon('alert') + 'Who paid?</h2>' +
      '<p>' + esc(plural(list.length, 'thing') + ' for work with no answer yet. ' + C + '’s money stays here; yours moves to Get paid back so you can get it back.') + '</p></header>' +
      '<ul class="ask-card__list">' + rows + '</ul>' +
      (list.length > WHO_MAX ? '<footer class="ask-card__foot">' + esc(plural(list.length - WHO_MAX, 'more') + ' under Not sorted below.') + '</footer>' : '') + '</section>';
  }

  /* The page text for each area, under its title. */
  function introOf(area) {
    const s = store.state;
    const c = co();
    const C = co(true);
    const e = wm() ? wm().employer(s) : null;
    const contact = e && e.contact ? String(e.contact).trim() : '';
    if (area === 'invoices') return 'Orders, invoices and receipts ' + c + ' pays for, on ' + c + '’s card or account' + (contact ? ' or settled by ' + contact : '') + '. None of this is your money, so it never shows in Home.';
    if (area === 'bills') return 'Regular costs for ' + c + '. Say who pays each one: if it comes out of your account, each payment joins Get paid back by itself.';
    if (area === 'tasks') return 'Things to do for ' + c + '. They stay out of Home › To-do.';
    if (area === 'projects') return 'Jobs and pieces of work: on the go, coming up, ideas and done.';
    if (area === 'contracts') return C + '’s contracts, leases, licences, insurance, supplier terms and registrations, with reminders before they end. Your own payslips and P60s stay in Home › Documents.';
    return '';
  }
  const DROP = {
    invoices: () => ['Drop invoices or receipts ' + co() + ' pays for', 'Photos and PDFs. I’ll read each one and file it as ' + co() + '’s money.'],
    bills: () => ['Drop work bills here', 'Photos and PDFs. I’ll read each one and file it under Work › Bills.'],
    contracts: () => ['Drop contracts or documents for ' + co(), 'Photos and PDFs. I’ll read each one and file it under Work.'],
  };

  function areaHTML(s, area) {
    const folders = foldersOf(s, area);
    const all = itemsOf(s, area);
    if (ui.folder !== 'all' && ui.folder !== 'none' && !folders.some((f) => f.id === ui.folder)) ui.folder = 'all';
    const inFolder = (id) => all.filter((r) => folderOf(s, r, area) === id).length + notesOf(s, area).filter((n) => n.folder === id).length;
    const unfiled = all.filter((r) => !folderOf(s, r, area)).length;
    const cur = folders.find((f) => f.id === ui.folder);
    const notes = notesOf(s, area).filter((n) => ui.folder === 'all' || (ui.folder === 'none' ? !n.folder || !folders.some((f) => f.id === n.folder) : n.folder === ui.folder))
      .sort((x, y) => (y.updated || y.created || '').localeCompare(x.updated || x.created || ''));
    const drop = DROP[area] ? DROP[area]() : null;
    return tallyHTML(s, area) +
      (area === 'invoices' ? whoHTML(s) : '') +
      '<div class="wk-folders" role="group" aria-label="Folders">' +
      (folders.length ? '<button type="button" class="chip" data-folder="all" aria-pressed="' + (ui.folder === 'all') + '">' + icon('list') + 'All <span class="chip__n">' + all.length + '</span></button>' : '') +
      folders.map((fo) => '<button type="button" class="chip" data-folder="' + esc(fo.id) + '" aria-pressed="' + (ui.folder === fo.id) + '">' + icon('folder') + esc(fo.name) + ' <span class="chip__n">' + inFolder(fo.id) + '</span></button>').join('') +
      (folders.length ? '<button type="button" class="chip" data-folder="none" aria-pressed="' + (ui.folder === 'none') + '">Not in a folder <span class="chip__n">' + unfiled + '</span></button>' : '') +
      '<button type="button" class="chip chip--add" data-new-folder>' + icon('plus') + 'New folder</button>' +
      '<label class="search wk-search">' + icon('search') + '<input type="search" id="wk-q" placeholder="Search ' + esc(((AREAS.find((x) => x.id === area) || {}).one || 'item') + 's') + '" value="' + esc(ui.q) + '" aria-label="Search"></label></div>' +
      (cur ? '<div class="wk-folderbar">' + icon('folder') + '<b>' + esc(cur.name) + '</b><span class="spacer"></span><button type="button" class="btn btn--sm btn--ghost" data-rename-folder="' + esc(cur.id) + '">' + icon('edit') + 'Rename</button>' +
        '<button type="button" class="btn btn--sm btn--ghost" data-delete-folder="' + esc(cur.id) + '">' + icon('trash') + 'Delete folder</button></div>' : '') +
      (drop ? GU.ui.dropbar(drop[0] + (cur ? ' to file them in ' + cur.name : ''), drop[1]) : '') +
      '<div id="wk-body">' + areaBody(s, area) + '</div>' +
      // Notes: a panel once this page has some. Until then, a small '+ Note' button in the page head.
      (notesOf(s, area).length
        ? '<section class="panel"><header class="panel__head"><h2>' + icon('note') + 'Notes' + (cur ? ' in ' + esc(cur.name) : '') + '</h2><button type="button" class="btn btn--sm" data-new-note>' + icon('plus') + 'New note</button></header>' +
          (notes.length ? '<ul class="wk-notes">' + notes.map((n) => noteHTML(s, n, false)).join('') + '</ul>' : '<div class="panel__body"><p class="muted">No notes in this folder yet.</p></div>') + '</section>'
        : '');
  }

  /* The small '+ Note' button for a page with no notes yet ('' once it has some, and they have their own panel). */
  const noteBtn = (hasNotes) => (hasNotes ? '' : '<button type="button" class="btn btn--ghost" data-new-note>' + icon('plus') + 'Note</button>');
  function addButtons(s, area) {
    const c = co();
    const renameBtn = area === 'invoices' ? '' : '<button type="button" class="icon-btn" data-rename-area="' + area + '" aria-label="' + esc('Rename ' + labelOf(area)) + '" data-tip="Rename this page">' + icon('edit') + '</button>';
    const note = noteBtn(notesOf(s, area).length > 0);
    if (area === 'tasks') return renameBtn + note + '<button type="button" class="btn btn--primary" data-add="tasks">' + icon('plus') + 'New task</button>';
    if (area === 'invoices') {
      const send = ktkTotals(s).waiting.filter((p) => !p.handedDate);
      return '<button type="button" class="btn" data-import-orders>' + icon('upload') + 'Import orders</button>' +
        (send.length ? '<button type="button" class="btn" data-send-co="' + esc(send.map((p) => p.id).join(',')) + '">' + icon('send') + esc('Send to ' + c + ' (' + send.length + ')') + '</button>' : '') + note +
        '<button type="button" class="btn btn--primary" data-add="invoices">' + icon('plus') + esc('Something ' + c + ' is paying') + '</button>';
    }
    if (area === 'projects') return renameBtn + note + '<button type="button" class="btn btn--primary" data-add="projects">' + icon('plus') + 'New project</button>';
    if (area === 'bills') return renameBtn + '<button type="button" class="btn" data-move-home="bills">' + icon('home') + 'Move a bill from Home</button>' + note + '<button type="button" class="btn btn--primary" data-add="bills">' + icon('plus') + 'New bill</button>';
    return renameBtn + '<button type="button" class="btn" data-move-home="contracts">' + icon('home') + 'Move a document from Home</button>' + note + '<button type="button" class="btn btn--primary" data-add="contracts">' + icon('plus') + 'New contract or document</button>';
  }

  /* ---------- the page ---------- */
  /* Draws the Overview ('overview') or one area. Folders and search reset when you move to another area. */
  function render(root, area) {
    const s = store.state;
    area = area === 'overview' || AREAS.some((a) => a.id === area) ? area : 'overview';
    if (ui.area !== area) {
      ui.area = area;
      ui.folder = 'all';
      ui.q = '';
    }
    const name = coName();
    const head = area === 'overview'
      ? GU.view.head({
        eyebrow: name,
        title: 'Work overview',
        text: esc(name ? 'Everything for ' + name + ' in one place.' : 'Everything for your job or business in one place.'),
        actions: '<button type="button" class="btn btn--primary" data-add-menu>' + icon('plus') + 'Add</button>',
      })
      : GU.view.head({ eyebrow: name, title: labelOf(area), text: esc(introOf(area)), actions: addButtons(s, area) });
    root.innerHTML = (area === 'overview' && parts().doorsHTML ? parts().doorsHTML(s, 'work') : '') + head +
      '<div class="stack wk wk--' + area + '">' + (area === 'overview' ? overviewHTML(s) : areaHTML(s, area)) + '</div>';

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
        const parsed = GU.tabs.today && GU.tabs.today.parseQuickTask ? GU.tabs.today.parseQuickTask(raw) : { title: raw };
        store.commit((st) => {
          const listId = ensureWorkList(st);
          st.tasks.push({ id: 'k-' + uid(), listId, context: 'work', workFolder: curFolder(), title: parsed.title || raw, due: parsed.due || quick.elements.due.value, priority: 'normal', notes: '', done: false, created: today() });
        });
        setTimeout(() => {
          const el = document.getElementById('wk-task');
          if (el) el.focus();
        }, 0);
      });
    }
    const tell = root.querySelector('[data-tell]');
    if (tell) {
      tell.addEventListener('submit', (e) => {
        e.preventDefault();
        const note = tell.elements.note.value.trim();
        if (!note) return tell.elements.note.focus();
        tell.elements.note.value = '';
        if (GU.inbox && GU.inbox.add) GU.inbox.add({ note, scope: { kind: 'work', area: null, name: 'Work' }, ctx: 'work' });
        setTimeout(() => {
          const el = document.getElementById('wk-tell');
          if (el) el.focus();
        }, 0);
      });
      wireDropCover(root);
    }
    root.querySelectorAll('.wk-group').forEach((d) => d.addEventListener('toggle', () => (ui.showDone = d.open)));
    root.querySelectorAll('.wk-check__more').forEach((d) => d.addEventListener('toggle', () => (ui.moreChecks = d.open)));
    if (area !== 'overview') GU.ui.wireDropbar(root, (files) => upload(files));
    root.addEventListener('change', (e) => {
      const d = e.target.closest('[data-done]');
      if (d) GU.tabs.todos.complete(d.dataset.done, d.checked);
    });
    root.addEventListener('click', onClick);
  }

  /* Drop files anywhere on the Overview to file them under Work. */
  function wireDropCover(root) {
    const cover = root.querySelector('.dropcover');
    if (!cover) return;
    let depth = 0;
    root.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      depth++;
      cover.hidden = false;
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) cover.hidden = true;
    });
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      cover.hidden = true;
      GU.ui.filesFromDrop(e.dataTransfer).then((files) => files.length && upload(files));
    });
  }

  /* Goes to an area's page. */
  function go(area) {
    const tab = TAB_OF[area] || 'work';
    GU.view.go(GU.tabs[tab] ? tab : 'work');
  }

  function onClick(e) {
    const s = store.state;
    const b = (sel) => e.target.closest(sel);
    let el;
    if ((el = b('[data-go]'))) return GU.view.go(GU.tabs[el.dataset.go] ? el.dataset.go : 'work');
    if ((el = b('[data-area]'))) return go(el.dataset.area);
    if ((el = b('[data-folder]'))) {
      ui.folder = el.dataset.folder;
      return GU.render();
    }
    if ((el = b('[data-chip="inv"]'))) {
      ui.inv = el.dataset.value;
      return GU.render();
    }
    if (rowClick(e)) return;
    if ((el = b('[data-check]'))) {
      const x = checks(s)[+el.dataset.check];
      if (!x) return;
      if (x.tidy) {
        if (GU.refile && GU.refile.openTidy) GU.refile.openTidy();
        return;
      }
      if (x.inv) ui.inv = x.inv;
      if (x.go) return GU.view.go(GU.tabs[x.go] ? x.go : 'work');
      if (x.ref) return GU.view.open(x.ref);
      return go(x.area);
    }
    if (b('[data-add-menu]')) return menu(b('[data-add-menu]'), parts().addMenu('work'));
    if ((el = b('[data-add]'))) return add(el.dataset.add, el.dataset.kind);
    if ((el = b('[data-move-home]'))) return moveFromHome(el.dataset.moveHome);
    if (b('[data-import-orders]')) return importOrders();
    if (b('[data-upload]')) {
      return GU.ui.pickFiles().then((files) => files.length && upload(files));
    }
    if (b('[data-new-folder]')) return newFolder(ui.area === 'overview' ? null : ui.area);
    if ((el = b('[data-rename-folder]'))) return rename('workFolders', el.dataset.renameFolder);
    if ((el = b('[data-delete-folder]'))) return deleteFolder(el.dataset.deleteFolder);
    if ((el = b('[data-rename-area]'))) return renameArea(el.dataset.renameArea);
    if (b('[data-new-note]')) return editNote(null, { area: ui.area === 'overview' ? 'general' : ui.area, folder: curFolder() });
  }

  /* Clicks on rows, the forecast and the 'Who paid?' answers. Home › Plans uses this for its rows too:
     returns true when it dealt with the click. */
  function rowClick(e) {
    const b = (sel) => e.target.closest(sel);
    const W = wm();
    let el;
    if ((el = b('[data-more]'))) {
      const [c, id] = el.dataset.more.split(':');
      moreMenu(el, c, id);
      return true;
    }
    if ((el = b('[data-payer]'))) {
      const [c, id, who] = el.dataset.payer.split(':');
      if (W && W.setPayer) W.setPayer(c, id, who);
      return true;
    }
    if ((el = b('[data-send-co]'))) {
      sendToCo(el.dataset.sendCo.split(',').filter(Boolean));
      return true;
    }
    if ((el = b('[data-ktkpaid]'))) {
      if (W && W.markKtkPaid) W.markKtkPaid(el.dataset.ktkpaid);
      return true;
    }
    if (b('[data-cf-settings]')) {
      forecastSettings();
      return true;
    }
    if (b('[data-balances]')) {
      GU.tabs.transactions.updateBalances();
      return true;
    }
    if ((el = b('[data-idea-done]'))) {
      ideaStatus(el.dataset.ideaDone, 'done');
      return true;
    }
    if ((el = b('[data-paid]'))) {
      GU.tabs.receipts.markPaid(el.dataset.paid);
      return true;
    }
    if ((el = b('[data-billpaid]'))) {
      GU.tabs.bills.markPaid(el.dataset.billpaid);
      return true;
    }
    if ((el = b('[data-bill-keep]'))) {
      const id = el.dataset.billKeep;
      store.commit((st) => {
        const x = st.bills.find((y) => y.id === id);
        if (x) x.review = false;
      });
      toast('Kept it', { action: 'Undo', onAction: () => store.commit((st) => {
        const x = st.bills.find((y) => y.id === id);
        if (x) x.review = true;
      }) });
      return true;
    }
    if ((el = b('[data-files]'))) {
      const [c, id] = el.dataset.files.split(':');
      const r = store.find(c, id);
      if (r && (r.files || []).length) viewFiles(r.files, 0, nameOf(c, r));
      else GU.view.open({ c, id });
      return true;
    }
    if ((el = b('[data-open]'))) {
      const [c, id] = el.dataset.open.split(':');
      GU.view.open({ c, id });
      return true;
    }
    return false;
  }

  /* ---------- sending to the business ---------- */
  /* Shares invoices with the business to pay (the file itself, or a zip with a summary), or copies the
     message. Marks them as sent to the business unless you untick it. */
  function sendToCo(ids) {
    const W = wm();
    const recs = ids.map((id) => store.find('paperwork', id)).filter(Boolean);
    if (!recs.length) return;
    if (!W || !W.share || !W.message) return toast('Sending isn’t ready yet. Download the files from the row instead.');
    const c = co();
    const total = sum(recs, (p) => Math.abs(Number(p.amount) || 0));
    const noFile = recs.filter((p) => !(p.files || []).length).length;
    const what = recs.length === 1 ? recs[0].title + amt(recs[0]) : plural(recs.length, 'invoice') + ', ' + money(total) + ' in total';
    const d = GU.ui.openDialog({
      title: 'Send to ' + c,
      body: '<p class="dlg__intro">' + esc(what + '. Share it with ' + c + ' (by WhatsApp or email on a phone), or download it and send it yourself.') + '</p>' +
        (noFile ? '<p class="note-line">' + icon('alert') + '<span>' + esc((recs.length === 1 ? 'It has' : noFile + ' of them have') + ' no file yet, so only the summary goes. You can add a file from its row first.') + '</span></p>' : '') +
        '<div class="field"><label class="field__label" for="wk-send-text">Message</label><textarea id="wk-send-text" name="text" rows="5">' + esc(W.message(ids, 'ktk')) + '</textarea></div>' +
        '<label class="check"><input type="checkbox" name="mark" checked><span>' + esc('Mark as sent to ' + c + ' today') + '</span></label>',
      footer: '<button type="button" class="btn" data-copy>' + icon('list') + 'Copy message</button><span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button>' +
        '<button type="submit" class="btn btn--primary">' + icon('send') + 'Share or download</button>',
    });
    const text = () => d.form.elements.text.value.trim();
    const mark = () => d.form.elements.mark.checked;
    d.el.querySelector('[data-copy]').addEventListener('click', async () => {
      const ok = await W.copyMessage(ids, 'ktk', { text: text(), markSent: mark() });
      if (ok) d.close();
    });
    d.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = await W.share(ids, 'ktk', { text: text(), markSent: mark() });
      if (out && !out.cancelled) d.close();
    });
  }

  /* ---------- adding ---------- */
  const curFolder = () => (ui.folder !== 'all' && ui.folder !== 'none' ? ui.folder : '');
  /* Marks a record made by another page's form as work, in the folder you're looking at, unless you switched its
     For to Home. extra fills in fields the form didn't set (who pays, say), without overriding what you chose. */
  function tag(c, id, folder, extra) {
    store.commit((s) => {
      const r = (s[c] || []).find((x) => x.id === id);
      if (!r || r.context === 'home') return;
      r.context = 'work';
      if (folder) r.workFolder = folder;
      if (c === 'tasks') r.listId = ensureWorkList(s);
      for (const k in extra || {}) if (r[k] == null || r[k] === '') r[k] = extra[k];
      if (c === 'paperwork' && wm() && wm().normalise) wm().normalise(r);
    });
  }

  function add(area, kind) {
    const folder = curFolder();
    const R = GU.tabs.receipts;
    if (area === 'tasks') {
      if (!workListId(store.state)) store.commit((s) => ensureWorkList(s));
      return GU.tabs.todos.create({ listId: workListId(store.state), context: 'work' }, { onSaved: (r) => tag('tasks', r.id, folder) });
    }
    if (area === 'invoices') {
      const v = kind === 'receipt' ? { kind: 'receipt', context: 'work', payer: 'company', date: today() } : { kind: 'invoice-in', context: 'work', payer: 'company', status: 'unpaid', date: today() };
      return R.create({ values: v, onSaved: (r) => tag('paperwork', r.id, folder, { payer: 'company' }) });
    }
    if (area === 'back') return R.create({ values: { kind: 'receipt', context: 'work', payer: 'me', date: today() }, onSaved: (r) => tag('paperwork', r.id, '', { payer: 'me' }) });
    if (area === 'projects') return editProject(null, { folder });
    if (area === 'bills') return GU.tabs.bills.create({ category: (F.WORK_OUT || 'Work expenses'), context: 'work' }, { onSaved: (r) => tag('bills', r.id, folder) });
    if (area === 'contracts') return GU.tabs.documents.create({ type: CONTRACT, title: '', context: 'work' }, { onSaved: (r) => tag('documents', r.id, folder) });
    if (area === 'note') return editNote(null, { area: ui.area === 'overview' ? 'general' : ui.area, folder });
    if (area === 'folder') return newFolder(ui.area === 'overview' ? null : ui.area);
  }

  /* An order history file: the importer, set to work and the business's card. */
  function importOrders() {
    const R = GU.tabs.receipts;
    if (R && R.importOrders) R.importOrders(null, { context: 'work', payer: 'company' });
  }

  /* Files dropped or picked here are read by the assistant and filed under Work, on this page and in this
     folder. On the business's page they're its money. */
  function upload(files) {
    const area = ui.area === 'overview' ? null : ui.area;
    const folder = curFolder();
    const fo = folder && (store.state.workFolders || []).find((x) => x.id === folder);
    GU.inbox.add({ files, scope: { kind: 'work', area, folderId: folder, payer: area === 'invoices' ? 'company' : null, name: 'Work' + (area ? ' › ' + labelOf(area) : '') + (fo ? ' › ' + fo.name : '') } });
  }

  /* Moves bills or documents from Home to Work, so each thing has one place. Bills ask who pays, once. */
  function moveFromHome(area) {
    const s = store.state;
    const c = COLL[area];
    const pool = area === 'bills' ? s.bills.filter((b) => !isWorkBill(b) && b.active !== false) : s.documents.filter((d) => !isWorkDoc(d));
    if (!pool.length) return toast(area === 'bills' ? 'All your bills are already in Work.' : 'There are no Home documents to choose from.');
    const folder = curFolder();
    const co1 = co();
    const who = area === 'bills' ? '<div class="field"><span class="field__label">Who pays them?</span><div class="seg" role="radiogroup" aria-label="Who pays them?">' +
      '<label><input type="radio" name="payer" value="me" checked><span>' + icon('coin') + esc('Out of my account, ' + co1 + ' pays me back') + '</span></label>' +
      '<label><input type="radio" name="payer" value="company"><span>' + icon('briefcase') + esc(co(true) + ' pays directly') + '</span></label></div></div>' : '';
    const d = GU.ui.openDialog({
      title: area === 'bills' ? 'Move bills from Home' : 'Move documents from Home',
      body: '<p class="dlg__intro">Tick the ones that are for ' + esc(co1) + '. They move to Work and leave your Home lists.</p>' + who +
        '<label class="search wk-pick__search">' + icon('search') + '<input type="search" data-pick-q placeholder="Search" aria-label="Search"></label><ul class="wk-pick" data-pick></ul>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary">Move to Work</button>',
    });
    const box = d.body.querySelector('[data-pick]');
    const chosen = new Set();
    const draw = (q) => {
      const ql = (q || '').toLowerCase();
      const list = pool.filter((r) => !ql || [nameOf(c, r), r.payee, r.type, r.holder, r.category].join(' ').toLowerCase().includes(ql)).slice(0, 150);
      box.innerHTML = list.map((r) => '<li><label class="check"><input type="checkbox" value="' + esc(r.id) + '"' + (chosen.has(r.id) ? ' checked' : '') + '><span><b>' + esc(nameOf(c, r)) + '</b> <em class="muted">' +
        esc(area === 'bills' ? money(r.amount) + ' · ' + F.freqLabel(r.frequency) + (r.category ? ' · ' + r.category : '') : [r.type, r.expiryDate ? 'ends ' + short(r.expiryDate) : ''].filter(Boolean).join(' · ')) + '</em></span></label></li>').join('') || '<li class="muted">Nothing matches.</li>';
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
      const payerEl = d.form.querySelector('input[name="payer"]:checked');
      const payer = payerEl ? payerEl.value : null;
      const before = ids.map((id) => JSON.parse(JSON.stringify(store.find(c, id))));
      let made = [];
      store.commit((st) => {
        for (const r of st[c]) {
          if (!ids.includes(r.id)) continue;
          r.context = 'work';
          if (folder) r.workFolder = folder;
          if (area === 'bills') {
            r.payer = payer;
            r.category = F.WORK_OUT || 'Work expenses';
          }
          if (area === 'contracts' && (!r.type || r.type === 'Other')) r.type = CONTRACT;
        }
        // Payments of a bill you pay from now on join Get paid back.
        if (area === 'bills' && payer === 'me' && wm() && wm().billClaims) {
          try {
            made = wm().billClaims(st) || [];
          } catch (err) {
            made = [];
          }
        }
      });
      d.close();
      const madeIds = made.map((p) => p.id);
      toast('Moved ' + plural(ids.length, area === 'bills' ? 'bill' : 'document') + ' to Work', { action: 'Undo', onAction: () => store.commit((st) => {
        for (const old of before) {
          const i = st[c].findIndex((x) => x.id === old.id);
          if (i >= 0) st[c][i] = old;
        }
        if (madeIds.length) st.paperwork = st.paperwork.filter((p) => !madeIds.includes(p.id));
      }) });
    });
  }

  /* ---------- projects ---------- */
  /* The form for a project. ctx 'home' is Home › Home projects (who asked, a budget, no work folder); anything else is Work. */
  function projectFields(area, ctx) {
    const s = store.state;
    if (ctx === 'home') {
      return [
        { name: 'name', label: 'Project', required: true, placeholder: 'e.g. Paint the garage, Fix the fence' },
        { name: 'client', label: 'Asked by', half: true, optional: true, placeholder: 'e.g. Dad' },
        { name: 'status', label: 'Where it’s at', type: 'select', options: STATUSES, default: 'Planned', half: true },
        { name: 'start', label: 'Starts', type: 'date', half: true, optional: true },
        { name: 'deadline', label: 'Due', type: 'date', half: true, optional: true },
        { name: 'value', label: 'Budget', type: 'money', half: true, optional: true, help: 'What it should cost.' },
        { name: 'files', label: 'Files', type: 'files', dropLabel: 'Add photos, quotes or plans' },
        { name: 'notes', label: 'Notes', type: 'textarea', rows: 4, optional: true, placeholder: 'What’s involved, what to buy, next steps…' },
      ];
    }
    return [
      { name: 'name', label: 'Project', required: true, placeholder: 'e.g. Shop refit, New website' },
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
  /* Opens a project's form. A new one is a Work project unless opts.context is 'home'; an old one keeps the part it is in.
     opts.values fills in a new project (a name, say). */
  function editProject(id, opts) {
    opts = opts || {};
    const p = id ? store.find('projects', id) : null;
    const ctx = p ? (parts().isHomeProject(p) ? 'home' : 'work') : opts.context === 'home' ? 'home' : 'work';
    formDialog({
      title: p ? (ctx === 'home' ? 'Edit home project' : 'Edit project') : ctx === 'home' ? 'New home project' : 'New project',
      fields: projectFields('projects', ctx),
      values: p || Object.assign({ status: 'Planned' }, ctx === 'home' ? {} : { workFolder: opts.folder || '' }, opts.values || {}),
      submitLabel: p ? 'Save' : 'Add project',
      onSubmit: (v) => {
        const rec = Object.assign(p ? Object.assign({}, p) : { id: 'pj-' + uid(), created: today() }, v, { updated: today() });
        // Home is marked; a Work project made here is marked work. An older Work project with no mark is left as it is.
        if (ctx === 'home') rec.context = 'home';
        else if (!p) rec.context = 'work';
        store.upsert('projects', rec);
        if (!p) toast('Added ' + rec.name);
      },
      onDelete: p ? () => store.remove('projects', p.id, p.name) : null,
      deleteMessage: 'This deletes the project and its files. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
  }
  /* A project to the other part ('home' or 'work'), with Undo. A project in Home has no Work folder, so it leaves it. */
  function moveProject(id, ctx) {
    const r = store.find('projects', id);
    if (!r) return;
    ctx = ctx === 'home' ? 'home' : 'work';
    if ((ctx === 'home') === parts().isHomeProject(r)) return;
    const before = JSON.parse(JSON.stringify(r));
    store.commit((s) => {
      const x = s.projects.find((y) => y.id === id);
      if (!x) return;
      x.context = ctx;
      if (ctx === 'home') delete x.workFolder;
      x.updated = today();
    });
    toast(ctx === 'home' ? 'Moved ' + r.name + ' to Home › Home projects' : 'Moved ' + r.name + ' to Work › ' + labelOf('projects'), { action: 'Undo', onAction: () => store.upsert('projects', before) });
  }
  /* Marks a project In progress or Done, with Undo. */
  function setProjectStatus(id, status) {
    const r = store.find('projects', id);
    if (!r || r.status === status) return;
    const before = JSON.parse(JSON.stringify(r));
    store.commit((s) => {
      const x = s.projects.find((y) => y.id === id);
      if (x) {
        x.status = status;
        x.updated = today();
      }
    });
    toast(status === 'Done' ? 'Marked ' + r.name + ' as done' : 'Marked ' + r.name + ' as in progress', { action: 'Undo', onAction: () => store.upsert('projects', before) });
  }

  /* ---------- your own cost ideas (Home › Plans) ---------- */
  /* When you can afford things. opts.context 'home' counts only your own ideas (the plan only holds those). */
  function forecastHTML(s, opts) {
    s = s || store.state;
    opts = opts || {};
    const ctx = opts.context === 'home' ? 'home' : null;
    const plan = GU.costs.schedule(s);
    const b = plan.base;
    if (!b.known) {
      return '<section class="panel"><div class="panel__body cf-empty">' + icon('bank') + '<p>Put in what’s in your accounts first, and I’ll work out when you can afford each idea.</p><button type="button" class="btn btn--primary" data-balances>Add your balances</button></div></section>';
    }
    const results = plan.results.filter((r) => !ctx || ideaPart(r.idea) === ctx);
    const outstanding = round2(sum(results, (r) => r.cost));
    const notFitting = results.filter((r) => !r.date).length;
    const allBy = results.length && results.every((r) => r.date) ? results.reduce((m, r) => (r.date > m ? r.date : m), '') : null;
    const keep = b.cfg.buffer ? money(b.cfg.buffer, { whole: true }) : '£0';
    const room = plan.months.slice(0, b.cfg.months);
    return '<section class="panel cf"><header class="panel__head"><h2>' + icon('trend') + 'When you can afford things</h2><span class="muted">next ' + b.cfg.months + ' months</span></header>' +
      '<div class="tally__sum">' +
      '<div><span>You could spend now</span><b>' + esc(money(plan.freeNow, { whole: true })) + '</b><em>' + esc('and never drop below ' + keep + (b.cfg.overdraft ? ' (with overdraft)' : '')) + '</em></div>' +
      '<div><span>Ideas to fund</span><b>' + esc(money(outstanding, { whole: true })) + '</b><em>' + esc(plural(results.length, 'idea') + ' on the list') + '</em></div>' +
      '<div><span>' + (notFitting ? 'Don’t fit yet' : 'All done by') + '</span><b class="' + (notFitting ? 'is-crit' : '') + '">' + esc(notFitting ? String(notFitting) : allBy ? short(allBy) : '–') + '</b><em>' + esc(notFitting ? 'not affordable in ' + b.cfg.months + ' months at this rate' : results.length ? 'at the earliest' : 'add an idea below') + '</em></div>' +
      '</div>' +
      '<div class="cf-room"><h3>Room to spend, month by month</h3><p class="muted">The most you could spend from the start of each month, after the ideas above, without dropping below ' + esc(keep) + ' later on.</p><ol>' +
      room.map((m) => '<li class="' + (m.room > 0 ? 'is-room' : '') + '"><span>' + esc(monthLabel(m.key) + (m.key.slice(0, 4) !== today().slice(0, 4) ? ' ' + m.key.slice(0, 4) : '')) + '</span><b>' + esc(money(m.room, { whole: true })) + '</b></li>').join('') + '</ol></div>' +
      '<footer class="panel__foot cf-note">' + icon('info') + '<span>' + esc('Starts from ' + money(b.plan.start) + ' across your accounts. Counts your income, bills, debt and instalment payments and invoices due, plus about ' + money(b.everyday, { whole: true }) + ' a month of everyday spending' +
        (b.cfg.everyday != null && b.cfg.everyday !== '' ? ' (your figure)' : b.est ? ' (from your last ' + plural(b.est.months.length, 'month') + ' of statements)' : '') + '. It keeps at least ' + keep + ' in your accounts' + (b.cfg.overdraft ? ', counting your overdraft' : '') + '. Must-haves are planned first. ') + '<button type="button" class="link link--btn" data-cf-settings>Change these</button></span></footer></section>';
  }

  /* A cost idea of your own: something to save for, in Home › Plans. (An idea left from the old Cost forecast keeps its
     own mark and who pays when it's edited; they're added to Work › To buy rather than planned here.) */
  function editIdea(id) {
    const i = id ? store.find('costIdeas', id) : null;
    const ctx = i ? ideaPart(i) : 'home';
    const fields = [
      { name: 'name', label: 'What is it?', required: true, placeholder: 'e.g. New laptop, A weekend away' },
      { name: 'cost', label: 'What it’ll cost', type: 'money', required: true, half: true },
      { name: 'monthly', label: 'Ongoing cost a month', type: 'money', optional: true, half: true, help: 'For things that keep costing, like software or rent.' },
      { name: 'priority', label: 'How important', type: 'segmented', options: PRIORITIES, default: 'should' },
      { name: 'notBefore', label: 'Not before', type: 'date', optional: true, half: true },
      { name: 'wantBy', label: 'Want it by', type: 'date', optional: true, half: true },
      { name: 'plannedDate', label: 'Already booked for', type: 'date', optional: true, half: true, help: 'Leave empty and I’ll find the earliest date you can afford it.' },
      { name: 'status', label: 'Status', type: 'segmented', options: [{ value: 'open', label: 'To do' }, { value: 'done', label: 'Done' }, { value: 'dropped', label: 'Dropped' }], default: 'open' },
      { name: 'files', label: 'Quotes or files', type: 'files', dropLabel: 'Add quotes, links saved as PDFs or photos' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, optional: true },
    ];
    formDialog({
      title: i ? 'Edit idea' : 'Something to save for',
      intro: i ? null : 'Add what it is and what it’ll cost. I’ll find the earliest date you can afford it without dropping below what you keep, and which account it could come from.',
      fields,
      values: i ? Object.assign({ status: 'open' }, i) : { priority: 'should', status: 'open' },
      submitLabel: i ? 'Save' : 'Add it',
      onSubmit: (v) => {
        const rec = Object.assign(i ? Object.assign({}, i) : { id: 'ci-' + uid(), created: today() }, v, { context: ctx, updated: today() });
        if (rec.status === 'done' && !rec.doneDate) rec.doneDate = today();
        if (rec.status !== 'done') delete rec.doneDate;
        store.upsert('costIdeas', rec);
        if (i) return;
        const r = GU.costs.schedule(store.state).results.find((x) => x.idea.id === rec.id);
        toast(r && r.date ? rec.name + ': ' + (daysUntil(r.date) <= 0 ? 'you can afford it now' : 'earliest ' + short(r.date)) + (r.account ? ', from ' + r.account : '') : rec.name + ' doesn’t fit in the time ahead yet');
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
    opts = opts || {};
    const s = store.state;
    const n = id ? store.find('workNotes', id) : null;
    const area = n ? noteArea(n) : opts.area || 'general';
    const folderOpts = (a) => [{ value: '', label: 'No folder' }].concat(foldersOf(s, a).map((f) => ({ value: f.id, label: f.name })));
    formDialog({
      title: n ? 'Note' : 'New note',
      wide: true,
      fields: [
        { name: 'title', label: 'Title', required: true, placeholder: 'e.g. Call with the supplier, Ideas for the shop' },
        { name: 'area', label: 'Page', type: 'select', options: [{ value: 'general', label: 'Overview' }, { value: 'requests', label: labelOf('requests') }].concat(AREAS.map((a) => ({ value: a.id, label: labelOf(a.id) }))), half: true },
        { name: 'folder', label: 'Folder', type: 'select', options: folderOpts(area), half: true, help: 'Folders belong to a page. Save, then reopen to pick a folder after changing the page.' },
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
  /* area: the page it's for (no question), or null to ask which page; preset: the page the question starts on. */
  function newFolder(area, then, preset) {
    const s = store.state;
    area = area && AREAS.some((a) => a.id === area) ? area : null;
    formDialog({
      title: 'New folder',
      fields: [{ name: 'name', label: 'Folder name', required: true, placeholder: 'e.g. Suppliers, 2026, Subscriptions' }].concat(area ? [] : [{ name: 'area', label: 'On the page', type: 'select', options: AREAS.map((a) => ({ value: a.id, label: labelOf(a.id) })) }]),
      values: { area: AREAS.some((a) => a.id === preset) ? preset : 'tasks' },
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
          ui.q = '';
          go(a);
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
    const field = c === 'bills' || c === 'projects' || c === 'workFolders' || c === 'costIdeas' ? 'name' : 'title';
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
    const def = (AREAS.find((a) => a.id === area) || {}).label;
    if (!def || area === 'invoices') return;
    formDialog({
      title: 'Rename ' + labelOf(area),
      fields: [{ name: 'name', label: 'Call it', required: true, help: 'Leave it as “' + esc(def) + '” to keep the usual name.' }],
      values: { name: labelOf(area) },
      submitLabel: 'Rename',
      onSubmit: (v) => store.commit((s) => {
        s.settings.workLabels = Object.assign({}, s.settings.workLabels);
        if (!v.name.trim() || v.name.trim() === def) delete s.settings.workLabels[area];
        else s.settings.workLabels[area] = v.name.trim();
      }),
    });
  }

  /* Open, rename, move to a folder, say who pays, move to Home, or delete. */
  function moreMenu(anchor, c, id) {
    const s = store.state;
    const r = store.find(c, id);
    if (!r) return;
    const W = wm();
    const C = co(true);
    if (c === 'workNotes') {
      return menu(anchor, [
        { icon: 'edit', label: 'Open', onClick: () => editNote(id) },
        { icon: 'edit', label: 'Rename', onClick: () => rename(c, id) },
        { icon: 'folder', label: 'Move to…', hint: 'Another folder or page', onClick: () => moveNote(anchor, id) },
        { icon: 'trash', label: 'Delete', onClick: () => store.remove('workNotes', id, r.title || 'Note') },
      ]);
    }
    const area = AREA_OF[c];
    const idea = c === 'costIdeas';
    const items = [
      { icon: 'edit', label: 'Open and edit', onClick: () => GU.view.open({ c, id }) },
      { icon: 'edit', label: 'Rename', onClick: () => rename(c, id) },
    ];
    const homeProject = c === 'projects' && parts().isHomeProject(r);
    // A home project has no work folders.
    if (!idea && !homeProject) items.push({ icon: 'folder', label: 'Move to folder…', hint: folderOf(s, r, area) ? 'Now in ' + ((s.workFolders || []).find((f) => f.id === r.workFolder) || {}).name : 'Not in a folder', onClick: () => moveMenu(anchor, c, id) });
    const setPayer = (who) => W && W.setPayer && W.setPayer(c, id, who);
    if (c === 'paperwork') {
      const ln = laneOf(r);
      if (ln !== 'back') items.push({ icon: 'coin', label: 'I paid this myself', hint: 'Moves it to Get paid back, to send to ' + co(), onClick: () => setPayer('me') });
      if (ln !== 'ktk') items.push({ icon: 'briefcase', label: C + ' paid this, not me', hint: 'Keeps it as ' + co() + '’s money', onClick: () => setPayer('company') });
      if (isWaiting(r)) items.push({ icon: 'check', label: 'Paid by ' + co(), onClick: () => W && W.markKtkPaid(id) });
      else if (ln === 'ktk' && r.kind === 'invoice-in') items.push({ icon: 'repeat', label: 'Not paid yet', hint: 'Back to waiting for ' + co(), onClick: () => notPaidYet(id) });
    } else if (c === 'bills') {
      if (billPayer(r) === 'company') items.push({ icon: 'coin', label: 'Comes out of my account', hint: co(true) + ' pays me back', onClick: () => setPayer('me') });
      else items.push({ icon: 'briefcase', label: C + ' pays it directly', hint: 'Not from your account', onClick: () => setPayer('company') });
    } else if (idea) {
      if (GU.costs.isOpen(r)) {
        items.push({ icon: 'check', label: 'Mark done', onClick: () => ideaStatus(id, 'done') });
        items.push({ icon: 'x', label: 'Drop it', hint: 'Keeps it, but stops planning for it', onClick: () => ideaStatus(id, 'dropped') });
      } else items.push({ icon: 'repeat', label: 'Back to the plan', onClick: () => ideaStatus(id, 'open') });
    } else if (c === 'projects') {
      for (const st of ['In progress', 'Done'].filter((x) => x !== r.status)) items.push({ icon: st === 'Done' ? 'check' : 'clock', label: 'Mark ' + st.toLowerCase(), onClick: () => setProjectStatus(id, st) });
      if (homeProject) items.push({ icon: 'briefcase', label: 'Move to Work', hint: 'It’s for work, not a home project', onClick: () => moveProject(id, 'work') });
      else items.push({ icon: 'home', label: 'Move to Home', hint: 'It’s mine, not for work', onClick: () => moveProject(id, 'home') });
    }
    if (idea) {
      if (GU.costs.isOpen(r)) items.push({ icon: 'briefcase', label: 'It’s for work', hint: 'Adds it to Work › To buy', onClick: () => toWork(id) });
    } else if (c !== 'projects') items.push({ icon: 'home', label: 'Move to Home', hint: 'It’s mine, not for work', onClick: () => takeOut(c, id) });
    items.push({ icon: 'trash', label: 'Delete', onClick: () => store.remove(c, id, nameOf(c, r)) });
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
    const opts = [{ area: 'general', folder: '', label: 'Overview' }, { area: 'requests', folder: '', label: labelOf('requests') }];
    for (const a of AREAS) {
      opts.push({ area: a.id, folder: '', label: labelOf(a.id) });
      for (const f of foldersOf(s, a.id)) opts.push({ area: a.id, folder: f.id, label: labelOf(a.id) + ' › ' + f.name });
    }
    menu(anchor, opts.map((o) => ({ icon: o.folder ? 'folder' : 'list', label: o.label, onClick: () => store.commit((st) => {
      const n = st.workNotes.find((x) => x.id === id);
      if (n) Object.assign(n, { area: o.area, folder: o.folder, updated: today() });
    }) })));
  }
  /* An invoice marked paid by the business by mistake: back to waiting. */
  function notPaidYet(id) {
    const before = Object.assign({}, store.find('paperwork', id));
    store.commit((s) => {
      const p = s.paperwork.find((x) => x.id === id);
      if (!p) return;
      p.status = 'unpaid';
      delete p.paidDate;
    });
    toast('Back to waiting for ' + co(), { action: 'Undo', onAction: () => store.upsert('paperwork', before) });
  }
  /* 'Move to Home': it's yours, not for work. Paperwork, bills and ideas lose who pays and any claim, and a
     linked bank payment counts as your own spending again. */
  function takeOut(c, id) {
    const W = wm();
    if (['paperwork', 'bills', 'costIdeas'].includes(c) && W && W.moveToHome) return W.moveToHome(c, id);
    const before = Object.assign({}, store.find(c, id));
    store.commit((s) => {
      const r = s[c].find((x) => x.id === id);
      if (!r) return;
      r.context = 'home';
      if (c === 'tasks') {
        const wl = workListId(s);
        if (r.listId === wl) r.listId = (s.todoLists.find((l) => l.id !== wl) || {}).id || r.listId;
      }
      delete r.payer;
      delete r.workFolder;
    });
    toast('Moved to Home', { action: 'Undo', onAction: () => store.upsert(c, before) });
  }
  /* The other way, for one of your own ideas: it's for work after all, so it goes on Work › To buy (and leaves the plan). */
  function toWork(id) {
    if (GU.requests && GU.requests.addIdeas) return GU.requests.addIdeas([id]);
    return null;
  }

  /* Opens a project, note or idea (from anywhere, e.g. Home's timeline). */
  function edit(id, c) {
    if (c === 'workNotes') return editNote(id);
    if (c === 'costIdeas') return editIdea(id);
    return editProject(id);
  }
  /* Opens Work on one area ('overview' or none for the Overview). opts.inv picks a tab on the business's page. */
  function show(area, opts) {
    if (opts && opts.inv) ui.inv = opts.inv;
    if (area && area !== 'overview' && ui.area !== area) {
      ui.area = area;
      ui.folder = 'all';
      ui.q = '';
    }
    go(area);
  }

  GU.work = {
    AREAS, TAB_OF, CONTRACT, STATUSES, CLOSED, labelOf, itemsOf, checks, dates, figures, workListId, ensureWorkList,
    projectLanes, groupsHTML, editProject, moveProject, setProjectStatus,
    isWorkBill: (b) => parts().isWorkBill(b), isWorkTask: (s, t) => parts().isWorkTask(s, t),
    forecastHTML, editIdea, ideaStatus, forecastSettings, rowHTML, rowClick, newFolder, show, sendToCo, moveFromHome, takeOut, card: cardBtn, editNote, notesOf,
  };
  GU.tabs.work = { label: 'Work overview', short: 'Overview', icon: 'briefcase', part: 'work', render: (r) => render(r, 'overview'), edit, show, editProject, editNote, editIdea, newFolder };
  // Each area is its own page in the Work part. Get paid back ('work-back') is js/tabs/payback.js.
  for (const a of AREAS) {
    GU.tabs[TAB_OF[a.id]] = {
      get label() { return labelOf(a.id); },
      get short() { return labelOf(a.id); },
      icon: a.icon,
      part: 'work',
      area: a.id,
      render: (r) => render(r, a.id),
      edit,
    };
  }
})();
