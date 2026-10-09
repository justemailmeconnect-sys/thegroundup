/* The Ground Up: the menu's own pages. Money, Bills & debts, Paperwork and To-do in Home, and Orders & claims and
   Jobs in Work, are containers: each one is a single item in the menu that holds the pages that answer its question,
   as a short strip of sub-tabs at the top. The pages themselves (Bank, Spending, Bills, Debts, To buy, Get paid back…)
   are exactly as they were, with their own ids, headings and code; the container only draws the strip and then
   asks the page to draw itself underneath. Every old page id still works: GU.containers.of('transactions') says
   'that's Money, with Bank showing', and the address bar, links, toasts and search results keep using the page ids.
   The sub-tab you used last in each container is remembered on this device (never synced). */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc } = GU.util;

  /* The containers, in the order of the menu. subs are the page ids inside, in the order of the strip. */
  const DEFS = {
    money: {
      part: 'home', label: 'Money', icon: 'bank', question: 'Where did my money go, and what came in?',
      subs: ['transactions', 'outgoings', 'incomings', 'taxyear'],
      names: { transactions: 'Bank', outgoings: 'Spending', incomings: 'Income', taxyear: 'Tax year' },
    },
    'bills-debts': {
      part: 'home', label: 'Bills & debts', icon: 'bills', question: 'What do I owe, and what’s due?',
      subs: ['bills', 'debts', 'plans'],
      names: { bills: 'Bills', debts: 'Debts', plans: 'Plans' },
    },
    paperwork: {
      part: 'home', label: 'Paperwork', icon: 'folder', question: 'Where’s that receipt or document?',
      subs: ['receipts', 'documents', 'warranties'],
      names: { receipts: 'Receipts', documents: 'Documents', warranties: 'Warranties' },
    },
    todo: {
      part: 'home', label: 'To-do', icon: 'todo', question: 'What do I need to do?',
      subs: ['todos', 'home-projects'],
      names: { todos: 'Tasks', 'home-projects': 'Projects' },
    },
    orders: {
      part: 'work', label: 'Orders & claims', icon: 'bag', steps: true, question: 'What was I asked to get, what did I buy, and who pays?',
      subs: ['work-requests', 'work-back', 'work-ktk', 'work-bills'],
      names: { 'work-requests': 'To buy', 'work-back': 'Get paid back', 'work-bills': 'Regular costs' },
    },
    jobs: {
      part: 'work', label: 'Jobs', icon: 'todo', question: 'What am I doing for the company?',
      subs: ['work-tasks', 'work-projects'],
      names: { 'work-tasks': 'Tasks', 'work-projects': 'Projects' },
    },
  };
  const IDS = Object.keys(DEFS);
  const PARENT = {};
  for (const id of IDS) for (const sub of DEFS[id].subs) PARENT[sub] = id;

  /* ---------- the sub-tab you used last in each container (this device only) ---------- */
  const KEY = 'groundup.subTab';
  let mem = null;
  function memory() {
    if (mem) return mem;
    let v = {};
    try {
      v = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch (e) {
      v = {};
    }
    mem = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    return mem;
  }
  function remember(container, sub) {
    if (!DEFS[container] || !DEFS[container].subs.includes(sub)) return;
    const m = memory();
    if (m[container] === sub) return;
    m[container] = sub;
    try {
      localStorage.setItem(KEY, JSON.stringify(m));
    } catch (e) {
      /* kept in memory only */
    }
  }

  const tabExists = (id) => !!(GU.tabs && GU.tabs[id]);
  const has = (id) => Object.prototype.hasOwnProperty.call(DEFS, id);
  const isSub = (id) => Object.prototype.hasOwnProperty.call(PARENT, id);
  /* The pages of a container that are there. */
  const subs = (container) => (has(container) ? DEFS[container].subs.filter(tabExists) : []);
  /* The page a container opens on: the one you used last in it, or its first. */
  function defaultSub(container) {
    const list = subs(container);
    const last = memory()[container];
    return list.includes(last) ? last : list[0] || null;
  }
  /* The container a page id belongs to (a sub-tab's id), or '' for any other page. */
  const parentOf = (id) => (isSub(id) ? PARENT[id] : '');
  /* An id as a container and the sub-tab showing: a sub's id gives its own container, a container's id gives the
     sub you used last in it, and anything else gives null. */
  function of(id) {
    id = String(id || '');
    if (isSub(id)) return { container: PARENT[id], sub: id };
    if (has(id)) {
      const sub = defaultSub(id);
      return sub ? { container: id, sub } : null;
    }
    return null;
  }
  /* Which menu item to light up for any page: its container, or the page itself. A category the menu hides because
     it holds records from a lender is lit as Bills & debts, where its link is. */
  function railId(id) {
    const c = of(id);
    if (c) return c.container;
    if (GU.sections && GU.sections.isLenderRecord && /^s-/.test(String(id))) {
      const sec = ((GU.store.state && GU.store.state.sections) || []).find((x) => 's-' + x.id === id);
      if (sec && GU.sections.isHidden(sec) && GU.sections.isLenderRecord(sec)) return 'bills-debts';
    }
    return id;
  }

  /* ---------- names ---------- */
  /* The name on a sub-tab: Bank, Spending, Tasks… The company's own pages follow what you've named them in Work. */
  function subLabel(container, sub) {
    const def = DEFS[container];
    const t = GU.tabs[sub];
    if (sub === 'work-ktk') return (t && (t.short || t.label)) || 'Company pays';
    if (sub === 'work-bills' || sub === 'work-tasks' || sub === 'work-projects') return (t && (t.short || t.label)) || def.names[sub];
    return (def && def.names[sub]) || (t && (t.short || t.label)) || sub;
  }
  const containerLabel = (container) => (has(container) ? DEFS[container].label : '');

  /* ---------- the strip ---------- */
  function stripHTML(container, sub) {
    const def = DEFS[container];
    const counts = (GU.view && GU.view.badges) || {};
    const list = subs(container);
    return '<nav class="subtabs' + (def.steps ? ' subtabs--steps' : '') + '" aria-label="' + esc(def.label) + '">' +
      list.map((id) => {
        const n = counts[id] || 0;
        return '<a class="subtab" href="#' + esc(id) + '" data-subtab="' + esc(id) + '"' + (id === sub ? ' aria-current="page"' : '') + '>' +
          '<span class="subtab__label">' + esc(subLabel(container, id)) + '</span>' +
          (n ? '<b class="subtab__badge" aria-label="' + n + (n === 1 ? ' needs' : ' need') + ' attention">' + (n > 9 ? '9+' : n) + '</b>' : '') + '</a>';
      }).join('') + '</nav>';
  }

  /* Draws a container: the strip, then the page you're on, which draws itself exactly as it always has. */
  function renderContainer(container, root, sub) {
    const list = subs(container);
    if (!sub || !list.includes(sub)) sub = defaultSub(container);
    if (!sub) {
      root.innerHTML = '';
      return;
    }
    remember(container, sub);
    root.innerHTML = stripHTML(container, sub) + '<div class="subpage subpage--' + esc(sub) + '"></div>';
    GU.tabs[sub].render(root.querySelector('.subpage'));
  }

  /* Registers the containers as pages. Called when the tabs are all there, and again whenever one might be missing. */
  function register() {
    for (const id of IDS) {
      const def = DEFS[id];
      const list = def.subs.filter(tabExists);
      if (!list.length) continue;
      GU.tabs[id] = {
        label: def.label, short: def.label, icon: def.icon, part: def.part, container: true,
        get subs() { return subs(id); },
        question: def.question,
        render: (root, sub) => renderContainer(id, root, sub),
      };
    }
  }
  register();

  GU.containers = { DEFS, IDS, subs, has, isSub, parentOf, of, railId, defaultSub, remember, subLabel, containerLabel, stripHTML, register };
})();
