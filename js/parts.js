/* The Ground Up: Home and Work, the two parts of the site. Which menu items belong to which part, which records
   are work, the part you're in (remembered on this device only), the two doors on each Overview and the
   Add menu for each part. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, money, plural, fmtDate, today, sum } = GU.util;

  /* ---------- the two parts ---------- */
  /* The menu of each part: one group, in order. Money, Bills & debts, Paperwork, To-do, Orders & claims and Jobs are
     containers (js/tabs/containers.js) that hold the older pages as sub-tabs, so the old page ids still work. */
  const PARTS = {
    home: {
      label: 'Home',
      start: 'today',
      groups: [['today', 'hub', 'money', 'bills-debts', 'paperwork', 'todo']],
      titles: [''],
    },
    work: {
      label: 'Work',
      start: 'work',
      groups: [['work', 'hub', 'orders', 'jobs', 'work-docs']],
      titles: [''],
    },
  };
  const SHARED = ['hub', 'settings'];
  const isPart = (p) => p === 'home' || p === 'work';

  /* The part and the last page in each are kept per device (not synced), so your phone and laptop
     don't flip each other. Storage can be blocked, so everything also lives in memory. */
  const PART_KEY = 'groundup.part';
  const LAST_KEY = 'groundup.lastTab';
  let memPart = null;
  let memLast = null;

  function readLast() {
    if (memLast) return memLast;
    let v = {};
    try {
      v = JSON.parse(localStorage.getItem(LAST_KEY) || '{}') || {};
    } catch (e) {
      v = {};
    }
    memLast = { home: typeof v.home === 'string' ? v.home : '', work: typeof v.work === 'string' ? v.work : '' };
    return memLast;
  }

  /* The part you're in: 'home' (the default) or 'work'. */
  function get() {
    if (memPart) return memPart;
    let p = null;
    try {
      p = localStorage.getItem(PART_KEY);
    } catch (e) {
      p = null;
    }
    memPart = isPart(p) ? p : 'home';
    return memPart;
  }
  function set(p) {
    if (!isPart(p)) return get();
    memPart = p;
    try {
      localStorage.setItem(PART_KEY, p);
    } catch (e) {
      /* kept in memory only */
    }
    try {
      document.documentElement.dataset.part = p;
    } catch (e) {
      /* no document */
    }
    return p;
  }

  const tabExists = (id) => !!(id && GU.tabs && GU.tabs[id]);

  /* Which part a page belongs to: 'home', 'work' or 'shared' (the Sorting hub, Settings and anything unknown). */
  function partOf(tabId) {
    const id = String(tabId || '');
    if (!id || SHARED.includes(id)) return 'shared';
    const box = GU.containers && GU.containers.parentOf(id);
    if (box) return GU.containers.DEFS[box].part;
    const t = GU.tabs && GU.tabs[id];
    if (t && (isPart(t.part) || t.part === 'shared')) return t.part;
    if (id.startsWith('s-')) {
      const sec = ((GU.store.state && GU.store.state.sections) || []).find((x) => 's-' + x.id === id);
      return sec && sec.part === 'work' ? 'work' : 'home';
    }
    for (const p of Object.keys(PARTS)) if (PARTS[p].groups.some((g) => g.includes(id))) return p;
    return 'shared';
  }

  /* The last page you used in a part, if it still exists and still belongs there. */
  function lastTab(p) {
    if (!isPart(p)) return null;
    const id = readLast()[p];
    if (!id) return null;
    if (id.startsWith('s-')) {
      if (!((GU.store.state && GU.store.state.sections) || []).some((x) => 's-' + x.id === id)) return null;
    } else if (GU.tabs && !GU.tabs[id]) return null;
    return partOf(id) === p ? id : null;
  }
  /* Notes the page you're on as the last one used in its part. Shared pages aren't remembered. */
  function remember(tabId) {
    const p = partOf(tabId);
    if (!isPart(p)) return;
    const last = readLast();
    if (last[p] === tabId) return;
    last[p] = tabId;
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(last));
    } catch (e) {
      /* kept in memory only */
    }
  }
  /* Switches to a part and opens the last page you used there, or its Overview. */
  function go(p) {
    if (!isPart(p)) return;
    set(p);
    const to = lastTab(p) || PARTS[p].start;
    if (GU.view && GU.view.go) GU.view.go(to);
    else location.hash = to;
  }
  /* The part's menu groups, keeping only pages that exist. */
  function groups(p) {
    const cfg = PARTS[isPart(p) ? p : 'home'];
    return cfg.groups.map((g) => g.filter((id) => !GU.tabs || GU.tabs[id])).filter((g) => g.length);
  }

  /* ---------- names ---------- */
  const st = (s) => s || GU.store.state || {};
  const employerOf = (s) => {
    const e = (st(s).settings || {}).employer;
    return e && typeof e === 'object' ? e : null;
  };
  /* The employer's short name (from Settings), or 'the company' when none is set. cap: 'The company' for the start of a sentence. */
  function co(s, cap) {
    const e = employerOf(s);
    const n = e && String(e.short || '').trim();
    if (n) return n;
    return cap ? 'The company' : 'the company';
  }
  /* The employer's name without 'Limited' or 'Ltd' ('Acme Care'); full: the whole legal name. */
  function coName(s, full) {
    const e = employerOf(s);
    const name = e && String(e.name || '').trim();
    if (!name) return co(s);
    return full ? name : name.replace(/[\s,]+(limited|ltd\.?|plc|llp)$/i, '').trim() || name;
  }
  /* The label for money the company pays itself: '<employer> pays', or 'Company pays' with no employer set. */
  const paysLabel = (s) => (employerOf(s) && String(employerOf(s).short || '').trim() ? co(s) + ' pays' : 'Company pays');

  /* ---------- what's work ---------- */
  const WORK_OUT = () => (GU.finance && GU.finance.WORK_OUT) || 'Work expenses';
  /* A work bill: marked as work, or an old bill in 'Work expenses' with no context. */
  const isWorkBill = (b) => !!b && (b.context === 'work' || (!b.context && b.category === WORK_OUT()));
  function workListId(s) {
    const lists = st(s).todoLists || [];
    const l = lists.find((x) => x.id === 'list-work') || lists.find((x) => /^work$/i.test(x.name || ''));
    return l ? l.id : null;
  }
  /* A work task: marked as work, or in the Work list and not marked as home.
     isWorkTask(task) and tasks.filter(isWorkTask) also work, reading the lists from the store. */
  function isWorkTask(s, t) {
    if (s && !s.todoLists && !s.tasks && (t == null || typeof t !== 'object')) {
      t = s;
      s = null;
    }
    if (!t) return false;
    if (t.context === 'work') return true;
    const wl = workListId(s);
    return !!(wl && t.listId === wl && t.context !== 'home');
  }
  const isWorkDoc = (d) => !!d && d.context === 'work';
  /* Projects were first made in Work, so one with no context is a work project. Home projects are marked 'home'. */
  const projectPart = (p) => (p && p.context === 'home' ? 'home' : 'work');
  const isHomeProject = (p) => !!p && p.context === 'home';
  const isWorkPaper = (p) => !!p && p.context === 'work';
  /* Cost ideas were first made in Work, so one with no context is a work idea. */
  const ideaPart = (i) => (i && i.context === 'home' ? 'home' : 'work');

  /* ---------- the two doors ---------- */
  /* A sum of money that never breaks across lines ('−£170.47', not '−' then '£170.47'). */
  const fig = (x) => '<span class="nowrap">' + esc(money(x)) + '</span>';
  /* A link to a page, or to fallback while that page isn't there yet. */
  const href = (id, fallback) => '#' + (!GU.tabs || GU.tabs[id] || !fallback ? id : fallback);

  function homeLine(s) {
    try {
      if (!GU.forecast || !GU.money) return esc('Your money, bills and documents');
      const t = today();
      const plan = GU.forecast.plan(s, { to: GU.forecast.monthEnd(t) });
      if (!plan.known) return esc('Add your balances and I’ll show where you’re heading');
      return (plan.start < 0 ? fig(-plan.start) + ' overdrawn across your accounts' : fig(plan.start) + ' across your accounts') +
        ' · about ' + fig(plan.end) + ' by <span class="nowrap">' + esc(fmtDate(plan.to, { short: true })) + '</span>';
    } catch (e) {
      return esc('Your money, bills and documents');
    }
  }
  /* What the company owes you: from GU.workMoney when it's there, otherwise the old 'to claim back' flags. */
  function owedBack(s) {
    try {
      const wm = GU.workMoney;
      if (wm && typeof wm.dueBack === 'function') return Number((wm.dueBack(s) || {}).total) || 0;
      return sum((GU.finance.toClaim(s) || []).filter((x) => isWorkPaper(x.p)), (x) => x.amount);
    } catch (e) {
      return 0;
    }
  }
  /* How many work checks need doing (late or due soon, not just for information). */
  function toDo(s) {
    try {
      if (!GU.work || typeof GU.work.checks !== 'function') return 0;
      return GU.work.checks(s).filter((c) => c.level === 'crit' || c.level === 'warn').length;
    } catch (e) {
      return 0;
    }
  }
  function workLine(s, owed, n) {
    return (owed > 0 ? esc(co(s, true) + ' owes you ') + fig(owed) : esc('Nothing due back from ' + co(s))) +
      ' · ' + esc(n ? plural(n, 'thing') + ' need' + (n === 1 ? 's' : '') + ' doing' : 'nothing needs doing');
  }

  /* The two doors at the top of each Overview: Home and Work side by side, the current one active. */
  function doorsHTML(s, current) {
    s = st(s);
    const icon = GU.ui.icon;
    const e = employerOf(s);
    const owed = owedBack(s);
    const n = toDo(s);
    const chip = (id, label, fallback) => '<a class="chip" href="' + href(id, fallback) + '">' + esc(label) + '</a>';
    const door = (part, o) => '<div class="door door--' + part + (current === part ? ' door--active' : '') + '" data-part="' + part + '">' +
      '<p class="door__eyebrow">' + esc(o.eyebrow) + '</p>' +
      '<h2 class="door__word">' + esc(o.word) + '<span class="door__dot" aria-hidden="true">.</span></h2>' +
      '<p class="door__line">' + o.line + '</p>' +
      '<a class="btn' + (current === part ? ' btn--primary' : '') + ' door__btn" href="' + o.btnHref + '"' + (o.btnAttr || '') + '>' + icon(o.btnIcon) + esc(o.btn) + '</a>' +
      '<nav class="door__chips chips" aria-label="' + esc(o.word) + ' pages">' + o.chips.join('') + '</nav></div>';
    const home = door('home', {
      eyebrow: 'Your life and money',
      word: 'Home',
      line: homeLine(s),
      btn: 'Money ahead',
      btnIcon: 'trend',
      btnHref: '#today',
      btnAttr: ' data-door-scroll=".ahead"',
      chips: [chip('bills', 'Bills'), chip('outgoings', 'Spending'), chip('receipts', 'Receipts'), chip('todos', 'To-do')],
    });
    const work = door('work', {
      eyebrow: e ? [e.about, coName(s, true)].filter((x) => x && String(x).trim()).join(' · ') : 'Your job or business',
      word: 'Work',
      line: workLine(s, owed, n),
      btn: owed > 0 ? 'Get paid back' : 'Open Work',
      btnIcon: owed > 0 ? 'coin' : 'briefcase',
      btnHref: owed > 0 ? href('work-back', 'work') : '#work',
      chips: [chip('work-ktk', paysLabel(s), 'work'), chip('work-bills', 'Regular costs', 'work'), chip('work-tasks', 'Tasks', 'work'), chip('work-projects', 'Projects', 'work')],
    });
    return '<section class="doors" aria-label="Home and Work">' + home + '<span class="doors__seam" aria-hidden="true">G</span>' + work + '</section>';
  }

  /* ---------- where a page is, in words ---------- */
  /* 'Home › Money › Bank', 'Work › Orders & claims › To buy', 'Work › Contracts & documents': the path to a page in
     the menu, for toasts, the Sorting hub's places and the help guide. Anything it doesn't know is just its name. */
  function pathOf(tabId, opts) {
    opts = opts || {};
    const C = GU.containers;
    const tab = GU.tabs && GU.tabs[tabId];
    const box = C && C.parentOf(tabId);
    const p = partOf(tabId);
    const bits = [];
    if (isPart(p) && opts.part !== false) bits.push(PARTS[p].label);
    if (box) {
      bits.push(C.containerLabel(box));
      bits.push(C.subLabel(box, tabId));
    } else if (tab) bits.push(tab.short || tab.label);
    else bits.push(String(tabId || ''));
    return bits.join(' › ');
  }

  /* ---------- Add ---------- */
  /* The Work area each page holds, so Add › Folder starts on the page you're looking at. */
  const AREA_OF_PAGE = { 'work-ktk': 'invoices', 'work-bills': 'bills', 'work-tasks': 'tasks', 'work-projects': 'projects', 'work-docs': 'contracts' };
  /* Calls an app function if it's there, otherwise opens a fallback page. */
  function use(getFn, args, fallbackTab) {
    let fn = null;
    try {
      fn = getFn();
    } catch (e) {
      fn = null;
    }
    if (typeof fn === 'function') return fn.apply(null, args || []);
    if (fallbackTab && GU.view) GU.view.go(tabExists(fallbackTab) ? fallbackTab : PARTS[partOf(fallbackTab) === 'work' ? 'work' : 'home'].start);
    return null;
  }
  /* Marks a record just saved as work (the forms don't all ask yet), unless you switched its For to Home. */
  function tagWork(c, id) {
    GU.store.commit((s) => {
      const r = (s[c] || []).find((x) => x.id === id);
      if (!r || r.context === 'home') return;
      r.context = 'work';
      if (c === 'tasks') {
        let wl = workListId(s);
        if (!wl) {
          wl = 'list-work';
          s.todoLists.push({ id: wl, name: 'Work' });
        }
        r.listId = wl;
      }
    });
  }
  /* The Add button that's on screen (rail on a computer, top bar on a phone). */
  function addButton() {
    const all = Array.from(document.querySelectorAll('[data-quick-add]'));
    return all.find((b) => b.getClientRects().length) || all[0] || document.body;
  }
  /* Switches part, then opens that part's Add menu. */
  function switchAndAdd(p) {
    go(p);
    setTimeout(() => GU.ui.menu(addButton(), addMenu(p)), 80);
  }
  /* Add anything: the Sorting hub, with its box ready to type or paste in. */
  function addAnything() {
    if (!GU.view) return;
    if (location.hash !== '#hub') GU.view.go('hub');
    let tries = 0;
    const timer = setInterval(() => {
      const el = location.hash === '#hub' ? document.getElementById('hub-box') : null;
      if (el || ++tries > 30) clearInterval(timer);
      if (el) el.focus();
    }, 40);
  }

  /* Add, as items for GU.ui.menu: a few things people add every day, then 'More…' for the rest. The menu is short on
     purpose: anything not here can still be dropped into the Sorting hub ('Add anything'). */
  function addMenu(part, anchor) {
    const s = GU.store.state;
    const tabs = () => GU.tabs || {};
    const again = (items) => setTimeout(() => GU.ui.menu(anchor && anchor.isConnected ? anchor : addButton(), items), 30);
    const more = (items) => ({ icon: 'more', label: 'More…', hint: items, onClick: () => again(addMore(part, anchor)) });
    const anything = (hint) => ({ icon: 'funnel', label: 'Add anything', hint, onClick: addAnything });
    if (part === 'work') {
      const c = co(s);
      return [
        anything('A photo, a PDF, an email or a few words'),
        { icon: 'coin', label: 'I paid for something (get it back)', hint: 'With your own card, cash or account', onClick: () => use(() => tabs().receipts.create, [{ values: { context: 'work', payer: 'me', kind: 'receipt' } }], 'work-back') },
        { icon: 'bag', label: 'Something ' + c + ' wants me to get', hint: 'Note it down, then order it', onClick: () => use(() => tabs()['work-requests'].create, [], 'work-requests') },
        { icon: 'todo', label: 'A job', hint: 'Something to do for ' + c, onClick: () => {
          if (!workListId(GU.store.state)) ensureWorkList();
          use(() => tabs().todos.create, [{ listId: workListId(GU.store.state), context: 'work' }, { onSaved: (r) => r && tagWork('tasks', r.id) }], 'work-tasks');
        } },
        more('A project, a contract, a note…'),
      ];
    }
    return [
      anything('A photo, a PDF, an email or a few words'),
      { icon: 'receipt', label: 'A receipt or expense', hint: 'Something you bought', onClick: () => use(() => tabs().receipts.create, [], 'receipts') },
      { icon: 'todo', label: 'A to-do', hint: 'Something to do', onClick: () => use(() => tabs().todos.create, [], 'todos') },
      more('A bill, a debt, a document…'),
    ];
  }
  /* The rest of Add, from 'More…'. */
  function addMore(part, anchor) {
    const tabs = () => GU.tabs || {};
    const s = GU.store.state;
    if (part === 'work') {
      const c = co(s);
      return [
        { icon: 'receipt', label: 'Something ' + c + ' is paying', hint: 'Or has already paid: an order, invoice or receipt', onClick: () => use(() => tabs().receipts.create, [{ values: { kind: 'invoice-in', context: 'work', payer: 'company', status: 'unpaid' } }], 'work-ktk') },
        { icon: 'bills', label: 'Regular work cost', hint: 'A bill that comes round again', onClick: () => use(() => tabs().bills.create, [{ category: WORK_OUT(), context: 'work' }, { onSaved: (r) => r && tagWork('bills', r.id) }], 'work-bills') },
        { icon: 'star', label: 'A project', hint: 'A bigger piece of work coming up', onClick: () => use(() => tabs().work.editProject, [null, {}], 'work-projects') },
        { icon: 'file', label: 'Contract or document', hint: 'Leases, licences, insurance, supplier terms', onClick: () => use(() => tabs().documents.create, [{ type: (GU.work && GU.work.CONTRACT) || 'Contract or agreement', title: '', context: 'work' }, { onSaved: (r) => r && tagWork('documents', r.id) }], 'work-docs') },
        { icon: 'note', label: 'Note', hint: 'Anything to remember', onClick: () => use(() => tabs().work.editNote, [null, { area: 'general' }], 'work') },
        { icon: 'folder', label: 'Folder', hint: 'To group things together', onClick: () => use(() => (GU.work && GU.work.newFolder) || tabs().work.newFolder, [null, null, AREA_OF_PAGE[(location.hash || '').slice(1)] || null], 'work') },
        { icon: 'home', label: 'Something personal →', hint: 'Switch to Home', onClick: () => switchAndAdd('home') },
      ];
    }
    return [
      { icon: 'bills', label: 'Bill', hint: 'A regular payment', onClick: () => use(() => tabs().bills.create, [], 'bills') },
      { icon: 'card', label: 'Debt', hint: 'Card, loan, Klarna, finance…', onClick: () => use(() => tabs().debts.create, [], 'debts') },
      { icon: 'upload', label: 'Bank statement', hint: 'Import a CSV or PDF', onClick: () => use(() => tabs().transactions.importCSV, [], 'transactions') },
      { icon: 'folder', label: 'Document', hint: 'Passport, certificate, tenancy…', onClick: () => use(() => tabs().documents.create, [], 'documents') },
      { icon: 'star', label: 'Project', hint: 'A job someone’s asked you to do at home', onClick: () => use(() => tabs()['home-projects'].create, [], 'home-projects') },
      { icon: 'trend', label: 'Something to save for', hint: 'I’ll work out when you can afford it', onClick: () => use(() => GU.work && GU.work.editIdea, [null, { context: 'home' }], 'plans') },
      { icon: 'star', label: 'New category', hint: 'Car, Pets, Wedding…', onClick: () => use(() => GU.sections && GU.sections.newSection, [], null) },
      { icon: 'briefcase', label: 'Something for work →', hint: 'Switch to Work', onClick: () => switchAndAdd('work') },
    ];
  }
  /* Makes the Work to-do list if it isn't there yet. */
  function ensureWorkList() {
    GU.store.commit((s) => {
      if (!workListId(s)) s.todoLists.push({ id: 'list-work', name: 'Work' });
    });
  }

  /* ---------- Help: where things go ---------- */
  /* The one guide, from Settings › Help. The menu is the fix for 'where does this go?'; this is only for looking things up. */
  function whereHelp() {
    const s = GU.store.state;
    const icon = GU.ui.icon;
    const e = employerOf(s);
    const c = co(s);
    const C = co(s, true);
    const about = e && e.about ? ' (' + e.about + ')' : '';
    const bill = (s.bills || []).find((b) => isWorkBill(b) && b.active !== false && b.payer !== 'company' && (b.payer === 'me' || b.foundKey || (b.history || []).length));
    const to = (tab, label) => '<button type="button" class="link link--btn" data-where-go="' + esc(tab) + '">' + esc(label || pathOf(tab)) + '</button>';
    const row = (q, dest, more) => '<li><b>' + esc(q) + '</b> <span class="where__to">→ ' + dest + '</span>' + (more ? '<em>' + esc(more) + '</em>' : '') + '</li>';
    const work = [
      row(C + ' asked me to get something', to('work-requests'), 'Note it there with its price and I’ll add up what it will cost. When you’ve bought it, add the receipt and it goes to Get paid back.'),
      row('I bought something for ' + c + ' with my own card or cash', to('work-back'), 'Snap the receipt, or open the payment in Bank and choose ‘Paid for ' + c + ', get it back’. Then tap ‘Send to ' + c + '’.'),
      row('I set up an order or quote and ' + c + ' pays at the end', to('work-ktk'), 'It waits there for ' + c + '. Tap ‘Send to ' + c + '’, then ‘Paid by ' + c + '’ once it’s paid.'),
      row('It went on ' + c + '’s card or account', to('work-ktk'), 'It’s filed as paid by ' + c + '.'),
      row('An invoice addressed to ' + c + ' that ' + c + ' pays', to('work-ktk')),
      row('Amazon orders for ' + c, to('work-ktk', 'Import them'), 'Choose ‘Work, I paid’ or ‘Work, ' + c + '’s card’.'),
      row('A monthly cost that comes out of my account and ' + c + ' pays back' + (bill ? ' (like ' + bill.name + ')' : ''), to('work-bills'), 'Choose ‘Comes out of my account’. It joins Get paid back by itself each month.'),
      row('A regular cost ' + c + ' pays itself', to('work-bills'), 'Choose ‘' + c + ' pays it directly’.'),
      row(C + ' has paid me back', 'nothing to add', 'Import your bank statement and Get paid back ticks it off. Or open the payment in Bank and choose ‘' + c + ' paying me back’.'),
      row('A contract, lease, licence, insurance or supplier terms for ' + c, to('work-docs')),
      row('Something to do for ' + c, to('work-tasks')),
      row('A job or piece of work coming up', to('work-projects')),
    ];
    const home = [
      row('My wages from ' + c, 'nothing to do', 'They show in ' + pathOf('incomings') + ' by themselves.'),
      row('A payslip, P60 or tax summary from ' + c, to('documents'), 'Under Employment and payslips. It’s about your pay, so it’s yours.'),
      row('A receipt, order or warranty for me or the house', to('receipts')),
      row('An invoice I have to pay myself', to('receipts'), 'Under To pay.'),
      row('An invoice I sent someone for my own side work (not ' + c + ')', to('receipts'), 'Under Owed to you.'),
      row('My own regular bill or subscription', to('bills')),
      row('Klarna, PayPal Pay in 3, a card or a loan', to('debts'), 'Add the payment schedule there. Records from your lenders are kept in their own categories.'),
      row('A bank statement', to('transactions'), 'Or add it with Add anything.'),
      row('Something I’m saving up for', to('plans')),
      row('Passport, visa or immigration papers, certificates, tenancy, insurance', to('documents')),
      row('A to-do for me', to('todos')),
      row('A project someone’s asked me to do at home', to('home-projects'), 'Say what it is, when it’s due and what it should cost.'),
      row('Anything else (a wedding, the car, pets)', 'one of your categories', 'Or make a new category with Add › More…, or at the bottom of the menu.'),
    ];
    const body = '<div class="where">' +
      '<p class="dlg__intro">The quickest way is <b>Add anything</b>: drop it in the ' + to('hub', 'Sorting hub') + ' and I’ll work out where it goes. This guide is for looking things up.</p>' +
      '<ol class="where__rule">' +
      '<li><b>Is it for ' + esc(c + about) + '?</b> If not, it goes in Home.</li>' +
      '<li><b>If it is, did the money come out of your own account, card, PayPal or Amazon?</b>' +
      '<ul><li>Yes: ' + to('work-back') + '</li><li>No (' + esc(c) + ' paid, or will pay): ' + to('work-ktk') + '</li></ul></li>' +
      '</ol>' +
      '<div class="where__cols">' +
      '<section class="where__col where__col--work"><h3>' + icon('briefcase') + esc('For ' + c + ' (Work)') + '</h3><ul class="where__list">' + work.join('') + '</ul></section>' +
      '<section class="where__col where__col--home"><h3>' + icon('home') + 'Mine (Home)</h3><ul class="where__list">' + home.join('') + '</ul></section>' +
      '</div>' +
      '<h3>Good to know</h3>' +
      '<ul class="where__list where__list--plain">' +
      '<li>In Work, what you add is treated as ' + esc(c) + '’s, and I’ll ask ‘Whose money paid for this?’ if I can’t tell.</li>' +
      '<li>In Home it’s treated as yours.</li>' +
      '<li>Anything in Work can go back to Home from its ⋯ menu (Move to Home).</li>' +
      '<li>To move something into Work, open it and set ‘For’ to Work, or use ‘Move a bill from Home’ and ‘Move a document from Home’ in Work.</li>' +
      '</ul></div>';
    const d = GU.ui.openDialog({
      title: 'Where things go',
      wide: true,
      className: 'dlg--where',
      body,
      footer: '<span class="spacer"></span><button type="button" class="btn btn--primary" data-close>Got it</button>',
    });
    d.body.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-where-go]');
      if (!b) return;
      ev.preventDefault();
      const tab = b.getAttribute('data-where-go');
      d.close();
      const p = partOf(tab);
      if (isPart(p)) set(p);
      if (GU.view) GU.view.go(tabExists(tab) ? tab : PARTS[isPart(p) ? p : get()].start);
    });
    return d;
  }

  /* Clicks anywhere: [data-where-help] opens the guide,
     [data-door-scroll] scrolls to that part of the page when the link points at the page you're on. */
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;
    const help = t.closest('[data-where-help]');
    if (help) {
      ev.preventDefault();
      whereHelp();
      return;
    }
    const sc = t.closest('[data-door-scroll]');
    if (sc) {
      const href = sc.getAttribute('href');
      const sel = sc.getAttribute('data-door-scroll');
      if (href === location.hash) {
        const el = document.querySelector(sel);
        if (el) {
          ev.preventDefault();
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } else {
        // Another page: the link takes you there, then the page scrolls to that part once it's drawn.
        let tries = 0;
        const timer = setInterval(() => {
          const el = location.hash === href ? document.querySelector(sel) : null;
          if (el || ++tries > 25) clearInterval(timer);
          if (el) el.scrollIntoView({ block: 'start' });
        }, 40);
      }
    }
  });

  // The accent colours follow the part from the first paint, before the app draws anything.
  try {
    document.documentElement.dataset.part = get();
  } catch (e) {
    /* no document */
  }

  GU.parts = {
    PARTS, SHARED,
    get, set, lastTab, remember, go, partOf, groups,
    co, coName, paysLabel,
    isWorkBill, isWorkTask, isWorkDoc, isWorkPaper, ideaPart, workListId, projectPart, isHomeProject,
    doorsHTML, addMenu, addMore, addAnything, whereHelp, pathOf,
  };
})();
