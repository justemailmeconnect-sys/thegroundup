/* The Ground Up: Home › Plans. Things you're saving up for and when you can afford each one: the cost
   forecast on your own money (GU.costs), with your ideas grouped by whether they fit yet. Work ideas live in
   Work › Cost forecast, but the ones you pay for yourself still take room in this plan, so a line says so.
   The rows, the idea form and the forecast come from GU.work, with plain stand-ins while those aren't there. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, today, fmtDate, money, plural, sum, daysUntil } = GU.util;
  const { icon, pill, emptyState, toast, menu, viewFiles } = GU.ui;
  const store = GU.store;
  const C = 'costIdeas';
  const ui = { showDone: false };

  const work = () => GU.work || {};
  const ideaPart = (i) => (GU.parts && GU.parts.ideaPart ? GU.parts.ideaPart(i) : i && i.context === 'home' ? 'home' : 'work');
  const isHome = (i) => ideaPart(i) === 'home';
  const co = (s) => (GU.parts && GU.parts.co ? GU.parts.co(s) : 'the company');

  /* ---------- changes ---------- */
  function editIdea(id) {
    const w = work();
    if (typeof w.editIdea === 'function') return id ? w.editIdea(id) : w.editIdea(null, { context: 'home' });
    // An older Work page without GU.work.editIdea: its own form (which doesn't ask Home or Work yet).
    if (GU.tabs.work && GU.tabs.work.edit) return GU.tabs.work.edit(id || null, C);
    return null;
  }
  function setStatus(id, status) {
    const w = work();
    if (typeof w.ideaStatus === 'function') return w.ideaStatus(id, status);
    const before = Object.assign({}, store.find(C, id));
    store.commit((s) => {
      const i = (s.costIdeas || []).find((x) => x.id === id);
      if (!i) return;
      i.status = status;
      if (status === 'done') i.doneDate = today();
      else delete i.doneDate;
    });
    toast(status === 'done' ? 'Marked done' : status === 'dropped' ? 'Dropped from the plan' : 'Back in the plan', { action: 'Undo', onAction: () => store.upsert(C, before) });
  }
  /* 'It's for work': moves the idea to Work › Cost forecast, where you say who pays. */
  function moveToWork(id) {
    const before = Object.assign({}, store.find(C, id));
    store.commit((s) => {
      const i = (s.costIdeas || []).find((x) => x.id === id);
      if (i) i.context = 'work';
    });
    toast('Moved to Work › Cost forecast', { action: 'Undo', onAction: () => store.upsert(C, before) });
  }
  function forecastSettings() {
    const w = work();
    if (typeof w.forecastSettings === 'function') return w.forecastSettings();
    return GU.view.go(GU.tabs['work-costs'] ? 'work-costs' : 'work');
  }

  /* ---------- the forecast ---------- */
  /* GU.work's chart and figures for your own money; a plain summary while that isn't there. */
  function forecastHTML(s, plan) {
    const w = work();
    if (typeof w.forecastHTML === 'function') return w.forecastHTML(s, { context: 'home' });
    const b = plan.base;
    if (!b.known) {
      return '<section class="panel"><div class="panel__body cf-empty">' + icon('bank') + '<p>Put in what’s in your accounts first, and I’ll work out when you can afford each thing.</p><button type="button" class="btn btn--primary" data-balances>Add your balances</button></div></section>';
    }
    const mine = plan.results.filter((r) => r.part === 'home');
    const keep = b.cfg.buffer ? money(b.cfg.buffer, { whole: true }) : '£0';
    return '<section class="panel cf"><header class="panel__head"><h2>' + icon('trend') + 'When you can afford things</h2><span class="muted">next ' + b.cfg.months + ' months</span></header>' +
      '<div class="tally__sum">' +
      '<div><span>Spare each month</span><b class="' + (plan.spare < 0 ? 'is-crit' : 'is-in') + '">' + esc(money(plan.spare, { whole: true })) + '</b><em>' + esc(plan.spare < 0 ? 'more goes out than comes in' : 'on average, after bills, debts and everyday spending') + '</em></div>' +
      '<div><span>You could spend now</span><b>' + esc(money(plan.freeNow, { whole: true })) + '</b><em>' + esc('and never drop below ' + keep) + '</em></div>' +
      '<div><span>Saving up for</span><b>' + esc(money(sum(mine, (r) => r.cost), { whole: true })) + '</b><em>' + esc(plural(mine.length, 'thing') + ' on the list') + '</em></div>' +
      '</div></section>';
  }

  /* ---------- rows ---------- */
  function rowHTML(s, plan, i) {
    const w = work();
    if (typeof w.rowHTML === 'function') return w.rowHTML(s, 'costs', i);
    const x = plan.results.find((r) => r.idea.id === i.id);
    let when;
    if (i.status === 'done') when = pill('Done' + (i.doneDate ? ' ' + fmtDate(i.doneDate, { short: true }) : ''), 'good', 'check');
    else if (i.status === 'dropped') when = pill('Dropped', 'muted');
    else if (x && x.date) when = pill(daysUntil(x.date) <= 0 ? 'You can afford it now' : 'Earliest ' + fmtDate(x.date, { short: true }), daysUntil(x.date) <= 0 ? 'good' : 'info', 'clock') + (x.account ? pill('from ' + x.account, 'muted', 'bank') : '');
    else when = pill('Not in the next ' + plan.base.cfg.months + ' months', 'crit', 'alert');
    const open = GU.costs.isOpen(i);
    return '<li class="wk-row' + (open ? '' : ' is-done') + '"><span class="wk-row__lead wk-row__ico">' + icon('coin') + '</span>' +
      '<button type="button" class="wk-row__main" data-open="' + esc(C + ':' + i.id) + '"><b>' + esc(i.name) + '</b>' +
      '<em>' + esc([i.wantBy ? 'wanted by ' + fmtDate(i.wantBy, { short: true }) : '', i.notBefore ? 'not before ' + fmtDate(i.notBefore, { short: true }) : ''].filter(Boolean).join(' · ')) + '</em>' +
      '<span class="wk-row__chips">' + when + '</span></button>' +
      '<span class="wk-row__end"><b>' + esc(money(i.cost)) + '</b>' + (Number(i.monthly) > 0 ? '<em>+ ' + esc(money(i.monthly)) + ' a month</em>' : '') + '</span>' +
      '<span class="wk-row__act">' + (open ? '<button type="button" class="btn btn--sm btn--soft" data-idea-done="' + esc(i.id) + '">' + icon('check') + 'Done</button>' : '') +
      '<button type="button" class="icon-btn" data-more="' + esc(C + ':' + i.id) + '" aria-label="' + esc('More for ' + i.name) + '">' + icon('more') + '</button></span></li>';
  }

  /* Work ideas planned on your money too: ones you pay for and get back, and ones nobody's said who pays for. */
  function workLine(s, plan) {
    const fronted = plan.results.filter((r) => r.part === 'work' && r.dip);
    const unsorted = plan.results.filter((r) => r.part === 'work' && !r.dip);
    if (!fronted.length && !unsorted.length) return '';
    const c = co(s);
    const parts = [];
    if (fronted.length) parts.push('This plan also counts ' + plural(fronted.length, 'work thing') + ' you’ll pay for and get back from ' + c + ' (' + money(sum(fronted, (r) => r.cost), { whole: true }) + '). ' +
      (fronted.length === 1 ? 'It only takes' : 'Each only takes') + ' room until it’s paid back, about ' + plural(plan.repayDays || 14, 'day') + ' later.');
    if (unsorted.length) parts.push(plural(unsorted.length, 'work idea') + ' ' + (unsorted.length === 1 ? 'is' : 'are') + ' planned on your money too (' + money(sum(unsorted, (r) => r.cost), { whole: true }) + '), because nobody’s said who pays yet.');
    return '<p class="note-line plans__work">' + icon('briefcase') + '<span>' + esc(parts.join(' ')) + '</span>' +
      '<button type="button" class="btn btn--sm" data-go-costs>Work › Cost forecast' + icon('chevron') + '</button></p>';
  }

  /* ---------- the page ---------- */
  function render(root) {
    const s = store.state;
    const plan = GU.costs.schedule(s);
    const ideas = (s.costIdeas || []).filter(isHome);
    const at = (i) => (plan.results.find((r) => r.idea.id === i.id) || {}).date || '9999';
    const open = ideas.filter(GU.costs.isOpen);
    const groups = [
      { title: 'Can be done', items: open.filter((i) => at(i) !== '9999').sort((a, b) => at(a).localeCompare(at(b))) },
      { title: 'Doesn’t fit yet', items: open.filter((i) => at(i) === '9999') },
      { title: 'Done or dropped', items: ideas.filter((i) => !GU.costs.isOpen(i)).sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || '')), closed: true },
    ].filter((g) => g.items.length);
    const list = groups.length
      ? groups.map((g) => (g.closed ? '<details class="wk-group"' + (ui.showDone ? ' open' : '') + '><summary>' + esc(g.title) + ' (' + g.items.length + ')</summary>' : '<h3 class="wk-group__title">' + esc(g.title) + '</h3>') +
        '<ul class="wk-rows">' + g.items.map((i) => rowHTML(s, plan, i)).join('') + '</ul>' + (g.closed ? '</details>' : '')).join('')
      : emptyState({ icon: 'trend', title: 'Nothing planned yet', text: 'Add something you’re saving up for, like a holiday, a new laptop or a sofa, and I’ll tell you the earliest date you can afford it.',
        action: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Something to save for</button>' });

    root.innerHTML = GU.view.head({
      eyebrow: 'Money ahead',
      title: 'Plans',
      text: 'When can I afford it? Add what you’re saving up for and I’ll find the earliest date each one fits, without your accounts dropping below what you want to keep.',
      actions: '<button type="button" class="btn" data-cf-settings>' + icon('settings') + 'Forecast settings</button>' +
        '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Something to save for</button>',
    }) +
      '<div class="stack plans">' + forecastHTML(s, plan) + workLine(s, plan) + '<section class="panel">' + list + '</section></div>';

    root.querySelectorAll('.wk-group').forEach((d) => d.addEventListener('toggle', () => (ui.showDone = d.open)));
    root.addEventListener('click', onClick);
  }

  function moreMenu(anchor, id) {
    const i = store.find(C, id);
    if (!i) return;
    const items = [{ icon: 'edit', label: 'Open and edit', onClick: () => editIdea(id) }];
    if (GU.costs.isOpen(i)) {
      items.push({ icon: 'check', label: 'Mark done', onClick: () => setStatus(id, 'done') });
      items.push({ icon: 'x', label: 'Drop it', hint: 'Keeps it, but stops planning for it', onClick: () => setStatus(id, 'dropped') });
    } else items.push({ icon: 'repeat', label: 'Back to the plan', onClick: () => setStatus(id, 'open') });
    items.push({ icon: 'briefcase', label: 'It’s for work', hint: 'Moves it to Work › Cost forecast', onClick: () => moveToWork(id) });
    items.push({ icon: 'trash', label: 'Delete', onClick: () => store.remove(C, id, i.name) });
    menu(anchor, items);
  }

  function onClick(e) {
    const b = (sel) => e.target.closest(sel);
    let el;
    if (b('[data-add]')) return editIdea(null);
    if (b('[data-go-costs]')) return GU.view.go(GU.tabs['work-costs'] ? 'work-costs' : 'work');
    // The rows come from GU.work, so its own handler runs their buttons and ⋯ menu.
    const w = work();
    if (typeof w.rowClick === 'function' && w.rowClick(e)) return;
    if (b('[data-cf-settings]')) return forecastSettings();
    if (b('[data-balances]')) return GU.tabs.transactions.updateBalances();
    if ((el = b('[data-idea-done]'))) return setStatus(el.dataset.ideaDone, 'done');
    if ((el = b('[data-more]'))) return moreMenu(el, el.dataset.more.split(':')[1]);
    if ((el = b('[data-files]'))) {
      const id = el.dataset.files.split(':')[1];
      const i = store.find(C, id);
      if (i && (i.files || []).length) return viewFiles(i.files, 0, i.name);
      return editIdea(id);
    }
    if ((el = b('[data-open]'))) {
      const [c, id] = el.dataset.open.split(':');
      if (c === C) return editIdea(id);
      return GU.view.open({ c, id });
    }
  }

  GU.tabs.plans = { label: 'Plans', short: 'Plans', icon: 'trend', part: 'home', render, edit: editIdea };
})();
