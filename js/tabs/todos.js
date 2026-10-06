/* The Ground Up: To-do lists. Several lists (Personal, Life admin, Work…), smart views for
   Today and Upcoming, quick add that understands "tomorrow" or "on Friday". */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, addDays, daysUntil, fmtDate, relDays, plural } = GU.util;
  const { icon, pill, emptyState, selectOptions, formDialog, toast, confirmBox } = GU.ui;
  const store = GU.store;

  let view = 'today';
  let showDone = false;
  const PRIORITIES = [{ value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }];

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
    const all = store.state.tasks;
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

  function render(root) {
    const s = store.state;
    if (view !== 'today' && view !== 'upcoming' && view !== 'all' && !s.todoLists.some((l) => l.id === view)) view = 'today';
    const t = today();
    const open = s.tasks.filter((x) => !x.done);
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
    const done = s.tasks.filter((x) => x.done && (view === 'today' || view === 'upcoming' || view === 'all' || x.listId === view))
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 30);
    const isList = s.todoLists.some((l) => l.id === view);
    const title = isList ? listName(view) : smart.find((x) => x.id === view).label;
    const showList = !isList;

    root.innerHTML = GU.view.head({
      eyebrow: 'Life admin',
      title: 'To-do lists',
      text: 'Type a task the way you’d say it, like “Renew car tax on Friday”, and I’ll set the date for you.',
    }) +
      '<div class="split">' +
      '<nav class="lists" aria-label="Lists">' +
      smart.map((x) => '<button type="button" class="lists__item" data-view="' + x.id + '" aria-current="' + (view === x.id) + '">' + icon(x.icon) + '<span>' + esc(x.label) + '</span><b>' + (x.n || '') + '</b></button>').join('') +
      '<p class="lists__label">Your lists</p>' +
      s.todoLists.map((l) => '<button type="button" class="lists__item" data-view="' + esc(l.id) + '" aria-current="' + (view === l.id) + '">' + icon('list') + '<span>' + esc(l.name) + '</span><b>' + (open.filter((x) => x.listId === l.id).length || '') + '</b></button>').join('') +
      '<button type="button" class="lists__item lists__new" data-new-list>' + icon('plus') + '<span>New list</span></button>' +
      '</nav>' +
      '<div class="stack">' +
      '<form class="task-add" data-quick>' +
      '<input type="text" name="title" id="todo-title" placeholder="Add a task to ' + esc(isList ? title : listName((s.todoLists[0] || {}).id) || 'your list') + '" aria-label="New task" autocomplete="off">' +
      '<input type="date" name="due" aria-label="Due date"' + (view === 'today' ? ' value="' + t + '"' : '') + '>' +
      '<select name="priority" aria-label="Priority">' + selectOptions(PRIORITIES, 'normal') + '</select>' +
      (isList ? '' : '<select name="listId" aria-label="List">' + selectOptions(s.todoLists.map((l) => ({ value: l.id, label: l.name })), (s.todoLists[0] || {}).id) + '</select>') +
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
      const listId = isList ? view : f.elements.listId.value;
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
        const n = s.tasks.filter((x) => x.listId === view).length;
        const ok = await confirmBox({ title: 'Delete ' + esc(listName(view)) + '?', message: n ? 'This also deletes its ' + plural(n, 'task') + '.' : 'The list is empty.', confirmLabel: 'Delete list', danger: true });
        if (!ok) return;
        const id = view;
        view = 'today';
        store.commit((st) => {
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

  function fields() {
    return [
      { name: 'title', label: 'Task', required: true },
      { name: 'listId', label: 'List', type: 'select', options: store.state.todoLists.map((l) => ({ value: l.id, label: l.name })), half: true },
      { name: 'due', label: 'Due', type: 'date', half: true, optional: true },
      { name: 'priority', label: 'Priority', type: 'segmented', options: PRIORITIES, default: 'normal' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, optional: true },
    ];
  }

  function create(prefill, opts) {
    opts = opts || {};
    const s = store.state;
    formDialog({
      title: 'New task',
      fields: fields(),
      values: Object.assign({ listId: s.todoLists.some((l) => l.id === view) ? view : (s.todoLists[0] || {}).id, priority: 'normal', due: view === 'today' ? today() : '' }, prefill || {}),
      submitLabel: 'Add task',
      onSubmit: (v) => {
        const rec = Object.assign({ id: 'k-' + uid(), done: false, created: today() }, v);
        store.upsert('tasks', rec);
        toast('Added ' + rec.title + (rec.due ? ' for ' + relDays(rec.due) : ''));
        if (opts.onSaved) opts.onSaved(rec);
      },
    });
  }

  function edit(id) {
    const t = store.find('tasks', id);
    if (!t) return;
    formDialog({
      title: 'Edit task',
      fields: fields().concat([{ name: 'done', label: 'Done', type: 'checkbox', checkLabel: 'Done' }]),
      values: t,
      onSubmit: (v) => store.upsert('tasks', Object.assign({}, t, v, { doneAt: v.done ? t.doneAt || today() : '' })),
      onDelete: () => {
        const rec = store.remove('tasks', id);
        toast('Task deleted', { action: 'Undo', onAction: () => store.upsert('tasks', rec) });
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

  GU.tabs.todos = { label: 'To-do lists', short: 'To-do', icon: 'todo', render, create, edit, complete };
})();
