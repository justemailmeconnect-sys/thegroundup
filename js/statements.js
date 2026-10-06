/* The Ground Up: reading bank statements. Everything here runs on this device.
   Formats: CSV (Monzo, HSBC with or without headers, most banks), Santander .txt, Quicken (.qif),
   Money/OFX (.ofx, .qfx), Excel (.xls, .xlsx) and PDF statements (Monzo, Santander, HSBC and
   most others with a table of Date / Description / Money in / Money out / Balance). */
(function () {
  'use strict';
  const GU = window.GU;
  const { parseCSV, parseLooseDate, parseAmount, round2, addDays, guessDateOrder, MONTHS } = GU.util;

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load ' + src));
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  /* Text files from banks come in UTF-8, UTF-16 or Windows Latin-1 (Santander). */
  async function readText(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
    if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(buf);
    }
  }

  /* ---------- which bank ---------- */
  const BANKS = [
    ['Monzo', /monzo|monzgb/], ['Santander', /santander|abbygb|cahoot/], ['HSBC', /\bhsbc\b|midlgb/], ['First Direct', /first ?direct/],
    ['Barclays', /barclays|barcgb/], ['Lloyds', /lloyds|loydgb/], ['Halifax', /halifax/], ['NatWest', /natwest|nwbkgb/], ['Nationwide', /nationwide|naiagb/],
    ['Starling', /starling|srlggb/], ['Revolut', /revolut|revogb/], ['Chase', /chase/], ['TSB', /\btsb\b/], ['Metro Bank', /metro ?bank/], ['Co-operative Bank', /co-?operative bank/],
    ['American Express', /american express|amex/], ['Virgin Money', /virgin money/],
  ];
  function detectBank(text, name) {
    const t = ((name || '') + ' ' + String(text || '').slice(0, 6000)).toLowerCase();
    if (/transaction id,date,time,type,name,emoji/.test(t)) return 'Monzo';
    const hit = BANKS.find(([, re]) => re.test(t));
    return hit ? hit[0] : '';
  }

  /* ---------- tidy bank descriptions ---------- */
  const CLEAN = [
    [/\s*Santander Reference \S+$/i, ''],
    [/^Third party payment made via Faster Payment to (.+?) Reference (.+)$/i, '$1 · $2'],
    [/^CARD PAYMENT TO (.+?)(?:,\s*[\d.,]+\s*[A-Z]{3}\b.*?)?(?:\s+ON \d{2}-\d{2}-\d{4})?$/i, '$1'],
    [/^(?:CONTACTLESS|CARD) (?:PURCHASE|PAYMENT) (?:AT |TO )?(.+)$/i, '$1'],
    [/^CASH WITHDRAWAL AT (.+?)(?:,\s*[\d.,]+\s*GBP.*)?(?:\s*,?\s*ON \d{2}-\d{2}-\d{4})?$/i, 'Cash withdrawal · $1'],
    [/^(?:DIRECT DEBIT PAYMENT TO|STANDING ORDER VIA FASTER PAYMENT TO|BILL PAYMENT VIA FASTER PAYMENT TO|BILL PAYMENT TO|STANDING ORDER TO)\s+(.+?)(?:\s*,?\s*(?:REF(?:ERENCE)?\b|MANDATE NO).*)?$/i, '$1'],
    [/^FASTER PAYMENTS? RECEIPT\s+REF\.?\s*(?:NOT PROVIDED)?\s*(.*?)\s*FROM\s+(.+)$/i, (m, ref, who) => who + (ref ? ' · ' + ref : '')],
    [/^BILL PAYMENT FROM (.+?)(?:,\s*REFERENCE\s+(.+))?$/i, (m, who, ref) => who + (ref ? ' · ' + ref : '')],
    [/^BANK GIRO CREDIT REF \S+\s+(.+?)(?:,\s*\d+)?$/i, '$1'],
    [/^CREDIT FROM (.+?)(?:\s+ON \d{2}-\d{2}-\d{4})?$/i, 'Refund · $1'],
    [/^(.+?)\s+\((?:Faster Payments|Direct Debit|Standing Order|Bank Transfer|Bacs)\)\s*(?:Reference:\s*(.+))?$/i, (m, who, ref) => who + (ref ? ' · ' + ref : '')],
    [/^(?:VIS|DD|SO|BP|CR|DR|ATM|TFR|CHQ|OBP|FPI|FPO|PAY|DEB|BGC|\)\)\))\s+/i, ''],
    [/\s+ON \d{2}-\d{2}-\d{4}$/i, ''],
  ];
  function cleanDescription(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim();
    for (const [re, rep] of CLEAN) s = s.replace(re, rep);
    return s.trim() || String(raw || '').trim();
  }

  /* Monzo and some other banks put their own category in the export. */
  const BANK_CATEGORIES = {
    groceries: 'Groceries', 'eating out': 'Eating out', eating_out: 'Eating out', transport: 'Transport', bills: 'Bills & utilities', entertainment: 'Entertainment',
    shopping: 'Shopping', holidays: 'Travel', travel: 'Travel', 'personal care': 'Personal care', personal_care: 'Personal care', family: 'Family & kids',
    charity: 'Gifts & donations', gifts: 'Gifts & donations', expenses: 'Work expenses', savings: 'Transfers', cash: 'Cash', transfers: 'Transfers', transfer: 'Transfers',
    income: '', general: '', finances: '',
  };
  function bankCategory(value) {
    const v = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(BANK_CATEGORIES, v) ? BANK_CATEGORIES[v] : '';
  }

  /* ---------- Santander .txt ---------- */
  function parseSantanderTxt(text) {
    if (!/^\s*From:/m.test(text) || !/^\s*Description:/m.test(text) || !/^\s*Amount:/m.test(text)) return null;
    const norm = text.replace(/ /g, ' ');
    const out = [];
    let cur = null;
    for (const line of norm.split(/\r?\n/)) {
      const m = line.match(/^\s*(Date|Description|Amount|Balance):\s*(.*?)\s*$/i);
      if (!m) continue;
      const k = m[1].toLowerCase();
      if (k === 'date') {
        if (cur) out.push(cur);
        cur = { date: parseLooseDate(m[2], 'dmy') };
      } else if (cur) cur[k] = m[2];
    }
    if (cur) out.push(cur);
    const acct = (norm.match(/^\s*Account:\s*(.+)$/m) || [])[1] || '';
    return {
      kind: 'transactions', bank: 'Santander', format: 'text export', accountHint: acct.trim(),
      transactions: out.filter((r) => r.date && r.description).map((r) => ({ date: r.date, raw: r.description, amount: parseAmount(r.amount), balance: parseAmount(r.balance) })).filter((r) => !isNaN(r.amount)),
    };
  }

  /* ---------- Quicken .qif ---------- */
  function parseQIF(text) {
    if (!/^!Type:/im.test(text)) return null;
    const recs = [];
    let cur = {};
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('^')) {
        if (cur.D) recs.push(cur);
        cur = {};
      } else if (line.length > 1 && /[DTUPM]/.test(line[0])) cur[line[0]] = line.slice(1).trim();
    }
    const order = guessDateOrder(recs.map((r) => r.D));
    return {
      kind: 'transactions', bank: '', format: 'Quicken file',
      transactions: recs.map((r) => ({ date: parseLooseDate(r.D.replace(/'/g, '/').replace(/\s/g, ''), order), raw: [r.P, r.M].filter(Boolean).join(' · ') || 'Transaction', amount: parseAmount(r.T || r.U) }))
        .filter((r) => r.date && !isNaN(r.amount)),
    };
  }

  /* ---------- OFX / QFX ---------- */
  function parseOFX(text) {
    if (!/<OFX>|OFXHEADER/i.test(text)) return null;
    const get = (b, tag) => ((b.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i')) || [])[1] || '').trim();
    const txs = text.split(/<STMTTRN>/i).slice(1).map((b) => {
      const d = get(b, 'DTPOSTED');
      return { date: d.length >= 8 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : null, raw: [get(b, 'NAME'), get(b, 'MEMO')].filter(Boolean).join(' · ') || 'Transaction', amount: parseAmount(get(b, 'TRNAMT')) };
    }).filter((r) => r.date && !isNaN(r.amount));
    return { kind: 'transactions', bank: detectBank(get(text, 'ORG') + ' ' + text.slice(0, 2000)), format: 'Money (OFX) file', transactions: txs };
  }

  /* ---------- Excel ---------- */
  async function parseSheet(file) {
    const head = await readText(file.slice(0, 600));
    if (/^\s*</.test(head)) {
      // Some banks' "Excel" downloads are really web pages with a table in them.
      const doc = new DOMParser().parseFromString(await readText(file), 'text/html');
      const rows = Array.from(doc.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
      return rows.filter((r) => r.some(Boolean));
    }
    await loadScript(SHEETJS);
    const wb = window.XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
    let best = [];
    for (const name of wb.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' })
        .map((r) => r.map((c) => String(c).trim())).filter((r) => r.some(Boolean));
      if (rows.length > best.length) best = rows;
    }
    return best;
  }

  /* ---------- PDF statements ---------- */
  const MONEY = /^\(?[-−]?£?\s?[-−]?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR|D))?$/i;
  const DATE_AT_START = /^(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{2,4})?|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})(?=\s|$)/i;
  const SKIP_LINE = /balance (?:brought|carried) forward|brought forward|carried forward|opening balance|closing balance|start balance|end balance|^total\b|page \d+ of \d+|continued on|^\s*(?:date\s+)?description\b/i;
  const FOOTER = /monzo bank limited|registered in england|registered office|important information|financial services compensation|authorised by the prudential|santander uk plc\.|hsbc uk bank plc|account name:|statement number:|^\s*page number/i;

  async function pdfLines(file) {
    await loadScript(PDFJS);
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      const items = [];
      for (const it of tc.items) {
        const s = (it.str || '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        const x = it.transform[4];
        const y = it.transform[5];
        const w = it.width || s.length * 5;
        // A run like "29.39 514.95" holds two numbers: split it so each lands in its own column.
        const parts = s.split(' ');
        if (parts.length > 1 && parts.every((t) => MONEY.test(t))) {
          let off = 0;
          for (const t of parts) {
            const start = s.indexOf(t, off);
            items.push({ s: t, x: x + (w * start) / s.length, y, w: (w * t.length) / s.length });
            off = start + t.length;
          }
        } else items.push({ s, x, y, w });
      }
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of items) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
        else lines.push({ y: it.y, items: [it] });
      }
      for (const l of lines) {
        l.items.sort((a, b) => a.x - b.x);
        l.text = l.items.map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim();
      }
      pages.push(lines);
    }
    return pages;
  }

  function findPeriod(text) {
    const m1 = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})\s*(?:to|-|–|until)\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})/);
    if (m1) {
      const a = parseLooseDate(m1[1] + ' ' + m1[2] + ' ' + m1[3], 'dmy');
      const b = parseLooseDate(m1[4] + ' ' + m1[5] + ' ' + m1[6], 'dmy');
      if (a && b) return { from: a, to: b };
    }
    const m2 = text.match(/(\d{2}\/\d{2}\/\d{4})\s*(?:to|-|–)\s*(\d{2}\/\d{2}\/\d{4})/);
    if (m2) return { from: parseLooseDate(m2[1], 'dmy'), to: parseLooseDate(m2[2], 'dmy') };
    return null;
  }
  /* "17th Dec" has no year: use the statement period to work it out. */
  function parseStatementDate(s, period, fallbackYear) {
    const clean = s.replace(/(\d)(st|nd|rd|th)\b/i, '$1').replace(/\./g, '').trim();
    if (/\d{4}$|\/\d{2}$|\s\d{2}$/.test(clean)) return parseLooseDate(clean, 'dmy');
    const endYear = period && period.to ? +period.to.slice(0, 4) : fallbackYear;
    for (const y of [endYear, endYear - 1, endYear + 1]) {
      const d = parseLooseDate(clean + ' ' + y, 'dmy');
      if (!d) continue;
      if (!period || (d >= addDays(period.from, -10) && d <= addDays(period.to, 10))) return d;
    }
    return parseLooseDate(clean + ' ' + endYear, 'dmy');
  }

  function classifyHeader(line) {
    const low = line.text.toLowerCase();
    if (!/\bdate\b/.test(low) || !/balance/.test(low) || !/(money|paid)\s*(in|out)|amount|credit|debit|withdraw|deposit|receipts|payments/.test(low)) return null;
    if (!/description|details|transaction|narrative|particulars|payee|merchant/.test(low)) return null;
    // Group neighbouring words into phrases, then decide what each column holds.
    const phrases = [];
    for (const it of line.items) {
      const last = phrases[phrases.length - 1];
      if (last && it.x - (last.x + last.w) < 8) {
        last.s += ' ' + it.s;
        last.w = it.x + it.w - last.x;
      } else phrases.push({ s: it.s, x: it.x, w: it.w });
    }
    const cols = [];
    for (const p of phrases) {
      const t = p.s.toLowerCase();
      let kind = null;
      if (/balance/.test(t)) kind = 'balance';
      else if (/(money|paid)\s*in|credits?|deposits?|receipts|\bin\b/.test(t)) kind = 'in';
      else if (/(money|paid)\s*out|debits?|withdrawals?|payments|spent|\bout\b/.test(t)) kind = 'out';
      else if (/amount/.test(t)) kind = 'amount';
      if (kind) cols.push({ kind, centre: p.x + p.w / 2, right: p.x + p.w });
    }
    return cols.some((c) => c.kind !== 'balance') ? cols : null;
  }

  function moneyValue(s) {
    let v = parseAmount(s.replace(/−/g, '-'));
    if (/CR$/i.test(s)) v = Math.abs(v);
    return v;
  }

  async function parsePDF(file) {
    const pages = await pdfLines(file);
    const allText = pages.map((ls) => ls.map((l) => l.text).join('\n')).join('\n');
    const period = findPeriod(pages.slice(0, 2).map((ls) => ls.map((l) => l.text).join('\n')).join('\n'));
    const years = (allText.match(/\b20\d{2}\b/g) || []).map(Number);
    const fallbackYear = years.length ? Math.max(...years) : new Date().getFullYear();
    const bank = detectBank(allText, file.name);
    const rows = [];
    let cols = null;
    let headerSeen = false;
    const gaps = [];
    // Monzo adds a "Pot statement" section for each Pot after the main account.
    let section = 'main';
    let pots = 0;
    const potNames = {};

    for (const lines of pages) {
      let inTable = false;
      const pageRows = [];
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (/^pot statement$/i.test(line.text)) {
          section = 'pot' + ++pots;
          inTable = false;
          continue;
        }
        if (/^pot name$/i.test(line.text) && li > 0 && section !== 'main') potNames[section] = lines[li - 1].text;
        const header = classifyHeader(line);
        if (header) {
          cols = header;
          inTable = true;
          headerSeen = true;
          continue;
        }
        if (!inTable) continue;
        if (FOOTER.test(line.text)) {
          inTable = false;
          continue;
        }
        const row = { y: line.y, date: null, text: [], amount: null, balance: null, skip: SKIP_LINE.test(line.text), section };
        let rest = line.items.slice();
        const first = rest.length ? rest.map((i) => i.s).join(' ').match(DATE_AT_START) : null;
        const firstDate = first ? parseStatementDate(first[1], period, fallbackYear) : null;
        if (first && firstDate) {
          row.date = firstDate;
          // Drop the items that made up the date.
          let used = 0;
          while (rest.length && used < first[1].length) {
            used += rest[0].s.length + 1;
            rest.shift();
          }
        }
        for (const it of rest) {
          if (MONEY.test(it.s) && cols) {
            const c = cols.reduce((best, col) => (Math.abs(col.centre - (it.x + it.w / 2)) < Math.abs(best.centre - (it.x + it.w / 2)) ? col : best), cols[0]);
            const v = moneyValue(it.s);
            if (c.kind === 'balance') row.balance = v;
            else if (c.kind === 'in') row.amount = Math.abs(v);
            else if (c.kind === 'out') row.amount = -Math.abs(v);
            else row.amount = /DR$/i.test(it.s) ? -Math.abs(v) : v;
          } else row.text.push(it.s);
        }
        if (!row.text.length && row.amount == null && row.balance == null && !row.date) continue;
        pageRows.push(row);
      }
      for (let i = 1; i < pageRows.length; i++) gaps.push(pageRows[i - 1].y - pageRows[i].y);
      rows.push(pageRows);
    }
    if (!headerSeen) return { kind: 'transactions', bank, format: 'PDF statement', period, transactions: [], warning: 'I couldn’t find the transaction table in this PDF.' };

    // Lines without an amount belong to the nearest line with one (descriptions can wrap above and below it).
    gaps.sort((a, b) => a - b);
    const lineGap = gaps.length ? gaps[Math.floor(gaps.length * 0.25)] || 10 : 10;
    const maxDist = Math.max(8, lineGap * 1.8);
    const txs = [];
    let lastDate = null;
    // Santander and Monzo centre the amount line between wrapped description lines (the amount line has no text);
    // HSBC puts the amount on the last line of the description.
    const centred = rows.some((pr) => pr.some((r) => r.amount != null && !r.skip && !r.text.length));
    for (const pageRows of rows) {
      const anchors = pageRows.filter((r) => r.amount != null && !r.skip);
      for (const r of pageRows) {
        if (r.amount != null || r.skip || !r.text.length) continue;
        const near = (list) => list.filter((a) => Math.abs(a.y - r.y) <= maxDist);
        let pool = centred ? near(anchors.filter((a) => !a.text.length)) : [];
        if (!pool.length) pool = near(anchors);
        const preferBelow = !centred || !!r.date;
        let best = null;
        let bestD = Infinity;
        for (const a of pool) {
          const d = Math.abs(a.y - r.y);
          const tie = Math.abs(d - bestD) < 0.5 && (preferBelow ? a.y < r.y : a.y > r.y);
          if (d < bestD - 0.5 || tie) {
            best = a;
            bestD = d;
          }
        }
        if (best && bestD <= maxDist) {
          (best.extra = best.extra || []).push(r);
          if (r.date && !best.date) best.date = r.date;
        }
      }
      for (const r of pageRows) {
        if (r.skip && r.balance != null && r.amount == null) {
          txs.push({ openingBalance: r.balance, date: r.date || lastDate });
          continue;
        }
        if (r.amount == null || r.skip) continue;
        if (r.date) lastDate = r.date;
        const parts = [r].concat(r.extra || []).sort((a, b) => b.y - a.y).map((x) => x.text.join(' ')).filter(Boolean);
        txs.push({ date: r.date || lastDate, raw: parts.join(' ').replace(/\s+/g, ' ').trim(), amount: r.amount, balance: r.balance, section: r.section });
      }
    }
    const real = txs.filter((t) => t.raw != null && t.date && !isNaN(t.amount));
    // Statements can run newest first (Monzo): put each section in date order and check its running balance.
    const check = { ok: 0, bad: 0 };
    const inOrder = (list, count) => {
      const newestFirst = list.length > 1 && list[0].date > list[list.length - 1].date;
      const ordered = newestFirst ? list.slice().reverse() : list;
      let prev = null;
      for (const t of ordered) {
        if (count && t.balance != null && prev != null) {
          if (Math.abs(round2(prev + t.amount) - t.balance) < 0.011) check.ok++;
          else check.bad++;
        }
        if (t.balance != null) prev = t.balance;
        else if (prev != null) prev = round2(prev + t.amount);
      }
      return ordered;
    };
    const main = inOrder(real.filter((t) => t.section === 'main'), true);
    const potList = Object.keys(potNames).concat(Array.from(new Set(real.map((t) => t.section))).filter((x) => x !== 'main' && !potNames[x]))
      .map((sec) => ({ name: potNames[sec] || 'Pot', transactions: inOrder(real.filter((t) => t.section === sec), false) }))
      .filter((p) => p.transactions.length);
    const od = allText.match(/(?:arranged\s+)?overdraft limit(?:\s+is)?:?\s*£?\s*([\d,]+(?:\.\d{2})?)/i);
    return { kind: 'transactions', bank, format: 'PDF statement', period, transactions: main, pots: potList, check, overdraftLimit: od ? parseAmount(od[1]) : null };
  }

  /* ---------- the one entry point ---------- */
  async function read(file) {
    const name = file.name || '';
    if (/\.pdf$/i.test(name) || /pdf/.test(file.type)) {
      const res = await parsePDF(file);
      res.isPdf = true;
      return finish(res);
    }
    if (/\.(xlsx|xls|xlsm|ods)$/i.test(name)) {
      const rows = await parseSheet(file);
      return { kind: 'table', rows, bank: detectBank(rows.slice(0, 5).join(' '), name), format: 'Excel file' };
    }
    const text = await readText(file);
    const special = parseSantanderTxt(text) || parseQIF(text) || parseOFX(text);
    if (special) {
      if (!special.bank) special.bank = detectBank(text, name);
      return finish(special);
    }
    const rows = parseCSV(text);
    return { kind: 'table', rows, bank: detectBank(text, name), format: 'CSV file' };
  }
  function finish(res) {
    const tidy = (list) => (list || []).map((t) => Object.assign({}, t, { description: cleanDescription(t.raw), amount: round2(t.amount) }));
    res.transactions = tidy(res.transactions);
    (res.pots || []).forEach((p) => (p.transactions = tidy(p.transactions)));
    return res;
  }

  /* ---------- money moved between your own accounts ---------- */
  /* An amount leaving one account and arriving in another within 3 days is a transfer, not spending. */
  function matchTransfers(state, onlyIds) {
    const changed = [];
    const hint = /faster payment|transfer|standing order|pot\b|monzo|santander|hsbc|barclays|lloyds|natwest|nationwide|starling|revolut|halifax|own account|reference/i;
    const outs = state.transactions.filter((t) => t.amount < 0 && t.category !== 'Transfers');
    const ins = state.transactions.filter((t) => t.amount > 0 && t.category !== 'Transfers');
    const used = new Set();
    for (const o of outs) {
      const match = ins.find((i) => !used.has(i.id) && i.account !== o.account && Math.abs(i.amount + o.amount) < 0.005 &&
        Math.abs(GU.util.toDays(i.date) - GU.util.toDays(o.date)) <= 3 && (hint.test(o.description + ' ' + (o.notes || '')) || hint.test(i.description + ' ' + (i.notes || ''))) &&
        (!onlyIds || onlyIds.has(i.id) || onlyIds.has(o.id)));
      if (!match) continue;
      used.add(match.id);
      for (const t of [o, match]) {
        changed.push({ id: t.id, before: t.category });
        t.category = 'Transfers';
      }
    }
    return changed;
  }

  GU.statements = { read, readText, cleanDescription, bankCategory, detectBank, matchTransfers, parseStatementDate };
})();
