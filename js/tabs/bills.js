/* The Ground Up: Bills. Regular payments with their next due date. Direct debits and standing
   orders move on by themselves; bills you pay by hand wait for you to mark them paid.
   This page lists your own (Home) bills. Work bills are in Work › Bills, which uses the same form and
   'Paid' here: a work bill says who pays, you (and the business pays you back) or the business itself. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, relDays, daysUntil, plural, sum } = GU.util;
  const { icon, pill, emptyState, formDialog, toast, menu } = GU.ui;
  const F = GU.finance;
  const store = GU.store;
  /* Where a page is in the menu, for toasts and signposts: 'Work › Orders & claims › Get paid back'. */
  const at = (tab, fallback) => (GU.parts && GU.parts.pathOf && GU.tabs && GU.tabs[tab] ? GU.parts.pathOf(tab) : fallback);

  const METHODS = ['Direct debit', 'Standing order', 'Card (automatic)', 'Pay manually'];
  const isAuto = (m) => m !== 'Pay manually';
  let showStopped = false;
  let showWhere = false;

  /* ---------- home or work ---------- */
  const WORK_OUT = F.WORK_OUT || 'Work expenses';
  const WORK = F.WORK || [WORK_OUT, 'Work reimbursements'];
  const wm = () => GU.workMoney || null;
  const parts = () => GU.parts || null;
  const co = (cap) => (parts() ? parts().co(store.state, cap) : cap ? 'The company' : 'the company');
  const isWorkBill = (b) => (parts() && parts().isWorkBill ? parts().isWorkBill(b) : !!b && (b.context === 'work' || (!b.context && b.category === WORK_OUT)));
  /* Who pays a work bill: 'me' (it leaves your account, the business pays you back) or 'company'. */
  const payerOf = (b) => (wm() ? wm().payerOf(b, 'bills') : b.payer || (b.foundKey || (b.history || []).length ? 'me' : 'company'));
  const companyPays = (b) => isWorkBill(b) && payerOf(b) === 'company';
  const workBillsTab = () => (GU.tabs && GU.tabs['work-bills'] ? 'work-bills' : 'work');
  /* 'Added to Work › Bills', with Open unless you're on that page. */
  function partToast(msg, tab) {
    toast(msg, location.hash === '#' + tab ? {} : { action: 'Open', onAction: () => GU.view.go(tab) });
  }

  function status(b) {
    if (b.active === false) return pill(b.endedAs === 'once' ? 'One-off' : 'Stopped', 'muted');
    const n = daysUntil(b.nextDue);
    if (!b.autopay && n < 0) return pill('Overdue', 'crit', 'alert');
    if (n === 0) return pill(b.autopay ? 'Leaves today' : 'Due today', b.autopay ? 'info' : 'warn', 'clock');
    if (n <= 7) return pill('Due ' + relDays(b.nextDue), b.autopay ? 'info' : 'warn', 'clock');
    return b.autopay ? pill('Automatic', 'muted', 'repeat') : pill('Pay by hand', 'muted');
  }

  function rowHTML(b) {
    const canPay = b.active !== false && !b.autopay;
    return '<li class="row-item" data-id="' + esc(b.id) + '">' +
      '<button type="button" class="row-item__main" data-edit="' + esc(b.id) + '">' +
      '<span class="row-item__icon">' + icon(b.autopay ? 'repeat' : 'bills') + '</span>' +
      '<span class="row-item__text"><b>' + esc(b.name) + '</b><em>' + esc([b.payee, F.freqLabel(b.frequency), b.method, (b.files || []).length ? plural(b.files.length, 'file') : ''].filter(Boolean).join(' · ')) + '</em></span></button>' +
      '<span class="row-item__date">' + (b.active === false ? '' : '<b>' + esc(fmtDate(b.nextDue, { weekday: true })) + '</b><em>' + esc(relDays(b.nextDue)) + '</em>') + '</span>' +
      '<span class="row-item__status">' + status(b) + '</span>' +
      '<span class="row-item__amt">' + esc(money(b.amount)) + '</span>' +
      '<span class="row-item__act">' + GU.ui.dlButton(b.files, b.name) + (canPay ? '<button type="button" class="btn btn--sm btn--soft" data-pay="' + esc(b.id) + '">' + icon('check') + esc(companyPays(b) ? co(true) + ' paid' : 'Paid') + '</button>' : '') + '</span></li>';
  }

  /* Bills found in your statements, waiting for you to say whether they're right. */
  function reviewHTML(list) {
    if (!list.length) return '';
    return '<section class="panel panel--spotted"><header class="panel__head"><h2>' + icon('search') + 'Found in your bank statements</h2>' +
      '<button type="button" class="btn btn--sm btn--primary" data-keep-all>' + icon('check') + 'Keep all ' + list.length + '</button></header>' +
      '<p class="panel__intro">I added these because you pay them regularly. Keep the ones that are right, and tell me about any that aren’t a regular bill, were a one-off or you’ve cancelled.</p>' +
      '<ul class="rows">' + list.map((b) => {
        const h = b.history || [];
        const lo = Math.min(...h.map((x) => x.amount));
        const hi = Math.max(...h.map((x) => x.amount));
        const meta = [F.freqLabel(b.frequency), h.length ? plural(h.length, 'payment') + ' since ' + fmtDate(h[0].date, { short: true }) : '', hi - lo > 0.5 ? 'varies ' + money(lo) + ' to ' + money(hi) : '', 'next ' + fmtDate(b.nextDue, { short: true })].filter(Boolean).join(' · ');
        return '<li class="spot"><span class="row-item__icon">' + icon(b.autopay ? 'repeat' : 'bills') + '</span>' +
          '<button type="button" class="spot__text spot__btn" data-edit="' + esc(b.id) + '"><b>' + esc(b.name) + ' <span class="spot__amt">' + esc(money(b.amount)) + '</span></b><em>' + esc(meta) + '</em></button>' +
          '<span class="spot__act"><button type="button" class="btn btn--sm btn--soft" data-keep="' + esc(b.id) + '">' + icon('check') + 'Keep</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-notbill="' + esc(b.id) + '">Not a bill</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" data-more="' + esc(b.id) + '" aria-label="More for ' + esc(b.name) + '">' + icon('more') + '</button></span></li>';
      }).join('') + '</ul></section>';
  }

  /* Klarna, PayPal, Amazon and other instalment plans, each with the stage it's at ("Payment 2 of 3"). */
  function instalmentsHTML(plans) {
    if (!plans.length) return '';
    const lenders = Array.from(new Set(plans.map((p) => p.lender)));
    const steps = (p) => {
      // Paid so far, then what's actually left (a refund can cut a plan short of its original count).
      const total = p.stage ? p.stage - 1 + p.left : 0;
      if (!total || total > 24) return '';
      let h = '<span class="inst__steps" aria-hidden="true">';
      for (let i = 1; i <= total; i++) h += '<i class="' + (i < p.stage ? 'is-paid' : i === p.stage ? 'is-next' : '') + '"></i>';
      return h + '</span>';
    };
    const acctName = (p) => (p.account && (store.state.accounts.find((a) => a.id === p.account) || {}).name) || '';
    /* A row doesn't repeat what its lender's heading says ('from Santander') or what its stage already says ('Pay in 3', 'Payment 2 of 3'). */
    const row = (p, sameAcct) => {
      const n = daysUntil(p.next.date);
      const stage = p.stage ? 'Payment ' + p.stage + ' of ' + p.of : plural(p.left, 'payment') + ' left';
      const acct = sameAcct ? '' : acctName(p);
      const rest = p.left > 1 ? plural(p.left, 'payment') + ' left, ' + money(p.leftTotal) + ' in all, last on ' + fmtDate(p.last, { short: true }) : 'Last payment';
      const about = [p.stage ? '' : p.of === 3 ? 'Pay in 3' : p.of ? p.of + ' payments' : '', acct ? 'from ' + acct : ''].filter(Boolean).join(' · ');
      return '<li class="inst"><button type="button" class="inst__main" data-open-debt="' + esc(p.debt.id) + '">' +
        '<span class="row-item__icon">' + icon('card') + '</span>' +
        '<span class="inst__text"><b>' + esc(p.merchant) + '</b>' + (about ? '<em>' + esc(about) + '</em>' : '') + steps(p) + '</span>' +
        '<span class="inst__stage">' + pill(stage, p.stage && p.stage === p.of ? 'good' : 'info') + '<em>' + esc(rest) + '</em></span>' +
        '<span class="row-item__date"><b>' + esc(fmtDate(p.next.date, { weekday: true })) + '</b><em>' + esc(relDays(p.next.date)) + '</em></span>' +
        '<span class="row-item__amt' + (n <= 3 ? ' is-soon' : '') + '">' + esc(money(p.next.amount)) + '</span></button></li>';
    };
    return '<section class="panel inst-panel"><header class="panel__head"><h2>' + icon('card') + 'Instalments</h2><span class="muted">' + esc(plural(plans.length, 'plan') + ' · ' + money(sum(plans, (p) => p.leftTotal)) + ' left to pay') + '</span></header>' +
      lenders.map((l) => {
        const list = plans.filter((p) => p.lender === l);
        const accts = Array.from(new Set(list.map(acctName)));
        const sameAcct = accts.length === 1 && accts[0] ? accts[0] : '';
        return '<div class="inst-group"><h3 class="inst-group__head"><span>' + esc(l) + '</span><em>' + esc(plural(list.length, 'plan') + (sameAcct ? ' · from ' + sameAcct : '') + ' · ' + money(sum(list, (p) => p.leftTotal)) + ' left') + '</em></h3><ul class="rows">' + list.map((p) => row(p, !!sameAcct)).join('') + '</ul></div>';
      }).join('') +
      '<p class="panel__foot muted inst-note">From your payment schedules on the Debts page. They’re already in Money ahead on Home, so nothing is counted twice.</p></section>';
  }

  /* One line pointing to Work › Bills, so work bills don't look lost. */
  function signpostHTML(work) {
    if (!work.length) return '';
    const names = work.map((b) => b.name).filter(Boolean);
    const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '');
    return '<p class="note-line note-line--signpost">' + icon('briefcase') + '<span>' + esc(plural(work.length, 'work bill') + (shown ? ' (' + shown + ')' : '') + (work.length === 1 ? ' is' : ' are') + ' in ') +
      '<a class="link" href="#' + workBillsTab() + '">' + esc(at('work-bills', 'Work › Regular costs')) + '</a>.</span></p>';
  }

  function render(root) {
    const s = store.state;
    const t = today();
    const home = s.bills.filter((b) => !isWorkBill(b));
    const work = s.bills.filter((b) => isWorkBill(b) && b.active !== false);
    const review = home.filter((b) => b.review && b.active !== false);
    const active = home.filter((b) => b.active !== false).sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1));
    const stopped = home.filter((b) => b.active === false);
    const monthly = sum(active, (b) => F.monthlyEquivalent(b.amount, b.frequency));
    const week = active.filter((b) => daysUntil(b.nextDue) >= 0 && daysUntil(b.nextDue) <= 7);
    const overdue = active.filter((b) => !b.autopay && b.nextDue < t);
    const groups = [
      { title: 'Overdue', items: overdue },
      { title: 'Next 30 days', items: active.filter((b) => !overdue.includes(b) && daysUntil(b.nextDue) <= 30) },
      { title: 'Later', items: active.filter((b) => !overdue.includes(b) && daysUntil(b.nextDue) > 30) },
    ].filter((g) => g.items.length);

    const byCat = new Map();
    for (const b of active) {
      const c = b.category || 'Other spending';
      byCat.set(c, (byCat.get(c) || 0) + F.monthlyEquivalent(b.amount, b.frequency));
    }
    const catItems = Array.from(byCat, ([label, value]) => ({ label, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value);
    const plans = GU.debts.instalments(s);
    const instSoon = plans.flatMap((p) => p.items).filter((i) => daysUntil(i.date) >= 0 && daysUntil(i.date) <= 30);

    root.innerHTML = GU.view.head({
      eyebrow: 'Money ahead',
      title: 'Bills',
      text: 'Your regular payments' + (plans.length ? ', plus your instalment plans (Klarna, PayPal, Amazon and the like) with the stage each one is at.' : '.'),
      actions: (s.transactions.some((x) => !x.demo) ? '<button type="button" class="btn" data-scan>' + icon('search') + 'Find bills in my statements</button>' : '') +
        '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add bill</button>',
    }) +
      signpostHTML(work) +
      GU.ui.dropbar('Drop bills and contracts here, or a whole folder', 'Each new company becomes a bill. Letters from a company you already have are added to its bill, not duplicated.') +
      reviewHTML(review) +
      '<div class="ledger">' +
      '<div><span>Bills per month</span><b>' + esc(money(monthly)) + '</b><em>' + esc(money(monthly * 12, { whole: true }) + ' a year · ' + plural(active.length, 'active bill')) + '</em></div>' +
      '<div><span>Due in the next 7 days</span><b>' + esc(money(sum(week, (b) => b.amount))) + '</b><em>' + esc(plural(week.length, 'bill') + (overdue.length ? '' : ' · none overdue')) + '</em></div>' +
      (overdue.length ? '<div><span>Overdue</span><b class="is-crit">' + overdue.length + '</b><em>' + esc(money(sum(overdue, (b) => b.amount))) + ' to pay</em></div>' : '') +
      (plans.length ? '<div><span>Instalments, next 30 days</span><b>' + esc(money(sum(instSoon, (i) => i.amount))) + '</b><em>' + esc(plural(instSoon.length, 'payment')) + '</em></div>' : '') +
      '</div>' +
      '<div class="stack">' +
      (groups.length ? groups.map((g) => '<section class="panel"><header class="panel__head"><h2>' + esc(g.title) + '</h2>' + (g.title === 'Overdue' ? '' : '<span class="muted">' + esc(money(sum(g.items, (b) => b.amount))) + '</span>') + '</header><ul class="rows">' + g.items.map(rowHTML).join('') + '</ul></section>').join('')
        : '<section class="panel">' + emptyState({ icon: 'bills', title: 'No bills yet', text: 'Add your rent, energy, phone, subscriptions and anything else you pay regularly.', action: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add your first bill</button>' }) + '</section>') +
      instalmentsHTML(plans) +
      (stopped.length ? '<details class="panel panel--details" data-fold="stopped"' + (showStopped ? ' open' : '') + '><summary class="panel__head"><h2>Stopped bills</h2><span class="muted">' + stopped.length + '</span></summary><ul class="rows">' + stopped.map(rowHTML).join('') + '</ul></details>' : '') +
      (catItems.length ? '<details class="panel panel--details" data-fold="where"' + (showWhere ? ' open' : '') + '><summary class="panel__head"><h2>Where your bills go</h2><span class="muted">' + esc(plural(catItems.length, 'category', 'categories') + ', per month') + '</span></summary><div class="panel__body">' + GU.charts.barList(catItems, { color: '--series-out' }) + '</div></details>' : '') +
      '<p class="privacy-note bills-note">' + icon('info') + '<span>Direct debits and standing orders roll on by themselves. Bills you pay by hand wait on your Overview until you mark them paid. If you also import your bank statements, leave “add to transactions” unticked when you do, so it isn’t counted twice.</span></p>' +
      '</div>';

    GU.ui.wireDropbar(root, (files) => GU.inbox.add({ files, scope: { kind: 'bills', name: 'Bills' } }));
    root.querySelectorAll('details[data-fold]').forEach((d) => d.addEventListener('toggle', () => {
      if (d.dataset.fold === 'stopped') showStopped = d.open;
      else showWhere = d.open;
    }));
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) return create();
      if (e.target.closest('[data-scan]')) return GU.recurring.scan();
      if (e.target.closest('[data-keep-all]')) {
        const ids = review.map((b) => b.id);
        store.commit((st) => st.bills.forEach((b) => ids.includes(b.id) && (b.review = false)));
        toast('Kept ' + plural(ids.length, 'bill'), { action: 'Undo', onAction: () => store.commit((st) => st.bills.forEach((b) => ids.includes(b.id) && (b.review = true))) });
        return;
      }
      const keep = e.target.closest('[data-keep]');
      if (keep) return store.commit((st) => (st.bills.find((b) => b.id === keep.dataset.keep).review = false));
      const nb = e.target.closest('[data-notbill]');
      if (nb) return notABill(nb.dataset.notbill);
      const more = e.target.closest('[data-more]');
      if (more) {
        const id = more.dataset.more;
        return menu(more, [
          { icon: 'check', label: 'It was a one-off', hint: 'Keep it as a past payment, not a regular bill', onClick: () => endBill(id, 'once') },
          { icon: 'x', label: 'I’ve cancelled it', hint: 'Move it to stopped bills', onClick: () => endBill(id, 'cancelled') },
          { icon: 'edit', label: 'Change the details', hint: 'Name, amount, date or how often', onClick: () => edit(id) },
        ]);
      }
      const pay = e.target.closest('[data-pay]');
      if (pay) return markPaid(pay.dataset.pay);
      if (e.target.closest('[data-open-debt]')) return GU.view.go('debts');
      const ed = e.target.closest('[data-edit]');
      if (ed) edit(ed.dataset.edit);
    });
  }

  /* Not a regular bill: remove it and don't suggest it again. */
  function notABill(id) {
    const b = store.find('bills', id);
    if (!b) return;
    let entry = null;
    store.commit((st) => {
      st.bills = st.bills.filter((x) => x.id !== id);
      if (b.foundKey) st.settings.ignoredBills = (st.settings.ignoredBills || []).concat([b.foundKey]);
      entry = GU.trash.put(st, 'bills', b, b.name, b.foundKey ? { ignoredBill: b.foundKey } : null);
    });
    toast('Removed ' + b.name + '. I won’t suggest it again.', { timeout: 10000, action: 'Undo', onAction: () => GU.trash.restore(entry.id) });
  }
  /* A one-off or a cancelled bill: kept under stopped bills so it isn't suggested again. */
  function endBill(id, why) {
    const before = JSON.parse(JSON.stringify(store.find('bills', id)));
    store.commit((st) => {
      const b = st.bills.find((x) => x.id === id);
      Object.assign(b, { active: false, review: false, endedAs: why });
      if (why === 'once') b.frequency = 'once';
    });
    toast(before.name + (why === 'once' ? ' marked as a one-off' : ' moved to stopped bills'), { action: 'Undo', onAction: () => store.commit((st) => {
      st.bills = st.bills.map((x) => (x.id === id ? before : x));
    }) });
  }

  /* The fields. values: what the form opens with (a Home category list keeps an older bill's own category). */
  function fields(values) {
    values = values || {};
    const c = co();
    const e = wm() ? wm().employer(store.state) : { set: false };
    return [
      { name: 'name', label: 'What is it?', required: true, placeholder: 'e.g. Electricity, Netflix, Rent' },
      { name: 'payee', label: 'Paid to', placeholder: 'e.g. Octopus Energy', optional: true },
      { name: 'context', label: 'For', type: 'segmented', options: [{ value: 'home', label: 'Home', icon: 'home' }, { value: 'work', label: e.set ? 'Work (' + c + ')' : 'Work', icon: 'briefcase' }] },
      { name: 'payer', label: 'Who pays?', type: 'segmented', default: '', showIf: (v) => v.context === 'work',
        options: [{ value: 'me', label: 'Comes out of my account, ' + c + ' pays me back' }, { value: 'company', label: co(true) + ' pays it directly' }],
        help: 'When it comes out of your account, each payment joins Get paid back by itself.' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, half: true },
      { name: 'frequency', label: 'How often', type: 'select', options: F.FREQUENCIES, default: 'monthly', half: true },
      { name: 'nextDue', label: 'Next payment date', type: 'date', required: true, half: true },
      { name: 'method', label: 'How it’s paid', type: 'select', options: METHODS, default: 'Direct debit', half: true },
      { name: 'category', label: 'Category', type: 'select', options: F.EXPENSE.filter((x) => !WORK.includes(x) || x === values.category), default: 'Bills & utilities', half: true, showIf: (v) => v.context !== 'work' },
      { name: 'account', label: 'From account', type: 'select', options: store.state.accounts.map((a) => ({ value: a.id, label: a.name })), half: true, showIf: (v) => v.context !== 'work' || v.payer === 'me' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true, placeholder: 'Account number, contract end date, how to cancel…' },
      { name: 'files', label: 'Paperwork', type: 'files', dropLabel: 'Attach the contract or latest bill' },
      { name: 'active', label: 'Active', type: 'checkbox', checkLabel: 'I still pay this bill' },
    ];
  }

  /* A work bill has to say who pays: the form asks every time. */
  function needsPayer(v) {
    if (v.context !== 'work' || v.payer === 'me' || v.payer === 'company') return false;
    toast('Say who pays for it: you, or ' + co() + ' directly.');
    return true;
  }

  /* Saves the form. A work bill is in 'Work expenses' and says who pays; a Home bill has no payer. A work bill you
     pay yourself adds its payments since you set up work to Get paid back, in the same commit. */
  function save(v, existing) {
    const rec = Object.assign(existing ? Object.assign({}, existing) : { id: 'b-' + uid(), history: [], created: today() }, v, { review: false }, {
      autopay: isAuto(v.method),
      anchorDay: +String(v.nextDue).slice(8, 10),
      active: existing ? v.active : true,
    });
    if (rec.context === 'work') {
      rec.category = WORK_OUT;
      if (rec.payer !== 'me' && rec.payer !== 'company') delete rec.payer;
      if (rec.payer === 'company' && existing) rec.account = existing.account || ''; // not asked: kept for if it changes back
    } else {
      rec.context = 'home';
      delete rec.payer;
    }
    let claims = [];
    store.commit((s) => {
      const i = s.bills.findIndex((x) => x.id === rec.id);
      if (i >= 0) s.bills[i] = rec;
      else s.bills.push(rec);
      if (rec.context === 'work' && rec.payer === 'me' && wm()) {
        claims = wm().billClaims(s);
        linkClaims(s, claims, {});
      }
    });
    return { rec, claims };
  }
  const claimNote = (claims) => (claims.length ? '. ' + (claims.length === 1 ? '1 payment' : claims.length + ' payments') + ' added to Get paid back' : '');

  /* prefill: values to start with ({context: 'work'} for a work bill). opts.onSaved(rec): called after saving. */
  function create(prefill, opts) {
    opts = opts || {};
    prefill = prefill || {};
    const ctx = prefill.context || (isWorkBill(prefill) || (parts() && parts().get() === 'work') ? 'work' : 'home');
    const values = Object.assign({ nextDue: today(), frequency: 'monthly', method: 'Direct debit', category: 'Bills & utilities' }, prefill, { context: ctx });
    if (ctx === 'work' && WORK.includes(values.category)) values.category = 'Bills & utilities';
    formDialog({
      title: ctx === 'work' ? 'Add a work bill' : 'Add a bill',
      fields: fields(values).filter((f) => f.name !== 'active'),
      values,
      submitLabel: 'Add bill',
      onSubmit: (v) => {
        if (needsPayer(v)) return false;
        const { rec, claims } = save(v, null);
        if (rec.context === 'work') partToast('Added ' + rec.name + ' to ' + at('work-bills', 'Work › Regular costs') + claimNote(claims), workBillsTab());
        else toast('Added ' + rec.name);
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
  }

  function edit(id) {
    const b = store.find('bills', id);
    if (!b) return;
    const work = isWorkBill(b);
    const values = Object.assign({}, b, { active: b.active !== false, context: work ? 'work' : 'home', payer: work ? payerOf(b) : '' });
    // The category is only asked for Home bills: one moving back to Home starts from the usual one.
    if (work && WORK.includes(values.category)) values.category = 'Bills & utilities';
    formDialog({
      title: work ? 'Edit work bill' : 'Edit bill',
      fields: fields(values),
      values,
      onSubmit: (v) => {
        if (needsPayer(v)) return false;
        const { rec, claims } = save(v, b);
        if (rec.context === 'work' && !work) partToast('Moved ' + rec.name + ' to ' + at('work-bills', 'Work › Regular costs') + claimNote(claims), workBillsTab());
        else if (rec.context !== 'work' && work) partToast('Moved ' + rec.name + ' to ' + at('bills', 'Home › Bills'), 'bills');
        else if (claims.length) toast(claimNote(claims).slice(2));
      },
      onDelete: () => {
        store.remove('bills', id, b.name);
      },
      deleteMessage: 'This removes the bill and its payment history. Transactions already in your bank list are kept. You can undo it, and it stays in Settings → Recently deleted for 30 days.',
    });
  }

  /* Inside a commit: links new claims from a bill to your bank payments. own {txId, billId, date}: the payment
     just added by hand, for that bill's claim on that day; the rest only when the match is sure. was collects
     each linked line's old category, for Undo. */
  function linkClaims(s, created, was, own) {
    const W = wm();
    if (!W || !created.length) return;
    const taken = new Set();
    for (const p of created) {
      if (own && p.billId === own.billId && p.date === own.date) {
        p.purchaseTx = own.txId;
        p.purchaseWas = '';
        taken.add(own.txId);
        continue;
      }
      const r = W.purchaseFor(s, p, taken);
      if (!r.sure || !r.tx) continue;
      if (!(r.tx.id in was)) was[r.tx.id] = r.tx.category;
      p.purchaseTx = r.tx.id;
      p.purchaseWas = r.tx.category || '';
      r.tx.category = WORK_OUT;
      taken.add(r.tx.id);
    }
  }

  /* Moves a bill on to its next date. Call inside a commit. */
  function moveOn(bill) {
    const n = F.nextDate(bill.nextDue, bill.frequency, bill.anchorDay);
    if (n) bill.nextDue = n;
    else bill.active = false;
  }
  const nextNote = (id) => {
    const nb = store.find('bills', id);
    return nb && nb.active !== false ? '. Next due ' + fmtDate(nb.nextDue, { short: true }) : '';
  };

  /* Marks a bill paid. Home bills as always. A work bill the business pays just moves on to its next date:
     it isn't your money, so nothing is recorded. A work bill you pay is recorded, and its payment joins
     Get paid back in the same commit (one claim per payment, however often it's marked). */
  function markPaid(id) {
    const b = store.find('bills', id);
    if (!b) return;
    const work = isWorkBill(b);
    if (work && payerOf(b) === 'company') return companyPaid(id);
    const c = co();
    formDialog({
      title: 'Mark ' + b.name + ' as paid',
      intro: work ? esc('It came out of your account, so it’s added to Get paid back for ' + c + ' to pay you back.') : undefined,
      fields: [
        { name: 'amount', label: 'Amount paid', type: 'money', required: true, half: true },
        { name: 'date', label: 'Date paid', type: 'date', required: true, half: true },
        { name: 'record', label: 'Also add', type: 'checkbox', checkLabel: 'Add this payment to my bank transactions', help: 'Only if it won’t be in a statement you import.' },
      ],
      values: { amount: b.amount, date: today(), record: false },
      submitLabel: 'Mark paid',
      onSubmit: (v) => {
        const before = JSON.parse(JSON.stringify(b));
        const W = wm();
        const was = {}; // bank lines linked as your payment, with their old category for Undo
        let txId = null;
        let created = [];
        store.commit((s) => {
          const bill = s.bills.find((x) => x.id === id);
          bill.history = (bill.history || []).concat([{ date: v.date, amount: v.amount }]).slice(-60);
          moveOn(bill);
          if (v.record) {
            txId = 't-' + uid();
            s.transactions.push({ id: txId, date: v.date, description: bill.payee || bill.name, amount: -Math.abs(v.amount), category: work ? WORK_OUT : bill.category || 'Bills & utilities', account: bill.account || (s.accounts[0] || {}).id, notes: 'Bill: ' + bill.name, source: 'bill', created: today() });
          }
          if (!work || !W) return;
          created = W.billClaims(s);
          linkClaims(s, created, was, txId && { txId, billId: id, date: v.date });
        });
        const ids = new Set(created.map((p) => p.id));
        const mine = created.find((p) => p.billId === id && p.date === v.date);
        const when = v.date === today() ? 'today' : 'on ' + fmtDate(v.date, { short: true });
        toast(mine ? b.name + ' ' + money(v.amount) + ' left your account ' + when + '. Added to Get paid back' : b.name + ' paid' + nextNote(id), {
          action: 'Undo',
          onAction: () => store.commit((s) => {
            s.bills = s.bills.map((x) => (x.id === id ? before : x));
            if (txId) s.transactions = s.transactions.filter((t) => t.id !== txId);
            if (ids.size) s.paperwork = s.paperwork.filter((p) => !ids.has(p.id));
            for (const tid in was) {
              const t = s.transactions.find((x) => x.id === tid);
              if (t) t.category = was[tid];
            }
          }),
        });
      },
    });
  }

  /* The business paid a work bill itself: just move it on to the next date. */
  function companyPaid(id) {
    const b = store.find('bills', id);
    if (!b) return;
    const before = JSON.parse(JSON.stringify(b));
    store.commit((s) => moveOn(s.bills.find((x) => x.id === id)));
    toast(co(true) + ' paid ' + b.name + nextNote(id), {
      action: 'Undo',
      onAction: () => store.commit((s) => {
        s.bills = s.bills.map((x) => (x.id === id ? before : x));
      }),
    });
  }

  GU.tabs.bills = { label: 'Bills', short: 'Bills', icon: 'bills', part: 'home', render, create, edit, markPaid, METHODS };
})();
