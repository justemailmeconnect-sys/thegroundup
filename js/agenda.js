/* The Ground Up: the assistant's brain. Gathers everything with a date into one timeline,
   and works out what needs attention for the badges on each tab.
   Every item says which part of the site it belongs to (.part 'home' or 'work'), so Home only shows your
   own things and the Work pages get their own badges. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, daysUntil, fmtDate, money, relDays, plural } = GU.util;
  const F = GU.finance;

  /* ---------- work or home, read through GU.parts and GU.workMoney when they're there ---------- */
  const employerShort = (s) => {
    const e = GU.workMoney ? GU.workMoney.employer(s) : null;
    return e && e.set ? e.short : '';
  };
  const coLabel = (s) => (GU.workMoney ? GU.workMoney.employer(s).label : 'the company');
  const CoLabel = (s) => (GU.workMoney ? GU.workMoney.employer(s).Label : 'The company');
  const isWorkBill = (b) => (GU.parts && GU.parts.isWorkBill ? GU.parts.isWorkBill(b) : b.context === 'work' || (!b.context && b.category === (F.WORK_OUT || 'Work expenses')));
  const isWorkTask = (s, t) => (GU.parts && GU.parts.isWorkTask ? GU.parts.isWorkTask(s, t) : t.context === 'work');
  const isWorkDoc = (d) => !!d && d.context === 'work';
  const laneOf = (p) => (GU.workMoney ? GU.workMoney.lane(p, 'paperwork') : p.context === 'work' ? 'unsorted' : 'home');
  const billPayer = (b) => (GU.workMoney ? GU.workMoney.payerOf(b, 'bills') : 'me');
  const work = (tab) => ({ part: 'work', tab });

  const KINDS = {
    task: { label: 'Task', tab: 'todos' },
    bill: { label: 'Bill', tab: 'bills' },
    invoice: { label: 'Invoice', tab: 'receipts' },
    owed: { label: 'Owed to you', tab: 'receipts' },
    income: { label: 'Income', tab: 'incomings' },
    visa: { label: 'Visa', tab: 'visas' },
    document: { label: 'Document', tab: 'documents' },
    warranty: { label: 'Warranty', tab: 'receipts' },
    return: { label: 'Return', tab: 'receipts' },
    debt: { label: 'Debt', tab: 'debts' },
    project: { label: 'Work project', tab: 'work-projects' },
    // Something you've been asked to get, on the date it's needed (Work › To buy).
    request: { label: 'To get', tab: 'work-requests' },
    // A work invoice the business pays, and money it should pay you back. Named after your employer.
    ktk: { get label() { const c = employerShort(); return c ? c + ' to pay' : 'Company to pay'; }, tab: 'work-ktk' },
    reclaim: { get label() { return 'Back from ' + coLabel(); }, tab: 'work-back' },
    item: { label: 'Reminder', tab: null },
  };

  /* Everything dated up to `to`, plus anything overdue. part: only 'home' or only 'work' items. */
  function timeline(state, days, part) {
    const t = today();
    const to = addDays(t, days);
    const items = [];
    const push = (o) => items.push(Object.assign({ overdue: o.date < t, part: 'home' }, o));
    const co = coLabel(state);
    const Co = CoLabel(state);

    for (const task of state.tasks) {
      if (task.done || !task.due || task.due > to) continue;
      const list = state.todoLists.find((l) => l.id === task.listId);
      push(Object.assign({ kind: 'task', date: task.due, title: task.title, meta: list ? list.name : '',
        ref: { c: 'tasks', id: task.id }, action: 'done', priority: task.priority }, isWorkTask(state, task) ? work('work-tasks') : null));
    }
    for (const b of state.bills) {
      if (b.active === false || !b.nextDue) continue;
      // Work bills: who pays them comes first.
      const w = isWorkBill(b) ? work('work-bills') : null;
      const who = w ? (billPayer(b) === 'company' ? Co + ' pays' : 'You pay, ' + co + ' pays you back') + ' · ' : '';
      if (b.nextDue < t) {
        push(Object.assign({ kind: 'bill', date: b.nextDue, title: b.name, meta: who + 'Pay manually' + (b.payee ? ' · ' + b.payee : ''), amount: -b.amount, ref: { c: 'bills', id: b.id }, action: 'paid' }, w));
        continue;
      }
      for (const d of F.occurrences(b.nextDue, b.frequency, b.anchorDay, t, to)) {
        const first = d === b.nextDue;
        push(Object.assign({ kind: 'bill', date: d, title: b.name, meta: who + (b.autopay ? 'Leaves automatically by ' + (b.method || 'direct debit').toLowerCase() : 'Pay manually' + (b.payee ? ' · ' + b.payee : '')),
          amount: -b.amount, ref: { c: 'bills', id: b.id }, action: !b.autopay && first ? 'paid' : null }, w));
      }
    }
    for (const p of state.paperwork) {
      const lane = laneOf(p);
      const ref = { c: 'paperwork', id: p.id };
      if (p.kind === 'invoice-in' && p.status !== 'paid' && p.dueDate && p.dueDate <= to) {
        if (lane === 'ktk' || lane === 'unsorted') {
          // The business's own bill to pay: no amount (it's not your money) and a 'Paid by …' button.
          push(Object.assign({ kind: 'ktk', date: p.dueDate, title: p.title, meta: [lane === 'unsorted' ? 'Who paid? Not sorted yet' : Co + ' pays', p.party, p.reference].filter(Boolean).join(' · '),
            ref, action: 'ktkpaid' }, work('work-ktk')));
        } else {
          push(Object.assign({ kind: 'invoice', date: p.dueDate, title: p.title, meta: [lane === 'back' ? 'Pay it, then ' + co + ' pays you back' : '', p.party, p.reference].filter(Boolean).join(' · '),
            amount: -p.amount, ref, action: 'paid' }, lane === 'back' ? work('work-back') : null));
        }
      }
      // Invoices you've sent for your own side work. An old work one (claiming expenses back) is in Get paid back instead.
      if (p.kind === 'invoice-out' && p.status !== 'paid' && p.dueDate && p.dueDate <= to && p.context !== 'work') {
        push({ kind: 'owed', date: p.dueDate, title: (p.party || p.title) + (p.dueDate < t ? ' is late paying you' : ' should pay you'),
          meta: [p.title, p.reference].filter(Boolean).join(' · '), amount: F.outstanding(p), ref, action: 'paid' });
      }
      if (p.warrantyUntil && p.warrantyUntil >= t && p.warrantyUntil <= to) {
        push(Object.assign({ kind: 'warranty', date: p.warrantyUntil, title: 'Warranty ends: ' + p.title, meta: 'Make any claims before this date', ref },
          lane === 'home' ? null : work(lane === 'back' ? 'work-back' : 'work-ktk')));
      }
      // The last day to take something back: it stays for a few days after, for you to say what happened.
      if (p.returnBy && !p.returned && p.returnBy <= to && p.returnBy >= addDays(t, GU.returns ? -GU.returns.NAG_PAST : -7)) {
        push(Object.assign({ kind: 'return', date: p.returnBy, title: 'Last day to return ' + (p.title || p.party || 'this'), meta: [p.party, p.amount != null && p.amount !== '' ? money(Math.abs(p.amount)) : ''].filter(Boolean).join(' · '), ref, action: 'return' },
          lane === 'home' ? null : work(lane === 'back' ? 'work-back' : 'work-ktk')));
      }
    }
    for (const s of state.incomeSources) {
      if (!s.nextDate) continue;
      for (const d of F.occurrences(s.nextDate, s.frequency, s.anchorDay, t, to)) {
        push({ kind: 'income', date: d, title: s.name + ' expected', meta: s.from || 'Regular income', amount: s.amount, ref: { c: 'incomeSources', id: s.id } });
      }
    }
    for (const v of state.visas) {
      const name = v.visaType + (v.country ? ', ' + v.country : '');
      const closed = ['Refused', 'Withdrawn'].includes(v.status);
      if (closed) continue;
      if (v.appointmentDate && v.appointmentDate >= t && v.appointmentDate <= to)
        push({ kind: 'visa', date: v.appointmentDate, title: (v.appointmentLabel || 'Appointment') + ' for ' + name, meta: [v.appointmentTime, v.appointmentPlace].filter(Boolean).join(' · ') || v.applicant, ref: { c: 'visas', id: v.id } });
      if (v.decisionExpected && v.status === 'Awaiting decision' && v.decisionExpected <= to)
        push({ kind: 'visa', date: v.decisionExpected, title: 'Decision expected: ' + name, meta: v.applicant || '', ref: { c: 'visas', id: v.id } });
      if (v.status === 'Approved' && v.validUntil && v.validUntil >= t && v.validUntil <= to)
        push({ kind: 'visa', date: v.validUntil, title: name + ' expires', meta: v.applicant || '', ref: { c: 'visas', id: v.id } });
    }
    for (const it of state.sectionItems || []) {
      if (!it.dueDate || it.dueDate > to) continue;
      const sec = (state.sections || []).find((x) => x.id === it.sectionId);
      push({ kind: 'item', date: it.dueDate, title: it.title, meta: sec ? sec.name : '', ref: { c: 'sectionItems', id: it.id }, tab: sec ? 's-' + sec.id : null, part: sec && sec.part === 'work' ? 'work' : 'home' });
    }
    if (GU.debts) {
      for (const p of GU.debts.upcoming(state, to)) {
        push({ kind: 'debt', date: p.date, title: 'Payment to ' + p.debt.name, meta: p.debt.paymentDay ? 'Monthly payment' : 'Expected, going by your past payments', amount: p.amount ? -p.amount : null, ref: { c: 'debts', id: p.debt.id } });
      }
    }
    if (GU.work && GU.work.dates) for (const p of GU.work.dates(state, to)) push(Object.assign({ kind: 'project' }, p, { part: 'work' }));
    if (GU.requests && GU.requests.dates) for (const p of GU.requests.dates(state, to)) push(Object.assign({ kind: 'request' }, p, { part: 'work' }));
    for (const d of state.documents) {
      if (d.expiryDate && d.expiryDate >= t && d.expiryDate <= to)
        push(Object.assign({ kind: 'document', date: d.expiryDate, title: d.title + ' expires', meta: d.holder || d.type, ref: { c: 'documents', id: d.id } }, isWorkDoc(d) ? work('work-docs') : null));
    }
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.kind === 'task') - (b.kind === 'task')));
    return part ? items.filter((i) => i.part === part) : items;
  }

  /* Things that need attention but don't belong on a calendar day. Home only: work has its own checks
     (GU.work.checks) on Work › Overview. */
  function attention(state) {
    const t = today();
    const out = [];
    for (const d of state.documents) {
      if (!d.expiryDate || isWorkDoc(d)) continue;
      const n = daysUntil(d.expiryDate);
      if (n < 0) out.push({ level: 'crit', tab: 'documents', title: d.title + ' has expired', detail: 'Expired ' + fmtDate(d.expiryDate) + (d.holder ? ' · ' + d.holder : ''), ref: { c: 'documents', id: d.id } });
      else if (n <= (state.settings.docWarnDays || 90)) out.push({ level: n <= 30 ? 'crit' : 'warn', tab: 'documents', title: d.title + ' expires ' + relDays(d.expiryDate), detail: fmtDate(d.expiryDate) + ' · start the renewal early', ref: { c: 'documents', id: d.id } });
    }
    for (const v of state.visas) {
      const name = v.visaType + (v.country ? ', ' + v.country : '');
      if (v.status === 'Approved' && v.validUntil) {
        const n = daysUntil(v.validUntil);
        if (n < 0) continue;
        if (n <= (state.settings.visaWarnDays || 120)) out.push({ level: n <= 45 ? 'crit' : 'warn', tab: 'visas', title: name + ' ends ' + relDays(v.validUntil), detail: 'Valid until ' + fmtDate(v.validUntil) + '. Check when you can apply to extend or switch.', ref: { c: 'visas', id: v.id } });
      }
      if (['Planning', 'Preparing documents'].includes(v.status) && v.checklist && v.checklist.length) {
        const left = v.checklist.filter((c) => !c.done).length;
        if (left) out.push({ level: 'info', tab: 'visas', title: plural(left, 'document') + ' still to gather', detail: name, ref: { c: 'visas', id: v.id } });
      }
    }
    if (GU.money) {
      for (const x of GU.money.accounts(state)) {
        const b = x.info;
        if (!b) continue;
        const name = x.account.name;
        const when = b.staleDays > 3 ? ' on ' + fmtDate(b.asOf, { short: true }) : '';
        const go = { account: x.account.id };
        if (b.balance < 0 && b.overdraftLimit && -b.balance >= b.overdraftLimit * 0.9) out.push(Object.assign({ level: 'crit', tab: 'transactions', title: name + (b.staleDays > 3 ? ' was ' : ' is ') + 'near its overdraft limit', detail: money(-b.balance) + ' of ' + money(b.overdraftLimit, { whole: true }) + ' used' + when }, go));
        else if (b.balance < 0) out.push(Object.assign({ level: 'warn', tab: 'transactions', title: name + (b.staleDays > 3 ? ' was' : ' is') + ' overdrawn by ' + money(-b.balance), detail: (b.overdraftLimit ? money(b.available) + ' of overdraft left' : 'Overdraft fees may apply') + when }, go));
        if (b.staleDays >= 14 && x.count) out.push(Object.assign({ level: 'info', tab: 'transactions', title: 'Import your latest ' + (x.account.bank || name) + ' statement', detail: 'I only know your balance up to ' + fmtDate(b.asOf, { short: true }) }, go));
      }
    }
    // Statements that stopped coming, or a month missing from the middle (GU.gaps leaves out what the line above already says).
    if (GU.gaps) for (const g of GU.gaps.attention(state)) out.push(g);
    if (GU.debts) {
      for (const d of state.debts || []) {
        if (d.closed) continue;
        const sm = GU.debts.summary(state, d);
        if (sm.months === Infinity) out.push({ level: 'warn', tab: 'debts', title: d.name + ': payments don’t cover the interest', detail: 'At ' + money(sm.payment) + ' a month the balance won’t go down', ref: { c: 'debts', id: d.id } });
        else if (!sm.balanceKnown) out.push({ level: 'info', tab: 'debts', title: 'Add the balance for ' + d.name, detail: 'So I can work out when it’ll be paid off', ref: { c: 'debts', id: d.id } });
      }
      for (const x of GU.debts.spotted(state).slice(0, 2)) out.push({ level: 'info', tab: 'debts', title: plural(x.count, 'payment') + ' to ' + x.lender + ' look like a debt', detail: 'Track it to see what’s left to pay' });
    }
    if (GU.money) for (const f of GU.money.accountFixes(state)) out.push({ level: 'warn', tab: 'transactions', title: f.title, detail: f.kind === 'merge' ? 'Some payments are counted twice. Fix it on the Bank tab.' : 'Fix it in one tap on the Bank tab.' });
    const toCheck = state.bills.filter((b) => b.review && b.active !== false && !isWorkBill(b)).length;
    if (toCheck) out.push({ level: 'info', tab: 'bills', title: plural(toCheck, 'bill') + ' I found in your statements', detail: 'Check they’re right: keep them, or tell me which aren’t regular bills' });
    const uncategorised = state.transactions.filter((x) => !x.category).length;
    if (uncategorised) out.push({ level: 'info', tab: 'transactions', title: plural(uncategorised, 'transaction') + ' need a category', detail: 'Sorting them keeps your spending totals right', go: 'uncategorised' });
    const month = t.slice(0, 7);
    const spent = F.byCategory(F.inMonth(state.transactions, month), 'out');
    for (const row of spent) {
      const b = state.settings.budgets[row.category];
      if (b && row.total > b) out.push({ level: 'warn', tab: 'outgoings', title: row.category + ' is ' + money(row.total - b) + ' over budget', detail: money(row.total) + ' spent of ' + money(b) + ' this month' });
    }
    const rank = { crit: 0, warn: 1, info: 2 };
    for (const a of out) a.part = 'home';
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  /* Things you're waiting on someone else for, including what your employer owes you for things you've sent. */
  function waiting(state) {
    const t = today();
    const out = [];
    for (const v of state.visas) {
      if (['Submitted', 'Biometrics / interview', 'Awaiting decision'].includes(v.status))
        out.push({ tab: 'visas', title: (v.applicant ? v.applicant + ': ' : '') + v.visaType + ' decision', detail: (v.decisionExpected ? 'Expected ' + fmtDate(v.decisionExpected, { short: true }) : 'No date yet') + (v.submittedDate ? ' · submitted ' + fmtDate(v.submittedDate, { short: true }) : ''), ref: { c: 'visas', id: v.id }, part: 'home' });
    }
    for (const p of state.paperwork) {
      if (p.kind === 'invoice-out' && p.context !== 'work' && p.status !== 'paid' && (F.outstanding(p) > 0 || p.amount == null))
        out.push({ tab: 'receipts', title: (p.party || p.title) + ' owes you' + (p.amount != null ? ' ' + money(F.outstanding(p)) : ''), detail: p.dueDate ? (p.dueDate < t ? daysUntil(p.dueDate) * -1 + ' days late' : 'Due ' + fmtDate(p.dueDate, { short: true })) : 'No due date', ref: { c: 'paperwork', id: p.id }, late: p.dueDate && p.dueDate < t, part: 'home' });
    }
    // One line for everything sent to your employer and not paid back yet: it's your money, so it shows on Home.
    const W = GU.workMoney;
    if (W) {
      const d = W.dueBack(state);
      const e = W.employer(state);
      const pk = d.packs.filter((x) => x.left > 0);
      if (d.sentTotal > 0 && pk.length) {
        const first = pk[0];
        const last = pk[pk.length - 1];
        const when = !first.date ? 'Sent' : 'Sent ' + fmtDate(first.date, { short: true }) +
          (last.date && last.date !== first.date ? (pk.length > 2 ? ' to ' : ' and ') + fmtDate(last.date, { short: true }) : '');
        const ago = first.date ? first.days + (first.days === 1 ? ' day' : ' days') + ' ago' : '';
        const late = pk.some((x) => x.late);
        out.push({ tab: 'work-back', title: e.Label + ' owes you ' + money(d.sentTotal), detail: when + (pk.some((x) => x.chase) ? ' · ' + ago + ', time to remind ' + e.label : late ? ' · ' + ago + ', longer than usual' : ''), late, part: 'home' });
      }
    }
    return out;
  }

  /* Which Work page each area of the work checks belongs to. */
  const WORK_TABS = { tasks: 'work-tasks', invoices: 'work-ktk', back: 'work-back', projects: 'work-projects', bills: 'work-bills', contracts: 'work-docs', costs: 'work-costs', requests: 'work-requests' };

  /* Red/amber counts shown on each tab in the rail. Home pages count Home things only; Work pages count the
     work checks. __home and __work are the totals for each half of the Home | Work switch. */
  function badges(state) {
    const t = today();
    const counts = {};
    let home = 0;
    let workN = 0;
    const bump = (tab) => (counts[tab] = (counts[tab] || 0) + 1);
    const mine = timeline(state, 0, 'home');
    for (const it of mine) {
      if (it.kind === 'income' || it.kind === 'warranty' || it.kind === 'debt') continue;
      if (it.kind === 'bill' && !it.action) continue;
      bump(it.tab || KINDS[it.kind].tab);
      home++;
    }
    for (const a of attention(state)) if (a.level !== 'info') {
      bump(a.tab);
      home++;
    }
    counts.today = mine.filter((i) => i.date <= t && i.kind !== 'income' && i.kind !== 'debt' && !(i.kind === 'bill' && !i.action)).length;
    counts.inbox = (state.inbox || []).filter((i) => i.status !== 'reading').length;

    // Work: the checks on Work › Overview that are late or need doing, on the page they belong to.
    let checks = null;
    try {
      checks = GU.work && GU.work.checks ? GU.work.checks(state) : null;
    } catch (e) {
      checks = null;
    }
    const W = GU.workMoney;
    const backBadge = W && W.badge ? W.badge(state) : null;
    if (checks) {
      counts.work = checks.filter((c) => c.level === 'crit').length;
      for (const c of checks) {
        if (c.level !== 'crit' && c.level !== 'warn') continue;
        const tab = WORK_TABS[c.area];
        // Get paid back has its own count (see workMoney.badge) when it's there.
        if (tab === 'work-back' && backBadge != null) continue;
        if (tab) bump(tab);
        workN++;
      }
      // Sections marked Work aren't in the checks: their own reminders that are due.
      for (const it of timeline(state, 0, 'work')) {
        if (it.kind !== 'item' || !it.tab) continue;
        bump(it.tab);
        workN++;
      }
    } else {
      // No checks to go on: late or due work things from the timeline.
      const late = timeline(state, 0, 'work').filter((it) => it.date <= t && it.kind !== 'warranty' && !(it.kind === 'bill' && !it.action));
      for (const it of late) {
        bump(it.tab || KINDS[it.kind].tab);
        workN++;
      }
      counts.work = late.filter((it) => it.overdue).length;
    }
    if (backBadge) {
      counts['work-back'] = backBadge;
      workN += backBadge;
    }
    counts.__home = home;
    counts.__work = workN;
    return counts;
  }

  GU.agenda = { KINDS, WORK_TABS, timeline, attention, waiting, badges };
})();
