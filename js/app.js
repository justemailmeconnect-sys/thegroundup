/* The Ground Up: app shell. Builds the Home | Work switch and the icon rail for the part you're in, routes
   between tabs and redraws on every change. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc } = GU.util;
  const { icon } = GU.ui;
  const store = GU.store;

  /* The two parts and their menus live in GU.parts (js/parts.js). */
  const parts = GU.parts;
  const PARTS = parts.PARTS;
  const isPart = (p) => p === 'home' || p === 'work';
  GU.tabs = GU.tabs || {};
  const intents = {};
  let current = null;

  /* The part a page belongs to, or '' for the shared pages (the Sorting hub, Settings). */
  const pagePart = (tabId) => {
    const p = parts.partOf(tabId);
    return isPart(p) ? p : '';
  };

  const view = {
    /* Standard page heading for a tab. The eyebrow starts with the page's part: 'Home · Money ahead'. A page inside a
       container (Bank in Money, Get paid back in Orders & claims) names the container instead, so the strip above and
       the heading read as one page: 'Home · Money'. */
    head(o) {
      const p = o.part || pagePart(current);
      const label = isPart(p) ? PARTS[p].label : '';
      let eyebrow = o.eyebrow || '';
      const box = GU.containers && o.part !== false ? GU.containers.parentOf(current) : '';
      if (box) eyebrow = GU.containers.containerLabel(box);
      if (label && o.part !== false && !new RegExp('^' + label + '\\b', 'i').test(eyebrow)) eyebrow = eyebrow ? label + ' · ' + eyebrow : label;
      return '<header class="page-head"><div class="page-head__text">' +
        (eyebrow ? '<p class="eyebrow">' + esc(eyebrow) + '</p>' : '') +
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
      const map = { tasks: 'todos', bills: 'bills', paperwork: 'receipts', incomeSources: 'incomings', documents: 'documents', transactions: 'transactions', debts: 'debts', projects: 'work', workNotes: 'work', costIdeas: 'work', requests: 'work-requests' };
      const tab = GU.tabs[map[ref.c]];
      if (tab && tab.edit) tab.edit(ref.id, ref.c);
    },
    /* The Add menu for the part you're in. */
    quickAdd(anchor) {
      GU.ui.menu(anchor, parts.addMenu(parts.get(), anchor));
    },
    /* The red and amber counts for each page, as the menu last worked them out (the sub-tab strips show them too). */
    badges: {},
  };
  GU.view = view;

  function hasDemo(s) {
    // 'visas' stays in these lists: the page is gone but the records are still data (and old examples can still be cleared).
    return ['transactions', 'debts', 'bills', 'incomeSources', 'paperwork', 'documents', 'visas', 'tasks'].some((k) => (s[k] || []).some((x) => x.demo));
  }

  /* ---------- the Home | Work switch ---------- */
  /* Two buttons, the same in the rail (computer) and the top bar (phone). The other part's button shows a
     count when something there is late or needs doing. */
  function switchHTML(where) {
    const btn = (p, ico) => '<button type="button" class="partswitch__btn partswitch__btn--' + p + '" data-part-go="' + p + '" aria-pressed="false">' +
      '<span class="partswitch__ico">' + icon(ico) + '</span><span class="partswitch__label">' + esc(PARTS[p].label) + '</span>' +
      '<b class="partswitch__count" hidden></b></button>';
    return '<div class="partswitch partswitch--' + where + '" role="group" aria-label="Home or Work">' + btn('home', 'home') + btn('work', 'briefcase') + '</div>';
  }

  /* Undo and Redo: two small buttons next to Add in the rail (computer) and in the top bar (phone). What each would
     do is in its tooltip; they're greyed out when there's nothing to undo or redo. */
  function historyHTML(where) {
    const btn = (kind) => '<button type="button" class="' + (where === 'bar' ? 'partbar__tool partbar__hbtn' : 'rail__hbtn') + '" data-history="' + kind + '" aria-label="' + (kind === 'undo' ? 'Undo' : 'Redo') + '" disabled>' +
      icon(kind) + '</button>';
    return '<div class="' + (where === 'bar' ? 'partbar__history' : 'rail__history') + '" role="group" aria-label="Undo and redo">' + btn('undo') + btn('redo') + '</div>';
  }
  function syncHistory() {
    const h = GU.history;
    if (!h) return;
    const st = h.status();
    document.querySelectorAll('[data-history]').forEach((b) => {
      const undo = b.getAttribute('data-history') === 'undo';
      const on = undo ? st.canUndo : st.canRedo;
      const label = undo ? st.undoLabel : st.redoLabel;
      b.disabled = !on;
      const mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd' : 'Ctrl';
      const tip = on ? (undo ? 'Undo: ' : 'Redo: ') + label + '  (' + mod + (undo ? '+Z' : '+Shift+Z') + ')' : undo ? 'Nothing to undo' : 'Nothing to redo';
      b.setAttribute('data-tip', tip);
      b.setAttribute('aria-label', on ? (undo ? 'Undo ' : 'Redo ') + label : undo ? 'Undo (nothing to undo)' : 'Redo (nothing to redo)');
    });
  }

  function shell() {
    const app = document.getElementById('app');
    const start = PARTS[parts.get()].start;
    app.innerHTML =
      '<div class="app">' +
      '<header class="partbar">' +
      '<a class="partbar__brand" href="#' + start + '" aria-label="The Ground Up, overview"><span>G</span></a>' +
      switchHTML('bar') +
      (GU.search ? GU.search.barHTML() : '') + (GU.lock ? GU.lock.barHTML() : '') +
      '<button type="button" class="partbar__tool partbar__claude" data-chat-toggle aria-pressed="false" aria-label="Ask Claude">' + icon('spark') + '</button>' +
      // On a phone Undo, Redo and Switch look share one More button (js/looks.js); without the looks the two history buttons stay.
      (GU.look ? GU.look.barHTML() : historyHTML('bar')) +
      '<button type="button" class="partbar__add" data-quick-add aria-label="Add something">' + icon('plus') + '</button>' +
      '</header>' +
      '<nav class="rail" aria-label="Menu">' +
      '<a class="rail__brand" href="#' + start + '" aria-label="The Ground Up, overview"><span>G</span></a>' +
      switchHTML('rail') +
      '<div class="rail__items"></div></nav>' +
      '<main class="main" id="main"><div class="banner-slot"></div><div class="view" id="view"></div></main>' +
      '</div>';
    app.addEventListener('click', (e) => {
      const hist = e.target.closest('[data-history]');
      if (hist) {
        if (hist.disabled) return;
        return hist.getAttribute('data-history') === 'undo' ? GU.history.undo() : GU.history.redo();
      }
      const lk = e.target.closest('[data-look-toggle]');
      if (lk) return lk.getAttribute('data-look-toggle') === 'menu' ? GU.look.openMenu(lk) : GU.look.toggle();
      const add = e.target.closest('[data-quick-add]');
      if (add) return view.quickAdd(add);
      if (e.target.closest('[data-new-category]')) return GU.sections.newSection({ part: parts.get() });
      const sw = e.target.closest('[data-part-go]');
      if (sw) {
        const p = sw.getAttribute('data-part-go');
        // Already there: back to that part's Overview.
        if (p === parts.get() && pagePart(current) === p) view.go(PARTS[p].start);
        else parts.go(p);
      }
    });
  }

  /* The switch's state: which part is pressed, its tooltip, and the other part's count. */
  function renderSwitch(part, counts) {
    const e = GU.workMoney ? GU.workMoney.employer(store.state) : null;
    const workTip = 'Work: ' + (e && e.set ? e.fullName || e.short : 'your job or business');
    document.querySelectorAll('[data-part-go]').forEach((b) => {
      const p = b.getAttribute('data-part-go');
      const on = p === part;
      b.setAttribute('aria-pressed', String(on));
      const n = on ? 0 : counts['__' + p] || 0;
      const badge = b.querySelector('.partswitch__count');
      badge.hidden = !n;
      badge.textContent = n > 9 ? '9+' : n;
      const tip = p === 'work' ? workTip : 'Home: your life and money';
      b.title = tip;
      b.setAttribute('aria-label', tip + (n ? ', ' + n + (n === 1 ? ' needs' : ' need') + ' attention' : ''));
    });
    document.querySelectorAll('.rail__brand, .partbar__brand').forEach((a) => a.setAttribute('href', '#' + PARTS[part].start));
  }

  /* ---------- the rail: Add, Search, Claude, the part's pages, its categories, Settings ---------- */
  let railKey = '';
  function buildRail(part) {
    const custom = GU.sections.menuIds(part);
    const groups = parts.groups(part);
    const label = (id) => {
      const t = GU.tabs[id];
      return t ? t.short || t.label : id;
    };
    const ids = groups.flat().concat(custom);
    const key = part + '|' + ids.map((id) => id + ':' + label(id)).join('|') + (GU.lock && GU.lock.enabled() ? '|lock' : '');
    const host = document.querySelector('.rail__items');
    if (key === railKey && host.children.length) return;
    railKey = key;
    const item = (id) => {
      const t = GU.tabs[id];
      return '<a class="rail__item' + (t.custom ? ' rail__item--custom' : '') + '" href="#' + id + '" data-tab="' + id + '"><span class="rail__ico">' + icon(t.icon) + '<b class="rail__badge" hidden></b></span><span class="rail__label">' + esc(label(id)) + '</span></a>';
    };
    // A thin line before the categories you made yourself; the pages above it are one list.
    const sep = '<span class="rail__sep" aria-hidden="true"></span>';
    const chatOpen = document.documentElement.classList.contains('chat-open');
    host.innerHTML =
      '<button type="button" class="rail__item rail__add" data-quick-add aria-label="Add something"><span class="rail__ico">' + icon('plus') + '</span><span class="rail__label">Add</span></button>' +
      historyHTML('rail') +
      (GU.search ? GU.search.railHTML() : '') + (GU.lock ? GU.lock.railHTML() : '') +
      '<button type="button" class="rail__item rail__claude" data-chat-toggle aria-pressed="' + chatOpen + '" aria-label="Ask Claude (Ctrl or Cmd + K)"><span class="rail__ico">' + icon('spark') + '</span><span class="rail__label">Claude</span></button>' +
      groups.map((g, i) => (i ? sep : '') + g.map(item).join('')).join('') +
      (custom.length ? sep + custom.map(item).join('') : '') +
      '<div class="rail__foot">' + (GU.look ? GU.look.railHTML() : '') + '<a class="rail__item rail__settings" href="#settings" data-tab="settings"><span class="rail__ico">' + icon('settings') + '</span><span class="rail__label">Settings</span></a>' +
      '<button type="button" class="rail__item rail__newcat" data-new-category aria-label="New category"><span class="rail__ico">' + icon('plus') + '</span><span class="rail__label">New category</span></button></div>';
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

  function renderRail(tabId, part) {
    buildRail(part);
    syncHistory();
    if (GU.look) GU.look.syncUI(); // the Look button says which look it would switch to
    let counts = {};
    try {
      counts = GU.agenda.badges(store.state) || {};
    } catch (e) {
      console.error(e);
    }
    // The Sorting hub took over from the Inbox: its count is the same thing.
    if (counts.hub == null && counts.inbox != null) counts.hub = counts.inbox;
    view.badges = counts;
    renderSwitch(part, counts);
    // A container's count is its pages' counts added up (the counts are worked out per page).
    const countOf = (id) => {
      const C = GU.containers;
      if (C && C.has(id)) return C.subs(id).reduce((n, sub) => n + (counts[sub] || 0), 0);
      return counts[id] || 0;
    };
    const lit = GU.containers ? GU.containers.railId(tabId) : tabId;
    document.querySelectorAll('.rail__item[data-tab]').forEach((a) => {
      const id = a.getAttribute('data-tab');
      if (id === lit) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      const badge = a.querySelector('.rail__badge');
      if (!badge) return;
      const n = countOf(id);
      badge.hidden = !n;
      badge.textContent = n > 9 ? '9+' : n;
      const tab = GU.tabs[id];
      a.setAttribute('aria-label', (tab ? tab.label : id) + (n ? ', ' + n + (n === 1 ? ' needs' : ' need') + ' attention' : ''));
    });
  }

  /* The page to show for a hash: the page itself, or its part's Overview when it isn't there (an old link, a
     deleted section). No hash: the last page you used in the part you were in. */
  function resolve(id, part) {
    if (!id) {
      const to = parts.lastTab(part) || PARTS[part].start;
      const tab = GU.tabs[to] ? to : 'today';
      try {
        history.replaceState(null, '', '#' + tab);
      } catch (e) {
        /* the address bar just stays as it is */
      }
      return tab;
    }
    // Old links to the Inbox open the Sorting hub that replaced it.
    if (id === 'inbox' && GU.tabs.hub) {
      try {
        history.replaceState(null, '', '#hub');
      } catch (e) {
        /* the address bar just stays as it is */
      }
      return 'hub';
    }
    // The Visas page was taken out (the records stay in your data): old links open the Home Overview.
    if (id === 'visas' && !GU.tabs.visas) {
      try {
        history.replaceState(null, '', '#today');
      } catch (e) {
        /* the address bar just stays as it is */
      }
      return 'today';
    }
    // The Cost forecast page was folded into To buy (the old ideas are offered there): old links open it.
    if (id === 'work-costs' && !GU.tabs['work-costs'] && GU.tabs['work-requests']) {
      try {
        history.replaceState(null, '', '#work-requests');
      } catch (e) {
        /* the address bar just stays as it is */
      }
      return 'work-requests';
    }
    // A menu item that holds several pages (Money, Bills & debts…): open the page you used last in it. The address
    // bar then names that page, so links, toasts and 'Open' buttons all keep using the page ids.
    if (GU.containers && GU.containers.has(id) && GU.tabs[id]) {
      const sub = GU.containers.defaultSub(id);
      if (sub && GU.tabs[sub]) {
        try {
          history.replaceState(null, '', '#' + sub);
        } catch (e) {
          /* the address bar just stays as it is */
        }
        return sub;
      }
    }
    if (GU.tabs[id]) return id;
    const start = PARTS[parts.partOf(id) === 'work' ? 'work' : part].start;
    return GU.tabs[start] ? start : 'today';
  }

  /* Scrolls the menu itself (not the page) so the current page's item is in view: sideways on a phone, up or down
     when the screen is too short for the whole list. It only moves when the item isn't fully showing, so the six
     main items stay where they are. Done by hand: scrollIntoView also moves where Tab starts. */
  function revealInRail(item) {
    const host = item && item.closest('.rail__items');
    if (!host) return;
    const h = host.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    if (host.scrollWidth > host.clientWidth + 1) {
      if (r.left < h.left) host.scrollLeft += r.left - h.left - 8;
      else if (r.right > h.right) host.scrollLeft += r.right - h.right + 8;
    }
    if (host.scrollHeight > host.clientHeight + 1) {
      // Settings is pinned at the bottom of the list: items must clear it, not just the edge.
      const foot = host.querySelector('.rail__foot');
      const pinned = foot && getComputedStyle(foot).position === 'sticky';
      if (pinned && foot.contains(item)) return;
      const bottom = pinned ? foot.getBoundingClientRect().top : h.bottom;
      if (r.top < h.top) host.scrollTop += r.top - h.top - 6;
      else if (r.bottom > bottom) host.scrollTop += r.bottom - bottom + 6;
    }
  }

  function render() {
    GU.finance.useCustom(store.state);
    GU.sections.sync();
    let part = parts.get();
    const tabId = resolve((location.hash || '').slice(1), part);
    // A page from the other part (a card, a toast, an 'Open' in the Sorting hub, an old link) flips the switch to match.
    const p = pagePart(tabId);
    if (p && p !== part) part = parts.set(p);
    document.documentElement.dataset.part = part;
    parts.remember(tabId);
    const tab = GU.tabs[tabId];
    const changedTab = current !== tabId;
    current = tabId;
    applyTheme();
    renderRail(tabId, part);
    renderBanner();
    const host = document.getElementById('view');
    // A box marked data-keep-focus that you're typing in keeps focus (and your place in it) when the page redraws.
    const was = !changedTab ? document.activeElement : null;
    const keep = was && was.id && was.hasAttribute && was.hasAttribute('data-keep-focus') && host.contains(was)
      ? { id: was.id, start: was.selectionStart, end: was.selectionEnd, scroll: was.scrollTop } : null;
    const fresh = document.createElement('div');
    fresh.className = 'view__inner view--' + tabId;
    host.replaceChildren(fresh);
    // A page inside Money, Bills & debts… is drawn by its container: the strip of pages, then the page itself.
    const box = GU.containers ? GU.containers.parentOf(tabId) : '';
    if (box && GU.tabs[box]) {
      fresh.classList.add('view--in-' + box);
      GU.tabs[box].render(fresh, tabId);
    } else tab.render(fresh);
    GU.ui.hydrate(fresh);
    if (keep) {
      const el = document.getElementById(keep.id);
      if (el && el.hasAttribute('data-keep-focus')) {
        el.focus({ preventScroll: true });
        try {
          if (keep.start != null) el.setSelectionRange(Math.min(keep.start, el.value.length), Math.min(keep.end, el.value.length));
          el.scrollTop = keep.scroll;
        } catch (e) {
          /* not a text box */
        }
      }
    }
    const label = tab.label || '';
    document.title = (pagePart(tabId) === 'work' && !/^work\b/i.test(label) ? 'Work · ' : '') + (label ? label + ' · ' : '') + 'The Ground Up';
    if (changedTab) {
      window.scrollTo(0, 0);
      revealInRail(document.querySelector('.rail__item[aria-current="page"]'));
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

  /* Moves bill dates on, and adds this month's claims for the work bills you pay and get back. */
  function rollForward() {
    store.commit((s) => {
      GU.finance.rollForward(s);
      try {
        if (GU.workMoney && GU.workMoney.billClaims) GU.workMoney.billClaims(s);
      } catch (e) {
        console.error(e);
      }
    }, { history: false });
  }
  /* Once the data is in: the one-off Home/Work re-sort, then matching work payments to your bank, then bills. */
  function settle() {
    try {
      if (GU.refile && GU.refile.run) GU.refile.run();
    } catch (e) {
      console.error(e);
    }
    try {
      if (GU.workMoney && GU.workMoney.reconcile) GU.workMoney.reconcile({ quiet: true });
    } catch (e) {
      console.error(e);
    }
    try {
      if (GU.hub && GU.hub.startFresh) GU.hub.startFresh();
    } catch (e) {
      console.error(e);
    }
    firstBillScan();
  }

  async function start() {
    store.init();
    if (GU.look) GU.look.init(); // settings.look, else the saved choice, else Soft Glass: before anything is drawn
    if (GU.lock) GU.lock.start(); // the privacy screen, if it's on, covers everything before anything is drawn
    await GU.files.open();
    const fresh = store.isFirstRun;
    const sync = GU.sync.possible();
    // With sync, wait for your other devices' data before showing examples or moving bill dates on.
    if (fresh && !sync) await GU.sample.load();
    if (!sync) rollForward();
    shell();
    if (GU.history) GU.history.onChange(syncHistory);
    store.subscribe(render);
    window.addEventListener('hashchange', render);
    render();
    if (GU.looks) GU.looks.boot(); // the look's own behaviour starts once there is something on screen to dress
    if (sync) {
      GU.sync.start({ fresh }).then(async (r) => {
        const empty = !['transactions', 'bills', 'paperwork', 'documents', 'visas', 'tasks', 'debts'].some((k) => (store.state[k] || []).length);
        if (fresh && !r.remote && empty) await GU.sample.load();
        rollForward();
        // The re-sort only runs on data that's caught up with your other devices, never on an old copy.
        if (GU.sync.active() || GU.sync.status().mode === 'off') settle();
        else {
          const off = GU.sync.onStatus(() => {
            if (!GU.sync.active()) return;
            off();
            settle();
          });
        }
      });
    } else settle();
    GU.hub.resume();
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
