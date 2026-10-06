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
    receipt: 'Receipts & invoices',
    invoice_to_pay: 'Receipts & invoices',
    invoice_owed_to_me: 'Receipts & invoices',
    warranty: 'Receipts & invoices',
    bill: 'Bills',
    document: 'Important documents',
    visa: 'Visa applications',
    task: 'To-do lists',
    transaction_out: 'Bank transactions',
    transaction_in: 'Bank transactions',
    bank_statement: 'Bank transactions',
    order_history: 'Receipts & invoices',
    section: 'Your sections',
    unsure: 'Inbox',
  };
  const DEST_LABEL = {
    receipt: 'Receipt', invoice_to_pay: 'Invoice to pay', invoice_owed_to_me: 'Invoice someone owes you', warranty: 'Warranty',
    bill: 'Regular bill', document: 'Important document', visa: 'Visa application', task: 'Task', transaction_out: 'Money out',
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
  async function pdfText(file) {
    await withTimeout(loadScript(PDFJS), 20000, 'PDF reader did not load');
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await lib.getDocument({ data }).promise;
    let out = '';
    for (let i = 1; i <= Math.min(doc.numPages, 6); i++) {
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
    return {
      today: today(),
      name: s.settings.name || '',
      business: s.settings.business || '',
      currency: s.settings.currency || 'GBP',
      visas: s.visas.map((v) => ({ id: v.id, visa: v.visaType, country: v.country || '', applicant: v.applicant || '', status: v.status })),
      sections: (s.sections || []).map((x) => ({ id: x.id, name: x.name })),
      documentTypes: GU.tabs.documents.TYPES,
      categories: F.EXPENSE.concat(F.INCOME),
    };
  }

  /* ---------- the shape every reader returns ---------- */
  const NULLABLE = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });
  const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['destination', 'confidence', 'summary', 'title', 'party', 'amount', 'date', 'due_date', 'expiry_date', 'reference', 'context', 'category',
      'document_type', 'frequency', 'paid', 'visa_id', 'section_id', 'new_section_name', 'task_title', 'task_due', 'notes'],
    properties: {
      destination: { type: 'string', enum: Object.keys(DESTINATIONS) },
      confidence: { type: 'number' },
      summary: { type: 'string' },
      title: { type: 'string' },
      party: NULLABLE('string'),
      amount: NULLABLE('number'),
      date: NULLABLE('string'),
      due_date: NULLABLE('string'),
      expiry_date: NULLABLE('string'),
      reference: NULLABLE('string'),
      context: { type: 'string', enum: ['home', 'work'] },
      category: NULLABLE('string'),
      document_type: NULLABLE('string'),
      frequency: { anyOf: [{ type: 'string', enum: F.FREQUENCIES.map((f) => f.value) }, { type: 'null' }] },
      paid: { type: 'boolean' },
      visa_id: NULLABLE('string'),
      section_id: NULLABLE('string'),
      new_section_name: NULLABLE('string'),
      task_title: NULLABLE('string'),
      task_due: NULLABLE('string'),
      notes: NULLABLE('string'),
    },
  };

  function instructions(ctx) {
    return [
      'You are the filing assistant inside a personal organiser app. The user throws things at you: photos of receipts, PDFs of invoices, letters, screenshots, pasted emails or quick notes. Decide where each one belongs and pull out the details so it can be filed without the user typing anything.',
      '',
      'Today is ' + ctx.today + '. The user is ' + (ctx.name || 'not named') + '.' + (ctx.business ? ' Their business or trading name, used on invoices they send, is "' + ctx.business + '".' : '') + ' Their currency is ' + ctx.currency + '. Most users are in the UK, so read dates like 03/04/2026 as 3 April.',
      '',
      'Pick one destination:',
      '- receipt: proof of something already bought or paid for (till receipt, card slip, order confirmation, e-receipt).',
      '- invoice_to_pay: an invoice or one-off bill the user has to pay. If it shows it has already been paid, still use this and set paid to true. Invoices for online orders (Amazon, eBay and similar) are already paid: set paid to true and put the order number in reference.',
      '- invoice_owed_to_me: an invoice the user or their business sent to someone else, so someone owes the user money.',
      '- warranty: a warranty, guarantee or protection plan. Put the cover end date in expiry_date (work it out from the purchase date and length if needed).',
      '- bill: a regular payment being set up or changed (direct debit notice, subscription, contract with a monthly cost). Set frequency and put the next payment date in due_date.',
      '- document: an important document to keep: passport, ID, driving licence, certificates, contracts, tenancy, insurance policy, payslip, P60, tax letters, medical letters, pension or bank letters. Set document_type to one of: ' + ctx.documentTypes.join('; ') + '. Put any expiry or renewal date in expiry_date and the issue date in date.',
      '- visa: anything about a visa or immigration application (UKVI, Home Office, eVisa, biometrics, TLScontact, VFS, Certificate of Sponsorship, embassy letters). If it belongs to one of these existing applications, set visa_id to its id: ' + JSON.stringify(ctx.visas) + '.',
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
      '- context: "work" if it is for the user\'s job or business, otherwise "home".',
      '- task_title and task_due: if the item asks the user to do something by a date (reply, pay, book, renew, send documents) and the destination is not already task, describe that follow-up. Otherwise null.',
      '- summary: one short, friendly sentence to the user saying what it is, for example "Receipt from Currys for a Samsung TV, £549.00, with a 2-year guarantee."',
      '- confidence: 0 to 1, how sure you are about the destination.',
      '- notes: anything else worth keeping (policy numbers, what is covered, account numbers). null if nothing.',
    ].join('\n');
  }

  function blankResult() {
    return { destination: 'unsure', confidence: 0.3, summary: '', title: '', party: null, amount: null, date: null, due_date: null, expiry_date: null, reference: null,
      context: 'home', category: null, document_type: null, frequency: null, paid: false, visa_id: null, section_id: null, new_section_name: null, task_title: null, task_due: null, notes: null };
  }
  function clean(r) {
    const out = Object.assign(blankResult(), r || {});
    for (const k of ['date', 'due_date', 'expiry_date', 'task_due']) if (out[k] && !GU.util.isISO(out[k])) out[k] = parseLooseDate(out[k], 'dmy');
    if (typeof out.amount === 'string') out.amount = parseAmount(out.amount);
    if (out.amount != null && isNaN(out.amount)) out.amount = null;
    if (out.amount != null) out.amount = Math.abs(round2(out.amount));
    if (!DESTINATIONS[out.destination]) out.destination = 'unsure';
    out.confidence = Math.max(0, Math.min(1, Number(out.confidence) || 0));
    if (out.visa_id && !store.find('visas', out.visa_id)) out.visa_id = null;
    if (out.section_id && !(store.state.sections || []).some((x) => x.id === out.section_id)) out.section_id = null;
    if (out.document_type && !GU.tabs.documents.TYPES.includes(out.document_type)) out.document_type = 'Other';
    if (out.category && !F.EXPENSE.concat(F.INCOME, [F.TRANSFER]).includes(out.category)) out.category = null;
    out.title = (out.title || '').trim() || (out.party || DEST_LABEL[out.destination]);
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
      (input.files.length ? 'Files: ' + input.files.map((f) => f.name + ' (' + (f.type || 'unknown type') + ')').join(', ') + (images.length ? '. The image' + (images.length > 1 ? 's are' : ' is') + ' attached.' : '') + '\n' : '') +
      (input.note ? 'The user wrote: ' + input.note + '\n' : '') +
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
      (input.files.length ? 'Files: ' + input.files.map((f) => f.name).join(', ') + '\n' : '') +
      (input.note ? 'The user wrote: ' + input.note + '\n' : '') +
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
    [['p60', 'p45', 'payslip', 'pay slip', 'contract of employment', 'offer letter', 'employment contract'], 'Employment and payslips'],
    [['hmrc', 'self assessment', 'tax return', 'tax code', 'unique taxpayer', 'utr'], 'Tax'],
    [['policy schedule', 'certificate of insurance', 'insurance policy', 'policy number', 'policy document'], 'Insurance policy'],
    [['tenancy agreement', 'lease agreement', 'mortgage offer', 'completion statement', 'deed', 'council tax'], 'Home and tenancy'],
    [['v5c', 'mot certificate', 'logbook', 'vehicle registration'], 'Vehicle'],
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
    const names = input.files.map((f) => f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ')).join(' ');
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
    r.reference = findReference(raw, input.files.map((f) => f.name).join(' '));
    r.party = findParty(raw, t);
    r.context = /\b(my business|client|expenses claim|expense claim|for work|work expense|office supplies|freelance|bill to:? .{0,40}(ltd|limited))\b/.test(t) || (store.state.settings.business && t.includes(store.state.settings.business.toLowerCase())) ? 'work' : 'home';

    // A spreadsheet is either a list of online orders or a bank statement.
    const sheetLike = !input.files.length || input.files.every((f) => /\.(csv|tsv|txt)$/i.test(f.name) || /^text\//.test(f.type));
    const headerLine = (raw.split(/\n/).find((l) => l.trim()) || '').toLowerCase();
    const looksLikeOrders = sheetLike && headerLine.split(/,|\t/).length >= 3 && /order\s*(id|number|no|#)/.test(headerLine) && /date/.test(headerLine);
    if (looksLikeOrders && raw.split(/\n/).filter((l) => l.trim()).length > 1) {
      return Object.assign(r, { destination: 'order_history', confidence: 0.95, title: 'Order list', summary: 'A list of online orders. I’ll open the importer so every order becomes a paid invoice.' });
    }
    if (input.files.some((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')) {
      return Object.assign(r, { destination: 'bank_statement', confidence: 0.9, title: 'Bank statement', summary: 'A bank statement. I’ll open the importer so you can check the columns.' });
    }
    // Typed notes with no files: tasks or quick money notes.
    if (!input.files.length && raw.length < 240) {
      const amt = raw.match(/(?:£|\$|€)\s?(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s?(?:quid|pounds|gbp)/i);
      if (amt && /\b(paid|spent|bought|gave|cost)\b/i.test(raw)) {
        const who = raw.match(/\b(?:to|at|on|for)\s+(?:the\s+)?([a-z][\w' &-]{2,40})/i);
        return Object.assign(r, { destination: 'transaction_out', confidence: 0.8, amount: parseFloat(amt[1] || amt[2]), party: who ? who[1].trim() : null, title: who ? who[1].trim() : raw,
          date: r.date || today(), category: F.categorise(raw, -1, store.state.rules) || null, summary: 'Money out: ' + money(parseFloat(amt[1] || amt[2])) + (who ? ' to ' + who[1].trim() : '') + '.' });
      }
      if (amt && /\b(received|got paid|earned|was paid|refund)\b/i.test(raw)) {
        const who = raw.match(/\bfrom\s+([a-z][\w' &-]{2,40})/i);
        return Object.assign(r, { destination: 'transaction_in', confidence: 0.8, amount: parseFloat(amt[1] || amt[2]), party: who ? who[1].trim() : null, title: who ? who[1].trim() : raw,
          date: r.date || today(), category: /refund/i.test(raw) ? 'Refunds' : null, summary: 'Money in: ' + money(parseFloat(amt[1] || amt[2])) + (who ? ' from ' + who[1].trim() : '') + '.' });
      }
      const q = GU.tabs.today.parseQuickTask(raw);
      const verb = /^(call|ring|email|text|book|buy|pay|renew|cancel|send|post|check|ask|remember|remind|don'?t forget|need to|sort|fix|clean|pick up|collect|order|apply|reply|chase|find|get|make|take|return|update|finish|write|print|sign|submit|arrange|organise|organize)\b/i.test(raw.trim());
      return Object.assign(r, { destination: 'task', confidence: verb || q.due ? 0.88 : 0.66, title: q.title, due_date: q.due || null, amount: null,
        summary: 'A task' + (q.due ? ' for ' + fmtDate(q.due, { weekday: true }) : '') + ': ' + q.title + '.' });
    }

    const sc = {
      visa: has(t, ['visa', 'ukvi', 'home office', 'biometric', 'evisa', 'brp', 'tlscontact', 'tls contact', 'vfs global', 'schengen', 'certificate of sponsorship', 'immigration', 'leave to remain', 'share code', 'embassy', 'consulate', 'gwf']) * 3,
      warranty: has(t, ['warranty', 'guarantee', 'applecare', 'extended cover', 'protection plan', 'care plan']) * 3,
      invoice: has(t, ['invoice', 'amount due', 'balance due', 'payment due', 'due date', 'pay by', 'please pay', 'remittance', 'sort code', 'bill to', 'billed to', 'payment terms']) * 2,
      receipt: has(t, ['receipt', 'subtotal', 'sub total', 'change due', 'card payment', 'contactless', 'visa debit', 'mastercard', 'thank you for shopping', 'vat ', 'order confirmation', 'paid with', 'auth code', 'qty', 'cashier', 'till']) * 1.3,
      bill: has(t, ['direct debit', 'monthly payment', 'your new monthly', 'subscription', 'per month', 'standing order', 'payment schedule', 'monthly plan']) * 2,
    };
    let docType = null;
    for (const [words, type] of DOC_RULES) if (has(t, words)) {
      docType = type;
      break;
    }
    const topic = TOPICS.map((x) => ({ x, n: has(t, x.words) })).sort((a, b) => b.n - a.n)[0];
    const onlineOrder = /\bamazon\b|\bebay\b|sold by|order (?:number|no\.?|#|id)|order date/.test(t) && !/amount due|balance due|please pay|payment due|pay by/.test(t);
    const paidWords = has(t, ['paid in full', 'payment received', 'thank you for your payment', 'amount paid', 'balance: 0.00', 'balance due: 0.00', 'balance due £0.00', 'paid on']) + (onlineOrder ? 1 : 0);
    const biz = (store.state.settings.business || '').toLowerCase().trim();
    const fromMe = biz && t.includes(biz) && !new RegExp('bill(?:ed)? to:?\\s*' + biz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t);
    const warrantyYears = t.match(/(\d+)[\s-]*year (?:manufacturer'?s? )?(?:warranty|guarantee)/);

    if (sc.visa >= 3 && sc.visa >= sc.invoice && docType !== 'Passport') {
      const v = matchVisa(t);
      Object.assign(r, { destination: 'visa', confidence: v ? 0.82 : 0.7, visa_id: v ? v.id : null, title: v ? v.visaType : 'Visa letter',
        summary: v ? 'About your ' + v.visaType + (v.country ? ' (' + v.country + ')' : '') + '. I’ll add it to that application.' : 'A visa or immigration letter.' });
    } else if (sc.warranty >= 3 && sc.warranty >= sc.invoice && !(sc.receipt >= 2.6 && sc.warranty < 6)) {
      const until = r.expiry_date || (warrantyYears && (r.date || today()) ? addMonths(r.date || today(), 12 * +warrantyYears[1]) : null);
      Object.assign(r, { destination: 'warranty', confidence: 0.78, expiry_date: until, title: r.party ? r.party + ' warranty' : 'Warranty',
        summary: 'A warranty' + (r.party ? ' from ' + r.party : '') + (until ? ', covered until ' + fmtDate(until) : '') + '.' });
    } else if (sc.invoice >= 4 || (sc.invoice >= 2 && (sc.invoice > sc.receipt || onlineOrder))) {
      const dest = fromMe ? 'invoice_owed_to_me' : 'invoice_to_pay';
      Object.assign(r, { destination: dest, confidence: 0.72 + Math.min(0.15, sc.invoice / 40), paid: !fromMe && paidWords > 0, title: r.party ? 'Invoice from ' + r.party : 'Invoice',
        category: F.categorise(r.party + ' ' + t, -1, store.state.rules) || null,
        summary: (fromMe ? 'An invoice you sent' : paidWords ? 'A paid invoice' : 'An invoice to pay') + (r.party && !fromMe ? ' from ' + r.party : '') + (r.amount ? ' for ' + money(r.amount) : '') + (r.due_date && !paidWords ? ', due ' + fmtDate(r.due_date) : '') + '.' });
    } else if (sc.bill >= 2 && sc.bill >= sc.receipt) {
      Object.assign(r, { destination: 'bill', confidence: 0.7, frequency: /year|annual/.test(t) ? 'yearly' : /quarter/.test(t) ? 'quarterly' : /week/.test(t) ? 'weekly' : 'monthly',
        title: r.party || 'New bill', due_date: r.due_date || r.date, category: F.categorise(r.party + ' ' + t, -1, store.state.rules) || 'Bills & utilities',
        summary: 'A regular payment' + (r.party ? ' to ' + r.party : '') + (r.amount ? ' of ' + money(r.amount) : '') + '.' });
    } else if (docType) {
      Object.assign(r, { destination: 'document', confidence: 0.75, document_type: docType, title: docType === 'Other' ? (r.party || 'Document') : docType.split(/[,(]/)[0].replace(/ or .*/, '').trim(),
        summary: 'An important document (' + docType.toLowerCase() + ')' + (r.expiry_date ? ', expires ' + fmtDate(r.expiry_date) : '') + '.' });
    } else if (sc.receipt >= 1.3) {
      Object.assign(r, { destination: 'receipt', confidence: 0.6 + Math.min(0.3, sc.receipt / 12), title: r.party ? r.party + ' receipt' : 'Receipt',
        category: F.categorise(r.party + ' ' + t, -1, store.state.rules) || null,
        expiry_date: warrantyYears ? addMonths(r.date || today(), 12 * +warrantyYears[1]) : null,
        summary: 'A receipt' + (r.party ? ' from ' + r.party : '') + (r.amount ? ' for ' + money(r.amount) : '') + (r.date ? ' on ' + fmtDate(r.date) : '') + '.' });
    } else if (topic && topic.n >= 1) {
      const existing = (store.state.sections || []).find((x) => x.name.toLowerCase() === topic.x.name.toLowerCase());
      Object.assign(r, { destination: 'section', confidence: 0.55 + Math.min(0.25, topic.n / 10), section_id: existing ? existing.id : null, new_section_name: existing ? null : topic.x.name,
        title: input.files[0] ? input.files[0].name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ') : raw.split('\n')[0].slice(0, 60),
        summary: 'This looks like it belongs with ' + topic.x.name + (existing ? '.' : '. I can start a new ' + topic.x.name + ' section for it.') });
    } else if (input.files.some(isImg) && !raw.trim()) {
      Object.assign(r, { destination: 'receipt', confidence: 0.4, title: 'Photo ' + fmtDate(today(), { short: true }),
        summary: 'A photo I couldn’t read. Is it a receipt? Check the details before filing.' });
    } else {
      Object.assign(r, { destination: 'unsure', confidence: 0.25, title: input.files[0] ? input.files[0].name : raw.slice(0, 60), summary: 'I’m not sure where this goes. Pick a place for it.' });
    }
    if (r.destination !== 'task' && /\b(reply|respond|book|renew|send|submit|call us|contact us|attend|bring)\b/.test(t) && (r.due_date || r.expiry_date) && r.destination !== 'invoice_to_pay') {
      r.task_title = 'Follow up: ' + r.title;
      r.task_due = r.due_date || addDays(r.expiry_date, -30);
    }
    return clean(r);
  }

  function matchVisa(t) {
    const visas = store.state.visas.filter((v) => !['Refused', 'Withdrawn'].includes(v.status));
    let best = null;
    let bestScore = 0;
    for (const v of visas) {
      let score = 0;
      for (const w of [v.country, v.visaType, v.applicant, v.reference].filter(Boolean)) {
        for (const part of String(w).toLowerCase().split(/[\s,]+/)) if (part.length > 3 && t.includes(part)) score++;
      }
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }
    return best || (visas.length === 1 ? visas[0] : null);
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
    input = { files: input.files || [], note: (input.note || '').trim(), text: '' };
    const m = await mode();
    // Spreadsheets (bank statements, order lists) are sorted on this device: no need to send them anywhere.
    if (input.files.some((f) => /\.(csv|tsv)$/i.test(f.name) || f.type === 'text/csv')) {
      input.text = (await readFileText(input.files[0], false)).slice(0, 4000);
      return Object.assign(await viaRules(input), { via: 'offline' });
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
  function where(result) {
    const r = result;
    if (r.destination === 'section') {
      const sec = r.section_id && (store.state.sections || []).find((x) => x.id === r.section_id);
      return sec ? sec.name : (r.new_section_name ? 'New section: ' + r.new_section_name : 'A new section');
    }
    if (r.destination === 'visa') {
      const v = r.visa_id && store.find('visas', r.visa_id);
      return v ? 'Visa applications › ' + v.visaType : 'Visa applications › new application';
    }
    if (r.destination === 'document') return 'Important documents › ' + (r.document_type || 'Other');
    if (['receipt', 'invoice_to_pay', 'invoice_owed_to_me', 'warranty'].includes(r.destination)) return 'Receipts & invoices › ' + (r.context === 'work' ? 'Work' : 'Home');
    return DESTINATIONS[r.destination];
  }

  /* Files the item. metas: already-stored file metadata. Returns {tab, ref, label, undo} or null if it needs the user. */
  function file(result, metas, note) {
    const r = result;
    const s = store.state;
    const created = [];
    const t = today();
    const notes = [r.notes, note && note !== r.title ? note : ''].filter(Boolean).join('\n') || '';
    let tab = null;
    let ref = null;
    let visaUndo = null;
    let attachUndo = null;
    let sameTitle = '';
    store.commit((st) => {
      const add = (c, rec) => {
        st[c].push(rec);
        created.push({ c, id: rec.id });
        return rec;
      };
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
            tab = 'receipts';
            ref = { c: 'paperwork', id: same.id };
            break;
          }
          const rec = add('paperwork', { id: 'p-' + uid(), created: t, kind, context: r.context, title: r.title, party: r.party || '', amount: r.amount, date: r.date || t,
            dueDate: inv ? r.due_date || '' : '', status: inv ? (r.paid ? 'paid' : 'unpaid') : '', paidDate: inv && r.paid ? r.date || t : '',
            warrantyUntil: r.destination === 'warranty' || r.expiry_date ? r.expiry_date || '' : '', reference: r.reference || '', category: r.category || '', notes, files: metas, via: r.via });
          tab = 'receipts';
          ref = { c: 'paperwork', id: rec.id };
          break;
        }
        case 'bill': {
          const due = r.due_date || r.date || t;
          const rec = add('bills', { id: 'b-' + uid(), created: t, name: r.title, payee: r.party || '', amount: r.amount || 0, frequency: r.frequency || 'monthly', nextDue: due < t ? F.nextDate(due, r.frequency || 'monthly', +due.slice(8)) || t : due,
            anchorDay: +due.slice(8), method: 'Direct debit', autopay: true, category: r.category || 'Bills & utilities', account: (st.accounts[0] || {}).id, notes, files: metas, history: [], active: true });
          tab = 'bills';
          ref = { c: 'bills', id: rec.id };
          break;
        }
        case 'document': {
          const rec = add('documents', { id: 'd-' + uid(), created: t, title: r.title, type: r.document_type || 'Other', holder: '', reference: r.reference || '', location: '',
            issueDate: r.date || '', expiryDate: r.expiry_date || '', notes: [r.summary, notes].filter(Boolean).join('\n'), files: metas });
          tab = 'documents';
          ref = { c: 'documents', id: rec.id };
          break;
        }
        case 'visa': {
          const v = r.visa_id && st.visas.find((x) => x.id === r.visa_id);
          if (v) {
            const logId = uid();
            v.files = (v.files || []).concat(metas);
            v.log = (v.log || []).concat([{ id: logId, date: t, text: r.summary || 'Filed ' + r.title }]);
            if (r.reference && !v.reference) v.reference = r.reference;
            visaUndo = { id: v.id, logId, fileIds: metas.map((m) => m.id) };
            ref = { c: 'visas', id: v.id };
          } else {
            const rec = add('visas', { id: 'v-' + uid(), created: t, visaType: r.title || 'Visa application', country: '', applicant: 'Me', status: 'Planning', reference: r.reference || '',
              checklist: [], log: [{ id: uid(), date: t, text: r.summary || 'Created from an upload' }], files: metas, notes });
            ref = { c: 'visas', id: rec.id };
          }
          tab = 'visas';
          break;
        }
        case 'task': {
          const rec = add('tasks', { id: 'k-' + uid(), created: t, listId: (st.todoLists[0] || {}).id, title: r.title, due: r.due_date || '', priority: 'normal', notes: [notes, metas.length ? plural(metas.length, 'file') + ' attached in Inbox history' : ''].filter(Boolean).join('\n'), done: false });
          tab = 'todos';
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
              sec = { id: 's' + uid(), name, icon: GU.sections.iconFor(name), created: t, byAssistant: true };
              st.sections = st.sections || [];
              st.sections.push(sec);
              created.push({ c: 'sections', id: sec.id });
            }
          }
          const rec = add('sectionItems', { id: 'si-' + uid(), created: t, sectionId: sec.id, title: r.title, party: r.party || '', amount: r.amount, date: r.date || '', dueDate: r.due_date || r.expiry_date || '',
            reference: r.reference || '', notes: [r.summary, notes].filter(Boolean).join('\n'), files: metas });
          tab = 's-' + sec.id;
          ref = { c: 'sectionItems', id: rec.id };
          break;
        }
        default:
          return;
      }
      if (r.task_title && r.destination !== 'task') {
        add('tasks', { id: 'k-' + uid(), created: t, listId: (st.todoLists.find((l) => /admin/i.test(l.name)) || st.todoLists[0] || {}).id, title: r.task_title, due: r.task_due || '', priority: 'normal', notes: 'From: ' + r.title, done: false });
      }
    });
    if (!ref) return null;
    const label = sameTitle ? 'Receipts & invoices › ' + sameTitle + ' (added to it)' : where(r);
    return {
      tab,
      ref,
      label,
      undo() {
        store.commit((st) => {
          for (const c of created) st[c.c] = st[c.c].filter((x) => x.id !== c.id);
          if (attachUndo) {
            const p = st.paperwork.find((x) => x.id === attachUndo.id);
            if (p) p.files = (p.files || []).filter((f) => !attachUndo.fileIds.includes(f.id));
          }
          if (visaUndo) {
            const v = st.visas.find((x) => x.id === visaUndo.id);
            if (v) {
              v.files = (v.files || []).filter((f) => !visaUndo.fileIds.includes(f.id));
              v.log = (v.log || []).filter((l) => l.id !== visaUndo.logId);
            }
          }
        });
      },
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
        set('kind', kindMap[r.destination]);
        set('context', r.context);
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
        note.innerHTML = GU.ui.icon('info') + '<span>' + esc(r.summary || '') + ' This looks like it belongs in <b>' + esc(where(r)) + '</b>. You can still file it here, or close this and drop it in the Inbox instead.</span>';
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

  GU.brain = { quick, analyse, file, where, mode, modeLabel, prefillForm, DEST_LABEL, DESTINATIONS, getSample, TOPICS };
})();
