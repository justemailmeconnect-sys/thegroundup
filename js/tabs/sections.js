/* The Ground Up: your own sections. Created by you or by the assistant when something doesn't fit
   the built-in tabs (Car, Pets, Travel, Kids & school…). Each one is a simple filing drawer. */
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

  function itemRow(it) {
    const due = it.dueDate ? pill((daysUntil(it.dueDate) < 0 ? 'Was due ' : 'Due ') + fmtDate(it.dueDate, { short: true }), daysUntil(it.dueDate) < 0 ? 'crit' : daysUntil(it.dueDate) <= 7 ? 'warn' : 'muted', 'clock') : '';
    return '<li class="doc-row">' +
      '<button type="button" class="doc-row__thumb" data-view="' + esc(it.id) + '" aria-label="' + (it.files && it.files.length ? 'View files for ' : 'Add a file to ') + esc(it.title) + '">' + thumbHTML(it.files) + '</button>' +
      '<button type="button" class="doc-row__main" data-edit="' + esc(it.id) + '"><b>' + esc(it.title) + '</b>' +
      '<em>' + esc([it.party, it.date && fmtDate(it.date, { short: true }), it.reference].filter(Boolean).join(' · ')) + '</em>' +
      (it.notes ? '<span class="doc-row__note">' + esc(it.notes.length > 140 ? it.notes.slice(0, 140) + '…' : it.notes) + '</span>' : '') +
      (due ? '<span class="doc-row__chips">' + due + '</span>' : '') + '</button>' +
      '<span class="doc-row__end">' + (it.amount != null ? '<b>' + esc(money(it.amount)) + '</b>' : '') + '</span></li>';
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
      root.innerHTML = GU.view.head({
        eyebrow: live.byAssistant ? 'Section started by your assistant' : 'Your section',
        title: live.name,
        text: live.byAssistant ? 'I started this section on ' + esc(fmtDate(live.created)) + ' because some things you sent me belong together. Rename it or add to it any time.' : 'Your own filing drawer. Drop anything related in here.',
        actions: '<button type="button" class="btn" data-rename>' + icon('edit') + 'Rename</button><button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add</button>',
      }) +
        GU.ui.dropbar('Drop anything for ' + live.name + ' here, or a whole folder', 'It all stays in ' + live.name + '. Subfolders become groups, so your own organisation is kept.') +
        '<div class="toolbar"><label class="search">' + icon('search') + '<input type="search" id="sec-search" placeholder="Search ' + esc(live.name) + '" value="' + esc(queries[sec.id] || '') + '" aria-label="Search"></label>' +
        '<span class="toolbar__gap"></span><button type="button" class="btn btn--sm btn--ghost" data-delete-section>' + icon('trash') + 'Delete section</button></div>' +
        (list.length ? groupsOf(list).map((g) => '<section class="panel">' + (g.name ? '<header class="panel__head"><h2>' + icon('folder') + esc(g.name) + '</h2><span class="muted">' + g.items.length + '</span></header>' : '') +
          '<ul class="doc-rows">' + g.items.map(itemRow).join('') + '</ul></section>').join('')
          : '<section class="panel"><ul class="doc-rows"><li>' + emptyState({ icon: live.icon || 'star', title: all.length ? 'Nothing matches' : 'Nothing here yet', text: 'Drop files or a folder above, or send things to the Inbox and I’ll put them here.' }) + '</li></ul></section>');
      GU.ui.wireDropbar(root, (files) => GU.inbox.add({ files, scope: { kind: 'section', sectionId: sec.id, name: live.name } }));

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
        if (e.target.closest('[data-add]')) return createItem(sec.id);
        if (e.target.closest('[data-rename]')) return rename(sec.id);
        if (e.target.closest('[data-delete-section]')) {
          const n = all.length;
          const ok = await confirmBox({ title: 'Delete ' + esc(live.name) + '?', message: (n ? 'This deletes the section and the ' + n + ' thing' + (n === 1 ? '' : 's') + ' filed in it, including attached files.' : 'The section is empty.') + ' You can undo it, and it stays in Settings → Recently deleted for 30 days.', confirmLabel: 'Delete section', danger: true });
          if (!ok) return;
          let entry = null;
          store.commit((st) => {
            const items = st.sectionItems.filter((x) => x.sectionId === sec.id);
            st.sections = st.sections.filter((x) => x.id !== sec.id);
            st.sectionItems = st.sectionItems.filter((x) => x.sectionId !== sec.id);
            entry = GU.trash.put(st, 'sections', live, live.name + ' section', { sectionItems: items });
          });
          GU.trash.offerUndo(entry);
          GU.view.go('today');
          return;
        }
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
    return { label: sec.name, short: sec.name, icon: sec.icon || iconFor(sec.name), render, edit: editItem, custom: true, tabId };
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

  /* sectionRef: an existing section id, or {name} for a new section. */
  function createItem(sectionRef, prefill, opts) {
    opts = opts || {};
    const existing = typeof sectionRef === 'string' ? (store.state.sections || []).find((x) => x.id === sectionRef) : null;
    const name = existing ? existing.name : (sectionRef && sectionRef.name) || 'New section';
    formDialog({
      title: 'Add to ' + name,
      fields: (existing ? [] : [{ name: 'sectionName', label: 'Section name', required: true }]).concat(fields()),
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
              st.sections.push({ id: sid, name: v.sectionName, icon: iconFor(v.sectionName), created: today(), byAssistant: !!opts.byAssistant });
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

  function rename(id) {
    const sec = store.state.sections.find((x) => x.id === id);
    formDialog({
      title: 'Rename section',
      fields: [{ name: 'name', label: 'Name', required: true }],
      values: { name: sec.name },
      onSubmit: (v) => store.commit((st) => {
        const x = st.sections.find((y) => y.id === id);
        x.name = v.name;
        x.icon = iconFor(v.name);
      }),
    });
  }

  function newSection() {
    formDialog({
      title: 'New section',
      intro: 'Make a drawer for anything that doesn’t fit the other tabs, for example Car, Pets, Wedding or Garden.',
      fields: [{ name: 'name', label: 'Section name', required: true }],
      submitLabel: 'Create section',
      onSubmit: (v) => {
        const id = 's' + uid();
        store.commit((st) => st.sections.push({ id, name: v.name, icon: iconFor(v.name), created: today() }));
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

  GU.sections = { iconFor, sync, createItem, editItem, newSection };
})();
