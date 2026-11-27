/* The Ground Up: invoices from Oswaldtwistle Pharmacy (GU.owpImport).
   The pharmacy's dashboard (Owner → Invoices → Export for The Ground Up) makes a zip of the invoices the owner paid
   himself (Paid by: Abdul Haleem): each file as it downloads there, and groundup-import.json, the list. This reads that
   zip and puts each invoice in Work › Orders & claims › Get paid back, with its file, named as it was there:
     not paid yet            → Pay these first (an invoice you still have to pay)
     paid, not reimbursed    → Not sent yet
     reimbursed              → Paid back, on the day it was reimbursed
   Each one is kept as p-owp-<its id there>, so importing the same zip again, or a newer one, updates it and never adds it
   twice. An update only changes what you haven't changed here yourself. Something already here that looks like the same
   invoice (the same amount, within 3 days) is offered as the one to link it to. The whole import is one Undo.
   Opened from Get paid back's 'Import from the pharmacy', or by dropping the zip on any drop area (GU.hub.add). */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, money, plural, fmtDate, round2 } = GU.util;
  const store = GU.store;

  const FORMAT = 'owp-invoices-for-the-ground-up';
  const VERSION = 1; // the newest list this reads (lib/owner-invoices.mjs EXPORT_VERSION there)
  const MANIFEST = 'groundup-import.json';
  const PLACE = { pay: 'Pay these first', send: 'Not sent yet', back: 'Paid back' };
  const recId = (x) => 'p-owp-' + x.id;
  const short = (iso) => (iso ? fmtDate(iso, { short: true }) : '');
  const pounds = (p) => money(round2((Number(p) || 0) / 100));
  const icon = (n) => GU.ui.icon(n);

  /* ---------- reading a zip ---------- */
  /* Its central directory: {name: {method, csize, size, at}}. Files stored as they are (the pharmacy's) or squeezed
     (a zip made again on a computer) both read; one over 4 GB doesn't. */
  async function listZip(blob) {
    const tailLen = Math.min(blob.size, 65557);
    const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    let end = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('not a zip');
    const count = tail.getUint16(end + 10, true);
    const cdSize = tail.getUint32(end + 12, true);
    const cdAt = tail.getUint32(end + 16, true);
    const cd = new DataView(await blob.slice(cdAt, cdAt + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const out = {};
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const nameLen = cd.getUint16(p + 28, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
      out[name] = { method: cd.getUint16(p + 10, true), csize: cd.getUint32(p + 20, true), size: cd.getUint32(p + 24, true), at: cd.getUint32(p + 42, true) };
      p += 46 + nameLen + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true);
    }
    return out;
  }
  async function readEntry(blob, e) {
    const head = new DataView(await blob.slice(e.at, e.at + 30).arrayBuffer());
    if (head.getUint32(0, true) !== 0x04034b50) throw new Error('damaged zip');
    const from = e.at + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const raw = blob.slice(from, from + e.csize);
    if (e.method === 0) return new Uint8Array(await raw.arrayBuffer());
    if (e.method === 8 && typeof DecompressionStream === 'function') {
      return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    }
    throw new Error('This zip is packed in a way I can’t read. Use the zip as it came from the pharmacy.');
  }
  async function hashOf(bytes) {
    if (!(window.crypto && crypto.subtle)) return '';
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(h), (b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
  }

  /* ---------- is it one? ---------- */
  const isZipName = (f) => !!f && (/\.zip$/i.test(f.name || '') || /zip/.test(f.type || ''));
  const seen = new WeakMap();
  /* {zip, list, entries} for an export from the pharmacy, or null for any other file. */
  function parse(file) {
    if (!isZipName(file)) return Promise.resolve(null);
    if (!seen.has(file)) {
      seen.set(file, (async () => {
        try {
          const entries = await listZip(file);
          if (!entries[MANIFEST]) return null;
          const list = JSON.parse(new TextDecoder().decode(await readEntry(file, entries[MANIFEST])));
          if (!list || list.format !== FORMAT) return null;
          return { zip: file, list, entries };
        } catch (e) {
          return null;
        }
      })());
    }
    return seen.get(file);
  }
  /* The files that are exports from the pharmacy, and the rest, for GU.hub.add. */
  async function split(files) {
    const mine = [];
    const rest = [];
    for (const f of files) ((await parse(f)) ? mine : rest).push(f);
    return { mine, rest };
  }

  /* ---------- what each one becomes ---------- */
  const noteFor = (x) => 'VAT ' + pounds(x.vatPence) + ' (' + pounds(x.totalPence - x.vatPence) + ' without VAT). From Oswaldtwistle Pharmacy, Owner › Invoices.';
  const snap = (x, from) => ({ id: x.id, label: x.label, totalPence: x.totalPence, vatPence: x.vatPence, date: x.date, paid: !!x.paid, paidOn: x.paidOn || '',
    reimbursed: !!x.reimbursed, reimbursedOn: x.reimbursedOn || '', fileName: x.fileName, sha256: x.sha256 || '', from: from || '', at: new Date().toISOString() });
  const amountOf = (x) => round2((Number(x.totalPence) || 0) / 100);
  const paidOn = (x) => (x.paid || x.reimbursed ? x.paidOn || x.date || today() : '');
  const backOn = (x) => x.reimbursedOn || x.paidOn || x.date || today();
  function fresh(x, file, from) {
    const W = GU.workMoney;
    const rec = {
      id: recId(x), created: today(), kind: 'invoice-in', context: 'work', payer: 'me', category: W.WORK_OUT,
      title: x.label, party: '', amount: amountOf(x), date: x.date, dueDate: '', warrantyUntil: '', reference: '',
      status: x.paid || x.reimbursed ? 'paid' : 'unpaid', paidDate: paidOn(x), notes: noteFor(x), files: file ? [file] : [],
      claimStatus: x.reimbursed ? 'paid-back' : 'to-send', owp: snap(x, from),
    };
    if (x.reimbursed) Object.assign(rec, { claimedDate: backOn(x), repaidDate: backOn(x) });
    return W.mirror(rec);
  }
  /* What an import would change on a record that's here already: only what still is as the last import left it
     (what you changed here stays), and reimbursed or not as the pharmacy says. [{field, to, what}] */
  function changesFor(r, x) {
    const W = GU.workMoney;
    const was = r.owp || null;
    const out = [];
    const same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);
    if (was) {
      if (!same(x.label, was.label) && same(r.title, was.label)) out.push({ field: 'title', to: x.label, what: 'label' });
      if (x.totalPence !== was.totalPence && Math.abs((Number(r.amount) || 0) - amountOf(was)) < 0.005) out.push({ field: 'amount', to: amountOf(x), what: 'total' });
      if (!same(x.date, was.date) && same(r.date, was.date)) out.push({ field: 'date', to: x.date, what: 'date' });
      if ((x.vatPence !== was.vatPence || x.totalPence !== was.totalPence) && same(r.notes, noteFor(was))) out.push({ field: 'notes', to: noteFor(x), what: 'VAT' });
    }
    if ((x.paid || x.reimbursed) && r.kind === 'invoice-in' && r.status !== 'paid') out.push({ field: 'status', to: 'paid', what: 'paid' }, { field: 'paidDate', to: paidOn(x) });
    const st = W.stage(r);
    if (x.reimbursed && st !== 'paid-back') {
      out.push({ field: 'claimStatus', to: 'paid-back', what: 'paid back' }, { field: 'repaidDate', to: backOn(x) });
      if (!r.claimedDate) out.push({ field: 'claimedDate', to: backOn(x) });
    } else if (!x.reimbursed && was && was.reimbursed && st === 'paid-back' && !r.repaidTx && same(r.repaidDate, was.reimbursedOn || backOn(was))) {
      // reimbursed there by mistake, and unticked: back to Not sent yet (unless you'd matched a payment here)
      out.push({ field: 'claimStatus', to: 'to-send', what: 'not paid back' }, { field: 'repaidDate', to: '' }, { field: 'claimedDate', to: '' });
    }
    return out;
  }
  const hasFile = (r, x) => (r.files || []).some((f) => f && (f.owp === x.id || (x.sha256 && f.sha256 === x.sha256)));
  /* Already here, but not from the pharmacy: a work record of the same amount within 3 days. */
  function lookalikes(s, x) {
    const a = amountOf(x);
    const day = (iso) => Date.parse((iso || '') + 'T12:00:00Z') / 864e5;
    return (s.paperwork || []).filter((p) => p.context === 'work' && !p.owp && !p.owpId && Math.abs(Math.abs(Number(p.amount) || 0) - a) < 0.005 &&
      p.date && x.date && Math.abs(day(p.date) - day(x.date)) <= 3);
  }

  /* ---------- the plan ---------- */
  /* Each invoice in the zips: {x, src, state: 'new' | 'update' | 'same' | 'deleted', rec, changes, file, like, choice}. */
  function plan(found) {
    const s = store.state;
    const byId = new Map();
    for (const f of found) for (const x of f.list.invoices || []) if (x && x.id && !byId.has(x.id)) byId.set(x.id, { x, src: f });
    const binned = new Set((s.trash || []).filter((e) => e.c === 'paperwork' && e.record).map((e) => e.record.id));
    return Array.from(byId.values()).sort((a, b) => (a.x.date || '').localeCompare(b.x.date || '')).map((row) => {
      const x = row.x;
      const rec = (s.paperwork || []).find((p) => p.id === recId(x) || p.owpId === x.id) || null;
      if (!rec && binned.has(recId(x))) return Object.assign(row, { state: 'deleted', choice: 'skip' });
      if (rec) {
        const changes = changesFor(rec, x);
        const file = !hasFile(rec, x);
        return Object.assign(row, { rec, changes, file, state: changes.length || file ? 'update' : 'same', choice: 'apply' });
      }
      const like = lookalikes(s, x);
      return Object.assign(row, { state: 'new', like, choice: like.length === 1 && like[0].date === x.date ? 'link:' + like[0].id : 'add' });
    });
  }

  /* ---------- the dialog ---------- */
  async function open(files) {
    files = Array.from(files || []);
    const found = [];
    const bad = [];
    for (const f of files) {
      const p = await parse(f);
      if (!p) bad.push(f.name || 'a file');
      else if (!(p.list.version <= VERSION)) return GU.ui.toast('That zip is from a newer pharmacy dashboard. Reload The Ground Up to get its newest version, then try again.', { timeout: 9000 });
      else found.push(p);
    }
    if (!found.length) {
      GU.ui.toast(bad.length ? 'That isn’t an export from the pharmacy. In its dashboard: Owner › Invoices › Export for The Ground Up.' : 'Choose the zip from the pharmacy.', { timeout: 9000 });
      return null;
    }
    const W = GU.workMoney;
    const s = store.state;
    const e = W.employer(s);
    const head = found[0].list;
    const from = (head.from && head.from.business) || 'Oswaldtwistle Pharmacy';
    const trading = (head.from && head.from.tradingName) || '';
    const payers = Array.from(new Set(found.map((f) => f.list.payer).filter(Boolean)));
    const rows = plan(found);
    const parts = found.map((f) => f.list).filter((l) => l.parts > 1);
    const missingParts = parts.length && parts[0].parts > new Set(parts.map((l) => l.part)).size ? parts[0].parts - new Set(parts.map((l) => l.part)).size : 0;
    // The example business (Acme, from the example data) counts as none: yours can take its place
    const example = !!(s.settings.employer && s.settings.employer.demo);
    const theirs = e.set && !example && !(W.isEmployerText(s, from) || (trading && W.isEmployerText(s, trading)));
    const me = String(s.settings.name || '').trim().toLowerCase();
    const notMe = me && payers.length && !payers.some((n) => me.includes(String(n).toLowerCase().split(' ')[0]));

    const notes = [];
    if (!e.set || example) notes.push('<label class="check"><input type="checkbox" data-employer checked><span>' + esc('Set ' + from + (trading ? ' (' + trading + ')' : '') + ' as the business you work for' + (example ? ', in place of the example one, ' + e.name : '') + '. You can change it in Settings › Work.') + '</span></label>');
    if (theirs) notes.push('<p class="note-line">' + icon('info') + '<span>' + esc('These are from ' + from + '. The business you work for here is ' + e.name + ', so they’ll be things ' + e.label + ' pays you back for.') + '</span></p>');
    if (notMe) notes.push('<p class="note-line">' + icon('alert') + '<span>' + esc('These were paid by ' + payers.join(' and ') + '. Your name here is ' + s.settings.name + '.') + '</span></p>');
    if (missingParts) notes.push('<p class="note-line">' + icon('alert') + '<span>' + esc('This export came in ' + parts[0].parts + ' zips and ' + plural(missingParts, 'is', 'are') + ' not here. Import ' + (missingParts === 1 ? 'it' : 'them') + ' too, now or later.') + '</span></p>');
    if (bad.length) notes.push('<p class="note-line">' + icon('info') + '<span>' + esc(plural(bad.length, 'file') + ' that isn’t from the pharmacy ' + (bad.length === 1 ? 'is' : 'are') + ' left out: ' + bad.slice(0, 3).join(', ') + '.') + '</span></p>');

    const stateText = (r) => {
      if (r.state === 'deleted') return 'You deleted it here: it’s in Settings › Recently deleted';
      if (r.state === 'same') return 'Here already, up to date';
      if (r.state === 'update') return 'Here already: ' + [r.file ? 'adds the file' : ''].concat(r.changes.filter((c) => c.what).map((c) => 'now ' + c.what)).filter(Boolean).join(', ');
      return 'New';
    };
    const choiceHTML = (r, i) => {
      if (r.state !== 'new' || !r.like.length) return '';
      const opts = [['add', 'Add it as a new one']].concat(r.like.map((p) => ['link:' + p.id, 'It’s “' + (p.party || p.title || 'Item') + '”, ' + short(p.date) + ': put it with that'])).concat([['skip', 'Leave it out']]);
      return '<label class="field"><span class="field__label">' + esc('Looks like one you have') + '</span><select data-choice="' + i + '">' +
        opts.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === r.choice ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
    };
    const counts = { pay: 0, send: 0, back: 0 };
    rows.forEach((r) => counts[r.x.where] !== undefined && counts[r.x.where]++);
    const total = rows.reduce((a, r) => a + (Number(r.x.totalPence) || 0), 0);
    const intro = '<b>' + esc(plural(rows.length, 'invoice') + ' · ' + pounds(total)) + '</b>' + esc(', paid by ' + (payers.join(' and ') || 'you') + ', from ' + from + '. They go in Work › Orders & claims › Get paid back, each with its file: ' +
      ['send', 'pay', 'back'].filter((k) => counts[k]).map((k) => PLACE[k] + ' ' + counts[k]).join(' · ') + '.');
    const list = '<ol class="pb-send pb-owp">' + rows.map((r, i) => '<li><span class="pb-send__date">' + esc(short(r.x.date) || '–') + '</span>' +
      '<span class="pb-send__main"><b>' + esc(r.x.label) + '</b><em>' + esc(PLACE[r.x.where] + ' · ' + r.x.fileName + ' · ' + stateText(r)) + '</em>' + choiceHTML(r, i) + '</span>' +
      '<b class="pb-send__amt">' + esc(pounds(r.x.totalPence)) + '</b></li>').join('') + '</ol>';
    const todo = () => rows.filter((r) => r.choice !== 'skip' && (r.state === 'new' || r.state === 'update')).length;
    const d = GU.ui.openDialog({
      title: 'Invoices from the pharmacy',
      wide: true,
      className: 'dlg--send',
      body: '<p class="dlg__intro">' + intro + '</p>' + notes.join('') + list + '<p class="field__help">' + esc('Importing the same invoices again updates them, never twice. What you change here yourself stays as you made it.') + '</p>',
      footer: '<span class="spacer"></span><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn btn--primary" data-go>' + icon('download') + '<span data-go-label></span></button>',
    });
    const go = d.el.querySelector('[data-go]');
    const label = () => {
      const n = todo();
      d.el.querySelector('[data-go-label]').textContent = n ? 'Import ' + plural(n, 'invoice') : 'Nothing to import';
      go.disabled = !n && !(d.body.querySelector('[data-employer]') || {}).checked;
    };
    label();
    d.body.addEventListener('change', (ev) => {
      const sel = ev.target.closest('[data-choice]');
      if (sel) rows[+sel.dataset.choice].choice = sel.value;
      label();
    });
    return new Promise((resolve) => {
      let busy = false;
      d.form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (busy) return;
        busy = true;
        go.disabled = true;
        const setEmployer = !!(d.body.querySelector('[data-employer]') || {}).checked;
        try {
          const out = await apply(rows, { from, trading, setEmployer, progress: (t) => (d.el.querySelector('[data-go-label]').textContent = t) });
          d.close();
          resolve(out);
        } catch (err) {
          busy = false;
          label();
          GU.ui.toast(err && err.message ? err.message : 'That didn’t import. Try again.', { timeout: 9000 });
        }
      });
      d.el.addEventListener('close', () => resolve(null));
    });
  }

  /* ---------- importing ---------- */
  async function putFile(row) {
    const x = row.x;
    const e = row.src.entries[x.path];
    if (!e) throw new Error('“' + x.label + '” has no file in the zip. Export it again from the pharmacy.');
    const bytes = await readEntry(row.src.zip, e);
    const h = await hashOf(bytes);
    if (x.sha256 && h && h !== x.sha256) throw new Error('“' + x.label + '”’s file in the zip is damaged. Download the zip from the pharmacy again.');
    const rec = { id: 'f-' + uid(), name: x.fileName, type: x.type || 'application/octet-stream', size: bytes.length, added: today(), blob: new Blob([bytes], { type: x.type || 'application/octet-stream' }) };
    await GU.files.put(rec);
    if (GU.sync && GU.sync.queueUpload) GU.sync.queueUpload(rec.id);
    return { id: rec.id, name: rec.name, type: rec.type, size: rec.size, added: rec.added, owp: x.id, sha256: x.sha256 || h };
  }
  async function apply(rows, o) {
    const W = GU.workMoney;
    const work = rows.filter((r) => r.choice !== 'skip' && (r.state === 'new' || r.state === 'update'));
    // The files first, all of them, so a damaged one stops the import before anything is changed
    const files = new Map();
    let k = 0;
    for (const r of work) {
      k++;
      const needs = r.state === 'new' ? !(r.choice.startsWith('link:') && (findPaper(r.choice.slice(5)) || {}).files && findPaper(r.choice.slice(5)).files.length) : r.file;
      if (!needs) continue;
      if (o.progress) o.progress('Reading ' + k + ' of ' + work.length + '…');
      files.set(r.x.id, await putFile(r));
    }
    const done = { added: 0, linked: 0, updated: 0 };
    store.commit((st) => {
      if (o.setEmployer && (!W.employer(st).set || (st.settings.employer && st.settings.employer.demo))) {
        const short = String(o.from).replace(/[\s,]+(limited|ltd\.?)$/i, '').trim();
        st.settings.employer = { name: o.from, short, match: [short.toLowerCase(), String(o.trading || '').toLowerCase()].filter(Boolean), since: today() };
      }
      for (const r of work) {
        const x = r.x;
        const file = files.get(x.id) || null;
        const from = o.from;
        if (r.state === 'new' && r.choice === 'add') {
          st.paperwork.push(fresh(x, file, from));
          done.added++;
          continue;
        }
        const rec = r.state === 'new' ? st.paperwork.find((p) => p.id === r.choice.slice(5)) : st.paperwork.find((p) => p.id === r.rec.id);
        if (!rec) continue;
        for (const c of changesFor(rec, x)) rec[c.field] = c.to;
        if (file) rec.files = (rec.files || []).concat(file);
        if (r.state === 'new') {
          rec.owpId = x.id;
          rec.context = 'work';
          if (!rec.payer) rec.payer = 'me';
          if (!rec.claimStatus) rec.claimStatus = W.stage(rec);
          done.linked++;
        } else done.updated++;
        // The file keeps the invoice's name there, when you haven't renamed it here
        const was = rec.owp;
        if (was && was.fileName !== x.fileName) for (const f of rec.files || []) if (f && f.owp === x.id && f.name === was.fileName) f.name = x.fileName;
        rec.owp = snap(x, from);
        W.mirror(rec);
      }
    }, { label: 'Imported ' + plural(work.length, 'invoice') + ' from the pharmacy' });
    // a renamed file keeps the name on this device too, for its download
    for (const r of work) {
      const rec = findPaper(r.rec ? r.rec.id : recId(r.x));
      for (const f of (rec && rec.files) || []) {
        if (!f || f.owp !== r.x.id) continue;
        const local = await GU.files.getLocal(f.id);
        if (local && local.name !== f.name) await GU.files.put(Object.assign(local, { name: f.name }));
      }
    }
    const said = [done.added ? plural(done.added, 'invoice') + ' added' : '', done.linked ? done.linked + ' put with ones you had' : '', done.updated ? done.updated + ' updated' : ''].filter(Boolean).join(', ');
    GU.ui.toast((said || 'Nothing changed') + ' in Get paid back.', { timeout: 10000, action: said ? 'Undo' : null, exact: true, onAction: said ? () => GU.history.undo() : null });
    return done;
  }
  const findPaper = (id) => (store.state.paperwork || []).find((p) => p.id === id) || null;

  /* The button on Get paid back: choose the zip (or zips, for an export in parts). */
  async function choose() {
    const files = await GU.ui.pickFiles('.zip,application/zip,application/x-zip-compressed');
    if (files && files.length) return open(files);
    return null;
  }

  GU.owpImport = { parse, split, open, choose, plan, fresh, changesFor };
})();
