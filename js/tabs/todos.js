/* The Ground Up: To-do lists in Home. Several lists (Personal, Life admin…), smart views for
   Today and Upcoming, quick add that understands "tomorrow" or "on Friday".
   Work tasks (the Work list, or anything marked as work) live in Work › Tasks, so this page leaves them out
   and says where they are. The task form here is shared with Work: its 'For' field moves a task across. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, addDays, daysUntil, fmtDate, relDays, plural } = GU.util;
  const { icon, pill, emptyState, selectOptions, formDialog, toast, confirmBox } = GU.ui;
  const store = GU.store;
  /* Where a page is in the menu, for toasts and signposts: 'Work › Orders & claims › Get paid back'. */
  const at = (tab, fallback) => (GU.parts && GU.parts.pathOf && GU.tabs && GU.tabs[tab] ? GU.parts.pathOf(tab) : fallback);

  let view = 'today';
  let showDone = false;
  const PRIORITIES = [{ value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }];

  /* Work tasks belong to Work › Tasks (GU.parts decides what's work). */
  const isWork = (t) => !!(GU.parts && GU.parts.isWorkTask(store.state, t));
  const workList = () => (GU.parts ? GU.parts.workListId(store.state) : null);
  const homeLists = () => store.state.todoLists.filter((l) => l.id !== workList());
  const homeTasks = () => store.state.tasks.filter((t) => !isWork(t));
  const workTasksTab = () => (GU.tabs['work-tasks'] ? 'work-tasks' : 'work');
  function forOptions() {
    const e = GU.workMoney ? GU.workMoney.employer(store.state) : { set: false };
    return [{ value: 'home', label: 'Home', icon: 'home' }, { value: 'work', label: e.set ? 'Work (' + e.short + ')' : 'Work', icon: 'briefcase' }];
  }

  function listName(id) {
    const l = store.state.todoLists.find((x) => x.id === id);
    return l ? l.name : '';
  }
  function bucket(t) {
    if (!t.due) return 'No date';
    const n = daysUntil(t.due);
    if (n < 0) return 'Overdue';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n <= 7) return 'Next 7 days';
    return 'Later';
  }
  const BUCKETS = ['Overdue', 'Today', 'Tomorrow', 'Next 7 days', 'Later', 'No date'];
  const prioRank = { high: 0, normal: 1, low: 2 };

  function viewTasks() {
    const all = homeTasks();
    const t = today();
    if (view === 'today') return all.filter((x) => !x.done && x.due && x.due <= t);
    if (view === 'upcoming') return all.filter((x) => !x.done && x.due && x.due > t);
    if (view === 'all') return all.filter((x) => !x.done);
    return all.filter((x) => !x.done && x.listId === view);
  }

  function taskHTML(t, showList) {
    const n = t.due ? daysUntil(t.due) : null;
    const due = t.due ? pill(n < 0 ? relDays(t.due).replace(' ago', ' late') : n <= 1 ? relDays(t.due) : fmtDate(t.due, { weekday: true }), n < 0 ? 'crit' : n === 0 ? 'warn' : 'muted', 'clock') : '';
    return '<li class="task' + (t.done ? ' is-done' : '') + (t.priority === 'high' ? ' is-high' : '') + '">' +
      '<input type="checkbox" class="tick" data-toggle="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + ' aria-label="Mark ' + esc(t.title) + ' as done">' +
      '<button type="button" class="task__main" data-edit="' + esc(t.id) + '"><b>' + esc(t.title) + '</b>' +
      (t.notes ? '<em>' + esc(t.notes.length > 90 ? t.notes.slice(0, 90) + '…' : t.notes) + '</em>' : '') + '</button>' +
      '<span class="task__meta">' + (t.priority === 'high' ? pill('High', 'crit', 'flag') : '') + (showList ? pill(listName(t.listId), 'muted') : '') + (t.done ? '' : due) + '</span></li>';
  }

  /* One line pointing to Work › Tasks, so work tasks don't look lost. */
  function signpostHTML(work) {
    if (!work.length) return '';
    const names = work.map((x) => x.title).filter(Boolean);
    const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ' and ' + (names.length - 2) + ' more' : '');
    return '<p class="note-line note-line--signpost">' + icon('briefcase') + '<span>' + esc(plural(work.length, 'work task') + (shown ? ' (' + shown + ')' : '') + (work.length === 1 ? ' is' : ' are') + ' in ') +
      '<a class="link" href="#' + workTasksTab() + '">' + esc(at('work-tasks', 'Work › Tasks')) + '</a>.</span></p>';
  }

  function render(root) {
    const s = store.state;
    const lists = homeLists();
    if (view !== 'today' && view !== 'upcoming' && view !== 'all' && !lists.some((l) => l.id === view)) view = 'today';
    const t = today();
    const mine = homeTasks();
    const open = mine.filter((x) => !x.done);
    const workOpen = s.tasks.filter((x) => !x.done && isWork(x));
    const counts = {
      today: open.filter((x) => x.due && x.due <= t).length,
      upcoming: open.filter((x) => x.due && x.due > t).length,
      all: open.length,
    };
    const smart = [
      { id: 'today', label: 'Today', icon: 'today', n: counts.today },
      { id: 'upcoming', label: 'Upcoming', icon: 'clock', n: counts.upcoming },
      { id: 'all', label: 'All tasks', icon: 'list', n: counts.all },
    ];
    const tasks = viewTasks().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || prioRank[a.priority || 'normal'] - prioRank[b.priority || 'normal']);
    const groups = BUCKETS.map((b) => ({ b, items: tasks.filter((x) => bucket(x) === b) })).filter((g) => g.items.length);
    const done = mine.filter((x) => x.done && (view === 'today' || view === 'upcoming' || view === 'all' || x.listId === view))
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 30);
    const isList = lists.some((l) => l.id === view);
    const title = isList ? listName(view) : smart.find((x) => x.id === view).label;
    const showList = !isList;

    root.innerHTML = GU.view.head({
      eyebrow: 'Life',
      title: 'Tasks',
      text: 'Type a task the way you’d say it, like “Renew car tax on Friday”, and I’ll set the date for you.',
    }) +
      signpostHTML(workOpen) +
      '<div class="split">' +
      '<nav class="lists" aria-label="Lists">' +
      smart.map((x) => '<button type="button" class="lists__item" data-view="' + x.id + '" aria-current="' + (view === x.id) + '">' + icon(x.icon) + '<span>' + esc(x.label) + '</span><b>' + (x.n || '') + '</b></button>').join('') +
      '<p class="lists__label">Your lists</p>' +
      lists.map((l) => '<button type="button" class="lists__item" data-view="' + esc(l.id) + '" aria-current="' + (view === l.id) + '">' + icon('list') + '<span>' + esc(l.name) + '</span><b>' + (open.filter((x) => x.listId === l.id).length || '') + '</b></button>').join('') +
      '<button type="button" class="lists__item lists__new" data-new-list>' + icon('plus') + '<span>New list</span></button>' +
      '</nav>' +
      '<div class="stack">' +
      '<form class="task-add" data-quick>' +
      '<input type="text" name="title" id="todo-title" placeholder="Add a task to ' + esc(isList ? title : listName((lists[0] || {}).id) || 'your list') + '" aria-label="New task" autocomplete="off">' +
      '<input type="date" name="due" aria-label="Due date"' + (view === 'today' ? ' value="' + t + '"' : '') + '>' +
      '<select name="priority" aria-label="Priority">' + selectOptions(PRIORITIES, 'normal') + '</select>' +
      (isList || !lists.length ? '' : '<select name="listId" aria-label="List">' + selectOptions(lists.map((l) => ({ value: l.id, label: l.name })), lists[0].id) + '</select>') +
      '<button type="submit" class="btn btn--primary">' + icon('plus') + 'Add</button></form>' +
      '<section class="panel"><header class="panel__head"><h2>' + esc(title) + '</h2>' +
      (isList ? '<span class="panel__tools"><button type="button" class="btn btn--sm btn--ghost" data-rename-list>' + icon('edit') + 'Rename</button><button type="button" class="btn btn--sm btn--ghost" data-delete-list>' + icon('trash') + 'Delete list</button></span>' : '<span class="muted">' + esc(plural(tasks.length, 'task')) + '</span>') + '</header>' +
      (groups.length ? groups.map((g) => '<div class="task-group' + (g.b === 'Overdue' ? ' task-group--overdue' : '') + '"><h3>' + esc(g.b) + '</h3><ul class="tasks">' + g.items.map((x) => taskHTML(x, showList)).join('') + '</ul></div>').join('')
        : emptyState({ icon: 'check', title: view === 'today' ? 'Nothing due today' : 'No open tasks here', text: view === 'today' ? 'Enjoy it, or plan ahead in Upcoming.' : 'Add one above.' })) +
      (done.length ? '<details class="task-done"' + (showDone ? ' open' : '') + '><summary>Completed (' + done.length + ')</summary><ul class="tasks">' + done.map((x) => taskHTML(x, showList)).join('') + '</ul></details>' : '') +
      '</section></div></div>';

    const det = root.querySelector('.task-done');
    if (det) det.addEventListener('toggle', () => (showDone = det.open));

    root.querySelector('[data-quick]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const raw = f.elements.title.value.trim();
      if (!raw) return;
      const parsed = GU.tabs.today.parseQuickTask(raw);
      const listId = isList ? view : f.elements.listId ? f.elements.listId.value : '';
      store.upsert('tasks', { id: 'k-' + uid(), listId, title: parsed.title || raw, due: parsed.due || f.elements.due.value, priority: f.elements.priority.value, notes: '', done: false, created: today() });
      setTimeout(() => {
        const el = document.getElementById('todo-title');
        if (el) el.focus();
      }, 0);
    });
    root.addEventListener('change', (e) => {
      const tg = e.target.closest('[data-toggle]');
      if (tg) complete(tg.dataset.toggle, tg.checked);
    });
    root.addEventListener('click', async (e) => {
      const v = e.target.closest('[data-view]');
      if (v) {
        view = v.dataset.view;
        return GU.render();
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) return edit(ed.dataset.edit);
      if (e.target.closest('[data-new-list]')) return newList();
      if (e.target.closest('[data-rename-list]')) return renameList(view);
      if (e.target.closest('[data-delete-list]')) {
        const n = mine.filter((x) => x.listId === view).length;
        const ok = await confirmBox({ title: 'Delete ' + esc(listName(view)) + '?', message: n ? 'This also deletes its ' + plural(n, 'task') + '.' : 'The list is empty.', confirmLabel: 'Delete list', danger: true });
        if (!ok) return;
        const id = view;
        view = 'today';
        store.commit((st) => {
          // Work tasks filed in this list aren't shown here, so they move to the Work list instead of going too.
          const keep = st.tasks.filter((x) => x.listId === id && GU.parts && GU.parts.isWorkTask(st, x));
          if (keep.length) {
            const wl = ensureWorkList(st);
            keep.forEach((x) => (x.listId = wl));
          }
          st.todoLists = st.todoLists.filter((l) => l.id !== id);
          st.tasks = st.tasks.filter((x) => x.listId !== id);
        });
      }
    });
  }

  function complete(id, done) {
    const t = store.find('tasks', id);
    if (!t) return;
    const val = done === undefined ? !t.done : done;
    store.commit((s) => {
      const x = s.tasks.find((k) => k.id === id);
      x.done = val;
      x.doneAt = val ? today() : '';
    });
    if (val) toast('Done: ' + t.title, { action: 'Undo', onAction: () => complete(id, false) });
  }

  /* The Work list, made if it isn't there yet. Inside a commit. */
  function ensureWorkList(st) {
    let id = GU.parts ? GU.parts.workListId(st) : null;
    if (!id) {
      id = 'list-work';
      st.todoLists.push({ id, name: 'Work' });
    }
    return id;
  }
  /* Puts a task where its 'For' says: the Work list for work, one of your own lists for home. Inside a commit. */
  function place(st, rec) {
    if (rec.context === 'work') {
      rec.listId = ensureWorkList(st);
      return;
    }
    rec.context = 'home';
    const wl = GU.parts ? GU.parts.workListId(st) : null;
    if (!rec.listId || rec.listId === wl || !st.todoLists.some((l) => l.id === rec.listId)) rec.listId = (st.todoLists.find((l) => l.id !== wl) || {}).id || '';
  }
  function save(rec) {
    store.commit((st) => {
      place(st, rec);
      const i = st.tasks.findIndex((x) => x.id === rec.id);
      if (i >= 0) st.tasks[i] = rec;
      else st.tasks.push(rec);
    });
  }
  const goWork = () => GU.view.go(workTasksTab());

  /* The task form, here and in Work › Tasks. 'For' moves a task between Home and Work; the list is one of
     your own (the Work list is what makes a task a work task). */
  function fields() {
    return [
      { name: 'title', label: 'Task', required: true },
      { name: 'context', label: 'For', type: 'segmented', options: forOptions(), default: 'home', half: true },
      { name: 'listId', label: 'List', type: 'select', options: homeLists().map((l) => ({ value: l.id, label: l.name })), half: true, showIf: (v) => v.context !== 'work' },
      { name: 'due', label: 'Due', type: 'date', half: true, optional: true },
      { name: 'priority', label: 'Priority', type: 'segmented', options: PRIORITIES, default: 'normal' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, optional: true },
    ];
  }

  function create(prefill, opts) {
    opts = opts || {};
    prefill = Object.assign({}, prefill || {});
    const lists = homeLists();
    const wl = workList();
    // Work when asked for (its context, or the Work list), or when nothing says and you're in Work.
    const work = prefill.context ? prefill.context === 'work' : (!!wl && prefill.listId === wl) || (!prefill.listId && !!GU.parts && GU.parts.get() === 'work');
    if (work) delete prefill.listId;
    formDialog({
      title: work ? 'New work task' : 'New task',
      fields: fields(),
      values: Object.assign({ listId: lists.some((l) => l.id === view) ? view : (lists[0] || {}).id, priority: 'normal', due: view === 'today' && !work ? today() : '' }, prefill, { context: work ? 'work' : 'home' }),
      submitLabel: 'Add task',
      onSubmit: (v) => {
        const rec = Object.assign({ id: 'k-' + uid(), done: false, created: today() }, v);
        save(rec);
        const when = rec.due ? ' for ' + relDays(rec.due) : '';
        // Added from Home but for work: say where it went, since it won't show on this page.
        if (rec.context === 'work' && GU.parts && GU.parts.get() !== 'work') toast('Added ' + rec.title + when + ' to ' + at('work-tasks', 'Work › Tasks'), { action: 'Open', onAction: goWork });
        else toast('Added ' + rec.title + when);
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
  }

  function edit(id) {
    const t = store.find('tasks', id);
    if (!t) return;
    const was = isWork(t) ? 'work' : 'home';
    formDialog({
      title: 'Edit task',
      fields: fields().concat([{ name: 'done', label: 'Done', type: 'checkbox', checkLabel: 'Done' }]),
      values: Object.assign({}, t, { context: was }),
      onSubmit: (v) => {
        const before = Object.assign({}, t);
        save(Object.assign({}, t, v, { doneAt: v.done ? t.doneAt || today() : '' }));
        if (v.context === was) return;
        const undo = () => store.upsert('tasks', before);
        if (v.context === 'work') toast('Moved to ' + at('work-tasks', 'Work › Tasks'), { action: 'Undo', onAction: undo });
        else toast('Moved to ' + at('todos', 'Home › To-do'), { action: 'Undo', onAction: undo });
      },
      onDelete: () => {
        store.remove('tasks', id);
      },
    });
  }

  function newList() {
    formDialog({
      title: 'New list',
      fields: [{ name: 'name', label: 'List name', required: true, placeholder: 'e.g. Wedding, Moving house, Shopping' }],
      submitLabel: 'Create list',
      onSubmit: (v) => {
        const id = 'list-' + uid();
        store.commit((s) => s.todoLists.push({ id, name: v.name }));
        view = id;
        GU.render();
      },
    });
  }
  function renameList(id) {
    const l = store.state.todoLists.find((x) => x.id === id);
    if (!l) return;
    formDialog({
      title: 'Rename list',
      fields: [{ name: 'name', label: 'List name', required: true }],
      values: { name: l.name },
      onSubmit: (v) => store.commit((s) => (s.todoLists.find((x) => x.id === id).name = v.name)),
    });
  }

  GU.tabs.todos = { label: 'Tasks', short: 'Tasks', icon: 'todo', part: 'home', render, create, edit, complete };
})();
