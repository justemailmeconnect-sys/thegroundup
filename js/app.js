/* The Ground Up: app shell. Builds the icon rail, routes between tabs and redraws on every change. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc } = GU.util;
  const { icon } = GU.ui;
  const store = GU.store;

  /* The menu, in groups: home, inbox and work; money ahead; paperwork; history. */
  const GROUPS = [['today', 'inbox', 'work'], ['bills', 'debts', 'incomings', 'todos'], ['receipts', 'documents', 'visas'], ['transactions', 'outgoings']];
  const ORDER = GROUPS.flat();
  GU.tabs = GU.tabs || {};
  const intents = {};
  let current = null;

  const view = {
    /* Standard page heading for a tab. */
    head(o) {
      return '<header class="page-head"><div class="page-head__text">' +
        (o.eyebrow ? '<p class="eyebrow">' + esc(o.eyebrow) + '</p>' : '') +
        '<h1>' + esc(o.title) + '</h1>' + (o.text ? '<p class="page-head__sub">' + o.text + '</p>' : '') + '</div>' +
        (o.actions ? '<div class="page-head__actions">' + o.actions + '</div>' : '') + '</header>';
    },
    go(tab, intent) {
      if (intent) intents[tab] = intent;
      if (location.hash === '#' + tab) render();
      else location.hash = tab;
    },
    intent(tab) {
      const i = intents[tab];
      delete intents[tab];
      return i;
    },
    /* Opens the right editor for any record, wherever it lives. */
    open(ref) {
      if (ref.c === 'sectionItems') return GU.sections.editItem(ref.id);
      const map = { tasks: 'todos', bills: 'bills', paperwork: 'receipts', incomeSources: 'incomings', visas: 'visas', documents: 'documents', transactions: 'transactions', debts: 'debts', projects: 'work', workNotes: 'work', costIdeas: 'work' };
      const tab = GU.tabs[map[ref.c]];
      if (tab && tab.edit) tab.edit(ref.id, ref.c);
    },
    quickAdd(anchor) {
      GU.ui.menu(anchor, [
        { icon: 'inbox', label: 'Anything', hint: 'Upload it and let me sort it', onClick: async () => {
          const files = await GU.ui.pickFiles();
          if (files.length) GU.inbox.add({ files });
        } },
        { icon: 'folder', label: 'A whole folder', hint: 'Every file inside gets sorted', onClick: async () => {
          const files = await GU.ui.pickFolder();
          if (files.length) GU.inbox.add({ files });
          else GU.ui.toast('That folder has no files I can read.');
        } },
        { icon: 'receipt', label: 'Receipt or invoice', hint: 'Upload a photo or PDF', onClick: () => GU.tabs.receipts.create({ pick: true }) },
        { icon: 'todo', label: 'Task', hint: 'Something to do', onClick: () => GU.tabs.todos.create() },
        { icon: 'briefcase', label: 'Work project', hint: 'Coming up at work', onClick: () => GU.tabs.work.editProject(null, {}) },
        { icon: 'bills', label: 'Bill', hint: 'A regular payment', onClick: () => GU.tabs.bills.create() },
        { icon: 'coin', label: 'Transaction', hint: 'Money in or out', onClick: () => GU.tabs.transactions.create() },
        { icon: 'card', label: 'Debt', hint: 'Card, loan, Klarna, finance…', onClick: () => GU.tabs.debts.create() },
        { icon: 'upload', label: 'Bank statement', hint: 'Import a CSV file', onClick: () => GU.tabs.transactions.importCSV() },
        { icon: 'folder', label: 'Document', hint: 'Passport, contract, certificate…', onClick: () => GU.tabs.documents.create() },
        { icon: 'globe', label: 'Visa application', hint: 'Track a new application', onClick: () => GU.tabs.visas.create() },
        { icon: 'star', label: 'New section', hint: 'Car, Pets, Wedding…', onClick: () => GU.sections.newSection() },
      ]);
    },
  };
  GU.view = view;

  function hasDemo(s) {
    return ['transactions', 'debts', 'bills', 'incomeSources', 'paperwork', 'documents', 'visas', 'tasks'].some((k) => (s[k] || []).some((x) => x.demo));
  }

  function shell() {
    const app = document.getElementById('app');
    app.innerHTML =
      '<div class="app">' +
      '<nav class="rail" aria-label="Sections">' +
      '<a class="rail__brand" href="#today" aria-label="The Ground Up, today"><span>G</span></a>' +
      '<div class="rail__items"></div></nav>' +
      '<main class="main" id="main"><div class="banner-slot"></div><div class="view" id="view"></div></main>' +
      '</div>';
    app.querySelector('.rail__items').addEventListener('click', (e) => {
      const b = e.target.closest('[data-quick-add]');
      if (b) view.quickAdd(b);
    });
  }

  let railKey = '';
  function buildRail() {
    const custom = GU.sections.sync();
    const key = custom.map((id) => id + GU.tabs[id].label).join('|');
    if (key === railKey && document.querySelector('.rail__items').children.length) return;
    railKey = key;
    const item = (id) => {
      const t = GU.tabs[id];
      return '<a class="rail__item' + (t.custom ? ' rail__item--custom' : '') + '" href="#' + id + '" data-tab="' + id + '"><span class="rail__ico">' + icon(t.icon) + '<b class="rail__badge" hidden></b></span><span class="rail__label">' + esc(t.short || t.label) + '</span></a>';
    };
    document.querySelector('.rail__items').innerHTML =
      '<button type="button" class="rail__item rail__add" data-quick-add aria-label="Add something"><span class="rail__ico">' + icon('plus') + '</span><span class="rail__label">Add</span></button>' +
      '<button type="button" class="rail__item rail__claude" data-chat-toggle aria-pressed="false" aria-label="Ask Claude (Ctrl or Cmd + K)"><span class="rail__ico">' + icon('spark') + '</span><span class="rail__label">Claude</span></button>' +
      GROUPS.map((g) => g.map(item).join('')).join('<span class="rail__sep" aria-hidden="true"></span>') +
      (custom.length ? '<span class="rail__sep" aria-hidden="true"></span>' + custom.map(item).join('') : '') +
      '<a class="rail__item rail__settings" href="#settings" data-tab="settings"><span class="rail__ico">' + icon('settings') + '</span><span class="rail__label">Settings</span></a>';
  }

  function applyTheme() {
    const t = store.state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  function renderBanner() {
    const slot = document.querySelector('.banner-slot');
    const s = store.state;
    let html = '';
    if (!store.storageOK()) {
      html += '<div class="banner banner--crit">' + icon('alert') + '<p><b>This browser is not saving your changes.</b> Private browsing or blocked storage can cause this. Open the app in a normal window, or export a backup from Settings before you close it.</p></div>';
    }
    if (hasDemo(s)) {
      html += '<div class="banner">' + icon('info') + '<p><b>You are looking at example data.</b> Everything marked here is made up so you can see how it works. Anything you add yourself is kept when you clear the examples.</p>' +
        '<button type="button" class="btn btn--sm" data-clear-demo>Clear examples</button></div>';
    }
    slot.innerHTML = html;
    const b = slot.querySelector('[data-clear-demo]');
    if (b) b.addEventListener('click', () => GU.sample.clear());
  }

  function renderRail(tabId) {
    buildRail();
    const counts = GU.agenda.badges(store.state);
    document.querySelectorAll('.rail__item[data-tab]').forEach((a) => {
      const id = a.getAttribute('data-tab');
      if (id === tabId) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      const badge = a.querySelector('.rail__badge');
      if (!badge) return;
      const n = counts[id] || 0;
      badge.hidden = !n;
      badge.textContent = n > 9 ? '9+' : n;
      const tab = GU.tabs[id];
      a.setAttribute('aria-label', (tab ? tab.label : id) + (n ? ', ' + n + ' need attention' : ''));
    });
  }

  function render() {
    const id = (location.hash || '#today').slice(1);
    GU.sections.sync();
    const tabId = GU.tabs[id] ? id : 'today';
    const tab = GU.tabs[tabId];
    const changedTab = current !== tabId;
    current = tabId;
    applyTheme();
    renderRail(tabId);
    renderBanner();
    const host = document.getElementById('view');
    const fresh = document.createElement('div');
    fresh.className = 'view__inner view--' + tabId;
    host.replaceChildren(fresh);
    tab.render(fresh);
    GU.ui.hydrate(fresh);
    document.title = (tabId === 'today' ? '' : tab.label + ' · ') + 'The Ground Up';
    if (changedTab) {
      window.scrollTo(0, 0);
      const active = document.querySelector('.rail__item[aria-current="page"]');
      if (active && active.scrollIntoView && window.matchMedia('(max-width: 860px)').matches) active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }
  GU.render = render;

  /* The first time there's a statement history, find the bills in it. Later imports look for new ones. */
  function firstBillScan() {
    GU.trash.purge();
    GU.tabs.transactions.autoTidy();
    const s = store.state;
    if (s.meta.billsScanned || s.transactions.filter((t) => !t.demo).length < 30) return;
    GU.recurring.scan({ quiet: true });
  }

  async function start() {
    store.init();
    await GU.files.open();
    const fresh = store.isFirstRun;
    const sync = GU.sync.possible();
    // With sync, wait for your other devices' data before showing examples or moving bill dates on.
    if (fresh && !sync) await GU.sample.load();
    if (!sync) store.commit((s) => GU.finance.rollForward(s));
    shell();
    store.subscribe(render);
    window.addEventListener('hashchange', render);
    render();
    if (sync) {
      GU.sync.start({ fresh }).then(async (r) => {
        const empty = !['transactions', 'bills', 'paperwork', 'documents', 'visas', 'tasks', 'debts'].some((k) => (store.state[k] || []).length);
        if (fresh && !r.remote && empty) await GU.sample.load();
        store.commit((s) => GU.finance.rollForward(s));
        firstBillScan();
      });
    } else firstBillScan();
    GU.inbox.resume();
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
