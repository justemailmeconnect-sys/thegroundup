/* The Ground Up: the assistant's brain. Gathers everything with a date into one timeline,
   and works out what needs attention for the badges on each tab. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, daysUntil, fmtDate, money, relDays, plural } = GU.util;
  const F = GU.finance;

  const KINDS = {
    task: { label: 'Task', tab: 'todos' },
    bill: { label: 'Bill', tab: 'bills' },
    invoice: { label: 'Invoice', tab: 'receipts' },
    owed: { label: 'Owed to you', tab: 'receipts' },
    income: { label: 'Income', tab: 'incomings' },
    visa: { label: 'Visa', tab: 'visas' },
    document: { label: 'Document', tab: 'documents' },
    warranty: { label: 'Warranty', tab: 'receipts' },
    debt: { label: 'Debt', tab: 'debts' },
    project: { label: 'Work project', tab: 'work' },
    item: { label: 'Reminder', tab: null },
  };

  /* Everything dated up to `to`, plus anything overdue. */
  function timeline(state, days) {
    const t = today();
    const to = addDays(t, days);
    const items = [];
    const push = (o) => items.push(Object.assign({ overdue: o.date < t }, o));

    for (const task of state.tasks) {
      if (task.done || !task.due || task.due > to) continue;
      const list = state.todoLists.find((l) => l.id === task.listId);
      push({ kind: 'task', date: task.due, title: task.title, meta: list ? list.name : '',
        ref: { c: 'tasks', id: task.id }, action: 'done', priority: task.priority });
    }
    for (const b of state.bills) {
      if (b.active === false || !b.nextDue) continue;
      if (b.nextDue < t) {
        push({ kind: 'bill', date: b.nextDue, title: b.name, meta: 'Pay manually' + (b.payee ? ' · ' + b.payee : ''), amount: -b.amount, ref: { c: 'bills', id: b.id }, action: 'paid' });
        continue;
      }
      for (const d of F.occurrences(b.nextDue, b.frequency, b.anchorDay, t, to)) {
        const first = d === b.nextDue;
        push({ kind: 'bill', date: d, title: b.name, meta: b.autopay ? 'Leaves automatically by ' + (b.method || 'direct debit').toLowerCase() : 'Pay manually' + (b.payee ? ' · ' + b.payee : ''),
          amount: -b.amount, ref: { c: 'bills', id: b.id }, action: !b.autopay && first ? 'paid' : null });
      }
    }
    for (const p of state.paperwork) {
      if ((p.kind === 'invoice-in' || p.kind === 'invoice-out') && p.status !== 'paid' && p.dueDate && p.dueDate <= to) {
        const mine = p.kind === 'invoice-in';
        push({ kind: mine ? 'invoice' : 'owed', date: p.dueDate,
          title: mine ? p.title : (p.party || p.title) + (p.dueDate < t ? ' is late paying you' : ' should pay you'),
          meta: [p.context === 'work' ? 'Work' : 'Home', mine ? p.party : p.title, p.reference].filter(Boolean).join(' · '),
          amount: mine ? -p.amount : F.outstanding(p), ref: { c: 'paperwork', id: p.id }, action: 'paid' });
      }
      if (p.warrantyUntil && p.warrantyUntil >= t && p.warrantyUntil <= to) {
        push({ kind: 'warranty', date: p.warrantyUntil, title: 'Warranty ends: ' + p.title, meta: 'Make any claims before this date', ref: { c: 'paperwork', id: p.id } });
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
      push({ kind: 'item', date: it.dueDate, title: it.title, meta: sec ? sec.name : '', ref: { c: 'sectionItems', id: it.id }, tab: sec ? 's-' + sec.id : null });
    }
    if (GU.debts) {
      for (const p of GU.debts.upcoming(state, to)) {
        push({ kind: 'debt', date: p.date, title: 'Payment to ' + p.debt.name, meta: p.debt.paymentDay ? 'Monthly payment' : 'Expected, going by your past payments', amount: p.amount ? -p.amount : null, ref: { c: 'debts', id: p.debt.id } });
      }
    }
    if (GU.work) for (const p of GU.work.dates(state, to)) push(Object.assign({ kind: 'project' }, p));
    for (const d of state.documents) {
      if (d.expiryDate && d.expiryDate >= t && d.expiryDate <= to)
        push({ kind: 'document', date: d.expiryDate, title: d.title + ' expires', meta: d.holder || d.type, ref: { c: 'documents', id: d.id } });
    }
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.kind === 'task') - (b.kind === 'task')));
    return items;
  }

  /* Things that need attention but don't belong on a calendar day. */
  function attention(state) {
    const t = today();
    const out = [];
    for (const d of state.documents) {
      if (!d.expiryDate) continue;
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
    const toCheck = state.bills.filter((b) => b.review && b.active !== false).length;
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
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  /* Things you're waiting on someone else for. */
  function waiting(state) {
    const t = today();
    const out = [];
    for (const v of state.visas) {
      if (['Submitted', 'Biometrics / interview', 'Awaiting decision'].includes(v.status))
        out.push({ tab: 'visas', title: (v.applicant ? v.applicant + ': ' : '') + v.visaType + ' decision', detail: (v.decisionExpected ? 'Expected ' + fmtDate(v.decisionExpected, { short: true }) : 'No date yet') + (v.submittedDate ? ' · submitted ' + fmtDate(v.submittedDate, { short: true }) : ''), ref: { c: 'visas', id: v.id } });
    }
    for (const p of state.paperwork) {
      if (p.kind === 'invoice-out' && p.status !== 'paid' && (F.outstanding(p) > 0 || p.amount == null))
        out.push({ tab: 'receipts', title: (p.party || p.title) + ' owes you' + (p.amount != null ? ' ' + money(F.outstanding(p)) : ''), detail: p.dueDate ? (p.dueDate < t ? daysUntil(p.dueDate) * -1 + ' days late' : 'Due ' + fmtDate(p.dueDate, { short: true })) : 'No due date', ref: { c: 'paperwork', id: p.id }, late: p.dueDate && p.dueDate < t });
    }
    return out;
  }

  /* Red/amber counts shown on each tab in the rail. */
  function badges(state) {
    const t = today();
    const counts = {};
    const bump = (tab) => (counts[tab] = (counts[tab] || 0) + 1);
    for (const it of timeline(state, 0)) {
      if (it.kind === 'income' || it.kind === 'warranty' || it.kind === 'debt') continue;
      if (it.kind === 'bill' && !it.action) continue;
      bump(it.tab || KINDS[it.kind].tab);
    }
    counts.inbox = (state.inbox || []).filter((i) => i.status !== 'reading').length;
    // Work: anything at work that's late or overdue.
    counts.work = GU.work ? GU.work.checks(state).filter((c) => c.level === 'crit').length : 0;
    for (const a of attention(state)) if (a.level !== 'info') bump(a.tab);
    counts.today = timeline(state, 0).filter((i) => i.date <= t && i.kind !== 'income' && i.kind !== 'debt' && !(i.kind === 'bill' && !i.action)).length;
    return counts;
  }

  GU.agenda = { KINDS, timeline, attention, waiting, badges };
})();
