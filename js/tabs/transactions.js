/* The Ground Up: Bank transactions. One ledger for every account, CSV statement import,
   automatic categories and rules that learn from your corrections. */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, fmtDate, monthKey, monthLabel, plural, parseCSV, parseLooseDate, guessDateOrder, parseAmount, debounce, sum } = GU.util;
  const { icon, pill, emptyState, selectOptions, formDialog, openDialog, toast } = GU.ui;
  const F = GU.finance;
  const store = GU.store;

  const ui = { q: '', month: '', account: '', category: '', type: '', limit: 100 };

  function accountName(id) {
    const a = store.state.accounts.find((x) => x.id === id);
    return a ? a.name : '';
  }
  function accountOptions() {
    return store.state.accounts.map((a) => ({ value: a.id, label: a.name })).concat([{ value: '__new', label: '+ Add another account…' }]);
  }
  function ensureAccount(v) {
    if (v.account !== '__new') return v.account;
    const name = (v.newAccount || '').trim() || 'New account';
    const id = 'acc-' + uid();
    store.state.accounts.push({ id, name });
    return id;
  }

  function filtered() {
    const s = store.state;
    const q = ui.q.toLowerCase();
    return s.transactions.filter((t) => {
      if (ui.month && t.date.slice(0, 7) !== ui.month) return false;
      if (ui.account && t.account !== ui.account) return false;
      if (ui.category === '__none' && t.category) return false;
      if (ui.category && ui.category !== '__none' && t.category !== ui.category) return false;
      if (ui.type === 'in' && t.amount <= 0) return false;
      if (ui.type === 'out' && t.amount >= 0) return false;
      if (q && !(t.description + ' ' + (t.notes || '') + ' ' + (t.category || '')).toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function rowsHTML(list) {
    if (!list.length) {
      return '<tr><td colspan="5">' + emptyState({ icon: 'search', title: store.state.transactions.length ? 'No transactions match' : 'No transactions yet',
        text: store.state.transactions.length ? 'Try clearing the search or filters.' : 'Import a CSV statement from your bank, or add a payment by hand.' }) + '</td></tr>';
    }
    return list.slice(0, ui.limit).map((t) =>
      '<tr class="clickable" data-id="' + esc(t.id) + '" tabindex="0">' +
      '<td class="nowrap muted">' + esc(fmtDate(t.date, { short: true })) + '</td>' +
      '<td class="wrap"><b class="cell-title">' + esc(t.description) + '</b>' + (t.notes ? '<small class="cell-sub">' + esc(t.notes) + '</small>' : '') + '</td>' +
      '<td>' + (t.category ? pill(t.category, F.isTransfer(t) ? 'muted' : '') : pill('Needs a category', 'warn', 'alert')) + '</td>' +
      '<td class="hide-sm muted">' + esc(accountName(t.account)) + '</td>' +
      '<td class="num ' + (t.amount > 0 ? 'is-in' : '') + '">' + esc(money(t.amount, { sign: true })) + '</td></tr>').join('');
  }

  function render(root) {
    const s = store.state;
    const intent = GU.view.intent('transactions');
    if (intent && intent.filter === 'uncategorised') {
      Object.assign(ui, { q: '', month: '', account: '', type: '', category: '__none' });
    }
    const months = Array.from(new Set(s.transactions.map((t) => t.date.slice(0, 7)))).sort().reverse();
    const cats = Array.from(new Set(s.transactions.map((t) => t.category).filter(Boolean))).sort();

    root.innerHTML = GU.view.head({
      eyebrow: 'Money',
      title: 'Bank transactions',
      text: 'Every payment in and out of your accounts. Import a statement from your bank as a CSV file and I’ll sort each line into a category.',
      actions: '<button type="button" class="btn" data-import>' + icon('upload') + 'Import statements</button>' +
        '<button type="button" class="btn btn--primary" data-add>' + icon('plus') + 'Add transaction</button>',
    }) +
      GU.ui.dropbar('Drop bank statements here, or a whole folder of them', 'PDF statements from Monzo, Santander, HSBC and most banks, or CSV, Excel, .txt, Quicken and Money files.') +
      '<div class="toolbar">' +
      '<label class="search">' + icon('search') + '<input type="search" id="tx-search" placeholder="Search descriptions" value="' + esc(ui.q) + '" aria-label="Search transactions"></label>' +
      '<select id="tx-month" aria-label="Month">' + selectOptions(months.map((m) => ({ value: m, label: monthLabel(m, true) })), ui.month, 'All months') + '</select>' +
      '<select id="tx-account" aria-label="Account">' + selectOptions(s.accounts.map((a) => ({ value: a.id, label: a.name })), ui.account, 'All accounts') + '</select>' +
      '<select id="tx-category" aria-label="Category">' + selectOptions([{ value: '__none', label: 'Needs a category' }].concat(cats), ui.category, 'All categories') + '</select>' +
      '<select id="tx-type" aria-label="Money in or out">' + selectOptions([{ value: 'in', label: 'Money in' }, { value: 'out', label: 'Money out' }], ui.type, 'In and out') + '</select>' +
      '</div>' +
      '<p class="summary-line" id="tx-summary"></p>' +
      '<div class="panel"><div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="hide-sm">Account</th><th class="num">Amount</th></tr></thead>' +
      '<tbody id="tx-rows"></tbody></table></div></div>' +
      '<div class="more-row" id="tx-more"></div>';

    const draw = () => {
      const list = filtered();
      root.querySelector('#tx-rows').innerHTML = rowsHTML(list);
      root.querySelector('#tx-summary').innerHTML = list.length
        ? esc(plural(list.length, 'transaction')) + ' · In <b>' + esc(money(F.moneyIn(list))) + '</b> · Out <b>' + esc(money(F.moneyOut(list))) + '</b>' +
          ' · Net <b>' + esc(money(F.moneyIn(list) - F.moneyOut(list), { sign: true })) + '</b> <span class="muted">(transfers between your own accounts are left out)</span>'
        : '';
      root.querySelector('#tx-more').innerHTML = list.length > ui.limit
        ? '<button type="button" class="btn" data-more>Show ' + Math.min(100, list.length - ui.limit) + ' more of ' + (list.length - ui.limit) + '</button>' : '';
    };
    draw();

    GU.ui.wireDropbar(root, (files) => importStatement(files));
    root.querySelector('#tx-search').addEventListener('input', debounce((e) => {
      ui.q = e.target.value;
      ui.limit = 100;
      draw();
    }, 150));
    [['#tx-month', 'month'], ['#tx-account', 'account'], ['#tx-category', 'category'], ['#tx-type', 'type']].forEach(([sel, key]) => {
      root.querySelector(sel).addEventListener('change', (e) => {
        ui[key] = e.target.value;
        ui.limit = 100;
        draw();
      });
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) return create();
      if (e.target.closest('[data-import]')) return importCSV();
      if (e.target.closest('[data-more]')) {
        ui.limit += 100;
        return draw();
      }
      const row = e.target.closest('tr[data-id]');
      if (row) edit(row.dataset.id);
    });
    root.addEventListener('keydown', (e) => {
      const row = e.target.closest && e.target.closest('tr[data-id]');
      if (row && e.key === 'Enter') edit(row.dataset.id);
    });
  }

  function suggestMatch(desc) {
    return String(desc || '').replace(/[*#\d]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  }

  function fields(isNew, dir) {
    return [
      { name: 'direction', label: 'Type', type: 'segmented', options: [{ value: 'out', label: 'Money out', icon: 'out' }, { value: 'in', label: 'Money in', icon: 'in' }], default: dir || 'out' },
      { name: 'description', label: 'Description', required: true, placeholder: 'e.g. Tesco Express' },
      { name: 'amount', label: 'Amount', type: 'money', required: true, half: true },
      { name: 'date', label: 'Date', type: 'date', required: true, half: true },
      { name: 'category', label: 'Category', type: 'select', options: F.categoryOptions(), placeholder: 'Choose later', half: true },
      { name: 'account', label: 'Account', type: 'select', options: accountOptions(), half: true },
      { name: 'newAccount', label: 'New account name', placeholder: 'e.g. Monzo, Barclays savings', showIf: (v) => v.account === '__new' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, optional: true },
      { name: 'remember', label: 'Remember', type: 'checkbox', checkLabel: 'Always use this category for similar payments', showIf: (v) => !!v.category },
      { name: 'match', label: 'When the description contains', showIf: (v) => v.remember && !!v.category, help: 'Applies to future imports and to existing transactions that have no category yet.' },
    ];
  }

  function save(v, existing, extra) {
    store.commit((s) => {
      const account = ensureAccount(v);
      const rec = Object.assign(existing ? Object.assign({}, existing) : { id: 't-' + uid(), source: 'manual', created: today() }, extra || {}, {
        date: v.date, description: v.description, amount: (v.direction === 'in' ? 1 : -1) * Math.abs(v.amount || 0),
        category: v.category, account, notes: v.notes,
      });
      const i = s.transactions.findIndex((t) => t.id === rec.id);
      if (i >= 0) s.transactions[i] = rec;
      else s.transactions.push(rec);
      if (v.remember && v.category && v.match) {
        s.rules = s.rules.filter((r) => r.match.toLowerCase() !== v.match.toLowerCase());
        s.rules.push({ id: 'r-' + uid(), match: v.match, category: v.category });
        let n = 0;
        for (const t of s.transactions) {
          if (!t.category && (' ' + t.description + ' ').toLowerCase().includes(v.match.toLowerCase())) {
            t.category = v.category;
            n++;
          }
        }
        if (n) setTimeout(() => toast('Also categorised ' + plural(n, 'other transaction')), 0);
      }
    });
  }

  function create(prefill, opts) {
    prefill = prefill || {};
    opts = opts || {};
    const dir = prefill.direction || (prefill.amount > 0 ? 'in' : 'out');
    formDialog({
      title: dir === 'in' ? 'Add money in' : 'Add a transaction',
      fields: fields(true, dir),
      values: Object.assign({ date: today(), account: store.state.accounts[0] && store.state.accounts[0].id, direction: dir }, prefill, { amount: prefill.amount != null ? Math.abs(prefill.amount) : null }),
      submitLabel: 'Add',
      onSubmit: (v) => {
        save(v, null, opts.extra);
        toast('Transaction added');
        if (opts.onSaved) opts.onSaved();
      },
    });
  }

  function edit(id) {
    const t = store.find('transactions', id);
    if (!t) return;
    formDialog({
      title: 'Edit transaction',
      fields: fields(false),
      values: Object.assign({}, t, { direction: t.amount > 0 ? 'in' : 'out', amount: Math.abs(t.amount), match: suggestMatch(t.description) }),
      onSubmit: (v) => save(v, t),
      onDelete: () => {
        const rec = store.remove('transactions', id);
        toast('Transaction deleted', { action: 'Undo', onAction: () => store.upsert('transactions', rec) });
      },
    });
  }

  /* ---------- CSV statement import ---------- */
  function guessColumns(header, rows) {
    const h = header.map((x) => x.toLowerCase());
    const find = (...words) => h.findIndex((c) => words.some((w) => c.includes(w)));
    let date = find('transaction date', 'date', 'completed', 'posted');
    let desc = find('description', 'narrative', 'details', 'counter party', 'merchant', 'name', 'payee', 'memo', 'reference');
    let amount = find('amount', 'value');
    let paidIn = find('paid in', 'credit', 'money in', 'in (');
    let paidOut = find('paid out', 'debit', 'money out', 'out (');
    if (amount >= 0 && (h[amount].includes('balance'))) amount = -1;
    const mode = paidIn >= 0 && paidOut >= 0 && (amount < 0 || paidIn !== amount) ? 'split' : 'single';
    if (date < 0 || desc < 0 || (mode === 'single' && amount < 0)) {
      // No useful headers (some banks, e.g. HSBC): look at the data itself.
      const sample = rows.slice(0, 10);
      const cols = header.length;
      const score = (fn) => Array.from({ length: cols }, (_, i) => sample.filter((r) => fn(r[i] || '')).length);
      const dateScore = score((v) => !!parseLooseDate(v, 'dmy'));
      const numScore = score((v) => /\d/.test(v) && !isNaN(parseAmount(v)) && !parseLooseDate(v, 'dmy'));
      const textScore = score((v) => /[a-z]{3}/i.test(v) && !parseLooseDate(v, 'dmy'));
      const best = (arr, skip) => arr.reduce((b, v, i) => (skip.includes(i) || v <= (arr[b] || -1) ? b : i), -1);
      if (date < 0) date = best(dateScore, []);
      if (desc < 0) desc = best(textScore, [date]);
      if (amount < 0 && mode === 'single') amount = best(numScore, [date, desc]);
    }
    return { date, desc, amount, paidIn, paidOut, mode };
  }

  /* ---------- statement import (CSV, Excel, Santander .txt, QIF, OFX, PDF) ---------- */
  const ACCEPT_STATEMENTS = '.csv,.txt,.tsv,.qif,.ofx,.qfx,.xls,.xlsx,.pdf,text/csv,application/pdf';
  function accountFor(bank) {
    const a = bank && store.state.accounts.find((x) => x.name.toLowerCase().includes(bank.toLowerCase()));
    if (a) return a.id;
    if (bank) return '__new';
    return (store.state.accounts[0] || {}).id || '__new';
  }
  const dupKey = (t) => t.date + '|' + Number(t.amount).toFixed(2) + '|' + String(t.description || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  /* Leaves out lines already in this account. Two identical payments on the same day both stay. */
  function withoutDuplicates(list, accountId) {
    const seen = new Map();
    for (const t of store.state.transactions) {
      if (accountId && accountId !== '__new' && t.account !== accountId) continue;
      const k = dupKey(t);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    return list.filter((t) => {
      const k = dupKey(t);
      const n = seen.get(k) || 0;
      if (n) {
        seen.set(k, n - 1);
        return false;
      }
      return true;
    });
  }

  /* Works out which spreadsheet column is which. */
  function tableSetup(res) {
    const rows = res.rows || [];
    if (rows.length < 2) return null;
    let headerIdx = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.length >= 3);
    if (headerIdx < 0 || headerIdx > 15) headerIdx = -1;
    const header = headerIdx >= 0 ? rows[headerIdx] : rows[0].map((_, i) => 'Column ' + (i + 1));
    const data = rows.slice(headerIdx + 1).filter((r) => r.length >= Math.min(3, header.length));
    const low = header.map((h) => h.toLowerCase());
    const map = guessColumns(header, data);
    map.order = map.date >= 0 ? guessDateOrder(data.map((r) => r[map.date])) : 'dmy';
    map.flip = false;
    map.category = low.findIndex((h) => h === 'category');
    map.type = low.findIndex((h) => h === 'type' || h === 'transaction type');
    return { header, data, map };
  }
  function tableRows(setup) {
    const { data, map } = setup;
    const out = [];
    for (const r of data) {
      const date = parseLooseDate(r[map.date], map.order);
      const raw = (r[map.desc] || '').replace(/\s+/g, ' ').trim();
      let amount;
      if (map.mode === 'split') {
        const pin = parseAmount(r[map.paidIn]);
        const pout = parseAmount(r[map.paidOut]);
        amount = (isNaN(pin) ? 0 : Math.abs(pin)) - (isNaN(pout) ? 0 : Math.abs(pout));
      } else amount = parseAmount(r[map.amount]);
      if (!date || !raw || isNaN(amount) || amount === 0) continue;
      if (map.flip) amount = -amount;
      const type = map.type >= 0 ? r[map.type] || '' : '';
      out.push({ date, raw: raw + (type ? ' ' + type : ''), description: GU.statements.cleanDescription(raw), amount, bankCategory: map.category >= 0 ? GU.statements.bankCategory(r[map.category]) : '' });
    }
    return out;
  }

  /* Opens the importer. preset: one File, or several Files (a folder of statements). */
  function importStatement(presetFile) {
    const s = store.state;
    let file = null;
    const d = openDialog({
      title: 'Import a bank statement',
      wide: true,
      body: '<div data-step></div>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary" data-go disabled>Import</button>',
    });
    const step = d.body.querySelector('[data-step]');
    const go = d.el.querySelector('[data-go]');
    let onImport = null;

    function pickStep() {
      step.innerHTML = '<p class="dlg__intro">Choose a statement downloaded from your online banking or banking app. These all work:</p>' +
        '<ul class="bank-list"><li><b>Monzo</b>: the PDF statement, or the CSV export from the app</li>' +
        '<li><b>Santander</b>: the PDF statement, or the download in .txt, Excel or Quicken format</li>' +
        '<li><b>HSBC</b>: the PDF statement, or the CSV or Excel download</li>' +
        '<li>Most other banks: PDF, CSV, Excel, Quicken (.qif) or Money (.ofx) files</li></ul>' +
        '<label class="drop drop--big" tabindex="0"><input type="file" multiple accept="' + ACCEPT_STATEMENTS + '" hidden>' + icon('upload', 'drop__icon') +
        '<span><b>Choose statements</b><small>or drop them here: one file, several, or a whole folder</small></span></label>' +
        '<div class="thrower__pick"><button type="button" class="btn btn--sm" data-st-folder>' + icon('folder') + 'Choose a folder of statements</button></div>' +
        '<p class="field__help">' + icon('lock') + ' Files are read on this device. They aren’t uploaded anywhere.</p>';
      const drop = step.querySelector('.drop');
      const input = step.querySelector('input');
      const start = (files) => {
        files = files.filter((f) => /\.(csv|txt|tsv|qif|ofx|qfx|xls|xlsx|pdf)$/i.test(f.name));
        if (!files.length) return toast('None of those look like statements (PDF, CSV, Excel, .txt, .qif or .ofx).');
        if (files.length === 1) load(files[0]);
        else multiStep(files);
      };
      input.addEventListener('change', () => start(Array.from(input.files)));
      step.querySelector('[data-st-folder]').addEventListener('click', async () => start(await GU.ui.pickFolder()));
      drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()));
      drop.addEventListener('dragover', (e) => (e.preventDefault(), drop.classList.add('is-over')));
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
        GU.ui.filesFromDrop(e.dataTransfer).then(start);
      });
    }

    /* Several statements at once: read them all, show one summary, import together. */
    async function multiStep(files) {
      d.el.querySelector('.dlg__head h2').textContent = 'Import ' + files.length + ' statements';
      const entries = files.map((f) => ({ file: f, status: 'reading', list: [], res: null }));
      const opts = { pots: false, keepPdf: true };
      const draw = () => {
        // Skip lines already imported, including ones in earlier files of this batch.
        const seen = new Map();
        const keyOf = (acct, t) => acct + '#' + dupKey(t);
        for (const t of store.state.transactions) seen.set(keyOf(t.account, t), (seen.get(keyOf(t.account, t)) || 0) + 1);
        let total = 0;
        for (const e of entries) {
          e.fresh = [];
          if (e.status !== 'ok') continue;
          let list = e.list.slice();
          if (opts.pots && e.res && e.res.pots) for (const p of e.res.pots) list = list.concat(p.transactions.map((t) => Object.assign({}, t, { pot: p.name })));
          const accepted = [];
          for (const t of list) {
            const k = keyOf(e.account, t);
            const n = seen.get(k) || 0;
            if (n) seen.set(k, n - 1);
            else accepted.push(t);
          }
          for (const t of accepted) seen.set(keyOf(e.account, t), (seen.get(keyOf(e.account, t)) || 0) + 1);
          e.fresh = accepted;
          total += accepted.length;
        }
        const reading = entries.filter((e) => e.status === 'reading').length;
        const banks = Array.from(new Set(entries.map((e) => e.res && e.res.bank).filter(Boolean)));
        const acctOpts = store.state.accounts.map((a) => ({ value: a.id, label: a.name })).concat(banks.concat(['Other account']).map((b) => ({ value: '__new:' + b, label: '+ New: ' + b })));
        const anyPdf = entries.some((e) => e.res && e.res.isPdf);
        const potLines = entries.reduce((a, e) => a + ((e.res && e.res.pots) || []).reduce((b, p) => b + p.transactions.length, 0), 0);
        step.innerHTML = (reading ? '<p class="reading"><span class="spinner" aria-hidden="true"></span>Reading ' + (entries.length - reading + 1) + ' of ' + entries.length + '…</p>' : '<p class="dlg__intro">Here’s what I found. Check each statement goes into the right account, then import them all.</p>') +
          '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Statement</th><th>Dates</th><th class="num">Lines</th><th class="num">New</th><th>Account</th></tr></thead><tbody>' +
          entries.map((e, i) => {
            const dates = e.list.map((t) => t.date).sort();
            const what = e.status === 'reading' ? '<span class="muted">Reading…</span>' : e.status === 'ok' ? esc([e.res.bank, e.res.format].filter(Boolean).join(' ')) +
              (e.res.check && e.res.check.ok && !e.res.check.bad ? ' ' + pill('Balances add up', 'good', 'check') : e.res.check && e.res.check.bad ? ' ' + pill(e.res.check.bad + ' to check', 'warn') : '') : pill('Couldn’t read', 'crit', 'alert');
            return '<tr><td class="wrap"><b class="cell-title">' + esc(GU.ui.pathOf(e.file)) + '</b><small class="cell-sub">' + what + '</small></td>' +
              '<td class="nowrap">' + (dates.length ? esc(fmtDate(dates[0], { short: true }) + ' to ' + fmtDate(dates[dates.length - 1], { short: true })) : '—') + '</td>' +
              '<td class="num">' + (e.status === 'ok' ? e.list.length : '—') + '</td><td class="num">' + (e.status === 'ok' ? e.fresh.length : '—') + '</td>' +
              '<td>' + (e.status === 'ok' ? '<select class="select-sm" data-acct="' + i + '" aria-label="Account for ' + esc(e.file.name) + '">' + selectOptions(acctOpts, e.account) + '</select>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (potLines ? '<label class="check"><input type="checkbox" id="ms-pots"' + (opts.pots ? ' checked' : '') + '><span>Also import Monzo Pots (' + esc(plural(potLines, 'line')) + '). Usually best left off.</span></label>' : '') +
          (anyPdf ? '<label class="check"><input type="checkbox" id="ms-keep"' + (opts.keepPdf ? ' checked' : '') + '><span>Keep a copy of each PDF statement in Important documents</span></label>' : '');
        go.disabled = !!reading || !total;
        go.textContent = reading ? 'Reading…' : total ? 'Import ' + plural(total, 'transaction') : 'Nothing new to import';
        step.querySelectorAll('[data-acct]').forEach((sel) => sel.addEventListener('change', () => ((entries[+sel.dataset.acct].account = sel.value), draw())));
        const pp = step.querySelector('#ms-pots');
        if (pp) pp.addEventListener('change', () => ((opts.pots = pp.checked), draw()));
        const kp = step.querySelector('#ms-keep');
        if (kp) kp.addEventListener('change', () => (opts.keepPdf = kp.checked));
        onImport = () => commitMany(entries.filter((e) => e.status === 'ok' && e.fresh.length), opts.keepPdf);
      };
      draw();
      for (const e of entries) {
        try {
          const res = await GU.statements.read(e.file);
          e.res = res;
          if (res.kind === 'table') {
            const setup = tableSetup(res);
            e.list = setup ? tableRows(setup) : [];
          } else e.list = res.transactions || [];
          const acct = accountFor(res.bank);
          e.account = acct === '__new' ? '__new:' + (res.bank || 'Other account') : acct;
          e.status = e.list.length ? 'ok' : 'empty';
        } catch (err) {
          console.warn('could not read', e.file.name, err);
          e.status = 'error';
        }
        draw();
      }
    }

    async function commitMany(entries, keepPdf) {
      if (!entries.length) return;
      const batch = 'imp-' + uid();
      let transfers = [];
      let count = 0;
      store.commit((st) => {
        const made = {};
        const ids = new Set();
        for (const e of entries) {
          let acct = e.account;
          if (acct.startsWith('__new:')) {
            const name = acct.slice(6);
            if (!made[name]) {
              made[name] = 'acc-' + uid();
              st.accounts.push({ id: made[name], name });
            }
            acct = made[name];
          }
          e.accountId = acct;
          for (const t of e.fresh) {
            const id = 't-' + uid();
            ids.add(id);
            count++;
            st.transactions.push({ id, date: t.date, description: t.description, amount: t.amount,
              category: t.pot ? F.TRANSFER : F.categorise(t.description + ' ' + (t.raw || ''), t.amount, st.rules) || t.bankCategory || '',
              account: acct, notes: t.pot ? t.pot + ' Pot' : '', source: 'import', importBatch: batch, created: today() });
          }
        }
        transfers = GU.statements.matchTransfers(st, ids);
      });
      if (keepPdf) {
        for (const e of entries) {
          if (!e.res.isPdf) continue;
          const meta = await GU.files.add(e.file);
          const dates = e.list.map((t) => t.date).sort();
          store.upsert('documents', { id: 'd-' + uid(), created: today(), title: (e.res.bank || 'Bank') + ' statement ' + fmtDate(dates[0], { short: true }) + ' to ' + fmtDate(dates[dates.length - 1], { short: true }),
            type: 'Bank, savings and pension', holder: 'Me', reference: '', location: 'Uploaded', issueDate: dates[dates.length - 1], expiryDate: '', notes: '', files: [meta], statementBatch: batch });
        }
      }
      d.close();
      toast('Imported ' + plural(count, 'transaction') + ' from ' + plural(entries.length, 'statement') + (transfers.length ? '. ' + plural(transfers.length / 2, 'move') + ' between your own accounts marked as transfers' : ''), {
        action: 'Undo',
        onAction: () => store.commit((st) => {
          st.transactions = st.transactions.filter((t) => t.importBatch !== batch);
          for (const c of transfers) {
            const t = st.transactions.find((x) => x.id === c.id);
            if (t) t.category = c.before;
          }
          st.documents.filter((x) => x.statementBatch === batch).forEach((doc) => (doc.files || []).forEach((f) => GU.files.remove(f.id)));
          st.documents = st.documents.filter((x) => x.statementBatch !== batch);
        }),
      });
      if (location.hash !== '#transactions') GU.view.go('transactions');
    }

    async function load(f) {
      file = f;
      step.innerHTML = '<p class="reading"><span class="spinner" aria-hidden="true"></span>Reading ' + esc(f.name) + '…</p>';
      let res;
      try {
        res = await GU.statements.read(f);
      } catch (e) {
        console.warn('statement read failed', e);
        res = { kind: 'error' };
      }
      if (res.kind === 'table') return tableStep(res);
      if (res.kind === 'transactions' && res.transactions.length) return reviewStep(res);
      failStep(res);
    }

    async function failStep(res) {
      const claude = res.isPdf && (await GU.brain.mode()) !== 'offline';
      step.innerHTML = '<p class="banner banner--crit">' + icon('alert') + '<span>' + esc(res.warning || 'I couldn’t find any transactions in ' + file.name + '.') +
        (claude ? ' I can ask Claude to read it instead.' : ' Try the CSV or Excel download from your online banking instead.') + '</span></p>' +
        (claude ? '<button type="button" class="btn btn--primary" data-claude>' + icon('check') + 'Read it with Claude</button>' : '') +
        '<button type="button" class="btn" data-again>Choose another file</button>';
      go.disabled = true;
      step.querySelector('[data-again]').addEventListener('click', pickStep);
      const b = step.querySelector('[data-claude]');
      if (b) b.addEventListener('click', async () => {
        step.innerHTML = '<p class="reading"><span class="spinner" aria-hidden="true"></span>Claude is reading your statement. Long statements take a minute or two…</p>';
        try {
          const r = await GU.brain.readStatement(file);
          if (r && r.transactions.length) return reviewStep(r);
        } catch (e) {
          console.warn(e);
        }
        failStep({ isPdf: false, warning: 'Claude couldn’t read the transactions either.' });
      });
    }

    /* Statements that come as a list of transactions (PDF, Santander .txt, QIF, OFX). */
    function reviewStep(res) {
      const ui2 = { account: accountFor(res.bank), newAccount: res.bank || '', pots: false, keepPdf: !!res.isPdf };
      const draw = () => {
        let list = res.transactions.slice();
        if (ui2.pots) for (const p of res.pots || []) list = list.concat(p.transactions.map((t) => Object.assign({}, t, { pot: p.name })));
        const fresh = withoutDuplicates(list, ui2.account);
        const dupes = list.length - fresh.length;
        const inn = sum(res.transactions.filter((t) => t.amount > 0), (t) => t.amount);
        const out = sum(res.transactions.filter((t) => t.amount < 0), (t) => -t.amount);
        const dates = res.transactions.map((t) => t.date).sort();
        const potLines = (res.pots || []).reduce((a, p) => a + p.transactions.length, 0);
        step.innerHTML =
          '<p class="dlg__intro"><b>' + esc([res.bank, res.format].filter(Boolean).join(' ') || file.name) + '</b>, ' + esc(fmtDate(dates[0])) + ' to ' + esc(fmtDate(dates[dates.length - 1])) + ': ' +
          esc(plural(res.transactions.length, 'transaction')) + '. Money in <b>' + esc(money(inn)) + '</b>, money out <b>' + esc(money(out)) + '</b>.</p>' +
          (res.check && res.check.ok && !res.check.bad ? '<p class="check-ok">' + icon('check') + 'Every line adds up against the statement’s running balance.</p>' : '') +
          (res.check && res.check.bad ? '<p class="banner banner--warn">' + icon('alert') + '<span>' + esc(plural(res.check.bad, 'line')) + ' didn’t add up against the running balance. They’ll still be imported; check any that look wrong.</span></p>' : '') +
          '<div class="form-grid">' +
          '<div class="field field--half"><label class="field__label" for="st-account">Which account is this?</label><select id="st-account">' + selectOptions(accountOptions(), ui2.account) + '</select></div>' +
          (ui2.account === '__new' ? '<div class="field field--half"><label class="field__label" for="st-new">New account name</label><input id="st-new" type="text" value="' + esc(ui2.newAccount) + '" placeholder="e.g. Monzo"></div>' : '<div class="field field--half"></div>') +
          (potLines ? '<div class="field"><label class="check"><input type="checkbox" id="st-pots"' + (ui2.pots ? ' checked' : '') + '><span>Also import my Pots (' + esc(plural(potLines, 'line')) + ' across ' + esc(plural(res.pots.length, 'Pot')) + ')</span></label><p class="field__help">Usually best left off: money moving into and out of Pots already shows in your main account as “Transfer to Pot”.</p></div>' : '') +
          (res.isPdf ? '<div class="field"><label class="check"><input type="checkbox" id="st-keep"' + (ui2.keepPdf ? ' checked' : '') + '><span>Keep a copy of this statement in Important documents</span></label></div>' : '') +
          '</div>' +
          '<h3 class="subhead">Preview</h3>' +
          (fresh.length ? '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>' +
            fresh.slice(-8).reverse().map((t) => {
              const c = F.categorise(t.description + ' ' + (t.raw || ''), t.amount, s.rules);
              return '<tr><td class="nowrap">' + esc(fmtDate(t.date, { short: true })) + '</td><td class="wrap">' + esc(t.description) + (t.pot ? ' <span class="muted">(' + esc(t.pot) + ' Pot)</span>' : '') + '</td><td>' + (c ? pill(c, c === F.TRANSFER ? 'muted' : '') : pill('Needs a category', 'warn')) + '</td><td class="num ' + (t.amount > 0 ? 'is-in' : '') + '">' + esc(money(t.amount, { sign: true })) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '<p class="muted">Everything in this statement is already imported.</p>') +
          '<p class="field__help">' + esc(plural(fresh.length, 'new transaction')) + ' ready (showing the latest 8)' + (dupes ? '. ' + plural(dupes, 'line') + ' already imported will be skipped' : '') + '.</p>';
        go.disabled = !fresh.length;
        go.textContent = fresh.length ? 'Import ' + plural(fresh.length, 'transaction') : 'Import';
        step.querySelector('#st-account').addEventListener('change', (e) => ((ui2.account = e.target.value), draw()));
        const nn = step.querySelector('#st-new');
        if (nn) nn.addEventListener('input', () => (ui2.newAccount = nn.value));
        const pp = step.querySelector('#st-pots');
        if (pp) pp.addEventListener('change', () => ((ui2.pots = pp.checked), draw()));
        const kp = step.querySelector('#st-keep');
        if (kp) kp.addEventListener('change', () => (ui2.keepPdf = kp.checked));
        onImport = () => commitImport(fresh, ui2.account, ui2.newAccount || res.bank || file.name.replace(/\.\w+$/, ''), res, ui2.keepPdf);
      };
      draw();
    }

    /* Spreadsheets: check which column is which, then import. */
    function tableStep(res) {
      const setup = tableSetup(res);
      if (!setup) return failStep({ warning: 'That file doesn’t have enough rows to be a statement.' });
      const { header, map } = setup;
      map.account = accountFor(res.bank);
      map.newAccount = res.bank || '';
      const build = () => tableRows(setup);

      function draw() {
        const colOpts = header.map((h, i) => ({ value: String(i), label: h || 'Column ' + (i + 1) }));
        const all = build();
        const fresh = withoutDuplicates(all, map.account);
        const dupes = all.length - fresh.length;
        step.innerHTML =
          '<p class="dlg__intro"><b>' + esc(file.name) + '</b>' + (res.bank ? ' (' + esc(res.bank) + ')' : '') + ': check the columns below look right. I guessed them from the file.</p>' +
          '<div class="form-grid">' +
          '<div class="field field--half"><label class="field__label" for="m-date">Date column</label><select id="m-date" data-m="date">' + selectOptions(colOpts, String(map.date)) + '</select></div>' +
          '<div class="field field--half"><label class="field__label" for="m-desc">Description column</label><select id="m-desc" data-m="desc">' + selectOptions(colOpts, String(map.desc)) + '</select></div>' +
          '<div class="field"><span class="field__label">Amounts</span><div class="seg"><label><input type="radio" name="m-mode" value="single"' + (map.mode === 'single' ? ' checked' : '') + '><span>One amount column</span></label>' +
          '<label><input type="radio" name="m-mode" value="split"' + (map.mode === 'split' ? ' checked' : '') + '><span>Separate “paid in” and “paid out” columns</span></label></div></div>' +
          (map.mode === 'single'
            ? '<div class="field field--half"><label class="field__label" for="m-amount">Amount column</label><select id="m-amount" data-m="amount">' + selectOptions(colOpts, String(map.amount)) + '</select></div>' +
              '<div class="field field--half"><span class="field__label">Signs</span><label class="check"><input type="checkbox" id="m-flip"' + (map.flip ? ' checked' : '') + '><span>Spending shows as positive (common on credit cards)</span></label></div>'
            : '<div class="field field--half"><label class="field__label" for="m-in">Paid in column</label><select id="m-in" data-m="paidIn">' + selectOptions(colOpts, String(map.paidIn)) + '</select></div>' +
              '<div class="field field--half"><label class="field__label" for="m-out">Paid out column</label><select id="m-out" data-m="paidOut">' + selectOptions(colOpts, String(map.paidOut)) + '</select></div>') +
          '<div class="field field--half"><label class="field__label" for="m-order">Date format</label><select id="m-order">' + selectOptions([{ value: 'dmy', label: 'Day first (31/12/2026)' }, { value: 'mdy', label: 'Month first (12/31/2026)' }], map.order) + '</select></div>' +
          '<div class="field field--half"><label class="field__label" for="m-account">Which account is this?</label><select id="m-account">' + selectOptions(accountOptions(), map.account) + '</select></div>' +
          (map.account === '__new' ? '<div class="field"><label class="field__label" for="m-newacc">New account name</label><input id="m-newacc" type="text" placeholder="e.g. Monzo current account" value="' + esc(map.newAccount || '') + '"></div>' : '') +
          '</div>' +
          '<h3 class="subhead">Preview</h3>' +
          (all.length
            ? '<div class="table-wrap"><table class="tbl tbl--compact"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>' +
              fresh.slice(0, 8).map((r) => {
                const c = F.categorise(r.description + ' ' + r.raw, r.amount, s.rules) || r.bankCategory;
                return '<tr><td class="nowrap">' + esc(fmtDate(r.date, { short: true })) + '</td><td class="wrap">' + esc(r.description) + '</td><td>' + (c ? pill(c) : pill('Needs a category', 'warn')) + '</td><td class="num ' + (r.amount > 0 ? 'is-in' : '') + '">' + esc(money(r.amount, { sign: true })) + '</td></tr>';
              }).join('') + '</tbody></table></div>' +
              '<p class="field__help">' + esc(plural(fresh.length, 'new transaction')) + ' ready' + (dupes ? ', ' + plural(dupes, 'line') + ' already imported will be skipped' : '') + '.</p>'
            : '<p class="banner banner--crit">' + icon('alert') + 'I couldn’t read any transactions with these columns. Try different columns or date format.</p>');
        go.disabled = !fresh.length;
        go.textContent = fresh.length ? 'Import ' + plural(fresh.length, 'transaction') : 'Import';
        step.querySelectorAll('[data-m]').forEach((el) => el.addEventListener('change', () => ((map[el.dataset.m] = +el.value), draw())));
        step.querySelectorAll('input[name="m-mode"]').forEach((el) => el.addEventListener('change', () => {
          map.mode = el.value;
          if (map.mode === 'split' && (map.paidIn < 0 || map.paidOut < 0)) {
            map.paidIn = map.paidIn >= 0 ? map.paidIn : 0;
            map.paidOut = map.paidOut >= 0 ? map.paidOut : 0;
          }
          draw();
        }));
        const flip = step.querySelector('#m-flip');
        if (flip) flip.addEventListener('change', () => ((map.flip = flip.checked), draw()));
        step.querySelector('#m-order').addEventListener('change', (e) => ((map.order = e.target.value), draw()));
        step.querySelector('#m-account').addEventListener('change', (e) => ((map.account = e.target.value), draw()));
        const na = step.querySelector('#m-newacc');
        if (na) na.addEventListener('input', () => (map.newAccount = na.value));
        onImport = () => commitImport(fresh, map.account, map.newAccount || res.bank || file.name.replace(/\.\w+$/, ''), res, false);
      }
      draw();
    }

    async function commitImport(list, account, newName, res, keepPdf) {
      if (!list.length) return;
      const batch = 'imp-' + uid();
      let accountId = account;
      let transfers = [];
      store.commit((st) => {
        if (accountId === '__new') {
          accountId = 'acc-' + uid();
          st.accounts.push({ id: accountId, name: (newName || '').trim() || 'Bank account' });
        }
        const ids = new Set();
        for (const t of list) {
          const id = 't-' + uid();
          ids.add(id);
          const text = t.description + ' ' + (t.raw || '');
          st.transactions.push({ id, date: t.date, description: t.description, amount: t.amount,
            category: t.pot ? F.TRANSFER : F.categorise(text, t.amount, st.rules) || t.bankCategory || '',
            account: accountId, notes: t.pot ? t.pot + ' Pot' : '', source: 'import', importBatch: batch, created: today() });
        }
        transfers = GU.statements.matchTransfers(st, ids);
      });
      if (keepPdf && file) {
        const meta = await GU.files.add(file);
        const dates = list.map((t) => t.date).sort();
        store.upsert('documents', { id: 'd-' + uid(), created: today(), title: (res.bank || 'Bank') + ' statement ' + fmtDate(dates[0], { short: true }) + ' to ' + fmtDate(dates[dates.length - 1], { short: true }),
          type: 'Bank, savings and pension', holder: 'Me', reference: '', location: 'Uploaded', issueDate: dates[dates.length - 1], expiryDate: '', notes: plural(list.length, 'transaction') + ' imported into Bank transactions.', files: [meta], statementBatch: batch });
      }
      const n = list.length;
      d.close();
      toast('Imported ' + plural(n, 'transaction') + (res.bank ? ' from ' + res.bank : '') + (transfers.length ? '. ' + plural(transfers.length / 2, 'move') + ' between your own accounts marked as transfers' : ''), {
        action: 'Undo',
        onAction: () => store.commit((st) => {
          st.transactions = st.transactions.filter((t) => t.importBatch !== batch);
          for (const c of transfers) {
            const t = st.transactions.find((x) => x.id === c.id);
            if (t) t.category = c.before;
          }
          const doc = st.documents.find((x) => x.statementBatch === batch);
          if (doc) {
            (doc.files || []).forEach((f) => GU.files.remove(f.id));
            st.documents = st.documents.filter((x) => x !== doc);
          }
        }),
      });
      if (location.hash !== '#transactions') GU.view.go('transactions');
    }

    d.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (onImport) onImport();
    });

    if (Array.isArray(presetFile)) {
      if (presetFile.length === 1) load(presetFile[0]);
      else multiStep(presetFile);
    } else if (presetFile) load(presetFile);
    else pickStep();
  }
  const importCSV = importStatement;

  GU.tabs.transactions = { label: 'Bank transactions', short: 'Bank', icon: 'bank', render, create, edit, importCSV, importStatement };
})();
