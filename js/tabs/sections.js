/* The Ground Up: your own categories (the records call them sections). Created by you or by the assistant when something
   doesn't fit the menu (Car, Pets, Wedding, Kids & school…). Each one is a simple filing drawer.
   A category belongs to Home unless it's marked as Work (section.part), and shows in that part's menu unless it's hidden
   (section.hidden). One named after a lender whose payment schedule Debts reads (Klarna, PayPal) is hidden by default,
   because it holds records rather than something you open every day; it's linked from Bills & debts and can be shown
   again in Settings. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, relDays, daysUntil, debounce } = GU.util;
  const { icon, pill, emptyState, formDialog, toast, thumbHTML, viewFiles, confirmBox } = GU.ui;
  const store = GU.store;

  const ICONS = [
    [/car|vehicle|motor/i, 'car'], [/pet|dog|cat|vet/i, 'paw'], [/health|medical|doctor|nhs/i, 'heart'], [/travel|holiday|trip|flight/i, 'plane'],
    [/school|kid|child|education|study|uni/i, 'book'], [/home|house|garden|property/i, 'home'], [/recipe|food|cook/i, 'note'], [/work|job|business/i, 'briefcase'],
  ];
  function iconFor(name) {
    const hit = ICONS.find(([re]) => re.test(name || ''));
    return hit ? hit[1] : 'star';
  }
  const queries = {};
  /* The part a section shows in: 'work' only when marked so. */
  const partOf = (sec) => (sec && sec.part === 'work' ? 'work' : 'home');
  /* ---------- in the menu, or hidden ---------- */
  const firstWord = (name) => String(name || '').toLowerCase().trim().split(/\s+/)[0] || '';
  /* The words that name a lender whose schedule Debts can read: the buy-now-pay-later ones (Klarna, PayPal, Clearpay…) and
     any lender you've added a debt for. Debts reads a category with that first word as the payment schedule. */
  function lenderWords(state) {
    const words = new Set();
    for (const l of (GU.debts && GU.debts.LENDERS) || []) if (l.type === 'Buy now pay later' && !l.exact) words.add(firstWord(l.name));
    for (const d of (state && state.debts) || []) for (const n of [d.lender, d.name]) words.add(firstWord(n));
    return new Set(Array.from(words).filter((w) => w.length >= 4));
  }
  /* Whether a category is a lender's records (Klarna, PayPal), by its name. */
  const isLenderRecord = (sec) => !!sec && lenderWords(store.state).has(firstWord(sec.name));
  /* Whether the menu leaves it out: what you chose, or by default when it's a lender's records. */
  const isHidden = (sec) => !!sec && (typeof sec.hidden === 'boolean' ? sec.hidden : isLenderRecord(sec));
  /* ---------- the order they're in ---------- */
  /* Your categories in the order you put them (section.order), or the order they were made in. */
  function ordered(list) {
    const all = (list || store.state.sections || []).map((sec, i) => ({ sec, i }));
    const key = (x) => (typeof x.sec.order === 'number' ? x.sec.order : x.i);
    return all.sort((a, b) => key(a) - key(b) || a.i - b.i).map((x) => x.sec);
  }
  /* Moves a category up or down among the others in the same part (and the same menu or hidden group), as one step in
     Undo. The first move gives every category its number, so the order you see is the order that's kept. */
  function move(id, dir) {
    const sec = (store.state.sections || []).find((x) => x.id === id);
    if (!sec) return false;
    const sibs = ordered().filter((x) => partOf(x) === partOf(sec) && isHidden(x) === isHidden(sec));
    const at = sibs.findIndex((x) => x.id === id);
    const other = sibs[at + (dir < 0 ? -1 : 1)];
    if (!other) return false;
    GU.history.seal();
    store.commit((st) => {
      const order = ordered(st.sections);
      order.forEach((x, i) => {
        if (x.order !== i) x.order = i;
      });
      const a = st.sections.find((x) => x.id === id);
      const b = st.sections.find((x) => x.id === other.id);
      const t = a.order;
      a.order = b.order;
      b.order = t;
    }, { label: 'Moved the category ‘' + sec.name + '’ ' + (dir < 0 ? 'up' : 'down') + ' in the menu' });
    return true;
  }
  /* The pages of the categories shown in a part's menu, in order. */
  const menuIds = (part) => {
    sync();
    return ordered().filter((sec) => partOf(sec) === part && !isHidden(sec)).map((sec) => 's-' + sec.id);
  };
  /* The categories that are a lender's records, for the line at the bottom of Debts. */
  const lenderRecords = () => (store.state.sections || []).filter((x) => isLenderRecord(x));
  function setHidden(id, hidden) {
    const sec = (store.state.sections || []).find((x) => x.id === id);
    if (!sec) return;
    const was = sec.hidden;
    store.commit((st) => {
      const x = (st.sections || []).find((y) => y.id === id);
      if (x) x.hidden = !!hidden;
    });
    return was;
  }
  const startOf = (part) => (GU.parts && GU.parts.PARTS[part] ? GU.parts.PARTS[part].start : 'today');
  const co = () => (GU.parts ? GU.parts.co(store.state) : 'work');
  const PART_OPTIONS = () => [{ value: 'home', label: 'Home', icon: 'home' }, { value: 'work', label: 'Work', icon: 'briefcase' }];

  function itemRow(it) {
    const due = it.dueDate ? pill((daysUntil(it.dueDate) < 0 ? 'Was due ' : 'Due ') + fmtDate(it.dueDate, { short: true }), daysUntil(it.dueDate) < 0 ? 'crit' : daysUntil(it.dueDate) <= 7 ? 'warn' : 'muted', 'clock') : '';
    return '<li class="doc-row">' +
      '<button type="button" class="doc-row__thumb" data-view="' + esc(it.id) + '" aria-label="' + (it.files && it.files.length ? 'View files for ' : 'Add a file to ') + esc(it.title) + '">' + thumbHTML(it.files) + '</button>' +
      '<button type="button" class="doc-row__main" data-edit="' + esc(it.id) + '"><b>' + esc(it.title) + '</b>' +
      '<em>' + esc([it.party, it.date && fmtDate(it.date, { short: true }), it.reference].filter(Boolean).join(' · ')) + '</em>' +
      (it.notes ? '<span class="doc-row__note">' + esc(it.notes.length > 140 ? it.notes.slice(0, 140) + '…' : it.notes) + '</span>' : '') +
      (due ? '<span class="doc-row__chips">' + due + '</span>' : '') + '</button>' +
      '<span class="doc-row__end">' + (it.amount != null ? '<b>' + esc(money(it.amount)) + '</b>' : '') + '<span class="doc-row__btns">' + GU.ui.dlButton(it.files, it.title) + GU.organise.moreBtn('sectionItems', it.id, it.title) + '</span></span></li>';
  }

  /* Items grouped by the subfolder they came from (ungrouped first). */
  function groupsOf(list) {
    const map = new Map();
    for (const it of list) {
      const g = it.group || '';
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(it);
    }
    return Array.from(map, ([name, items]) => ({ name, items })).sort((a, b) => (a.name === '' ? -1 : b.name === '' ? 1 : a.name.localeCompare(b.name)));
  }

  function makeTab(sec) {
    const tabId = 's-' + sec.id;
    function render(root) {
      const s = store.state;
      const live = (s.sections || []).find((x) => x.id === sec.id) || sec;
      const all = s.sectionItems.filter((x) => x.sectionId === sec.id).sort((a, b) => (b.date || b.created || '').localeCompare(a.date || a.created || ''));
      const q = (queries[sec.id] || '').toLowerCase();
      const list = all.filter((x) => !q || [x.title, x.party, x.notes, x.reference].join(' ').toLowerCase().includes(q));
      const work = partOf(live) === 'work';
      const hidden = isHidden(live);
      const lender = hidden && isLenderRecord(live);
      const note = lender
        ? '<p class="note-line note-line--back">' + icon('info') + '<span>Records from your lenders. They’re kept out of the menu, and Debts reads the payment schedule from here. <a class="link" href="#debts">Open Debts</a></span>' +
          '<button type="button" class="btn btn--sm" data-show-menu>Show in the menu</button></p>'
        : hidden ? '<p class="note-line note-line--back">' + icon('info') + '<span>This category is hidden from the menu. You can find it in Settings › Your categories.</span><button type="button" class="btn btn--sm" data-show-menu>Show in the menu</button></p>' : '';
      root.innerHTML = GU.view.head({
        eyebrow: lender ? 'Records from your lenders' : live.byAssistant ? 'Category started by your assistant' : 'Your category',
        title: live.name,
        text: live.byAssistant ? 'I started this category on ' + esc(fmtDate(live.created)) + ' because some things you sent me belong together. Rename it, move it or add to it any time.'
          : work ? 'A filing drawer for ' + esc(co()) + '. Drop anything related in here.' : 'Your own filing drawer. Drop anything related in here.',
        actions: '<button type="button" class="btn" data-rename>' + icon('edit') + 'Rename or move</button><button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add</button>',
      }) + note +
        GU.ui.dropbar('Drop anything for ' + live.name + ' here, or a whole folder', 'It all stays in ' + live.name + '. Subfolders become groups, so your own organisation is kept.') +
        '<div class="toolbar"><label class="search">' + icon('search') + '<input type="search" id="sec-search" placeholder="Search ' + esc(live.name) + '" value="' + esc(queries[sec.id] || '') + '" aria-label="Search"></label>' +
        '<span class="toolbar__gap"></span><button type="button" class="btn btn--sm btn--ghost" data-delete-section>' + icon('trash') + 'Delete category</button></div>' +
        (list.length ? groupsOf(list).map((g) => '<section class="panel">' + (g.name ? '<header class="panel__head"><h2>' + icon('folder') + esc(g.name) + '</h2><span class="muted">' + g.items.length + '</span></header>' : '') +
          '<ul class="doc-rows">' + g.items.map(itemRow).join('') + '</ul></section>').join('')
          : '<section class="panel"><ul class="doc-rows"><li>' + emptyState({ icon: live.icon || 'star', title: all.length ? 'Nothing matches' : 'Nothing here yet', text: 'Drop files or a folder above, or tell the Sorting hub to put things here.' }) + '</li></ul></section>');
      GU.ui.wireDropbar(root, (files) => GU.hub.add({ files, scope: { kind: 'section', sectionId: sec.id, name: live.name } }));

      root.querySelector('#sec-search').addEventListener('input', debounce((e) => {
        queries[sec.id] = e.target.value;
        GU.render();
        const el = document.getElementById('sec-search');
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 250));
      root.addEventListener('click', async (e) => {
        if (e.target.closest('[data-show-menu]')) {
          setHidden(sec.id, false);
          return toast('Showing ' + live.name + ' in the menu', { action: 'Undo', onAction: () => setHidden(sec.id, true) });
        }
        if (e.target.closest('[data-add]')) return createItem(sec.id);
        if (e.target.closest('[data-rename]')) return rename(sec.id);
        if (e.target.closest('[data-delete-section]')) return deleteSection(sec.id);
        const v = e.target.closest('[data-view]');
        if (v) {
          const it = store.find('sectionItems', v.dataset.view);
          if (it && it.files && it.files.length) viewFiles(it.files, 0, it.title);
          else editItem(v.dataset.view);
          return;
        }
        const ed = e.target.closest('[data-edit]');
        if (ed) editItem(ed.dataset.edit);
      });
    }
    return { label: sec.name, short: sec.name, icon: sec.icon || iconFor(sec.name), part: partOf(sec), render, edit: editItem, custom: true, tabId };
  }

  /* Deletes a category and what's filed in it into Recently deleted (one step, with Undo), after asking. */
  async function deleteSection(id) {
    const live = (store.state.sections || []).find((x) => x.id === id);
    if (!live) return false;
    const n = store.state.sectionItems.filter((x) => x.sectionId === id).length;
    const ok = await confirmBox({ title: 'Delete ' + esc(live.name) + '?', message: (n ? 'This deletes the category and the ' + n + ' thing' + (n === 1 ? '' : 's') + ' filed in it, including attached files.' : 'The category is empty.') + ' You can undo it, and it stays in Settings → Recently deleted for 30 days.', confirmLabel: 'Delete category', danger: true });
    if (!ok) return false;
    GU.history.seal();
    let entry = null;
    store.commit((st) => {
      const items = st.sectionItems.filter((x) => x.sectionId === id);
      st.sections = st.sections.filter((x) => x.id !== id);
      st.sectionItems = st.sectionItems.filter((x) => x.sectionId !== id);
      entry = GU.trash.put(st, 'sections', live, live.name + ' category', { sectionItems: items });
    }, { label: 'Deleted the category ‘' + live.name + '’' });
    GU.trash.offerUndo(entry);
    if (location.hash === '#s-' + id) GU.view.go(startOf(partOf(live)));
    return true;
  }

  function fields() {
    return [
      { name: 'title', label: 'What is it?', required: true },
      { name: 'party', label: 'From or with', half: true, optional: true },
      { name: 'date', label: 'Date', type: 'date', half: true, optional: true },
      { name: 'amount', label: 'Amount', type: 'money', half: true, optional: true },
      { name: 'dueDate', label: 'Remind me on', type: 'date', half: true, optional: true, help: 'Shows on your Today page.' },
      { name: 'reference', label: 'Reference number', optional: true, half: true },
      { name: 'group', label: 'Group', optional: true, half: true, placeholder: 'e.g. MOT, Insurance' },
      { name: 'files', label: 'Files', type: 'files' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, optional: true },
    ];
  }

  /* sectionRef: an existing section id, or {name} for a new section (opts.part 'work' makes it a Work section). */
  function createItem(sectionRef, prefill, opts) {
    opts = opts || {};
    const existing = typeof sectionRef === 'string' ? (store.state.sections || []).find((x) => x.id === sectionRef) : null;
    const name = existing ? existing.name : (sectionRef && sectionRef.name) || 'New category';
    formDialog({
      title: 'Add to ' + name,
      fields: (existing ? [] : [{ name: 'sectionName', label: 'Category name', required: true }]).concat(fields()),
      values: Object.assign({ sectionName: name }, prefill || {}),
      submitLabel: 'Add',
      onSubmit: (v) => {
        let sid = existing && existing.id;
        store.commit((st) => {
          if (!sid) {
            const found = st.sections.find((x) => x.name.toLowerCase() === v.sectionName.toLowerCase());
            if (found) sid = found.id;
            else {
              sid = 's' + uid();
              const sec = { id: sid, name: v.sectionName, icon: iconFor(v.sectionName), created: today(), byAssistant: !!opts.byAssistant };
              if (opts.part === 'work') sec.part = 'work';
              st.sections.push(sec);
            }
          }
          const rec = Object.assign({ id: 'si-' + uid(), created: today(), sectionId: sid }, v);
          delete rec.sectionName;
          st.sectionItems.push(rec);
        });
        toast('Added to ' + (existing ? existing.name : v.sectionName));
        if (opts.onSaved) opts.onSaved();
      },
    });
  }

  function editItem(id) {
    const it = store.find('sectionItems', id);
    if (!it) return;
    formDialog({
      title: 'Edit',
      fields: fields(),
      values: it,
      onSubmit: (v) => store.upsert('sectionItems', Object.assign({}, it, v)),
      onDelete: () => {
        store.remove('sectionItems', id, it.title);
      },
    });
  }

  /* Rename a section, or move it between Home and Work. */
  function rename(id) {
    const sec = store.state.sections.find((x) => x.id === id);
    if (!sec) return;
    const was = partOf(sec);
    formDialog({
      title: 'Rename or move category',
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'part', label: 'Show it in', type: 'segmented', options: PART_OPTIONS(), default: 'home', help: 'Work is for ' + esc(co()) + ' only. Everything else is Home.' },
      ],
      values: { name: sec.name, part: was },
      onSubmit: (v) => {
        const before = Object.assign({}, sec);
        const label = v.part !== was ? 'Moved the category ‘' + sec.name + '’ to ' + (v.part === 'work' ? 'Work' : 'Home') + (v.name !== sec.name ? ' and renamed it ‘' + v.name + '’' : '')
          : v.name !== sec.name ? 'Renamed the category ‘' + sec.name + '’ to ‘' + v.name + '’' : '';
        GU.history.seal();
        store.commit((st) => {
          const x = st.sections.find((y) => y.id === id);
          if (!x) return;
          x.name = v.name;
          x.icon = iconFor(v.name);
          x.part = v.part === 'work' ? 'work' : 'home';
        }, label ? { label } : null);
        // The page you're on follows the section into its new part.
        if (v.part !== was) toast('Moved ' + v.name + ' to ' + (v.part === 'work' ? 'Work' : 'Home'), { action: 'Undo', exact: true, onAction: () => store.upsert('sections', before) });
        else if (label) GU.history.offerUndo('Renamed to ‘' + v.name + '’');
      },
    });
  }

  /* A new section, in the part you're in (opts.part to choose). */
  function newSection(opts) {
    opts = opts || {};
    const part = opts.part === 'work' || opts.part === 'home' ? opts.part : GU.parts ? GU.parts.get() : 'home';
    formDialog({
      title: part === 'work' ? 'New work category' : 'New category',
      intro: part === 'work' ? 'Add a page for anything for ' + esc(co()) + ' that doesn’t fit the other Work pages, for example Vehicles, Premises or Training.'
        : 'Add a page to your menu for anything that doesn’t fit the menu, for example Car, Pets, Wedding or Garden.',
      fields: [{ name: 'name', label: 'Category name', required: true }],
      submitLabel: 'Create category',
      onSubmit: (v) => {
        const id = 's' + uid();
        store.commit((st) => st.sections.push({ id, name: v.name, icon: iconFor(v.name), created: today(), part }));
        GU.view.go('s-' + id);
      },
    });
  }

  /* Keeps GU.tabs in step with the sections in your data. */
  function sync() {
    for (const k of Object.keys(GU.tabs)) if (GU.tabs[k].custom) delete GU.tabs[k];
    const ids = [];
    for (const sec of store.state.sections || []) {
      const t = makeTab(sec);
      GU.tabs[t.tabId] = t;
      ids.push(t.tabId);
    }
    return ids;
  }

  GU.sections = { iconFor, sync, createItem, editItem, newSection, rename, partOf, isHidden, isLenderRecord, menuIds, lenderRecords, setHidden, ordered, move, deleteSection };
})();
