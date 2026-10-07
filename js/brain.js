/* The Ground Up: the assistant's reading and filing brain.
   Takes anything you throw at it (photos, PDFs, text, notes), works out what it is,
   pulls out the details and files it in the right section, or makes a new section.

   Three ways to read, best first:
   1. Claude inside the Claude app (the artifact "sample" capability, no setup needed)
   2. Claude through your own Anthropic API key (Settings)
   3. A built-in offline reader: PDF text, optional photo text recognition, and keyword rules */
(function () {
  'use strict';
  const GU = window.GU;
  const { esc, uid, today, addDays, addMonths, parseLooseDate, parseAmount, money, fmtDate, plural, round2 } = GU.util;
  const F = GU.finance;
  const store = GU.store;

  const MODEL = 'claude-opus-5-5';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  const DESTINATIONS = {
    receipt: 'Receipts',
    invoice_to_pay: 'Receipts',
    invoice_owed_to_me: 'Receipts',
    warranty: 'Receipts',
    bill: 'Bills',
    debt: 'Debts',
    document: 'Documents',
    task: 'To-do',
    transaction_out: 'Bank',
    transaction_in: 'Bank',
    bank_statement: 'Bank',
    order_history: 'Receipts',
    section: 'Your sections',
    unsure: 'Sorting hub',
  };
  const PAPER = ['receipt', 'invoice_to_pay', 'invoice_owed_to_me', 'warranty'];
  const PAYSLIPS = 'Employment and payslips';
  // Visa and immigration papers are filed as documents of this type.
  const IMMIGRATION_DOC = 'Residence permit or eVisa';
  /* The Visas page was taken out (the records stay in your data). A saved reading that still says 'visa' is a document now. */
  function retired(out) {
    if (out && out.destination === 'visa') {
      out.destination = 'document';
      if (!out.document_type || out.document_type === 'Other') out.document_type = IMMIGRATION_DOC;
    }
    return out;
  }
  const WORK_OUT = F.WORK_OUT || 'Work expenses';

  /* ---------- work: the employer and whose money ---------- */
  const wm = () => GU.workMoney || null;
  /* The employer from Settings, read through GU.workMoney's defaults ({set:false} when none is chosen). */
  function employer(s) {
    s = s || store.state;
    if (wm()) return wm().employer(s);
    const e = (s.settings && s.settings.employer) || null;
    const name = e && typeof e === 'object' ? String(e.name || e.short || '').trim() : '';
    return { set: !!name, name, short: name ? String(e.short || name).trim() : '', label: name ? String(e.short || name).trim() : 'the company', match: [] };
  }
  const isEmployerText = (text) => !!(wm() && text && wm().isEmployerText(store.state, String(text)));
  /* The receipts and invoices that need to know whose money paid (not a warranty, not an invoice you sent). */
  const asksPayer = (r) => !!r && r.context === 'work' && (r.destination === 'receipt' || r.destination === 'invoice_to_pay');
  const payerOk = (p) => p === 'me' || p === 'company';
  /* Whose money paid for a work receipt or invoice: what it says, or 'me' when your bank shows a payment of
     exactly that amount around its date (only when that's sure). null when it can't be told yet. */
  function payerFor(r, s) {
    if (!asksPayer(r)) return null;
    if (payerOk(r.payer)) return r.payer;
    if (!wm() || !(Number(r.amount) > 0) || !r.date || (r.destination === 'invoice_to_pay' && !r.paid)) return null;
    try {
      const m = wm().purchaseFor(s || store.state, { id: '', kind: 'receipt', context: 'work', amount: r.amount, date: r.date, party: r.party || '', title: r.title || '', notes: r.notes || '' });
      return m && m.sure && m.tx ? 'me' : null;
    } catch (e) {
      return null;
    }
  }
  const DEST_LABEL = {
    receipt: 'Receipt', invoice_to_pay: 'Invoice to pay', invoice_owed_to_me: 'Invoice someone owes you', warranty: 'Warranty',
    bill: 'Regular bill', debt: 'Debt', document: 'Important document', task: 'Task', transaction_out: 'Money out',
    transaction_in: 'Money in', bank_statement: 'Bank statement', order_history: 'Online order list', section: 'New or custom section', unsure: 'Not sure yet',
  };

  /* ---------- loading helpers ---------- */
  const scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Could not load ' + src));
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }
  function withTimeout(p, ms, msg) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'Timed out')), ms))]);
  }

  /* ---------- reading text out of files ---------- */
  async function pdfText(file, maxPages) {
    await withTimeout(loadScript(PDFJS), 20000, 'PDF reader did not load');
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data }).promise;
    let out = '';
    for (let i = 1; i <= Math.min(doc.numPages, maxPages || 6); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let line = '';
      let lastY = null;
      for (const it of tc.items) {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          out += line.trim() + '\n';
          line = '';
        }
        line += it.str + ' ';
        lastY = y;
      }
      out += line.trim() + '\n';
    }
    return out.trim();
  }
  async function ocrText(file) {
    await withTimeout(loadScript(TESSERACT), 20000, 'Photo reader did not load');
    const res = await withTimeout(window.Tesseract.recognize(file, 'eng'), 90000, 'Reading the photo took too long');
    return (res && res.data && res.data.text) || '';
  }
  const isPdf = (f) => /pdf/.test(f.type) || /\.pdf$/i.test(f.name);
  const isText = (f) => /^text\//.test(f.type) || /\.(txt|csv|eml|md|json)$/i.test(f.name);
  const isImg = (f) => /^image\/(jpeg|png|gif|webp)$/.test(f.type);

  async function readFileText(file, allowOcr) {
    try {
      if (isText(file)) return (await file.text()).slice(0, 20000);
      if (isPdf(file)) return (await pdfText(file)).slice(0, 20000);
      if (isImg(file) && allowOcr) return (await ocrText(file)).slice(0, 8000);
    } catch (e) {
      console.warn('[brain] could not read', file.name, e);
    }
    return '';
  }

  /* ---------- context the brain needs about your data ---------- */
  function context() {
    const s = store.state;
    const e = employer(s);
    const raw = (s.settings && s.settings.employer) || {};
    return {
      today: today(),
      name: s.settings.name || '',
      business: s.settings.business || '',
      employer: e.set ? { name: e.name, short: e.short, about: String(raw.about || '').trim() } : null,
      currency: s.settings.currency || 'GBP',
      sections: (s.sections || []).map((x) => ({ id: x.id, name: x.name })),
      documentTypes: GU.tabs.documents.TYPES,
      // Work money categories are set by the site itself (work paperwork and bills, the employer's bank lines).
      categories: F.EXPENSE.concat(F.INCOME).filter((c) => !(F.WORK || []).includes(c)),
    };
  }

  /* ---------- the shape every reader returns ---------- */
  const NULLABLE = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });
  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['destination', 'confidence', 'why', 'summary', 'title', 'party', 'amount', 'date', 'due_date', 'expiry_date', 'reference', 'context', 'payer', 'category',
      'document_type', 'frequency', 'paid', 'section_id', 'new_section_name', 'task_title', 'task_due', 'notes', 'monthly_payment', 'interest_rate', 'debt_type', 'term_months', 'borrowed_amount'],
    properties: {
      destination: { type: 'string', enum: Object.keys(DESTINATIONS) },
      confidence: { type: 'number' },
      why: { type: 'string' },
      summary: { type: 'string' },
      title: { type: 'string' },
      party: NULLABLE('string'),
      amount: NULLABLE('number'),
      date: NULLABLE('string'),
      due_date: NULLABLE('string'),
      expiry_date: NULLABLE('string'),
      reference: NULLABLE('string'),
      context: { type: 'string', enum: ['home', 'work'] },
      payer: { anyOf: [{ type: 'string', enum: ['company', 'me'] }, { type: 'null' }] },
      category: NULLABLE('string'),
      document_type: NULLABLE('string'),
      frequency: { anyOf: [{ type: 'string', enum: F.FREQUENCIES.map((f) => f.value) }, { type: 'null' }] },
      paid: { type: 'boolean' },
      section_id: NULLABLE('string'),
      new_section_name: NULLABLE('string'),
      task_title: NULLABLE('string'),
      task_due: NULLABLE('string'),
      notes: NULLABLE('string'),
      monthly_payment: NULLABLE('number'),
      interest_rate: NULLABLE('number'),
      debt_type: NULLABLE('string'),
      term_months: NULLABLE('number'),
      borrowed_amount: NULLABLE('number'),
    },
  };

  /* Who the user works for, and how to tell whose money paid for a work receipt. */
  function workLines(ctx) {
    const e = ctx.employer;
    if (!e) {
      return ['Work means the user\'s job or the business they work for. For a work receipt or invoice, set payer to "company" when the business paid or will pay, "me" when the user paid with their own card, account, cash, PayPal or Amazon and should get the money back, and null when you can\'t tell.'];
    }
    const named = '"' + e.name + '"' + (e.short && e.short !== e.name ? ' ("' + e.short + '")' : '');
    const who = e.short || e.name;
    return [
      named + ' is the business the user works for' + (e.about ? ' (' + e.about + ')' : '') + '. Anything for it is work: invoices and receipts addressed to it, orders for its premises, shop or office, its contracts, suppliers and jobs. Everything else is home.',
      'For a work receipt or invoice, set payer: "company" when ' + who + ' paid or will pay (its own card or account, or an invoice it will settle); "me" when the user\'s own card, account, cash, PayPal or Amazon shows they paid, so ' + who + ' owes them the money back; null when you can\'t tell.',
      'Payslips, P60s and tax summaries from ' + who + ' are about the user\'s own pay, so they are home documents. Wages from ' + who + ' are Salary.',
    ];
  }

  function instructions(ctx) {
    const e = ctx.employer;
    return [
      'You are the filing assistant inside a personal organiser app. The user throws things at you: photos of receipts, PDFs of invoices, letters, screenshots, pasted emails or quick notes. Decide where each one belongs and pull out the details so it can be filed without the user typing anything.',
      '',
      'Today is ' + ctx.today + '. The user is ' + (ctx.name || 'not named') + '.' + (ctx.business ? ' Their OWN trading name, used only on invoices they send for their own side work (not their employer), is "' + ctx.business + '".' : '') + ' Their currency is ' + ctx.currency + '. Most users are in the UK, so read dates like 03/04/2026 as 3 April.',
      '',
      ...workLines(ctx),
      '',
      'Pick one destination:',
      '- receipt: proof of something already bought or paid for (till receipt, card slip, order confirmation, e-receipt).',
      '- invoice_to_pay: an invoice or one-off bill the user has to pay. If it shows it has already been paid, still use this and set paid to true. Invoices for online orders (Amazon, eBay and similar) are already paid: set paid to true and put the order number in reference.',
      '- invoice_owed_to_me: an invoice the user (or their own business) sent to someone else, so someone owes the user money.',
      '- warranty: a warranty, guarantee or protection plan. Put the cover end date in expiry_date (work it out from the purchase date and length if needed).',
      '- debt: money the user owes and is paying off: a credit card or store card statement, loan or car finance agreement or statement, Klarna, PayPal Pay in 3, Clearpay or Monzo Flex plans and screenshots, overdraft letters, or money owed to a person. Put the balance still owed in amount (null if it only shows what was first borrowed, as a new agreement does), the date of that balance or of the agreement in date, the lender in party, the minimum or monthly payment in monthly_payment, the interest rate (APR) as a number in interest_rate, the number of monthly payments in term_months, the amount first borrowed in borrowed_amount, the next payment due date in due_date, and the account or agreement number in reference. Set debt_type to one of: ' + GU.debts.TYPES.join('; ') + '. A credit card statement is a debt, not a bank_statement.',
      '- bill: a regular payment being set up or changed (direct debit notice, subscription, contract with a monthly cost). Set frequency and put the next payment date in due_date.',
      '- document: an important document to keep: passport, ID, driving licence, visa or immigration papers (UKVI, Home Office, eVisa, biometrics, Certificate of Sponsorship, embassy letters: use the document type for residence permits and eVisas), certificates, contracts, tenancy, insurance policy, payslip, P60, tax letters, medical letters, pension or bank letters. Set document_type to one of: ' + ctx.documentTypes.join('; ') + '. Put any expiry or renewal date in expiry_date and the issue date in date.',
      '- task: something the user needs to do, usually a short note like "call the dentist tomorrow". Put the date in due_date.',
      '- transaction_out or transaction_in: a note about money spent or received that is not paperwork, such as "paid £20 cash to the window cleaner".',
      '- bank_statement: a bank statement export listing many transactions.',
      '- section: none of the above fit, but it belongs to a part of life worth its own section, like Car, Pets, Health, Travel, Kids & school, Home & garden or Recipes. Use an existing section by setting section_id if one fits: ' + JSON.stringify(ctx.sections) + '. Otherwise set new_section_name to a short title-case name (1 to 3 words).',
      '- unsure: you genuinely cannot tell.',
      '',
      'Fields:',
      '- title: a short label for what it is (for example "Samsung 55in TV", "Boiler repair", "Passport"), not who it is from.',
      '- party: the shop, company or person it is from or to.',
      '- amount: the total paid or to pay, as a plain number. null if there is none.',
      '- date: the date on it. due_date: when payment or action is due. All dates as YYYY-MM-DD.',
      '- category: for money items, one of: ' + ctx.categories.join('; ') + '.',
      '- context: "work" if it is for ' + (e ? (e.short || e.name) : 'the user\'s job or business') + ', otherwise "home".' + (ctx.business ? ' Invoices under the user\'s own trading name are "home".' : ''),
      '- payer: for work receipts and invoices only, "company", "me" or null as described above. null for everything else.',
      '- task_title and task_due: if the item asks the user to do something by a date (reply, pay, book, renew, send documents) and the destination is not already task, describe that follow-up. Otherwise null.',
      '- summary: one short, friendly sentence to the user saying what it is, for example "Receipt from Currys for a Samsung TV, £549.00, with a 2-year guarantee."',
      '- confidence: 0 to 1, how sure you are about the destination.',
      '- why: one short reason for the destination and who paid, under 12 words, for example "Invoice addressed to the business, paid on your card".',
      '- notes: anything else worth keeping (policy numbers, what is covered, account numbers). null if nothing.',
      '- monthly_payment, interest_rate, debt_type, term_months and borrowed_amount: only for debts. null otherwise.',
    ].join('\n');
  }

  function blankResult() {
    return { destination: 'unsure', confidence: 0.3, why: '', summary: '', title: '', party: null, amount: null, date: null, due_date: null, expiry_date: null, reference: null,
      context: 'home', payer: null, category: null, document_type: null, frequency: null, paid: false, section_id: null, new_section_name: null, task_title: null, task_due: null, notes: null,
      monthly_payment: null, interest_rate: null, debt_type: null, term_months: null, borrowed_amount: null };
  }
  function clean(r) {
    const out = Object.assign(blankResult(), r || {});
    for (const k of ['date', 'due_date', 'expiry_date', 'task_due']) if (out[k] && !GU.util.isISO(out[k])) out[k] = parseLooseDate(out[k], 'dmy');
    if (typeof out.amount === 'string') out.amount = parseAmount(out.amount);
    if (out.amount != null && isNaN(out.amount)) out.amount = null;
    if (out.amount != null) out.amount = Math.abs(round2(out.amount));
    retired(out);
    if (!DESTINATIONS[out.destination]) out.destination = 'unsure';
    out.confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0));
    out.why = typeof out.why === 'string' ? out.why.replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    if (out.section_id && !(store.state.sections || []).some((x) => x.id === out.section_id)) out.section_id = null;
    if (out.document_type && !GU.tabs.documents.TYPES.includes(out.document_type)) out.document_type = 'Other';
    if (out.category && !F.EXPENSE.concat(F.INCOME, [F.TRANSFER]).includes(out.category)) out.category = null;
    for (const k of ['monthly_payment', 'interest_rate', 'borrowed_amount', 'term_months']) {
      if (typeof out[k] === 'string') out[k] = parseAmount(out[k]);
      out[k] = out[k] != null && !isNaN(out[k]) ? Math.abs(round2(out[k])) : null;
    }
    if (out.term_months != null) out.term_months = Math.round(out.term_months) || null;
    if (out.debt_type && !GU.debts.TYPES.includes(out.debt_type)) out.debt_type = 'Other';
    out.title = (out.title || '').trim() || (out.party || DEST_LABEL[out.destination]);
    workSense(out);
    return out;
  }
  /* Home or work, and whose money, made to fit how the site files things. */
  function workSense(out) {
    retired(out);
    if (out.context !== 'work') out.context = 'home';
    if (!payerOk(out.payer)) out.payer = null;
    // A payslip or P60 is about your own pay, even when it comes from your employer.
    if (out.destination === 'document' && out.document_type === PAYSLIPS) out.context = 'home';
    if (out.context === 'work') {
      const e = employer();
      if (out.destination === 'invoice_owed_to_me') {
        // An invoice you sent the business is money it owes you back; with no employer set it's your own side work.
        if (e.set) Object.assign(out, { destination: 'receipt', payer: 'me' });
        else out.context = 'home';
      } else if (out.destination === 'transaction_out' && !isEmployerText(out.party)) {
        // 'Paid £18 for printer paper' for work: something to get back, not your own spending.
        const title = String(out.title || '').trim();
        Object.assign(out, { destination: 'receipt', payer: 'me', date: out.date || today(), title: title.charAt(0).toUpperCase() + title.slice(1), why: out.why || 'You paid for work, so it’s one to get back',
          summary: 'You paid ' + (out.amount != null ? money(out.amount) + ' ' : '') + (out.party ? 'for ' + out.party + ' ' : '') + 'for ' + e.label + '. It goes in Get paid back.' });
      }
    }
    if (out.context !== 'work') {
      out.payer = null;
      // Your own paperwork never sits in a work money category.
      if ((F.WORK || []).includes(out.category) && !/^transaction/.test(out.destination)) out.category = null;
    }
    return out;
  }

  /* ---------- reader 1: Claude inside the Claude app ---------- */
  let samplePromise = null;
  function getSample() {
    if (!samplePromise) {
      samplePromise = (window.claude && typeof window.claude.use === 'function')
        ? withTimeout(window.claude.use('sample'), 11000, 'no viewer').catch(() => null)
        : Promise.resolve(null);
    }
    return samplePromise;
  }
  async function viaSample(input) {
    const sample = await getSample();
    if (!sample) return null;
    let images = [];
    try {
      const lim = await sample.limits();
      if (lim && lim.images) images = input.files.filter((f) => lim.images.mediaTypes.includes(f.type)).slice(0, lim.images.maxCount || 1);
    } catch (e) {
      images = [];
    }
    const ctx = context();
    const prompt = instructions(ctx) + '\n\n' +
      'Reply with only a JSON object with exactly these keys: ' + SCHEMA.required.join(', ') + '. Use null for anything unknown.\n\n' +
      'THE ITEM:\n' +
      (input.files.length ? 'Files: ' + input.files.map((f, i) => ((input.paths && input.paths[i]) || f.name) + ' (' + (f.type || 'unknown type') + ')').join(', ') + ' (the folder names are how the user organised them, so use them as a hint)' + (images.length ? '. The image' + (images.length > 1 ? 's are' : ' is') + ' attached.' : '') + '\n' : '') +
      (input.note ? 'The user wrote: ' + input.note + '\n' : '') +
      (input.hint ? 'The user says where it goes (follow this): ' + input.hint + '\n' : '') +
      (input.text ? 'Text read from it:\n"""\n' + input.text.slice(0, 12000) + '\n"""\n' : '');
    const opts = { modelTier: 'default' };
    if (images.length) opts.images = images;
    const data = await sample.json(prompt, opts);
    return clean(data);
  }

  /* ---------- reader 2: Claude through your own API key ---------- */
  let sdkPromise = null;
  function getSDK() {
    if (!sdkPromise) sdkPromise = import(SDK_URL).then((m) => m.default || m.Anthropic);
    return sdkPromise;
  }
  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function viaApi(input) {
    const key = (store.state.settings.apiKey || '').trim();
    if (!key) return null;
    const Anthropic = await getSDK();
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const content = [];
    for (const f of input.files.slice(0, 4)) {
      if (isImg(f) && f.size < 5 * 1024 * 1024) content.push({ type: 'image', source: { type: 'base64', media_type: f.type, data: await toBase64(f) } });
      else if (isPdf(f) && f.size < 20 * 1024 * 1024) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await toBase64(f) } });
    }
    content.push({ type: 'text', text:
      (input.files.length ? 'Files: ' + input.files.map((f, i) => (input.paths && input.paths[i]) || f.name).join(', ') + (input.paths && input.paths.some((p) => p.includes('/')) ? ' (folder names show how the user organised them; use them as a hint)' : '') + '\n' : '') +
      (input.note ? 'The user wrote: ' + input.note + '\n' : '') +
      (input.hint ? 'The user says where it goes (follow this): ' + input.hint + '\n' : '') +
      (input.text && !content.length ? 'Text:\n"""\n' + input.text.slice(0, 20000) + '\n"""\n' : '') +
      'Where does this belong? Fill in every field.' });
    const res = await client.beta.messages.create({
      model: store.state.settings.model || MODEL,
      max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: instructions(context()),
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined to read this item.');
    const block = res.content.find((b) => b.type === 'text');
    if (!block) throw new Error('No answer came back.');
    return clean(JSON.parse(block.text));
  }

  /* Credit card statements, loan and finance agreements, BNPL plans. */
  const DEBT_WORDS = ['credit card', 'minimum payment', 'credit limit', 'statement balance', 'new balance', 'outstanding balance', 'balance outstanding', 'amount owed', 'loan agreement',
    'finance agreement', 'credit agreement', 'hire purchase', 'pay in 3', 'payin3', 'klarna', 'clearpay', 'monzo flex', 'representative apr', 'purchase rate', 'remaining balance', 'instalments', 'settlement figure', 'arrears'];
  function debtScore(t) {
    return has(String(t || '').toLowerCase(), DEBT_WORDS);
  }
  function looksLikeDebt(text) {
    const t = String(text || '').toLowerCase();
    if (/current account|personal account|everyday account/.test(t) && !/credit card/.test(t)) return false;
    return debtScore(t) >= 3 || (debtScore(t) >= 2 && /minimum payment|credit limit|loan agreement|finance agreement|credit agreement/.test(t));
  }
  /* Reads the figures off a debt statement or agreement. */
  function debtFigures(raw, t) {
    const num = (re) => {
      const m = raw.match(re);
      return m ? parseAmount(m[1]) : null;
    };
    const balance = num(/(?:new balance|statement balance|outstanding balance|balance outstanding|amount owed|total (?:amount )?(?:owed|outstanding|payable)|remaining balance|current balance|settlement figure|balance to pay)[^£\d\n]{0,30}£?\s?(-?[\d,]+\.\d{2})/i);
    const payment = num(/(?:minimum payment|monthly payment|monthly instalment|monthly repayment|instalment amount|payment amount|each instalment|next instalment|next payment|instalments? of)[^£\d\n]{0,30}£?\s?([\d,]+\.\d{2})/i);
    const borrowed = num(/(?:amount of credit|loan amount|amount borrowed|credit amount|cash price|total credit)[^£\d\n]{0,30}£?\s?([\d,]+\.\d{2})/i);
    const term = raw.match(/\bfor (\d{1,3}) months\b|\b(\d{1,3}) monthly (?:payments|instalments|repayments)\b|\bterm(?: of agreement)?:?\s*(\d{1,3}) months\b|\b(\d{1,3})[- ]month (?:term|agreement|loan)\b/i);
    const apr = raw.match(/(\d{1,2}(?:\.\d{1,2})?)\s?%\s?(?:apr|p\.?a\.?|\(variable\)|variable|purchase)/i) || raw.match(/\bapr\b[^\d\n]{0,25}(\d{1,2}(?:\.\d{1,2})?)\s?%/i);
    const lender = GU.debts.LENDERS.find((l) => t.includes(l.name.toLowerCase()) || l.keys.some((k) => !l.exact && t.includes(k)));
    const type = lender ? lender.type : /credit card|credit limit/.test(t) ? 'Credit card' : /car finance|hire purchase|vehicle/.test(t) ? 'Car finance' : /loan/.test(t) ? 'Loan' : /klarna|clearpay|pay in 3|instalments/.test(t) ? 'Buy now pay later' : 'Other';
    return { balance, payment, borrowed, term: term ? +(term[1] || term[2] || term[3] || term[4]) : null, apr: apr ? parseFloat(apr[1]) : null, lender, type };
  }

  function looksLikeStatement(text) {
    const t = String(text || '').toLowerCase();
    if (/^\s*from:\s*\d{2}\/\d{2}\/\d{4}/m.test(t) && /^\s*description:/m.test(t) && /^\s*amount:/m.test(t)) return true; // Santander .txt
    return /statement/.test(t) && /(sort code|account number|iban)/.test(t) && /balance/.test(t) && /(money in|money out|paid in|paid out|amount)/.test(t) && (t.match(/\d{1,2}[\/ ](?:\d{1,2}|[a-z]{3})/g) || []).length > 6;
  }

  /* ---------- Claude reads a statement PDF the offline reader couldn't ---------- */
  const STATEMENT_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['bank', 'transactions'],
    properties: {
      bank: { type: 'string' },
      transactions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['date', 'description', 'amount'],
        properties: { date: { type: 'string' }, description: { type: 'string' }, amount: { type: 'number' } } } },
    },
  };
  async function askJSON(prompt) {
    const sample = await getSample();
    if (sample) return sample.json(prompt + '\n\nReply with only the JSON object.', { modelTier: 'default' });
    const key = (store.state.settings.apiKey || '').trim();
    if (!key) return null;
    const Anthropic = await getSDK();
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    const res = await client.beta.messages.create({
      model: store.state.settings.model || MODEL, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: STATEMENT_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') throw new Error('Claude declined to read this statement.');
    const block = res.content.find((x) => x.type === 'text');
    return block ? JSON.parse(block.text) : null;
  }
  async function readStatement(file) {
    const text = await pdfText(file, 200);
    const chunks = [];
    let cur = '';
    for (const l of text.split('\n')) {
      if (cur.length + l.length > 14000) {
        chunks.push(cur);
        cur = '';
      }
      cur += l + '\n';
    }
    if (cur.trim()) chunks.push(cur);
    let bank = '';
    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      const data = await askJSON('Here is part ' + (i + 1) + ' of ' + chunks.length + ' of the text of a UK bank statement. List every transaction in this part as JSON: ' +
        '{"bank": "bank name", "transactions": [{"date": "YYYY-MM-DD", "description": "payee or description", "amount": -12.34}]}. ' +
        'Money out is negative and money in is positive. Use the statement period to work out the year when a date has none. ' +
        'Skip balance brought forward and carried forward lines, totals and anything that is not a transaction. ' +
        'If the statement has separate sections for savings pots, leave those out.\n\nSTATEMENT TEXT:\n' + chunks[i]);
      if (!data) return null;
      bank = bank || data.bank || '';
      for (const t of data.transactions || []) {
        const date = GU.util.isISO(t.date) ? t.date : parseLooseDate(t.date, 'dmy');
        const amount = typeof t.amount === 'number' ? t.amount : parseAmount(t.amount);
        if (date && !isNaN(amount) && t.description) out.push({ date, raw: t.description, description: GU.statements.cleanDescription(t.description), amount: round2(amount) });
      }
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return { kind: 'transactions', bank: bank || GU.statements.detectBank(text, file.name), format: 'PDF statement (read by Claude)', transactions: out, isPdf: true };
  }

  /* ---------- reader 3: offline rules ---------- */
  const TOPICS = [
    { name: 'Car', icon: 'car', words: ['mot test', 'mot certificate', 'v5c', 'dvla', 'car tax', 'vehicle tax', 'tyres', 'tyre ', 'garage', 'car service', 'parking fine', 'penalty charge', 'pcn ', 'breakdown cover', 'registration mark', 'mileage', 'vehicle'] },
    { name: 'Pets', icon: 'paw', words: ['vet ', 'vets ', 'veterinary', 'pet insurance', 'microchip', 'kennel', 'cattery', 'grooming', 'flea', 'worming', 'puppy', 'kitten'] },
    { name: 'Health', icon: 'heart', words: ['nhs', 'gp surgery', 'prescription', 'hospital', 'clinic', 'dentist', 'dental', 'optician', 'blood test', 'vaccination', 'referral', 'physio'] },
    { name: 'Travel', icon: 'plane', words: ['boarding pass', 'flight', 'itinerary', 'booking confirmation', 'check-in', 'e-ticket', 'hotel', 'airbnb', 'eurostar', 'ferry', 'car hire', 'departure', 'arrival'] },
    { name: 'Kids & school', icon: 'book', words: ['school', 'nursery', 'term dates', 'parents evening', 'pta', 'uniform', 'childcare', 'pupil', 'headteacher', 'class teacher'] },
    { name: 'Home & garden', icon: 'home', words: ['boiler', 'gas safety', 'landlord', 'meter reading', 'instruction manual', 'user manual', 'appliance', 'garden', 'roof', 'damp', 'plumbing', 'electrician'] },
    { name: 'Recipes', icon: 'note', words: ['recipe', 'ingredients', 'preheat', 'tbsp', 'tsp', 'serves '] },
  ];
  const DOC_RULES = [
    [['passport'], 'Passport'],
    [['driving licence', 'driving license', 'identity card', 'national id'], 'ID card or driving licence'],
    [['residence permit', 'evisa', 'biometric residence', 'brp', 'share code'], 'Residence permit or eVisa'],
    [['birth certificate', 'marriage certificate', 'death certificate', 'civil partnership'], 'Birth, marriage or death certificate'],
    [['degree', 'diploma', 'transcript', 'certificate of achievement', 'qualification'], 'Education and qualifications'],
    [['p60', 'p45', 'payslip', 'pay slip', 'contract of employment', 'offer letter', 'employment contract', 'taxable income', 'pay summary', 'earnings summary'], 'Employment and payslips'],
    [['hmrc', 'self assessment', 'tax return', 'tax code', 'unique taxpayer', 'utr'], 'Tax'],
    [['policy schedule', 'certificate of insurance', 'insurance policy', 'policy number', 'policy document'], 'Insurance policy'],
    [['tenancy agreement', 'lease agreement', 'mortgage offer', 'completion statement', 'deed', 'council tax'], 'Home and tenancy'],
    [['v5c', 'mot certificate', 'mot test', 'logbook', 'vehicle registration'], 'Vehicle'],
    [['nhs number', 'medical record', 'vaccination record', 'discharge summary'], 'Medical and health'],
    [['pension', 'isa ', 'annual statement', 'savings account'], 'Bank, savings and pension'],
    [['last will', 'power of attorney', 'testament'], 'Legal (will, power of attorney)'],
  ];
  const has = (t, words) => words.filter((w) => t.includes(w)).length;
  const MERCHANTS = ['tesco', "sainsbury's", 'asda', 'morrisons', 'aldi', 'lidl', 'waitrose', 'co-op', 'iceland', 'ocado', 'm&s', 'marks & spencer', 'boots', 'superdrug', 'currys', 'argos',
    'john lewis', 'ikea', 'b&q', 'wickes', 'screwfix', 'toolstation', 'amazon', 'ebay', 'apple', 'samsung', 'dyson', 'primark', 'next', 'uniqlo', 'zara', 'h&m', 'tk maxx', 'pret', 'costa', 'starbucks',
    'greggs', 'nando', 'wagamama', 'deliveroo', 'uber', 'trainline', 'tfl', 'shell', 'bp', 'esso', 'octopus energy', 'british gas', 'edf', 'ovo', 'thames water', 'bt', 'sky', 'virgin media',
    'vodafone', 'ee', 'o2', 'three', 'netflix', 'spotify', 'aviva', 'admiral', 'direct line', 'halfords', 'kwik fit', 'specsavers', 'home office', 'ukvi', 'tlscontact', 'vfs global'];

  function findDates(raw) {
    const out = [];
    const re = /(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/gi;
    let m;
    while ((m = re.exec(raw))) {
      const iso = parseLooseDate(m[1].replace(/\./g, ' ').replace(/\s+/g, ' '), 'dmy') || parseLooseDate(m[1], 'dmy');
      if (iso) out.push({ iso, at: m.index, before: raw.slice(Math.max(0, m.index - 40), m.index).toLowerCase() });
    }
    return out;
  }
  function findAmount(raw) {
    const lines = raw.split(/\n/);
    const money = /(?:£|gbp|€|eur|\$|usd)?\s?(-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2})/i;
    let best = null;
    for (const line of lines) {
      const l = line.toLowerCase();
      if (/(grand total|total due|amount due|balance due|total to pay|total paid|amount payable|total amount|^\s*total|\btotal\b)/.test(l) && !/sub ?total/.test(l)) {
        const m = line.match(new RegExp(money.source + '(?!.*\\d\\.\\d{2})', 'i')) || line.match(money);
        if (m) best = Math.abs(parseAmount(m[1]));
      }
    }
    if (best != null && !isNaN(best)) return best;
    const all = (raw.match(/(?:£|gbp\s?)\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2}/gi) || []).map((x) => Math.abs(parseAmount(x))).filter((x) => !isNaN(x) && x < 1e7);
    return all.length ? Math.max(...all) : null;
  }
  /* Amazon order numbers look like 203-1234567-1234567 (or D01-… for digital orders). */
  const ORDER_ID = /\b(?:\d{3}|D\d{2})-\d{7}-\d{7}\b/;
  function findReference(raw, names) {
    const order = String(raw || '').match(ORDER_ID) || String(names || '').match(ORDER_ID);
    if (order) return order[0];
    const re = /\b(?:invoice|order|receipt|policy|reference|ref|account|booking|application|confirmation|passport|licence|license|certificate|membership|customer|claim|case|transaction)\b[^\n\d]{0,20}?([A-Z0-9][A-Z0-9\-/]*\d[A-Z0-9\-/]*)/gi;
    let m;
    while ((m = re.exec(raw))) if (m[1].length >= 4 && !/^\d{1,2}[/-]\d{1,2}/.test(m[1])) return m[1];
    const gwf = raw.match(/\bGWF\d{6,}\b/i);
    return gwf ? gwf[0].toUpperCase() : null;
  }
  function findParty(raw, t) {
    const known = MERCHANTS.find((mm) => new RegExp('(^|[^a-z])' + mm.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&') + '([^a-z]|$)', 'i').test(t));
    if (known) return known.replace(/(^|[\s&-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/^(Bt|Ee|O2|Bp|Tfl|Ukvi|Vfs Global|M&s)$/i, (x) => x.toUpperCase());
    const from = raw.match(/\bfrom:?\s+([A-Z][\w&' .-]{2,40})/);
    if (from) return from[1].trim();
    const first = raw.split(/\n/).map((x) => x.trim()).find((x) => /[a-z]{3}/i.test(x) && x.length <= 40 && !/receipt|invoice|tax|vat|date|total/i.test(x));
    return first || null;
  }

  async function viaRules(input) {
    const raw = [input.note, input.text].filter(Boolean).join('\n');
    const paths = input.paths && input.paths.length ? input.paths : input.files.map((f) => f.name);
    const names = paths.map((p) => p.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-./]+/g, ' ')).join(' ');
    const folder = folderOf(paths);
    // "Paid with Visa Debit" is a bank card, not an immigration visa.
    const t = (' ' + raw + ' ' + names + ' ').toLowerCase().replace(/\s+/g, ' ')
      .replace(/\bvisa(?=\s*(debit|credit|card|contactless|electron|\*|ending|x{2,}|\d{4}|payment|purchase))/g, 'card');
    const r = blankResult();
    const dates = findDates(raw);
    const dueD = dates.find((d) => /due|pay by|payment date|by:?\s*$|deadline|before/.test(d.before));
    const expD = dates.find((d) => /expir|valid until|expires|date of expiry|renewal|renews|end date|valid to|cover ends/.test(d.before));
    const issueD = dates.find((d) => d !== dueD && d !== expD);
    r.date = issueD ? issueD.iso : null;
    r.due_date = dueD ? dueD.iso : null;
    r.expiry_date = expD ? expD.iso : null;
    r.amount = findAmount(raw);
    r.reference = findReference(raw, paths.join(' '));
    r.party = findParty(raw, t);
    // Work is the business you work for: its name anywhere, or plain work words. With no employer set, your own
    // business, clients and freelance work count too (as they always did).
    const emp = employer();
    const ownBiz = (store.state.settings.business || '').toLowerCase().trim();
    r.context = (emp.set && isEmployerText(raw + ' ' + names)) || /\b(expenses claim|expense claim|for work|work expense|office supplies)\b/.test(t) ||
      (!emp.set && (/\b(my business|client|freelance|bill to:? .{0,40}(ltd|limited))\b/.test(t) || (ownBiz && t.includes(ownBiz)))) ? 'work' : 'home';

    // A spreadsheet is either a list of online orders or a bank statement.
    const sheetLike = !input.files.length || input.files.every((f) => /\.(csv|tsv|txt)$/i.test(f.name) || /^text\//.test(f.type));
    const headerLine = (raw.split(/\n/).find((l) => l.trim()) || '').toLowerCase();
    const looksLikeOrders = sheetLike && headerLine.split(/,|\t/).length >= 3 && /order\s*(id|number|no|#)/.test(headerLine) && /date/.test(headerLine);
    if (looksLikeOrders && raw.split(/\n/).filter((l) => l.trim()).length > 1) {
      return Object.assign(r, { destination: 'order_history', confidence: 0.95, why: 'A spreadsheet of online orders', title: 'Order list', summary: 'A list of online orders. I’ll open the importer so every order becomes a paid invoice.' });
    }
    if (input.files.some((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')) {
      return Object.assign(r, { destination: 'bank_statement', confidence: 0.9, why: 'A spreadsheet of bank lines', title: 'Bank statement', summary: 'A bank statement. I’ll open the importer so you can check the columns.' });
    }
    // Typed notes (or a short note saved as a .txt file): tasks or quick money notes.
    const noteLike = (!input.files.length || (input.files.every((f) => /\.txt$/i.test(f.name)) && raw.length < 240 && !/receipt|invoice|statement|total|policy|certificate|booking/i.test(raw))) && debtScore(raw) < 2;
    if (noteLike && raw.length < 240) {
      const amt = raw.match(/(?:£|\$|€)\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?(?:quid|pounds|gbp)/i);
      // 'printer paper for work' names the thing, not who it was for.
      const whoOf = (m) => (m ? m[1].trim().split(/\s+(?:for|from|on|at)\s+/i)[0].trim() : null);
      if (amt && /\b(paid|spent|bought|gave|cost)\b/i.test(raw)) {
        const who = whoOf(raw.match(/\b(?:to|at|on|for)\s+(?:the\s+)?([a-z][\w' &-]{2,40})/i));
        return clean(Object.assign(r, { destination: 'transaction_out', confidence: 0.8, why: 'You wrote that you paid for something', amount: parseFloat(amt[1] || amt[2]), party: who, title: who || raw,
          date: r.date || today(), category: F.categorise(raw, -1, store.state.rules) || null, summary: 'Money out: ' + money(parseFloat(amt[1] || amt[2])) + (who ? ' to ' + who : '') + '.' }));
      }
      if (amt && /\b(received|got paid|earned|was paid|refund)\b/i.test(raw)) {
        const who = whoOf(raw.match(/\bfrom\s+([a-z][\w' &-]{2,40})/i));
        return clean(Object.assign(r, { destination: 'transaction_in', confidence: 0.8, why: 'You wrote that money came in', amount: parseFloat(amt[1] || amt[2]), party: who, title: who || raw,
          date: r.date || today(), category: /refund/i.test(raw) ? 'Refunds' : null, summary: 'Money in: ' + money(parseFloat(amt[1] || amt[2])) + (who ? ' from ' + who : '') + '.' }));
      }
      const q = GU.tabs.today.parseQuickTask(raw);
      const verb = /^(call|ring|email|text|book|buy|pay|renew|cancel|send|post|check|ask|remember|remind|don'?t forget|need to|sort|fix|clean|pick up|collect|order|apply|reply|chase|find|get|make|take|return|update|finish|write|print|sign|submit|arrange|organise|organize)\b/i.test(raw.trim());
      return Object.assign(r, { destination: 'task', confidence: verb || q.due ? 0.88 : 0.66, why: verb || q.due ? 'It reads like something to do' + (q.due ? ' by a date' : '') : 'A short note, so it’s kept as a task', title: q.title, due_date: q.due || null, amount: null,
        summary: 'A task' + (q.due ? ' for ' + fmtDate(q.due, { weekday: true }) : '') + ': ' + q.title + '.' });
    }

    const sc = {
      immigration: has(t, ['visa', 'ukvi', 'home office', 'biometric', 'evisa', 'brp', 'tlscontact', 'tls contact', 'vfs global', 'schengen', 'certificate of sponsorship', 'immigration', 'leave to remain', 'share code', 'embassy', 'consulate', 'gwf']) * 3,
      warranty: has(t, ['warranty', 'guarantee', 'applecare', 'extended cover', 'protection plan', 'care plan']) * 3,
      invoice: has(t, ['invoice', 'amount due', 'balance due', 'payment due', 'due date', 'pay by', 'please pay', 'remittance', 'sort code', 'bill to', 'billed to', 'payment terms']) * 2,
      receipt: has(t, ['receipt', 'subtotal', 'sub total', 'change due', 'card payment', 'contactless', 'visa debit', 'mastercard', 'thank you for shopping', 'vat ', 'order confirmation', 'paid with', 'auth code', 'qty', 'cashier', 'till']) * 1.3,
      bill: has(t, ['direct debit', 'monthly payment', 'your new monthly', 'subscription', 'per month', 'standing order', 'payment schedule', 'monthly plan']) * 2,
    };
    let docType = null;
    let docWord = '';
    for (const [words, type] of DOC_RULES) if (has(t, words)) {
      docType = type;
      docWord = words.find((w) => t.includes(w)).trim();
      break;
    }
    const topic = TOPICS.map((x) => ({ x, n: has(t, x.words) })).sort((a, b) => b.n - a.n)[0];
    const onlineOrder = /\bamazon\b|\bebay\b|sold by|order (?:number|no\.?|#|id)|order date/.test(t) && !/amount due|balance due|please pay|payment due|pay by/.test(t);
    const paidWords = has(t, ['paid in full', 'payment received', 'thank you for your payment', 'amount paid', 'balance: 0.00', 'balance due: 0.00', 'balance due £0.00', 'paid on']) + (onlineOrder ? 1 : 0);
    const biz = (store.state.settings.business || '').toLowerCase().trim();
    const fromMe = biz && t.includes(biz) && !new RegExp('bill(?:ed)? to:?\\s*' + biz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t);
    const warrantyYears = t.match(/(\d+)[\s-]*year (?:manufacturer'?s? )?(?:warranty|guarantee)/);

    const debtSc = debtScore(t);
    if (debtSc >= 2 && (looksLikeDebt(t) || debtSc * 2 >= sc.invoice) && sc.immigration < 3) {
      const f = debtFigures(raw, t);
      const name = f.lender ? f.lender.name : r.party || 'Debt';
      // The next instalment date is when to pay, not the date of the balance.
      const due = dates.find((d) => /due|next (?:instalment|payment)|instalment.{0,20}on\s*$|collected on|pay by/.test(d.before));
      const issued = dates.find((d) => d !== due && /statement date|date of (?:agreement|statement)|agreement date|as (?:of|at)|balance on|dated?:?\s*$/.test(d.before)) || dates.find((d) => d !== due);
      Object.assign(r, { destination: 'debt', confidence: Math.min(0.92, 0.66 + debtSc * 0.06), why: 'It shows money owed and payments', party: f.lender ? f.lender.name : r.party, title: name, amount: f.balance != null ? Math.abs(f.balance) : null,
        date: issued ? issued.iso : null, due_date: due ? due.iso : null, monthly_payment: f.payment, interest_rate: f.apr, debt_type: f.type, term_months: f.term, borrowed_amount: f.borrowed,
        summary: (f.type === 'Credit card' ? 'A credit card statement' : 'Details of a debt') + (f.lender || r.party ? ' from ' + name : '') + (f.balance != null ? ': ' + money(Math.abs(f.balance)) + ' owed' : '') + (f.payment ? ', ' + money(f.payment) + ' a month' : '') + '.' });
      return clean(r);
    }
    if (sc.immigration >= 3 && sc.immigration >= sc.invoice && docType !== 'Passport') {
      // Visa and immigration papers are kept with your documents.
      Object.assign(r, { destination: 'document', confidence: 0.75, document_type: docType || IMMIGRATION_DOC, why: 'It mentions visa or Home Office words', title: 'Visa or immigration letter',
        summary: 'A visa or immigration paper. I’ll keep it with your documents.' });
    } else if (sc.warranty >= 3 && sc.warranty >= sc.invoice && !(sc.receipt >= 2.6 && sc.warranty < 6)) {
      const until = r.expiry_date || (warrantyYears && (r.date || today()) ? addMonths(r.date || today(), 12 * +warrantyYears[1]) : null);
      Object.assign(r, { destination: 'warranty', confidence: 0.78, why: 'It mentions a warranty or guarantee', expiry_date: until, title: r.party ? r.party + ' warranty' : 'Warranty',
        summary: 'A warranty' + (r.party ? ' from ' + r.party : '') + (until ? ', covered until ' + fmtDate(until) : '') + '.' });
    } else if (sc.invoice >= 4 || (sc.invoice >= 2 && (sc.invoice > sc.receipt || onlineOrder))) {
      const dest = fromMe ? 'invoice_owed_to_me' : 'invoice_to_pay';
      Object.assign(r, { destination: dest, confidence: 0.72 + Math.min(0.15, sc.invoice / 40), paid: !fromMe && paidWords > 0,
        why: fromMe ? 'Your business name is on it as the sender' : paidWords ? 'An invoice that says it’s paid' : 'It asks for payment', title: r.party ? 'Invoice from ' + r.party : 'Invoice',
        category: F.categorise(r.party + ' ' + t, -1, store.state.rules, { spend: true }) || null,
        summary: (fromMe ? 'An invoice you sent' : paidWords ? 'A paid invoice' : 'An invoice to pay') + (r.party && !fromMe ? ' from ' + r.party : '') + (r.amount ? ' for ' + money(r.amount) : '') + (r.due_date && !paidWords ? ', due ' + fmtDate(r.due_date) : '') + '.' });
    } else if (sc.bill >= 2 && sc.bill >= sc.receipt) {
      Object.assign(r, { destination: 'bill', confidence: 0.7, why: 'It mentions a direct debit or subscription', frequency: /year|annual/.test(t) ? 'yearly' : /quarter/.test(t) ? 'quarterly' : /week/.test(t) ? 'weekly' : 'monthly',
        title: r.party || 'New bill', due_date: r.due_date || r.date, category: F.categorise(r.party + ' ' + t, -1, store.state.rules, { spend: true }) || 'Bills & utilities',
        summary: 'A regular payment' + (r.party ? ' to ' + r.party : '') + (r.amount ? ' of ' + money(r.amount) : '') + '.' });
    } else if (docType) {
      const firstLine = raw.split('\n').map((x) => x.trim()).find((l) => /[a-z]{3}/i.test(l) && l.length <= 60);
      const tidy = (l) => (l === l.toUpperCase() ? l.split(' ').map((w) => (w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase())).join(' ') : l);
      Object.assign(r, { destination: 'document', confidence: 0.75, document_type: docType, why: 'It mentions “' + docWord + '”', title: firstLine ? tidy(firstLine) : docType === 'Other' ? (r.party || 'Document') : docType.split(/[,(]/)[0].replace(/ or .*/, '').trim(),
        summary: 'An important document (' + docType.toLowerCase() + ')' + (r.expiry_date ? ', expires ' + fmtDate(r.expiry_date) : '') + '.' });
    } else if (sc.receipt >= 1.3) {
      Object.assign(r, { destination: 'receipt', confidence: 0.6 + Math.min(0.3, sc.receipt / 12), why: 'It has receipt words like total, VAT or card', title: r.party ? r.party + ' receipt' : 'Receipt',
        category: F.categorise(r.party + ' ' + t, -1, store.state.rules, { spend: true }) || null,
        expiry_date: warrantyYears ? addMonths(r.date || today(), 12 * +warrantyYears[1]) : null,
        summary: 'A receipt' + (r.party ? ' from ' + r.party : '') + (r.amount ? ' for ' + money(r.amount) : '') + (r.date ? ' on ' + fmtDate(r.date) : '') + '.' });
    } else if (topic && topic.n >= 1) {
      const existing = (store.state.sections || []).find((x) => x.name.toLowerCase() === topic.x.name.toLowerCase());
      Object.assign(r, { destination: 'section', confidence: 0.55 + Math.min(0.25, topic.n / 10), why: 'It mentions things to do with ' + topic.x.name, section_id: existing ? existing.id : null, new_section_name: existing ? null : topic.x.name,
        title: input.files[0] ? input.files[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ') : raw.split('\n')[0].slice(0, 60),
        summary: 'This looks like it belongs with ' + topic.x.name + (existing ? '.' : '. I can start a new ' + topic.x.name + ' section for it.') });
    } else if (input.files.some(isImg) && !raw.trim()) {
      Object.assign(r, { destination: 'receipt', confidence: 0.4, why: 'I couldn’t read the photo', title: 'Photo ' + fmtDate(today(), { short: true }),
        summary: 'A photo I couldn’t read. Is it a receipt? Check the details before filing.' });
    } else {
      Object.assign(r, { destination: 'unsure', confidence: 0.25, why: 'Nothing in it says where it goes', title: input.files[0] ? input.files[0].name : raw.slice(0, 60), summary: 'I’m not sure where this goes. Pick a place for it.' });
    }
    // Your own folder names are a strong hint: "Car/…" belongs in Car, "Work receipts/…" is for work.
    if (folder) {
      if (/\b(work|business|office|company|expenses?|clients?)\b/i.test(paths.join(' '))) r.context = 'work';
      const sec = (store.state.sections || []).find((x) => x.name.toLowerCase() === folder.toLowerCase());
      const topic = TOPICS.find((x) => x.name.toLowerCase() === folder.toLowerCase() || x.name.toLowerCase().split(' & ')[0] === folder.toLowerCase());
      const weak = ['unsure', 'section'].includes(r.destination) || r.confidence < 0.6;
      if (weak && sec) Object.assign(r, { destination: 'section', section_id: sec.id, new_section_name: null, confidence: 0.85, why: 'It was in your “' + folder + '” folder', summary: (r.summary && r.destination !== 'unsure' ? r.summary + ' ' : '') + 'It was in your “' + folder + '” folder, so it goes with ' + sec.name + '.' });
      else if (weak && topic && !/receipt|invoice|bill|warrant|guarantee|document|paperwork|statement|bank|visa|immigration|task|to.?do|admin|important|tax|insurance|passport/i.test(folder)) {
        const name = topic ? topic.name : folder.replace(/\b[a-z]/g, (c) => c.toUpperCase());
        Object.assign(r, { destination: 'section', section_id: null, new_section_name: name, confidence: topic ? 0.8 : 0.65, why: 'It was in your “' + folder + '” folder',
          title: r.title && r.destination !== 'unsure' ? r.title : (input.files[0] ? input.files[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ') : r.title),
          summary: 'It was in your “' + folder + '” folder, so I’ll keep it in a ' + name + ' section.' });
      }
    }
    if (r.destination !== 'task' && /\b(reply|respond|book|renew|send|submit|call us|contact us|attend|bring)\b/.test(t) && (r.due_date || r.expiry_date) && r.destination !== 'invoice_to_pay') {
      r.task_title = 'Follow up: ' + r.title;
      r.task_due = r.due_date || addDays(r.expiry_date, -30);
    }
    return clean(r);
  }

  /* The most specific folder name that means something ("Car", not "Downloads" or "2024"). */
  const GENERIC_FOLDER = /^(downloads?|documents?|my documents|desktop|new folder.*|untitled folder.*|scans?|scanned.*|photos?|pictures?|images?|camera roll|camera|dcim|files?|misc|miscellaneous|other|stuff|inbox|uploads?|onedrive|google drive|icloud drive|icloud|dropbox|archive|backups?|old|temp|tmp|done|to sort|sort|\d{1,4}|\d{4}[-_ ]\d{1,2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|q[1-4])$/i;
  function folderOf(paths) {
    const segs = String((paths || [])[0] || '').split('/').slice(0, -1).map((x) => x.trim()).filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) if (!GENERIC_FOLDER.test(segs[i])) return segs[i];
    return '';
  }

  /* ---------- public: analyse ---------- */
  async function mode() {
    if (await getSample()) return 'claude-app';
    if ((store.state.settings.apiKey || '').trim()) return 'claude-api';
    return 'offline';
  }
  function modeLabel(m) {
    return { 'claude-app': 'Claude (in the Claude app)', 'claude-api': 'Claude (your API key)', offline: 'Offline reader' }[m] || m;
  }

  /* input: {files: File[]|Blob[], note: string} -> result with .via */
  async function analyse(input) {
    const files = input.files || [];
    const hint = String(input.hint || '').trim().slice(0, 500);
    input = { files, note: (input.note || '').trim(), hint, text: '', paths: input.paths || files.map((f) => GU.ui.pathOf(f)) };
    const m = await mode();
    // Spreadsheets (bank statements, order lists) are sorted on this device: no need to send them anywhere.
    if (input.files.some((f) => /\.(csv|tsv)$/i.test(f.name) || f.type === 'text/csv')) {
      input.text = (await readFileText(input.files[0], false)).slice(0, 4000);
      return Object.assign(await viaRules(input), { via: 'offline' });
    }
    if (input.files.some((f) => /\.(qif|ofx|qfx|xls|xlsx)$/i.test(f.name))) {
      return Object.assign(blankResult(), { destination: 'bank_statement', confidence: 0.9, why: 'A bank export file', title: 'Bank statement', summary: 'A bank statement. I’ll open the importer so you can check it.', via: 'offline' });
    }
    const textNeeded = input.files.some((f) => isText(f) || isPdf(f));
    const ocr = m === 'offline' && store.state.settings.ocr !== false;
    if (textNeeded || ocr) {
      const parts = [];
      for (const f of input.files) {
        const t = await readFileText(f, ocr);
        if (t) parts.push(t);
      }
      input.text = parts.join('\n\n');
    }
    // Bank statements are spotted on this device and read by the statement importer (credit card statements are debts).
    if (looksLikeStatement(input.text) && !looksLikeDebt(input.text)) {
      return Object.assign(blankResult(), { destination: 'bank_statement', confidence: 0.9, why: 'It lists bank transactions', title: 'Bank statement', via: 'offline',
        summary: 'A ' + ((GU.statements && GU.statements.detectBank(input.text, input.files[0] && input.files[0].name)) || 'bank') + ' statement. I’ll open the importer so you can check it.' });
    }
    if (m === 'claude-app') {
      try {
        const r = await viaSample(input);
        if (r) return Object.assign(r, { via: m });
      } catch (e) {
        console.warn('[brain] Claude in app failed', e);
        if (e && e.code === 'not_granted') samplePromise = Promise.resolve(null);
      }
    }
    if (m === 'claude-api' || (m === 'claude-app' && store.state.settings.apiKey)) {
      try {
        const r = await viaApi(input);
        if (r) return Object.assign(r, { via: 'claude-api' });
      } catch (e) {
        console.warn('[brain] Claude API failed', e);
        const r = await viaRules(input);
        return Object.assign(r, { via: 'offline', warning: 'Claude couldn’t be reached (' + (e && e.message ? e.message.slice(0, 120) : 'error') + '), so I used the offline reader.' });
      }
    }
    return Object.assign(await viaRules(input), { via: 'offline' });
  }

  /* ---------- public: file a result ---------- */
  /* The page each thing is filed on: {tab, label}, e.g. 'Work › Get paid back' or 'Home › Documents › Passport'.
     Work receipts and invoices go by whose money paid: yours to Get paid back, the business's to its own page. */
  const tabOr = (id, fallback) => (GU.tabs && GU.tabs[id] ? id : fallback);
  const homePage = (id, fallback) => 'Home › ' + ((GU.tabs && GU.tabs[id] && GU.tabs[id].short) || fallback);
  function workPage(area, fallback) {
    let name = '';
    try {
      name = GU.work && GU.work.labelOf ? GU.work.labelOf(area) : '';
    } catch (e) {
      name = '';
    }
    return 'Work › ' + (name || fallback);
  }
  const paysLabel = () => (GU.parts && GU.parts.paysLabel ? GU.parts.paysLabel(store.state) : 'Company pays');
  const partName = (p) => (p === 'work' ? 'Work' : 'Home');
  /* A new section goes in the part you say, or Work when the thing is for work. */
  const newSectionPart = (r) => (r.section_part === 'work' || r.section_part === 'home' ? r.section_part : r.context === 'work' ? 'work' : 'home');
  const findList = (st, id) => (id ? (st.todoLists || []).find((l) => l.id === id) || null : null);
  const findFolder = (st, id) => (id ? (st.workFolders || []).find((f) => f.id === id) || null : null);
  /* A category the result names that isn't one yet, and will be made when it's filed. */
  const newCategory = (r) => {
    const n = F.tidyCategory ? F.tidyCategory(r.new_category) : '';
    return n && !(F.findCategory && F.findCategory(n)) ? n : '';
  };
  const categoryOf = (r) => (F.findCategory && F.findCategory(r.category)) || newCategory(r) || '';
  /* Your own category on a thing for Home, shown in its place ('Home › Bank › Gym'). */
  const withCategory = (label, r, always) => {
    const c = categoryOf(r);
    if (!c || r.context === 'work' || (F.WORK || []).includes(c)) return label;
    if (!always && !newCategory(r) && !(F.isCustom && F.isCustom(store.state, c))) return label;
    return label + ' › ' + c + (newCategory(r) ? ' (new category)' : '');
  };
  const MONEY = ['transaction_out', 'transaction_in', 'bill'].concat(PAPER);
  /* Where a result is filed: {tab, label, fresh}. fresh: filing it makes a new place (a section, list or category). */
  function placeOf(result) {
    const out = placeAt(result);
    const r = workSense(Object.assign({}, result));
    if (!out.fresh && r.context !== 'work' && MONEY.includes(r.destination) && newCategory(r)) out.fresh = true;
    return out;
  }
  function placeAt(result) {
    const r = workSense(Object.assign({}, result));
    const work = r.context === 'work';
    const d = r.destination;
    const s = store.state;
    const folder = work ? findFolder(s, r.folder_id) : null;
    const inFolder = (o) => (folder ? Object.assign(o, { label: o.label + ' › ' + folder.name }) : o);
    if (d === 'section') {
      const sec = r.section_id && (s.sections || []).find((x) => x.id === r.section_id);
      if (sec) return { tab: 's-' + sec.id, label: partName(sec.part) + ' › ' + sec.name };
      const name = String(r.new_section_name || '').trim();
      const same = name && (s.sections || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (same) return { tab: 's-' + same.id, label: partName(same.part) + ' › ' + same.name };
      return { tab: null, label: partName(newSectionPart(r)) + ' › ' + (name ? name + ' (new section)' : 'A new section'), fresh: true };
    }
    if (PAPER.includes(d)) {
      if (!work) return { tab: 'receipts', label: withCategory(homePage('receipts', 'Receipts') + (d === 'invoice_owed_to_me' ? ' › Owed to you' : ''), r) };
      if (d !== 'warranty' && r.payer === 'me') return { tab: tabOr('work-back', 'work'), label: workPage('back', 'Get paid back') };
      if (d === 'warranty' || r.payer === 'company') return inFolder({ tab: tabOr('work-ktk', 'work'), label: workPage('invoices', paysLabel()) });
      return { tab: tabOr('work-ktk', 'work'), label: 'Work › Who paid?' };
    }
    if (d === 'bill') return work ? inFolder({ tab: tabOr('work-bills', 'work'), label: workPage('bills', 'Bills') }) : { tab: 'bills', label: withCategory(homePage('bills', 'Bills'), r) };
    if (d === 'document') {
      return work ? inFolder({ tab: tabOr('work-docs', 'work'), label: workPage('contracts', 'Contracts & documents') })
        : { tab: 'documents', label: homePage('documents', 'Documents') + ' › ' + (r.document_type || 'Other') };
    }
    if (d === 'task') {
      if (work) return inFolder({ tab: tabOr('work-tasks', 'work'), label: workPage('tasks', 'Tasks') });
      const wl = GU.parts && GU.parts.workListId ? GU.parts.workListId(s) : null;
      const named = String(r.new_list_name || '').trim();
      const list = findList(s, r.list_id) || (named && (s.todoLists || []).find((l) => l.id !== wl && String(l.name || '').toLowerCase() === named.toLowerCase())) || null;
      const fresh = !list && named;
      return { tab: 'todos', label: homePage('todos', 'To-do') + (list && list.id !== wl ? ' › ' + list.name : fresh ? ' › ' + fresh + ' (new list)' : ''), fresh: !!fresh };
    }
    if (d === 'debt') return { tab: 'debts', label: homePage('debts', 'Debts') + ' › ' + (r.party || r.title || 'new debt') };
    if (d === 'transaction_out' || d === 'transaction_in') return { tab: 'transactions', label: withCategory(homePage('transactions', 'Bank'), r, true) };
    if (d === 'bank_statement') return { tab: 'transactions', label: homePage('transactions', 'Bank') };
    if (d === 'order_history') return { tab: 'receipts', label: homePage('receipts', 'Receipts') };
    return { tab: null, label: DESTINATIONS[d] || 'Sorting hub' };
  }
  function where(result) {
    return placeOf(result).label;
  }

  /* Files the item. metas: already-stored file metadata. Returns {tab, ref, label, undo} or null if it needs the user. */
  function file(result, metas, note) {
    // Home or work, and whose money, settled first so it lands on the page the Sorting hub showed.
    const r = workSense(Object.assign({}, result));
    if (r.destination === 'debt') {
      const res = GU.tabs.debts.fromInbox(Object.assign({}, r, { notes: [r.notes, note && note !== r.title ? note : ''].filter(Boolean).join('\n') || null }), metas);
      return { tab: 'debts', ref: { c: 'debts', id: res.rec.id }, label: homePage('debts', 'Debts') + ' › ' + res.rec.name + (res.added ? '' : ' (updated)'), undo: res.undo, attached: !res.added };
    }
    // A category you named that isn't there yet is made now, and taken away again by Undo.
    const madeCat = r.context !== 'work' && MONEY.includes(r.destination) && newCategory(r) ? { kind: r.destination === 'transaction_in' ? 'in' : 'out', name: newCategory(r) } : null;
    if (madeCat) r.category = madeCat.name;
    else if (categoryOf(r)) r.category = categoryOf(r);
    const created = [];
    const t = today();
    const notes = [r.notes, note && note !== r.title ? note : ''].filter(Boolean).join('\n') || '';
    const work = r.context === 'work';
    let tab = null;
    let ref = null;
    let attachUndo = null;
    let txUndo = null;
    let sameTitle = '';
    let sameLabel = '';
    let catAdded = false;
    store.commit((st) => {
      const add = (c, rec) => {
        st[c].push(rec);
        created.push({ c, id: rec.id });
        return rec;
      };
      if (madeCat) {
        const cats = (st.settings.categories = Object.assign({ out: [], in: [] }, st.settings.categories || {}));
        cats[madeCat.kind] = (Array.isArray(cats[madeCat.kind]) ? cats[madeCat.kind] : []).concat([madeCat.name]);
        catAdded = true;
      }
      // In a Work folder, when it's for work and the folder is on the page it's filed on.
      const AREA = { paperwork: 'invoices', bills: 'bills', documents: 'contracts', tasks: 'tasks' };
      const inFolder = (c, rec) => {
        const f = work && findFolder(st, r.folder_id);
        if (f && f.area === AREA[c]) rec.workFolder = f.id;
        return rec;
      };
      // Work tasks go in the Work list (made if it isn't there); your own never do.
      const workList = () => (GU.work && GU.work.ensureWorkList ? GU.work.ensureWorkList(st) : (GU.parts && GU.parts.workListId(st)) || (st.todoLists[0] || {}).id);
      const wl = GU.parts && GU.parts.workListId ? GU.parts.workListId(st) : null;
      const homeLists = st.todoLists.filter((l) => l.id !== wl);
      switch (r.destination) {
        case 'receipt':
        case 'invoice_to_pay':
        case 'invoice_owed_to_me':
        case 'warranty': {
          const kind = { receipt: 'receipt', invoice_to_pay: 'invoice-in', invoice_owed_to_me: 'invoice-out', warranty: 'warranty' }[r.destination];
          const inv = kind === 'invoice-in' || kind === 'invoice-out';
          const refKey = String(r.reference || '').trim().toLowerCase();
          const same = refKey.length >= 4 && st.paperwork.find((p) => String(p.reference || '').trim().toLowerCase() === refKey);
          if (same) {
            // Same order or invoice number: add the file to the record you already have.
            same.files = (same.files || []).concat(metas);
            if (same.amount == null && r.amount != null) same.amount = r.amount;
            attachUndo = { id: same.id, fileIds: metas.map((m) => m.id) };
            sameTitle = same.title;
            const at = placeOf({ destination: r.destination, context: same.context === 'work' ? 'work' : 'home', payer: wm() ? wm().payerOf(same, 'paperwork') : same.payer });
            tab = at.tab;
            sameLabel = at.label;
            ref = { c: 'paperwork', id: same.id };
            break;
          }
          // Whose money paid: what it said, or yours when your bank shows the payment.
          const payer = asksPayer(r) ? payerFor(r, st) : work && kind !== 'invoice-out' && payerOk(r.payer) ? r.payer : null;
          const rec = { id: 'p-' + uid(), created: t, kind, context: work ? 'work' : 'home', title: r.title, party: r.party || '', amount: r.amount, date: r.date || t,
            dueDate: inv ? r.due_date || '' : '', status: inv ? (r.paid ? 'paid' : 'unpaid') : '', paidDate: inv && r.paid ? r.date || t : '',
            warrantyUntil: r.destination === 'warranty' || r.expiry_date ? r.expiry_date || '' : '', reference: r.reference || '', category: work ? WORK_OUT : r.category || '', notes, files: metas, via: r.via, folder: r.folder || '' };
          if (work && payer) rec.payer = payer;
          if (wm()) {
            wm().normalise(rec);
            // The payment of a monthly work bill you pay yourself already has its claim: this invoice's files go on that
            // claim rather than claiming the same money twice (as when it's filed from the receipts form).
            const twin = wm().billTwin ? wm().billTwin(st, rec) : null;
            if (twin) {
              const have = new Set((twin.files || []).map((f) => f && f.id));
              twin.files = (twin.files || []).concat(metas.filter((m) => m && !have.has(m.id)));
              if (!twin.reference && rec.reference) twin.reference = rec.reference;
              attachUndo = { id: twin.id, fileIds: metas.map((m) => m.id) };
              sameTitle = twin.title;
              const at = placeOf({ destination: r.destination, context: 'work', payer: 'me' });
              tab = at.tab;
              sameLabel = at.label;
              ref = { c: 'paperwork', id: twin.id };
              break;
            }
            // Yours to get back: link your bank payment when it's sure, so it leaves your own spending.
            if (wm().isClaim(rec) && !rec.purchaseTx && (rec.kind !== 'invoice-in' || rec.status === 'paid')) {
              const m = wm().purchaseFor(st, rec);
              if (m.sure && m.tx) {
                txUndo = { id: m.tx.id, was: m.tx.category };
                rec.purchaseTx = m.tx.id;
                rec.purchaseWas = m.tx.category || '';
                m.tx.category = WORK_OUT;
              }
            }
          }
          add('paperwork', inFolder('paperwork', rec));
          tab = placeOf(Object.assign({}, r, { payer: rec.payer || null })).tab;
          ref = { c: 'paperwork', id: rec.id };
          break;
        }
        case 'bill': {
          const who = String(r.party || r.title || '').trim().toLowerCase();
          const existingBill = who && st.bills.find((x) => [x.payee, x.name].filter(Boolean).some((n) => n.toLowerCase() === who || (who.length > 3 && n.toLowerCase().includes(who))));
          if (existingBill) {
            existingBill.files = (existingBill.files || []).concat(metas);
            attachUndo = { id: existingBill.id, fileIds: metas.map((m) => m.id), c: 'bills' };
            sameTitle = existingBill.name;
            const at = placeOf({ destination: 'bill', context: GU.parts && GU.parts.isWorkBill(existingBill) ? 'work' : 'home' });
            tab = at.tab;
            sameLabel = at.label;
            ref = { c: 'bills', id: existingBill.id };
            break;
          }
          const due = r.due_date || r.date || t;
          const rec = add('bills', { id: 'b-' + uid(), created: t, name: r.title, payee: r.party || '', amount: r.amount || 0, frequency: r.frequency || 'monthly', nextDue: due < t ? F.nextDate(due, r.frequency || 'monthly', +due.slice(8)) || t : due,
            anchorDay: +due.slice(8), method: 'Direct debit', autopay: true, category: work ? WORK_OUT : r.category || 'Bills & utilities', context: work ? 'work' : 'home', account: (st.accounts[0] || {}).id, notes, files: metas, history: [], active: true });
          // Who pays a work bill: left out until it's known, and read as the business's (the form always asks).
          if (work && payerOk(r.payer)) rec.payer = r.payer;
          inFolder('bills', rec);
          tab = placeOf(r).tab;
          ref = { c: 'bills', id: rec.id };
          break;
        }
        case 'document': {
          const rec = add('documents', { id: 'd-' + uid(), created: t, title: r.title, type: r.document_type || 'Other', context: work ? 'work' : 'home', holder: '', reference: r.reference || '', location: '',
            issueDate: r.date || '', expiryDate: r.expiry_date || '', notes: [r.summary, notes].filter(Boolean).join('\n'), files: metas, folder: r.folder || '' });
          inFolder('documents', rec);
          tab = placeOf(r).tab;
          ref = { c: 'documents', id: rec.id };
          break;
        }
        case 'task': {
          // Your own: the list you chose, a new one you named, or your first list.
          let listId = work ? workList() : null;
          if (!work) {
            const want = findList(st, r.list_id);
            const name = String(r.new_list_name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
            if (want && want.id !== wl) listId = want.id;
            else if (name) {
              const same = homeLists.find((l) => String(l.name || '').toLowerCase() === name.toLowerCase());
              listId = same ? same.id : add('todoLists', { id: 'list-' + uid(), name }).id;
            } else listId = (homeLists[0] || st.todoLists[0] || {}).id;
          }
          const rec = add('tasks', Object.assign({ id: 'k-' + uid(), created: t, listId, title: r.title, due: r.due_date || '', priority: 'normal',
            notes: [notes, metas.length ? plural(metas.length, 'file') + ' kept in the Sorting hub history' : ''].filter(Boolean).join('\n'), done: false }, work ? { context: 'work' } : {}));
          inFolder('tasks', rec);
          tab = placeOf(r).tab;
          ref = { c: 'tasks', id: rec.id };
          break;
        }
        case 'transaction_out':
        case 'transaction_in': {
          const rec = add('transactions', { id: 't-' + uid(), created: t, date: r.date || t, description: r.party || r.title, amount: (r.destination === 'transaction_in' ? 1 : -1) * (r.amount || 0),
            category: r.category || '', account: (st.accounts[0] || {}).id, notes, source: 'inbox' });
          tab = 'transactions';
          ref = { c: 'transactions', id: rec.id };
          break;
        }
        case 'section': {
          let sec = r.section_id && (st.sections || []).find((x) => x.id === r.section_id);
          if (!sec) {
            const name = (r.new_section_name || 'Other things').trim();
            sec = (st.sections || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
            if (!sec) {
              sec = { id: 's' + uid(), name, icon: GU.sections.iconFor(name), created: t, byAssistant: true, part: newSectionPart(r) };
              st.sections = st.sections || [];
              st.sections.push(sec);
              created.push({ c: 'sections', id: sec.id });
            }
          }
          const rec = add('sectionItems', { id: 'si-' + uid(), created: t, sectionId: sec.id, title: r.title, party: r.party || '', amount: r.amount, date: r.date || '', dueDate: r.due_date || r.expiry_date || '',
            reference: r.reference || '', notes: [r.summary, notes].filter(Boolean).join('\n'), files: metas, group: r.group || '' });
          tab = 's-' + sec.id;
          ref = { c: 'sectionItems', id: rec.id };
          break;
        }
        default:
          return;
      }
      if (r.task_title && r.destination !== 'task') {
        const listId = work ? workList() : (homeLists.find((l) => /admin/i.test(l.name)) || homeLists[0] || st.todoLists[0] || {}).id;
        add('tasks', Object.assign({ id: 'k-' + uid(), created: t, listId, title: r.task_title, due: r.task_due || '', priority: 'normal', notes: 'From: ' + r.title, done: false }, work ? { context: 'work' } : {}));
      }
    });
    if (!ref) return null;
    const filed = ref.c === 'paperwork' && !sameTitle ? store.find('paperwork', ref.id) : null;
    const label = sameTitle ? sameLabel + ' › ' + sameTitle + ' (added to it)' : where(filed ? Object.assign({}, r, { payer: filed.payer || null }) : r);
    return {
      tab,
      ref,
      label,
      undo() {
        store.commit((st) => {
          for (const c of created) st[c.c] = st[c.c].filter((x) => x.id !== c.id);
          if (attachUndo) {
            const p = st[attachUndo.c || 'paperwork'].find((x) => x.id === attachUndo.id);
            if (p) p.files = (p.files || []).filter((f) => !attachUndo.fileIds.includes(f.id));
          }
          if (txUndo) {
            const tx = st.transactions.find((x) => x.id === txUndo.id);
            if (tx && tx.category === WORK_OUT) tx.category = txUndo.was || '';
          }
          // The category it made goes too, unless something else has been put in it since.
          if (catAdded) {
            const n = madeCat.name.toLowerCase();
            const used = ['transactions', 'paperwork', 'bills'].some((c) => (st[c] || []).some((x) => String(x.category || '').toLowerCase() === n));
            const cats = st.settings.categories;
            if (!used && cats && Array.isArray(cats[madeCat.kind])) cats[madeCat.kind] = cats[madeCat.kind].filter((x) => String(x).toLowerCase() !== n);
          }
        });
      },
      // Only added to a record you already had: nothing new was made.
      attached: !!sameTitle,
    };
  }

  /* Fills the empty fields of an open receipt form with what the brain reads from the files. */
  async function prefillForm(dialog, files, scope) {
    const form = dialog.form;
    const note = document.createElement('p');
    note.className = 'assist-note';
    note.innerHTML = GU.ui.icon('clock') + '<span>Reading your file…</span>';
    const body = dialog.body;
    body.insertBefore(note, body.firstChild);
    try {
      const r = await analyse({ files });
      if (!document.body.contains(form)) return;
      const kindMap = { receipt: 'receipt', invoice_to_pay: 'invoice-in', invoice_owed_to_me: 'invoice-out', warranty: 'warranty' };
      const set = (name, value) => {
        if (value == null || value === '') return;
        const el = form.elements[name];
        if (!el) return;
        if (el instanceof RadioNodeList || (el.length && el[0] && el[0].type === 'radio')) {
          Array.from(el).forEach((x) => (x.checked = x.value === value));
          return;
        }
        if (el.type === 'checkbox') {
          el.checked = !!value;
          return;
        }
        if (el.dataset.touched) return;
        if (el.tagName === 'SELECT' || !el.value || el.type === 'date') el.value = name === 'amount' ? Number(value).toFixed(2) : value;
      };
      if (scope === 'paperwork' && kindMap[r.destination]) {
        // Opened in Work, it stays for work; whose money paid comes from the file, or from your bank.
        const inWork = (form.elements.context && form.elements.context.value === 'work') || (GU.parts && GU.parts.get() === 'work');
        const fit = workSense(Object.assign({}, r, inWork ? { context: 'work' } : {}));
        set('kind', kindMap[fit.destination] || kindMap[r.destination]);
        set('context', fit.context);
        if (fit.context === 'work') set('payer', payerFor(fit));
        set('title', r.title);
        set('party', r.party);
        set('amount', r.amount);
        set('date', r.date);
        set('dueDate', r.due_date);
        set('status', r.paid ? 'paid' : 'unpaid');
        set('warrantyUntil', r.expiry_date);
        set('reference', r.reference);
        if (r.category && F.EXPENSE.includes(r.category)) set('category', r.category);
        if (r.notes) set('notes', r.notes);
        form.dispatchEvent(new Event('change'));
        note.innerHTML = GU.ui.icon('check') + '<span>' + esc(r.summary || 'Filled in from your file.') + ' Check the details, then file it.' + (r.via === 'offline' ? ' <small>(Offline reader. Add Claude in Settings for better results.)</small>' : '') + '</span>';
      } else if (r.destination !== 'unsure' && kindMap[r.destination] === undefined) {
        note.innerHTML = GU.ui.icon('info') + '<span>' + esc(r.summary || '') + ' This looks like it belongs in <b>' + esc(where(r)) + '</b>. You can still file it here, or close this and drop it in the Sorting hub instead.</span>';
      } else {
        note.innerHTML = GU.ui.icon('info') + '<span>I couldn’t read much from this file. Fill in the details below.</span>';
      }
    } catch (e) {
      note.innerHTML = GU.ui.icon('info') + '<span>I couldn’t read this file automatically. Fill in the details below.</span>';
    }
  }
  /* Remember fields the user typed in, so the brain never overwrites them. */
  document.addEventListener('input', (e) => {
    if (e.target && e.target.closest && e.target.closest('dialog') && e.target.dataset) e.target.dataset.touched = '1';
  });

  /* Instant offline check for typed notes, so "call the dentist tomorrow" files straight away. */
  async function quick(note) {
    return Object.assign(await viaRules({ files: [], note: note || '', text: '' }), { via: 'offline' });
  }

  /* ---------- payment schedules from Klarna, PayPal and similar ---------- */
  const SCHEDULE_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['lender', 'payments'],
    properties: {
      lender: NULLABLE('string'),
      payments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['date', 'amount', 'merchant', 'paid', 'n', 'of'],
        properties: { date: { type: 'string' }, amount: { type: 'number' }, merchant: NULLABLE('string'), paid: { type: 'boolean' }, n: NULLABLE('number'), of: NULLABLE('number') } } },
    },
  };
  function schedulePrompt(text) {
    return 'These are the user\'s payments from a buy now pay later or credit account (Klarna, PayPal Pay in 3, Clearpay, Monzo Flex or similar), as a screenshot or copied text. Today is ' + today() + '. ' +
      'List every payment in it. date: YYYY-MM-DD (UK dates, so 03/04 is 3 April; "Tomorrow" is the day after today; a date with no year is the next one from today). amount: the payment in pounds as a plain number. ' +
      'merchant: the shop or plan it is for, or null. paid: true if it has already been paid, false if it is still to pay. ' +
      'n: which payment this is in its plan (2 for "2 of 3", "2/3" or "payment 2 of 3"), or null if not shown. of: how many payments that plan has (3 for "2 of 3"), or null. lender: the company, for example "Klarna" or "PayPal Pay in 3".' +
      (text ? '\n\nTHE TEXT:\n<<<\n' + text.slice(0, 12000) + '\n>>>' : '');
  }
  function cleanSchedule(data) {
    const list = ((data && data.payments) || []).filter((p) => p && !p.paid && GU.util.isISO(p.date) && Number(p.amount) > 0)
      .map((p) => ({ date: p.date, amount: round2(Math.abs(Number(p.amount))), merchant: (p.merchant || '').trim(), n: Number(p.n) > 0 ? Math.round(+p.n) : null, of: Number(p.of) > 0 ? Math.round(+p.of) : null }));
    return { lender: (data && data.lender) || null, payments: list.sort((a, b) => a.date.localeCompare(b.date)) };
  }
  /* input: {text, files}. Pasted text is read on this device; screenshots go to Claude when it's connected,
     otherwise their text is read here (photo text recognition) and parsed the same way. */
  async function readSchedule(input) {
    const text = String(input.text || '').trim();
    const files = input.files || [];
    if (text && !files.length) {
      const offline = GU.debts.parseSchedule(text);
      if (offline.length) return { lender: null, payments: offline, via: 'offline' };
    }
    const sample = await getSample();
    if (sample) {
      let images = [];
      try {
        const lim = await sample.limits();
        if (lim && lim.images) images = files.filter((f) => lim.images.mediaTypes.includes(f.type)).slice(0, lim.images.maxCount || 1);
      } catch (e) {
        images = [];
      }
      const docs = [];
      for (const f of files) if (isPdf(f)) docs.push(await readFileText(f, false));
      const all = [text].concat(docs).filter(Boolean).join('\n\n');
      if (images.length || all) {
        try {
          const opts = { modelTier: 'default' };
          if (images.length) opts.images = images;
          const data = await sample.json(schedulePrompt(all) + '\n\nReply with only a JSON object: {"lender": string or null, "payments": [{"date", "amount", "merchant", "paid", "n", "of"}]}', opts);
          return Object.assign(cleanSchedule(data), { via: 'claude-app' });
        } catch (e) {
          console.warn('[brain] schedule via Claude failed', e);
        }
      }
    }
    const key = (store.state.settings.apiKey || '').trim();
    if (key && files.length) {
      try {
        const Anthropic = await getSDK();
        const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
        const content = [];
        for (const f of files) {
          if (/^image\/(png|jpeg|gif|webp)$/.test(f.type)) content.push({ type: 'image', source: { type: 'base64', media_type: f.type, data: await toBase64(f) } });
          else if (isPdf(f)) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await toBase64(f) } });
        }
        content.push({ type: 'text', text: schedulePrompt(text) });
        const res = await client.beta.messages.create({
          model: store.state.settings.model || MODEL, max_tokens: 8000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEDULE_SCHEMA } }, messages: [{ role: 'user', content }],
        });
        const block = res.content.find((x) => x.type === 'text');
        if (block) return Object.assign(cleanSchedule(JSON.parse(block.text)), { via: 'claude-api' });
      } catch (e) {
        console.warn('[brain] schedule via API failed', e);
      }
    }
    let all = text;
    for (const f of files) all += '\n' + (await readFileText(f, store.state.settings.ocr !== false));
    return { lender: null, payments: GU.debts.parseSchedule(all), via: 'offline' };
  }

  GU.brain = { readSchedule, readStatement, quick, analyse, file, where, placeOf, asksPayer, payerFor, workSense, mode, modeLabel, prefillForm, DEST_LABEL, DESTINATIONS, getSample, TOPICS,
    blank: blankResult, clean, PAPER, MONEY };
})();
