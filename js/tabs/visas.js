/* The Ground Up: Visa applications. Each application's stage, key dates, document checklist,
   notes timeline and uploaded files, plus reminders before an approved visa runs out. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, relDays, daysUntil, mask, plural } = GU.util;
  const { icon, pill, emptyState, selectOptions, formDialog, toast, thumbHTML, viewFiles, confirmBox } = GU.ui;
  const store = GU.store;

  const STATUSES = ['Planning', 'Preparing documents', 'Submitted', 'Biometrics / interview', 'Awaiting decision', 'Approved', 'Refused', 'Withdrawn'];
  const STAGES = ['Planning', 'Documents', 'Submitted', 'Biometrics', 'Decision pending', 'Decision'];
  const CHECKLIST = [
    'Passport (valid for the whole stay)', 'Passport photos', 'Completed application form', 'Bank statements (last 3–6 months)',
    'Proof of address or accommodation', 'Employer or sponsor letter', 'Travel insurance', 'Fee payment receipt',
  ];
  const openLogs = new Set();

  function stageIndex(status) {
    const i = STATUSES.indexOf(status);
    return i >= 5 ? 5 : Math.max(0, i);
  }
  function statusPill(v) {
    const tone = { Approved: 'good', Refused: 'crit', Withdrawn: 'muted', 'Awaiting decision': 'info', 'Biometrics / interview': 'info', Submitted: 'info' }[v.status] || 'warn';
    return pill(v.status, tone);
  }

  function facts(v) {
    const rows = [];
    if (v.submittedDate) rows.push(['Submitted', fmtDate(v.submittedDate)]);
    if (v.appointmentDate) rows.push([v.appointmentLabel || 'Appointment', fmtDate(v.appointmentDate, { weekday: true }) + (v.appointmentTime ? ', ' + v.appointmentTime : '') + (v.appointmentPlace ? ' · ' + v.appointmentPlace : ''), daysUntil(v.appointmentDate) >= 0 ? relDays(v.appointmentDate) : '']);
    if (v.decisionExpected && !['Approved', 'Refused', 'Withdrawn'].includes(v.status)) rows.push(['Decision expected', fmtDate(v.decisionExpected), relDays(v.decisionExpected)]);
    if (v.decisionDate) rows.push(['Decision', fmtDate(v.decisionDate)]);
    if (v.validFrom || v.validUntil) rows.push(['Valid', [v.validFrom && fmtDate(v.validFrom), v.validUntil && fmtDate(v.validUntil)].filter(Boolean).join(' to '), v.validUntil ? (daysUntil(v.validUntil) >= 0 ? 'ends ' + relDays(v.validUntil) : 'ended') : '']);
    if (v.reference) rows.push(['Reference', mask(v.reference)]);
    if (v.fee) rows.push(['Fees paid', money(v.fee)]);
    if (!rows.length) return '';
    return '<dl class="facts">' + rows.map((r) => '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + (r[2] ? ' <em>' + esc(r[2]) + '</em>' : '') + '</dd></div>').join('') + '</dl>';
  }

  function cardHTML(v) {
    const si = stageIndex(v.status);
    const closed = ['Refused', 'Withdrawn'].includes(v.status);
    const done = (v.checklist || []).filter((c) => c.done).length;
    const total = (v.checklist || []).length;
    const warnDays = store.state.settings.visaWarnDays || 120;
    const ending = v.status === 'Approved' && v.validUntil && daysUntil(v.validUntil) >= 0 && daysUntil(v.validUntil) <= warnDays;
    const log = (v.log || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    const showAll = openLogs.has(v.id);
    return '<article class="visa' + (closed ? ' is-closed' : '') + '" data-visa="' + esc(v.id) + '">' +
      '<header class="visa__head"><div><p class="eyebrow">' + esc([v.country, v.applicant].filter(Boolean).join(' · ')) + '</p><h2>' + esc(v.visaType) + '</h2></div>' +
      '<div class="visa__head-actions">' + statusPill(v) +
      '<label class="visually-hidden" for="vs-' + esc(v.id) + '">Change stage</label><select class="select-sm" id="vs-' + esc(v.id) + '" data-status="' + esc(v.id) + '">' + selectOptions(STATUSES.filter((x) => x !== v.status), '', 'Move to…') + '</select>' +
      '<button type="button" class="icon-btn" data-edit="' + esc(v.id) + '" aria-label="Edit application">' + icon('edit') + '</button></div></header>' +
      (ending ? '<p class="banner banner--warn">' + icon('alert') + '<span>This visa ends <b>' + esc(relDays(v.validUntil)) + '</b> (' + esc(fmtDate(v.validUntil)) + '). Check when you can apply to extend or switch, and start gathering documents.</span></p>' : '') +
      '<ol class="steps' + (closed ? ' steps--closed' : '') + '" aria-label="Stage ' + (si + 1) + ' of ' + STAGES.length + '">' + STAGES.map((st, i) =>
        '<li class="' + (i < si || (i === si && v.status === 'Approved') ? 'is-done' : i === si ? 'is-current' : '') + '"><span></span><em>' + esc(i === 5 && ['Approved', 'Refused', 'Withdrawn'].includes(v.status) ? v.status : st) + '</em></li>').join('') + '</ol>' +
      facts(v) +
      '<div class="visa__cols">' +
      '<section class="visa__block"><h3>Documents to gather <span class="muted">' + done + ' of ' + total + ' ready</span></h3>' +
      (total ? '<div class="meter"><i style="width:' + (total ? (done / total) * 100 : 0) + '%"></i></div>' : '') +
      '<ul class="checklist">' + (v.checklist || []).map((c) =>
        '<li><label class="check"><input type="checkbox" data-check="' + esc(v.id) + ':' + esc(c.id) + '"' + (c.done ? ' checked' : '') + '><span>' + esc(c.text) + '</span></label>' +
        '<button type="button" class="icon-btn icon-btn--sm" data-uncheck-del="' + esc(v.id) + ':' + esc(c.id) + '" aria-label="Remove ' + esc(c.text) + '">' + icon('x') + '</button></li>').join('') + '</ul>' +
      '<form class="inline-add" data-add-check="' + esc(v.id) + '"><input type="text" name="item" placeholder="Add a document to the list" aria-label="Add a document to the checklist"><button type="submit" class="btn btn--sm">Add</button></form></section>' +
      '<section class="visa__block"><h3>Notes and updates</h3>' +
      '<form class="inline-add" data-add-log="' + esc(v.id) + '"><input type="text" name="note" placeholder="e.g. Emailed sponsor for letter" aria-label="Add a note"><button type="submit" class="btn btn--sm">Add</button></form>' +
      (log.length ? '<ul class="log">' + (showAll ? log : log.slice(0, 4)).map((l) => '<li><time>' + esc(fmtDate(l.date, { short: true })) + '</time><span>' + esc(l.text) + '</span></li>').join('') + '</ul>' +
        (log.length > 4 ? '<button type="button" class="link link--btn" data-more-log="' + esc(v.id) + '">' + (showAll ? 'Show fewer' : 'Show all ' + log.length) + '</button>' : '') : '<p class="muted">No notes yet.</p>') +
      '</section></div>' +
      '<footer class="visa__foot"><div class="thumb-row">' + (v.files || []).map((f, i) => '<button type="button" class="thumb-btn" data-vfile="' + esc(v.id) + ':' + i + '" data-tip="' + esc(f.name) + '" aria-label="View ' + esc(f.name) + '">' + thumbHTML([f]) + '</button>').join('') +
      '<button type="button" class="btn btn--sm" data-vupload="' + esc(v.id) + '">' + icon('clip') + 'Add files</button></div>' +
      (v.portalUrl ? '<a class="link" href="' + esc(/^https?:\/\//.test(v.portalUrl) ? v.portalUrl : 'https://' + v.portalUrl) + '" target="_blank" rel="noopener">Open application website ' + icon('chevron') + '</a>' : '') + '</footer>' +
      '</article>';
  }

  function render(root) {
    const s = store.state;
    const order = (v) => (['Refused', 'Withdrawn'].includes(v.status) ? 2 : v.status === 'Approved' ? 1 : 0);
    const visas = s.visas.slice().sort((a, b) => order(a) - order(b) || (a.created || '').localeCompare(b.created || ''));
    root.innerHTML = GU.view.head({
      eyebrow: 'Life admin',
      title: 'Visa applications',
      text: 'Track each application from planning to decision: the documents you still need, appointments, and when each visa runs out.',
      actions: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'New application</button>',
    }) +
      (visas.length ? '<div class="stack">' + visas.map(cardHTML).join('') + '</div>'
        : '<section class="panel">' + emptyState({ icon: 'globe', title: 'No visa applications yet', text: 'Add one to get a ready-made document checklist and reminders for every key date.', action: '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Start an application</button>' }) + '</section>');

    root.addEventListener('change', (e) => {
      const st = e.target.closest('[data-status]');
      if (st) {
        const id = st.dataset.status;
        if (!st.value) return;
        store.commit((s2) => {
          const v = s2.visas.find((x) => x.id === id);
          v.status = st.value;
          v.log = (v.log || []).concat([{ id: uid(), date: today(), text: 'Stage changed to ' + st.value }]);
          if (['Approved', 'Refused'].includes(st.value) && !v.decisionDate) v.decisionDate = today();
          if (st.value === 'Submitted' && !v.submittedDate) v.submittedDate = today();
        });
        if (st.value === 'Approved') setTimeout(() => toast('Congratulations! Add the dates it’s valid for so I can remind you before it ends.', { action: 'Add dates', onAction: () => edit(id) }), 50);
        return;
      }
      const ck = e.target.closest('[data-check]');
      if (ck) {
        const [vid, cid] = ck.dataset.check.split(':');
        store.commit((s2) => {
          const item = s2.visas.find((x) => x.id === vid).checklist.find((c) => c.id === cid);
          item.done = ck.checked;
        });
      }
    });
    root.addEventListener('submit', (e) => {
      const f = e.target;
      e.preventDefault();
      if (f.dataset.addCheck) {
        const text = f.elements.item.value.trim();
        if (!text) return;
        store.commit((s2) => s2.visas.find((x) => x.id === f.dataset.addCheck).checklist.push({ id: uid(), text, done: false }));
      } else if (f.dataset.addLog) {
        const text = f.elements.note.value.trim();
        if (!text) return;
        store.commit((s2) => {
          const v = s2.visas.find((x) => x.id === f.dataset.addLog);
          v.log = (v.log || []).concat([{ id: uid(), date: today(), text }]);
        });
      }
    });
    root.addEventListener('click', async (e) => {
      if (e.target.closest('[data-add]')) return create();
      const ed = e.target.closest('[data-edit]');
      if (ed) return edit(ed.dataset.edit);
      const del = e.target.closest('[data-uncheck-del]');
      if (del) {
        const [vid, cid] = del.dataset.uncheckDel.split(':');
        return store.commit((s2) => {
          const v = s2.visas.find((x) => x.id === vid);
          v.checklist = v.checklist.filter((c) => c.id !== cid);
        });
      }
      const more = e.target.closest('[data-more-log]');
      if (more) {
        const id = more.dataset.moreLog;
        if (openLogs.has(id)) openLogs.delete(id);
        else openLogs.add(id);
        return GU.render();
      }
      const vf = e.target.closest('[data-vfile]');
      if (vf) {
        const [vid, i] = vf.dataset.vfile.split(':');
        const v = store.find('visas', vid);
        return viewFiles(v.files, +i, v.visaType);
      }
      const up = e.target.closest('[data-vupload]');
      if (up) {
        const files = await GU.ui.pickFiles();
        if (!files.length) return;
        const metas = [];
        for (const f of files) metas.push(await GU.files.add(f));
        store.commit((s2) => {
          const v = s2.visas.find((x) => x.id === up.dataset.vupload);
          v.files = (v.files || []).concat(metas);
          v.log = (v.log || []).concat([{ id: uid(), date: today(), text: 'Added ' + plural(metas.length, 'file') + ': ' + metas.map((m) => m.name).join(', ') }]);
        });
        toast('Added ' + plural(metas.length, 'file'));
      }
    });
  }

  function fields(isNew) {
    return [
      { name: 'visaType', label: 'Visa', required: true, placeholder: 'e.g. Skilled Worker visa, Schengen visa, Visitor visa' },
      { name: 'country', label: 'Country', half: true, placeholder: 'e.g. United Kingdom' },
      { name: 'applicant', label: 'Who is it for?', half: true, placeholder: 'e.g. Me, Mum' },
      { name: 'status', label: 'Stage', type: 'select', options: STATUSES, half: true },
      { name: 'reference', label: 'Application reference', half: true, optional: true },
      { name: 'submittedDate', label: 'Submitted', type: 'date', half: true, optional: true },
      { name: 'decisionExpected', label: 'Decision expected', type: 'date', half: true, optional: true },
      { name: 'appointmentLabel', label: 'Appointment type', half: true, optional: true, placeholder: 'e.g. Biometrics, Interview', list: ['Biometrics appointment', 'Interview', 'Document submission', 'Passport collection'] },
      { name: 'appointmentDate', label: 'Appointment date', type: 'date', half: true, optional: true },
      { name: 'appointmentTime', label: 'Time', type: 'time', half: true, optional: true },
      { name: 'appointmentPlace', label: 'Where', half: true, optional: true, placeholder: 'e.g. TLScontact London' },
      { name: 'validFrom', label: 'Valid from', type: 'date', half: true, optional: true },
      { name: 'validUntil', label: 'Valid until', type: 'date', half: true, optional: true },
      { name: 'fee', label: 'Fees paid', type: 'money', half: true, optional: true },
      { name: 'portalUrl', label: 'Application website', type: 'url', half: true, optional: true, placeholder: 'https://' },
      { name: 'useTemplate', label: 'Checklist', type: 'checkbox', checkLabel: 'Start with a standard document checklist (you can edit it)', showIf: () => isNew },
      { name: 'files', label: 'Files', type: 'files', dropLabel: 'Add letters, forms, confirmations' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true },
    ].filter((f) => isNew || f.name !== 'useTemplate');
  }

  function create(prefill, opts) {
    opts = opts || {};
    formDialog({
      title: 'New visa application',
      fields: fields(true),
      values: Object.assign({ status: 'Planning', useTemplate: true, applicant: 'Me' }, prefill || {}),
      initialFiles: opts.files,
      submitLabel: 'Add application',
      onSubmit: (v) => {
        const rec = Object.assign({ id: 'v-' + uid(), created: today(), log: [{ id: uid(), date: today(), text: 'Application added' }] }, v, {
          checklist: v.useTemplate ? CHECKLIST.map((text) => ({ id: uid(), text, done: false })) : [],
        });
        delete rec.useTemplate;
        store.upsert('visas', rec);
        toast('Added ' + rec.visaType);
        if (opts.onSaved) opts.onSaved(rec);
        if (location.hash !== '#visas') GU.view.go('visas');
      },
    });
  }

  function edit(id) {
    const v = store.find('visas', id);
    if (!v) return;
    formDialog({
      title: 'Edit application',
      fields: fields(false),
      values: v,
      onSubmit: (vals) => store.upsert('visas', Object.assign({}, v, vals)),
      onDelete: () => {
        store.remove('visas', id);
        toast('Application deleted');
      },
      deleteMessage: 'This deletes the application, its checklist, notes and files from this browser.',
    });
  }

  /* Adds files (and a note) to an existing application. Used by the Inbox. */
  function attach(id, metas, note) {
    store.commit((s) => {
      const v = s.visas.find((x) => x.id === id);
      if (!v) return;
      v.files = (v.files || []).concat(metas || []);
      v.log = (v.log || []).concat([{ id: uid(), date: today(), text: note || 'Added ' + plural((metas || []).length, 'file') }]);
    });
  }

  GU.tabs.visas = { label: 'Visa applications', short: 'Visas', icon: 'globe', render, create, edit, attach, STATUSES };
})();
