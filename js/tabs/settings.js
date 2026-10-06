/* The Ground Up: Settings. About you, how the assistant reads things, reminders, accounts,
   category rules, backup and restore. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, fmtBytes, plural } = GU.util;
  const { icon, selectOptions, toast, confirmBox, formDialog } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const CURRENCIES = [
    ['GBP', 'British pound (£)'], ['EUR', 'Euro (€)'], ['USD', 'US dollar ($)'], ['CAD', 'Canadian dollar'], ['AUD', 'Australian dollar'], ['NZD', 'New Zealand dollar'],
    ['INR', 'Indian rupee (₹)'], ['PKR', 'Pakistani rupee'], ['NGN', 'Nigerian naira (₦)'], ['ZAR', 'South African rand'], ['AED', 'UAE dirham'], ['PHP', 'Philippine peso'],
    ['CHF', 'Swiss franc'], ['PLN', 'Polish złoty'], ['JPY', 'Japanese yen'],
  ].map(([value, label]) => ({ value, label }));

  async function saveFile(blob, filename) {
    try {
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) {
        await dl.save({ filename, data: blob });
        return;
      }
    } catch (e) {
      if (e && e.code === 'cancelled') return;
    }
    GU.ui.download(blob, filename);
  }

  function syncHTML() {
    const sy = GU.sync.status();
    const on = GU.sync.active();
    const rf = Object.values(store.state.remoteFiles || {});
    const up = rf.filter((f) => f.asset).length;
    const local = rf.filter((f) => f.skip).length;
    const when = sy.savedAt ? new Date(sy.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const tone = sy.mode === 'error' ? 'crit' : on ? 'good' : 'muted';
    return '<header class="panel__head"><h2>' + icon('repeat') + 'Sync across your devices</h2>' + GU.ui.pill(on ? (sy.mode === 'saving' ? 'Saving…' : 'On') : sy.mode === 'connecting' ? 'Connecting…' : sy.mode === 'error' ? 'Problem' : 'Off', tone) + '</header>' +
      '<div class="panel__body stack"><p>' + esc(sy.message) + (on && when && sy.mode === 'on' ? ' Last saved at ' + esc(when) + '.' : '') + '</p>' +
      (on ? '<p class="muted">Open this same dashboard link on your phone, tablet or another computer while signed in to claude.ai, and everything is there. Changes show up on your other devices within a few seconds. Your records are kept in your own private space: even if you share the link, nobody else can read them.</p>' +
        '<p class="muted">' + esc(plural(up, 'file') + ' synced' + (sy.files.waiting ? ', ' + sy.files.waiting + ' uploading' : '') + (local ? '. ' + plural(local, 'file') + ' (Word, Excel or iPhone HEIC photos) can only be opened on the device that added them' : '') + '.') + ' Anyone you give edit access to this dashboard could open synced files, so keep the link to yourself.</p>'
        : '<p class="muted">Sync works when you open this dashboard from claude.ai while signed in. Anywhere else, move your data with Export backup and Restore below.</p>') +
      '</div>';
  }
  GU.sync.onStatus(() => {
    const el = document.querySelector('[data-sync]');
    if (el) el.innerHTML = syncHTML();
  });

  /* The same account imported twice under two names: fold one into the other. */
  function mergeAccount(fromId) {
    const s = store.state;
    const from = s.accounts.find((a) => a.id === fromId);
    const others = s.accounts.filter((a) => a.id !== fromId);
    const preview = (intoId) => {
      const copy = { transactions: s.transactions.map((t) => Object.assign({}, t)), accounts: s.accounts.map((a) => Object.assign({}, a)) };
      return GU.money.mergeAccounts(copy, fromId, intoId);
    };
    formDialog({
      title: 'Merge ' + from.name + ' into another account',
      intro: 'Use this when the same bank account was imported under two names. Its transactions move across, any that are already there (the same amount within 2 days) are dropped so nothing is counted twice, and “' + esc(from.name) + '” is removed.',
      fields: [
        { name: 'into', label: 'Merge into', type: 'select', options: others.map((a) => ({ value: a.id, label: a.name })) },
        { name: 'preview', type: 'html', html: '<p class="field__help" data-preview></p>' },
      ],
      values: { into: (others.find((a) => a.bank && from.bank && a.bank === from.bank) || others[0]).id },
      submitLabel: 'Merge',
      onChange: (v, form) => {
        const r = preview(v.into);
        form.querySelector('[data-preview]').textContent = plural(r.moved, 'transaction') + ' will move across and ' + plural(r.duplicates, 'duplicate') + ' will be dropped.';
      },
      onSubmit: (v) => {
        const before = { transactions: store.state.transactions, accounts: store.state.accounts, bills: store.state.bills };
        let r;
        store.commit((st) => {
          st.transactions = st.transactions.map((t) => Object.assign({}, t));
          st.accounts = st.accounts.map((a) => Object.assign({}, a));
          st.bills = st.bills.map((b) => Object.assign({}, b));
          r = GU.money.mergeAccounts(st, fromId, v.into);
          GU.recurring.reassignBills(st);
        });
        toast('Merged. ' + plural(r.moved, 'transaction') + ' moved and ' + plural(r.duplicates, 'duplicate') + ' removed.', { timeout: 12000, action: 'Undo', onAction: () => store.commit((st) => Object.assign(st, before)) });
      },
    });
  }

  function ago(iso) {
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' minutes ago';
    if (mins < 60 * 24) return plural(Math.round(mins / 60), 'hour') + ' ago';
    return plural(Math.round(mins / 1440), 'day') + ' ago';
  }
  function trashHTML(s) {
    const list = s.trash || [];
    return '<section class="panel" id="deleted"><header class="panel__head"><h2>' + icon('trash') + 'Recently deleted</h2><span class="muted">kept for 30 days</span></header>' +
      (list.length ? '<ul class="rows rows--tight">' + list.slice(0, 50).map((e) => '<li class="row-item"><span class="row-item__text"><b>' + esc(e.label) + '</b><em>' +
        esc((GU.trash.KIND[e.c] || 'Item') + ' · deleted ' + ago(e.at)) + '</em></span><span class="row-item__act"><button type="button" class="btn btn--sm btn--soft" data-restore="' + esc(e.id) + '">' + icon('repeat') + 'Restore</button></span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">Anything you delete shows up here for 30 days, so you can put it back.</p></div>') + '</section>';
  }

  function render(root) {
    const s = store.state;
    const st = s.settings;
    root.innerHTML = GU.view.head({ eyebrow: 'You', title: 'Settings', text: 'How your assistant works for you.' + (GU.sync.active() ? ' Your data syncs across your devices.' : ' Everything here is saved in this browser only.') }) +
      '<div class="settings">' +
      '<section class="panel" data-sync>' + syncHTML() + '</section>' +
      trashHTML(s) +

      '<section class="panel"><header class="panel__head"><h2>About you</h2></header><form class="panel__body form-grid" data-form="about">' +
      '<div class="field field--half"><label class="field__label" for="set-name">Your first name</label><input id="set-name" name="name" value="' + esc(st.name) + '" placeholder="Used in your greeting"></div>' +
      '<div class="field field--half"><label class="field__label" for="set-biz">Business or trading name <span class="opt">optional</span></label><input id="set-biz" name="business" value="' + esc(st.business || '') + '" placeholder="Helps me spot invoices you send"></div>' +
      '<div class="field field--half"><label class="field__label" for="set-cur">Currency</label><select id="set-cur" name="currency">' + selectOptions(CURRENCIES, st.currency) + '</select></div>' +
      '<div class="field field--half"><span class="field__label">Appearance</span><div class="seg">' + ['system', 'light', 'dark'].map((t) => '<label><input type="radio" name="theme" value="' + t + '"' + (st.theme === t ? ' checked' : '') + '><span>' + (t === 'system' ? 'Match device' : t[0].toUpperCase() + t.slice(1)) + '</span></label>').join('') + '</div></div>' +
      '<div class="field"><button type="submit" class="btn btn--primary">Save</button></div></form></section>' +

      '<section class="panel" id="assistant"><header class="panel__head"><h2>How your assistant reads things</h2><span data-mode class="muted"></span></header><form class="panel__body form-grid" data-form="brain">' +
      '<div class="field"><p class="tip">' + icon('info') + '<span>When you open this app inside the Claude app, I use Claude through your Claude account automatically. Anywhere else, you can add an Anthropic API key below. Without either, I read files offline on this device using text in PDFs, photo text recognition and keyword rules. That works for clear receipts and letters but is less accurate.</span></p></div>' +
      '<div class="field field--half"><label class="field__label" for="set-key">Anthropic API key <span class="opt">optional</span></label><input id="set-key" name="apiKey" type="password" autocomplete="off" value="' + esc(st.apiKey || '') + '" placeholder="sk-ant-…"><p class="field__help">Stored only in this browser and sent only to Anthropic when I read an item. Get one at console.anthropic.com. Each item costs about a penny or two.</p></div>' +
      '<div class="field field--half"><label class="field__label" for="set-model">Claude model</label><input id="set-model" name="model" value="' + esc(st.model || '') + '" placeholder="claude-opus-5-5"><p class="field__help">Leave empty to use the recommended model.</p></div>' +
      '<div class="field"><label class="check"><input type="checkbox" name="autoFile"' + (st.autoFile !== false ? ' checked' : '') + '><span>File things automatically when I’m sure where they go (you can always undo)</span></label></div>' +
      '<div class="field"><label class="check"><input type="checkbox" name="ocr"' + (st.ocr !== false ? ' checked' : '') + '><span>Read text in photos on this device when Claude isn’t connected (downloads a 10 MB reader the first time)</span></label></div>' +
      '<div class="field field--row"><button type="submit" class="btn btn--primary">Save</button><button type="button" class="btn" data-test>' + icon('check') + 'Test Claude connection</button><span class="muted" data-test-out></span></div></form></section>' +

      '<section class="panel"><header class="panel__head"><h2>Reminders</h2></header><form class="panel__body form-grid" data-form="reminders">' +
      '<div class="field field--half"><label class="field__label" for="set-doc">Warn me before documents expire</label><select id="set-doc" name="docWarnDays">' + selectOptions([30, 60, 90, 120, 180].map((n) => ({ value: n, label: n + ' days before' })), st.docWarnDays) + '</select></div>' +
      '<div class="field field--half"><label class="field__label" for="set-visa">Warn me before a visa runs out</label><select id="set-visa" name="visaWarnDays">' + selectOptions([60, 90, 120, 180, 240].map((n) => ({ value: n, label: n + ' days before' })), st.visaWarnDays) + '</select></div>' +
      '<div class="field"><button type="submit" class="btn btn--primary">Save</button></div></form></section>' +

      '<section class="panel"><header class="panel__head"><h2>Bank accounts</h2><button type="button" class="btn btn--sm btn--ghost" data-add-account>' + icon('plus') + 'Add</button></header><ul class="rows rows--tight">' +
      s.accounts.map((a) => {
        const n = s.transactions.filter((t) => t.account === a.id).length;
        return '<li class="row-item"><span class="row-item__icon">' + icon('bank') + '</span><span class="row-item__text"><b>' + esc(a.name) + '</b><em>' + esc(plural(n, 'transaction')) + '</em></span><span class="row-item__act">' +
          '<button type="button" class="btn btn--sm btn--ghost" data-rename-account="' + esc(a.id) + '">Rename</button>' +
          (s.accounts.length > 1 && n ? '<button type="button" class="btn btn--sm btn--ghost" data-merge-account="' + esc(a.id) + '">Merge into…</button>' : '') +
          (s.accounts.length > 1 ? '<button type="button" class="btn btn--sm btn--ghost" data-delete-account="' + esc(a.id) + '">Delete</button>' : '') + '</span></li>';
      }).join('') + '</ul></section>' +

      '<section class="panel"><header class="panel__head"><h2>Category rules</h2><span class="muted">' + s.rules.length + '</span></header>' +
      (s.rules.length ? '<ul class="rows rows--tight">' + s.rules.map((r) => '<li class="row-item"><span class="row-item__text"><b>“' + esc(r.match) + '”</b><em>always goes to ' + esc(r.category) + '</em></span><span class="row-item__act"><button type="button" class="btn btn--sm btn--ghost" data-delete-rule="' + esc(r.id) + '">Remove</button></span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">When you change a transaction’s category you can tick “always use this category”. Those rules appear here.</p></div>') + '</section>' +

      '<section class="panel"><header class="panel__head"><h2>Your sections</h2><button type="button" class="btn btn--sm btn--ghost" data-new-section>' + icon('plus') + 'New section</button></header>' +
      ((s.sections || []).length ? '<ul class="rows rows--tight">' + s.sections.map((x) => '<li class="row-item"><span class="row-item__icon">' + icon(x.icon || 'star') + '</span><span class="row-item__text"><b>' + esc(x.name) + '</b><em>' + esc(plural(s.sectionItems.filter((i) => i.sectionId === x.id).length, 'item')) + (x.byAssistant ? ' · started by your assistant' : '') + '</em></span><span class="row-item__act"><a class="btn btn--sm btn--ghost" href="#s-' + esc(x.id) + '">Open</a></span></li>').join('') + '</ul>'
        : '<div class="panel__body"><p class="muted">No extra sections yet. I’ll suggest one when something you send me doesn’t fit the other tabs.</p></div>') + '</section>' +

      '<section class="panel"><header class="panel__head"><h2>Backup and restore</h2><span class="muted" data-usage></span></header><div class="panel__body stack">' +
      '<p class="tip">' + icon('lock') + '<span>Your data lives only in this browser on this device. Nothing is sent to a server. Export a backup regularly (it includes your uploaded files) and keep it somewhere safe, so you can restore it on another device or if this browser is cleared.</span></p>' +
      '<div class="field--row"><button type="button" class="btn btn--primary" data-export>' + icon('download') + 'Export backup</button>' +
      '<label class="btn">' + icon('upload') + 'Restore from backup<input type="file" accept=".json,application/json" hidden data-import></label></div></div></section>' +

      '<section class="panel"><header class="panel__head"><h2>Example data</h2></header><div class="panel__body field--row">' +
      '<button type="button" class="btn" data-load-demo>Load example data</button><button type="button" class="btn" data-clear-demo>Clear example data</button>' +
      '<button type="button" class="btn btn--danger" data-erase>' + icon('trash') + 'Erase everything</button></div></section>' +
      '</div>';

    GU.brain.mode().then((m) => {
      const el = root.querySelector('[data-mode]');
      if (el) el.textContent = 'Now using: ' + GU.brain.modeLabel(m);
    });
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((est) => {
        const el = root.querySelector('[data-usage]');
        if (el && est.usage != null) el.textContent = fmtBytes(est.usage) + ' used';
      }).catch(() => {});
    }

    root.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const kind = f.dataset.form;
      store.commit((s2) => {
        const set = s2.settings;
        if (kind === 'about') {
          set.name = f.elements.name.value.trim();
          set.business = f.elements.business.value.trim();
          set.currency = f.elements.currency.value;
          set.theme = (f.querySelector('input[name=theme]:checked') || {}).value || 'system';
        } else if (kind === 'brain') {
          set.apiKey = f.elements.apiKey.value.trim();
          set.model = f.elements.model.value.trim();
          set.autoFile = f.elements.autoFile.checked;
          set.ocr = f.elements.ocr.checked;
        } else if (kind === 'reminders') {
          set.docWarnDays = +f.elements.docWarnDays.value;
          set.visaWarnDays = +f.elements.visaWarnDays.value;
        }
      });
      toast('Saved');
    });

    root.addEventListener('click', async (e) => {
      const b = (sel) => e.target.closest(sel);
      if (b('[data-test]')) {
        const out = root.querySelector('[data-test-out]');
        const key = root.querySelector('#set-key').value.trim();
        if (key !== (store.state.settings.apiKey || '')) store.commit((s2) => (s2.settings.apiKey = key));
        out.textContent = 'Asking Claude…';
        try {
          const r = await GU.brain.analyse({ files: [], note: 'Receipt: Tesco Express, total £4.20, paid today by card' });
          out.textContent = r.via === 'offline' ? (r.warning || 'Claude isn’t connected. Add an API key, or open the app inside Claude.') : 'Connected. Claude read the test as: ' + r.summary;
        } catch (err) {
          out.textContent = 'That didn’t work: ' + (err && err.message ? err.message : 'unknown error');
        }
        return;
      }
      if (b('[data-add-account]')) {
        return formDialog({ title: 'Add a bank account', fields: [{ name: 'name', label: 'Account name', required: true, placeholder: 'e.g. Monzo, Barclays savings, Amex' }], submitLabel: 'Add',
          onSubmit: (v) => store.commit((s2) => s2.accounts.push({ id: 'acc-' + uid(), name: v.name })) });
      }
      const ra = b('[data-rename-account]');
      if (ra) {
        const a = store.state.accounts.find((x) => x.id === ra.dataset.renameAccount);
        return formDialog({ title: 'Rename account', fields: [{ name: 'name', label: 'Account name', required: true }], values: { name: a.name },
          onSubmit: (v) => store.commit((s2) => (s2.accounts.find((x) => x.id === a.id).name = v.name)) });
      }
      const rs = b('[data-restore]');
      if (rs) return GU.trash.restore(rs.dataset.restore);
      const ma = b('[data-merge-account]');
      if (ma) return mergeAccount(ma.dataset.mergeAccount);
      const da = b('[data-delete-account]');
      if (da) {
        const id = da.dataset.deleteAccount;
        const n = store.state.transactions.filter((t) => t.account === id).length;
        const ok = await confirmBox({ title: 'Delete this account?', message: n ? 'Its ' + plural(n, 'transaction') + ' will be deleted too. If it’s the same bank account as another one in your list, use Merge into… instead, so nothing is lost or counted twice.' : 'It has no transactions.', confirmLabel: n ? 'Delete it and its transactions' : 'Delete', danger: true });
        if (!ok) return;
        let entry = null;
        store.commit((s2) => {
          const acct = s2.accounts.find((x) => x.id === id);
          const txs = s2.transactions.filter((t) => t.account === id);
          s2.accounts = s2.accounts.filter((x) => x.id !== id);
          s2.transactions = s2.transactions.filter((t) => t.account !== id);
          entry = GU.trash.put(s2, 'accounts', acct, acct.name + (txs.length ? ' and its ' + plural(txs.length, 'transaction') : ''), { transactions: txs });
        });
        return GU.trash.offerUndo(entry);
      }
      const dr = b('[data-delete-rule]');
      if (dr) return store.commit((s2) => (s2.rules = s2.rules.filter((r) => r.id !== dr.dataset.deleteRule)));
      if (b('[data-new-section]')) return GU.sections.newSection();
      if (b('[data-export]')) {
        toast('Preparing your backup…');
        const json = await GU.backup.build();
        return saveFile(new Blob([json], { type: 'application/json' }), 'the-ground-up-backup-' + GU.util.today() + '.json');
      }
      if (b('[data-load-demo]')) {
        await GU.sample.load();
        return toast('Example data added');
      }
      if (b('[data-clear-demo]')) return GU.sample.clear();
      if (b('[data-erase]')) {
        const ok = await confirmBox({ title: 'Erase everything?', message: 'This deletes all your transactions, bills, documents, receipts, visas, tasks and uploaded files from this browser. Export a backup first if you might want them back.', confirmLabel: 'Erase everything', danger: true });
        if (!ok) return;
        await GU.files.clear();
        store.replaceAll(store.blank());
        toast('Everything erased');
        GU.view.go('today');
      }
    });
    root.addEventListener('change', async (e) => {
      const imp = e.target.closest('[data-import]');
      if (!imp || !imp.files[0]) return;
      const ok = await confirmBox({ title: 'Restore this backup?', message: 'This replaces everything currently in the app with the contents of <b>' + esc(imp.files[0].name) + '</b>.', confirmLabel: 'Restore', danger: true });
      if (!ok) return;
      try {
        await GU.backup.restore(await imp.files[0].text());
        toast('Backup restored');
      } catch (err) {
        toast(err.message || 'That file could not be restored.');
      }
    });
  }

  GU.tabs.settings = { label: 'Settings', short: 'Settings', icon: 'settings', render };
})();
