/* The Ground Up: example data, so a first visit shows how everything works.
   Every example record is marked demo: true and can be cleared in one click. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, addMonths, uid, money } = GU.util;
  const store = GU.store;

  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* A simple drawn receipt or invoice, so the examples have real attachments. */
  function paperSVG(o) {
    const w = 300;
    const lines = o.lines || [];
    const h = 190 + lines.length * 22;
    const esc = GU.util.esc;
    let y = 104;
    const rows = lines.map(([a, b]) => {
      y += 22;
      return '<text x="24" y="' + y + '">' + esc(a) + '</text><text x="' + (w - 24) + '" y="' + y + '" text-anchor="end">' + esc(b) + '</text>';
    }).join('');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<rect width="100%" height="100%" fill="#fdfdfb"/>' +
      '<g font-family="Courier New, monospace" font-size="13" fill="#2b2b2b">' +
      '<text x="' + w / 2 + '" y="40" text-anchor="middle" font-size="18" font-weight="bold">' + esc(o.shop) + '</text>' +
      '<text x="' + w / 2 + '" y="62" text-anchor="middle" font-size="11">' + esc(o.sub || '') + '</text>' +
      '<text x="24" y="96" font-size="11">' + esc(o.kind || 'RECEIPT') + '   ' + esc(o.date) + '</text>' +
      '<line x1="24" y1="106" x2="' + (w - 24) + '" y2="106" stroke="#999" stroke-dasharray="3 3"/>' + rows +
      '<line x1="24" y1="' + (y + 14) + '" x2="' + (w - 24) + '" y2="' + (y + 14) + '" stroke="#999" stroke-dasharray="3 3"/>' +
      '<text x="24" y="' + (y + 38) + '" font-weight="bold">TOTAL</text><text x="' + (w - 24) + '" y="' + (y + 38) + '" text-anchor="end" font-weight="bold">' + esc(o.total) + '</text>' +
      '<text x="' + w / 2 + '" y="' + (h - 20) + '" text-anchor="middle" font-size="10">' + esc(o.foot || 'Thank you') + '</text></g></svg>';
    return new Blob([svg], { type: 'image/svg+xml' });
  }
  async function attach(name, o) {
    const blob = paperSVG(o);
    const f = new File([blob], name, { type: 'image/svg+xml' });
    const meta = await GU.files.add(f, { demo: true });
    return [meta];
  }

  async function load() {
    clear(true);
    const t = today();
    const d = (n) => addDays(t, n);
    const day = +t.slice(8, 10);
    const nextDay = (dom) => (day <= dom ? t.slice(0, 8) + String(dom).padStart(2, '0') : addMonths(t.slice(0, 8) + '01', 1).slice(0, 8) + String(dom).padStart(2, '0'));
    const r = rng(7);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const amt = (a, b) => Math.round((a + r() * (b - a)) * 100) / 100;
    const D = { demo: true, created: t };
    const cur = 'acc-demo-current';
    const sav = 'acc-demo-savings';

    /* transactions: about six months of an ordinary London life */
    const tx = [];
    const push = (date, description, amount, category, account) => {
      if (date <= t) tx.push(Object.assign({ id: 't-' + uid(), date, description, amount, category, account: account || cur, notes: '', source: 'import' }, D));
    };
    for (let k = -5; k <= 0; k++) {
      const m = addMonths(t.slice(0, 8) + '01', k).slice(0, 8);
      const at = (dd) => m + String(dd).padStart(2, '0');
      push(at(25), 'NORTHBRIDGE LTD SALARY', 2850, 'Salary');
      push(at(1), 'HARTLEY LETTINGS RENT', -1150, 'Housing');
      push(at(1), 'LAMBETH COUNCIL TAX', -142, 'Bills & utilities');
      push(at(14), 'OCTOPUS ENERGY', -96, 'Bills & utilities');
      push(at(20), 'THAMES WATER', -38, 'Bills & utilities');
      push(at(18), 'EE LIMITED', -28, 'Bills & utilities');
      push(at(9), 'BT GROUP PLC', -35, 'Bills & utilities');
      push(at(12), 'NETFLIX.COM', -10.99, 'Subscriptions');
      push(at(3), 'SPOTIFY UK', -11.99, 'Subscriptions');
      push(at(5), 'PUREGYM LTD', -24.99, 'Health & fitness');
      push(at(26), 'TRANSFER TO SAVINGS', -300, 'Transfers');
      push(at(26), 'TRANSFER FROM CURRENT', 300, 'Transfers', sav);
      for (const dd of [2, 9, 16, 23]) push(at(dd), pick(['TESCO STORES 2041', "SAINSBURY'S S/MKTS", 'LIDL GB LONDON', 'TESCO EXPRESS']), -amt(32, 92), 'Groceries');
      for (const dd of [4, 11, 17, 22, 27]) push(at(dd), pick(['PRET A MANGER', "NANDO'S BRIXTON", 'COSTA COFFEE', 'DELIVEROO', 'WAGAMAMA']), -amt(4.5, 38), 'Eating out');
      for (const dd of [6, 13, 20, 27]) push(at(dd), 'TFL TRAVEL CHARGE', -amt(22, 34), 'Transport');
      push(at(8), 'AMAZON.CO.UK*MK3', -amt(12, 58), 'Shopping');
      push(at(19), 'AMZN MKTP UK', -amt(9, 40), 'Shopping');
      push(at(15), 'BOOTS 1123', -amt(6, 22), 'Health & fitness');
      if (k % 2 === 0) push(at(15), pick(['BLOOM BAKERY LTD', 'KITE CYCLES LTD']), amt(380, 650), 'Freelance & side work');
      if (k === -4) push(at(10), 'HOME OFFICE UKVI VISA FEE', -827, 'Visa & immigration');
      if (k === -1) push(at(21), 'TRAINLINE.COM', -amt(48, 96), 'Transport');
      push(at(7), 'BARCLAYCARD PAYMENT', -120, 'Debt repayments');
      if (k >= -1) push(at(15), 'KLARNA*ASOS.COM', -33.33, 'Debt repayments');
    }
    push(d(-3), 'SQ *BRIXTON MARKET STALL', -14, '');
    push(d(-6), 'PAYPAL *JSMITH', -25, '');
    push(d(-11), 'CARD PAYMENT 0042 ZETTLE', -9.5, '');

    const first = tx.reduce((m, x) => (x.date < m ? x.date : m), t);
    const debts = [
      Object.assign({ id: 'debt-' + uid(), name: 'Barclaycard', lender: 'Barclaycard', type: 'Credit card', balance: 2860, balanceDate: addDays(first, -1), startBalance: 3400, apr: 24.9, monthlyPayment: 120, paymentDay: 7,
        notes: '0% on balance transfers ended in January.', history: [] }, D),
      Object.assign({ id: 'debt-' + uid(), name: 'Klarna (ASOS order)', lender: 'Klarna', type: 'Buy now pay later', balance: 99.99, balanceDate: addMonths(t.slice(0, 8) + '01', -1).slice(0, 8) + '14', monthlyPayment: 33.33, paymentDay: 15, history: [] }, D),
    ];

    const bill = (o) => Object.assign({ id: 'b-' + uid(), history: [], active: true, account: cur, anchorDay: +o.nextDue.slice(8) }, D, o, { autopay: o.method !== 'Pay manually' });
    const bills = [
      bill({ name: 'Rent', payee: 'Hartley Lettings', amount: 1150, frequency: 'monthly', nextDue: nextDay(1), method: 'Standing order', category: 'Housing' }),
      bill({ name: 'Council tax', payee: 'Lambeth Council', amount: 142, frequency: 'monthly', nextDue: nextDay(1), method: 'Direct debit', category: 'Bills & utilities' }),
      bill({ name: 'Electricity and gas', payee: 'Octopus Energy', amount: 96, frequency: 'monthly', nextDue: nextDay(14), method: 'Direct debit', category: 'Bills & utilities' }),
      bill({ name: 'Water', payee: 'Thames Water', amount: 38, frequency: 'monthly', nextDue: nextDay(20), method: 'Direct debit', category: 'Bills & utilities' }),
      bill({ name: 'Mobile', payee: 'EE', amount: 28, frequency: 'monthly', nextDue: nextDay(18), method: 'Direct debit', category: 'Bills & utilities' }),
      bill({ name: 'Broadband', payee: 'BT', amount: 35, frequency: 'monthly', nextDue: nextDay(9), method: 'Direct debit', category: 'Bills & utilities' }),
      bill({ name: 'Netflix', payee: 'Netflix', amount: 10.99, frequency: 'monthly', nextDue: nextDay(12), method: 'Card (automatic)', category: 'Subscriptions' }),
      bill({ name: 'Spotify', payee: 'Spotify', amount: 11.99, frequency: 'monthly', nextDue: nextDay(3), method: 'Card (automatic)', category: 'Subscriptions' }),
      bill({ name: 'Gym', payee: 'PureGym', amount: 24.99, frequency: 'monthly', nextDue: nextDay(5), method: 'Direct debit', category: 'Health & fitness' }),
      bill({ name: 'Car insurance', payee: 'Admiral', amount: 412, frequency: 'yearly', nextDue: d(5), method: 'Pay manually', category: 'Insurance', notes: 'Renewal quote came by email. Compare before paying.' }),
      bill({ name: 'TV Licence', payee: 'TV Licensing', amount: 174.5, frequency: 'yearly', nextDue: d(40), method: 'Pay manually', category: 'Bills & utilities' }),
      bill({ name: 'Window cleaner', payee: 'Dave’s Windows', amount: 20, frequency: 'monthly', nextDue: d(-3), method: 'Pay manually', category: 'Other spending' }),
    ];

    const incomeSources = [
      Object.assign({ id: 'i-' + uid(), name: 'Salary', from: 'Northbridge Ltd', amount: 2850, frequency: 'monthly', nextDate: nextDay(25), anchorDay: 25, account: cur }, D),
      Object.assign({ id: 'i-' + uid(), name: 'Freelance retainer', from: 'Kite Cycles', amount: 300, frequency: 'monthly', nextDate: nextDay(15), anchorDay: 15, account: cur }, D),
    ];

    const P = (o) => Object.assign({ id: 'p-' + uid(), status: '', dueDate: '', paidDate: '', warrantyUntil: '', reference: '', notes: '', files: [] }, D, o);
    const paperwork = [
      P({ kind: 'receipt', context: 'home', title: 'Samsung 55in TV', party: 'Currys', amount: 549, date: d(-240), warrantyUntil: addMonths(d(-240), 24), category: 'Shopping', reference: 'CUR-88412',
        files: await attach('currys-tv-receipt.svg', { shop: 'CURRYS', sub: 'Croydon Megastore', date: GU.util.fmtDate(d(-240)), lines: [['SAMSUNG 55" QLED', '549.00'], ['2 YR GUARANTEE', 'INCL']], total: '£549.00', foot: 'Keep this receipt for your guarantee' }) }),
      P({ kind: 'receipt', context: 'home', title: 'Weekly shop', party: 'Tesco', amount: 64.2, date: d(-4), category: 'Groceries',
        files: await attach('tesco-receipt.svg', { shop: 'TESCO', sub: 'Brixton Superstore', date: GU.util.fmtDate(d(-4)), lines: [['SEMI SKIMMED MILK', '1.45'], ['SOURDOUGH LOAF', '1.90'], ['CHICKEN THIGHS', '4.75'], ['MIXED VEG', '6.10'], ['OTHER ITEMS x23', '50.00']], total: '£64.20' }) }),
      P({ kind: 'receipt', context: 'work', title: 'Client lunch', party: 'Pret A Manger', amount: 18.45, date: d(-2), category: 'Eating out', claim: true,
        files: await attach('pret-receipt.svg', { shop: 'PRET A MANGER', sub: 'Kings Cross', date: GU.util.fmtDate(d(-2)), lines: [['CHICKEN CAESAR', '6.95'], ['FLAT WHITE x2', '7.30'], ['CROISSANT', '4.20']], total: '£18.45' }) }),
      P({ kind: 'invoice-in', context: 'home', title: 'Boiler repair', party: 'Hart & Sons Plumbing', amount: 180, date: d(-10), dueDate: d(4), status: 'unpaid', reference: 'HS-2231', category: 'Housing',
        files: await attach('hart-invoice.svg', { kind: 'INVOICE HS-2231', shop: 'HART & SONS PLUMBING', sub: 'Gas Safe reg. 512345', date: GU.util.fmtDate(d(-10)), lines: [['Call-out', '60.00'], ['Replace diverter valve', '120.00']], total: '£180.00', foot: 'Payment due within 14 days' }) }),
      P({ kind: 'invoice-in', context: 'work', title: 'Self assessment 2025/26', party: 'Clarke Accountancy', amount: 240, date: d(-36), dueDate: d(-6), status: 'unpaid', reference: 'CA-1093', category: 'Work expenses' }),
      P({ kind: 'invoice-in', context: 'home', title: 'Kitchen sockets', party: 'Spark Electrical', amount: 95, date: d(-40), dueDate: d(-26), status: 'paid', paidDate: d(-33), reference: 'SE-772', category: 'Housing' }),
      P({ kind: 'invoice-out', context: 'work', title: 'Website redesign', party: 'Bloom Bakery', amount: 650, date: d(-40), dueDate: d(-10), status: 'unpaid', reference: 'INV-0042' }),
      P({ kind: 'invoice-out', context: 'work', title: 'Logo refresh', party: 'Kite Cycles', amount: 300, date: d(-48), dueDate: d(-18), status: 'paid', paidDate: d(-20), reference: 'INV-0041' }),
      P({ kind: 'warranty', context: 'home', title: 'Dyson V11 vacuum', party: 'Dyson', amount: 399.99, date: d(-710), warrantyUntil: d(20), reference: 'DY-V11-55821', notes: 'Two-year guarantee, registered online.' }),
      P({ kind: 'warranty', context: 'work', title: 'MacBook Air (AppleCare+)', party: 'Apple', amount: 1199, date: d(-300), warrantyUntil: d(430), category: 'Work expenses' }),
    ];

    const DOC = (o) => Object.assign({ id: 'd-' + uid(), holder: 'Me', reference: '', location: '', issueDate: '', expiryDate: '', notes: '', files: [] }, D, o);
    const documents = [
      DOC({ title: 'Passport', type: 'Passport', reference: '548721093', issueDate: d(-1800), expiryDate: d(1850), location: 'Blue folder, top drawer' }),
      DOC({ title: 'Driving licence', type: 'ID card or driving licence', reference: 'SMITH801234AB9CD', issueDate: d(-3580), expiryDate: d(70), location: 'Wallet', notes: 'Photocard needs renewing every 10 years.' }),
      DOC({ title: 'UKVI eVisa', type: 'Residence permit or eVisa', reference: 'GWF071234567', expiryDate: d(110), location: 'UKVI account online', notes: 'Share code: generate a new one each time on GOV.UK.' }),
      DOC({ title: 'Tenancy agreement', type: 'Home and tenancy', issueDate: d(-235), expiryDate: d(130), location: 'Email from Hartley Lettings' }),
      DOC({ title: 'Contents insurance', type: 'Insurance policy', reference: 'AV-55219034', expiryDate: d(45), location: 'Aviva app' }),
      DOC({ title: 'Birth certificate', type: 'Birth, marriage or death certificate', location: 'Blue folder' }),
      DOC({ title: 'P60 2025/26', type: 'Employment and payslips', issueDate: d(-120), location: 'Scanned' }),
      DOC({ title: 'Degree certificate', type: 'Education and qualifications', issueDate: d(-3300), location: 'Frame in the study' }),
      DOC({ title: 'Freelance agreement with Bloom Bakery', type: 'Contract or agreement', holder: 'Bloom Bakery', issueDate: d(-120), expiryDate: d(50), context: 'work', notes: '30 days’ notice either side. Day rate £300.' }),
    ];
    const clientsFolder = { id: 'wf-demo-clients', area: 'projects', name: 'Clients', created: d(-20), demo: true };
    const projects = [
      { id: 'pj-' + uid(), name: 'Bloom Bakery online shop', client: 'Bloom Bakery', status: 'Booked', start: d(12), deadline: d(55), value: 1800, workFolder: clientsFolder.id, notes: 'Phase 2 after the redesign. Needs product photos by the start date.', files: [], created: d(-14), demo: true },
      { id: 'pj-' + uid(), name: 'Kite Cycles brand guide', client: 'Kite Cycles', status: 'In progress', start: d(-9), deadline: d(6), value: 450, workFolder: clientsFolder.id, notes: '', files: [], created: d(-20), demo: true },
      { id: 'pj-' + uid(), name: 'Portfolio website refresh', status: 'Idea', notes: 'Add the bakery and cycles work once they’re live.', files: [], created: d(-5), demo: true },
    ];
    const workNotes = [
      { id: 'wn-' + uid(), area: 'projects', folder: clientsFolder.id, title: 'Call with Bloom Bakery', body: 'They want online ordering for cakes, click and collect only.\nBudget agreed at £1,800. Send the quote by Friday.', created: d(-3), updated: d(-3), demo: true },
    ];

    const C = (texts, doneN) => texts.map((text, i) => ({ id: uid(), text, done: i < doneN }));
    const visas = [
      Object.assign({ id: 'v-' + uid(), visaType: 'Skilled Worker visa', country: 'United Kingdom', applicant: 'Me', status: 'Approved', reference: 'GWF071234567', submittedDate: d(-1120), decisionDate: d(-1085),
        validFrom: d(-1080), validUntil: d(110), fee: 827, portalUrl: 'https://www.gov.uk/skilled-worker-visa/extend-your-visa',
        checklist: C(['Passport', 'Certificate of Sponsorship', 'Proof of English', 'Bank statements', 'TB test certificate', 'Payslips'], 6),
        log: [{ id: uid(), date: d(-1120), text: 'Application submitted online' }, { id: uid(), date: d(-1100), text: 'Biometrics done at UKVCAS Croydon' }, { id: uid(), date: d(-1085), text: 'Approved' }, { id: uid(), date: d(-12), text: 'Asked HR for a new Certificate of Sponsorship for the extension' }], files: [] }, D),
      Object.assign({ id: 'v-' + uid(), visaType: 'Schengen visa (short stay)', country: 'France', applicant: 'Me', status: 'Preparing documents', appointmentLabel: 'Biometrics appointment', appointmentDate: d(9), appointmentTime: '09:40',
        appointmentPlace: 'TLScontact London', fee: 90, portalUrl: 'https://france-visas.gouv.fr',
        checklist: C(['Passport (valid 3 months after trip)', 'Two passport photos', 'Completed application form', 'Bank statements (3 months)', 'Hotel booking', 'Return flights', 'Travel insurance', 'Employer letter'], 4),
        log: [{ id: uid(), date: d(-15), text: 'Booked TLScontact appointment' }, { id: uid(), date: d(-8), text: 'Hotel and flights booked' }], files: [] }, D),
      Object.assign({ id: 'v-' + uid(), visaType: 'Standard Visitor visa', country: 'United Kingdom', applicant: 'Mum', status: 'Awaiting decision', reference: 'GWF078812345', submittedDate: d(-21), decisionExpected: d(7), fee: 127,
        checklist: C(['Passport', 'Invitation letter', 'My bank statements', 'Proof of my visa status', 'Mum’s bank statements'], 5),
        log: [{ id: uid(), date: d(-21), text: 'Submitted at VFS Lagos' }, { id: uid(), date: d(-20), text: 'Biometrics done' }], files: [] }, D),
    ];

    const lists = store.state.todoLists;
    const L = (re) => (lists.find((l) => re.test(l.name)) || lists[0] || {}).id;
    const K = (o) => Object.assign({ id: 'k-' + uid(), priority: 'normal', notes: '', done: false, due: '' }, D, o);
    const tasks = [
      K({ title: 'Book passport photos for Schengen application', due: d(1), listId: L(/admin/i), priority: 'high' }),
      K({ title: 'Call Octopus about the meter reading', due: d(-2), listId: L(/admin/i) }),
      K({ title: 'Pay Clarke Accountancy invoice', due: d(-1), listId: L(/work/i), priority: 'high' }),
      K({ title: 'Chase Bloom Bakery for invoice INV-0042', due: t, listId: L(/work/i), priority: 'high' }),
      K({ title: 'Buy birthday present for Priya', due: d(5), listId: L(/personal/i) }),
      K({ title: 'Renew driving licence photo', due: d(20), listId: L(/admin/i), notes: 'Do it on GOV.UK, costs £14.' }),
      K({ title: 'Book dentist check-up', listId: L(/personal/i) }),
      K({ title: 'Look into combining old pensions', listId: L(/admin/i), priority: 'low' }),
      K({ title: 'Renew gym membership', done: true, doneAt: d(-1), listId: L(/personal/i) }),
      K({ title: 'Send P60 to mortgage broker', done: true, doneAt: d(-3), listId: L(/admin/i) }),
    ];

    const carId = 's-demo-car';
    const sections = [Object.assign({ id: carId, name: 'Car', icon: 'car', byAssistant: true }, D, { created: d(-30) })];
    const sectionItems = [
      Object.assign({ id: 'si-' + uid(), sectionId: carId, title: 'MOT certificate', party: 'Kwik Fit Streatham', date: d(-200), dueDate: d(165), reference: 'MOT 4471 2290 8812', notes: 'Passed with one advisory: front tyres wearing.',
        files: await attach('mot-certificate.svg', { kind: 'MOT TEST CERTIFICATE', shop: 'MOT CERTIFICATE', sub: 'VW Golf · LD19 XKR', date: GU.util.fmtDate(d(-200)), lines: [['Result', 'PASS'], ['Mileage', '41,208'], ['Advisory', 'Tyres']], total: 'Expires ' + GU.util.fmtDate(d(165)) }) }, D),
      Object.assign({ id: 'si-' + uid(), sectionId: carId, title: 'Full service', party: 'Kwik Fit Streatham', amount: 189, date: d(-60), notes: 'Oil, filters, brake fluid.', files: [] }, D),
    ];

    const inbox = [
      Object.assign({ id: 'in-' + uid(), note: 'School trip letter for Amara: Science Museum, £35 by 24 Oct, sign the consent slip', files: [], status: 'ready',
        result: { destination: 'section', confidence: 0.62, summary: 'A school trip letter for Amara: £35 to pay and a consent slip to sign.', title: 'Science Museum school trip', party: 'Amara’s school', amount: 35,
          date: t, due_date: d(18), expiry_date: null, reference: null, context: 'home', category: 'Family & kids', document_type: null, frequency: null, paid: false, visa_id: null, section_id: null,
          new_section_name: 'Kids & school', task_title: 'Pay £35 and sign consent slip for school trip', task_due: d(16), notes: null, via: 'offline' } }, D),
    ];
    const filedLog = [
      Object.assign({ id: 'log-' + uid(), date: d(-4), summary: 'Receipt from Tesco for your weekly shop, £64.20.', title: 'Weekly shop', label: 'Receipts & invoices › Home', tab: 'receipts', ref: { c: 'paperwork', id: paperwork[1].id }, via: 'offline' }, D),
      Object.assign({ id: 'log-' + uid(), date: d(-10), summary: 'Invoice from Hart & Sons Plumbing for a boiler repair, £180.00, due in 14 days.', title: 'Boiler repair', label: 'Receipts & invoices › Home', tab: 'receipts', ref: { c: 'paperwork', id: paperwork[3].id }, via: 'offline' }, D),
      Object.assign({ id: 'log-' + uid(), date: d(-30), summary: 'Your MOT certificate. I started a Car section for it.', title: 'MOT certificate', label: 'Car', tab: 's-' + carId, ref: { c: 'sectionItems', id: sectionItems[0].id }, via: 'offline' }, D),
    ];

    store.commit((s) => {
      s.accounts.push({ id: cur, name: 'Monzo current account', bank: 'Monzo', type: 'current', overdraftLimit: 500, balanceAnchor: { date: addDays(first, -1), amount: 2412.37 }, demo: true },
        { id: sav, name: 'Savings pot', bank: 'Monzo', type: 'savings', balanceAnchor: { date: addDays(first, -1), amount: 2150 }, demo: true });
      s.debts.push(...debts);
      s.transactions.push(...tx);
      s.bills.push(...bills);
      s.incomeSources.push(...incomeSources);
      s.paperwork.push(...paperwork);
      s.documents.push(...documents);
      s.visas.push(...visas);
      s.tasks.push(...tasks);
      s.projects.push(...projects);
      s.workFolders.push(clientsFolder);
      s.workNotes.push(...workNotes);
      s.sections.push(...sections);
      s.sectionItems.push(...sectionItems);
      s.inbox.push(...inbox);
      s.filedLog.unshift(...filedLog);
      if (!Object.keys(s.settings.budgets).length) {
        s.settings.budgets = { Groceries: 320, 'Eating out': 120, Shopping: 90, Transport: 140 };
        s.meta.demoBudgets = true;
      }
    });
  }

  const COLLECTIONS = ['transactions', 'debts', 'bills', 'incomeSources', 'paperwork', 'documents', 'visas', 'tasks', 'sections', 'sectionItems', 'inbox', 'filedLog', 'projects', 'workFolders', 'workNotes'];
  function clear(silent) {
    const s = store.state;
    const files = [];
    for (const c of COLLECTIONS) for (const x of s[c] || []) if (x.demo) (x.files || []).forEach((f) => files.push(f.id));
    store.commit((st) => {
      for (const c of COLLECTIONS) st[c] = (st[c] || []).filter((x) => !x.demo);
      st.accounts = st.accounts.filter((a) => !a.demo || st.transactions.some((t) => t.account === a.id));
      if (!st.accounts.length) st.accounts.push({ id: 'acc-main', name: 'Current account' });
      if (st.meta.demoBudgets) {
        st.settings.budgets = {};
        delete st.meta.demoBudgets;
      }
    });
    files.forEach((id) => GU.files.remove(id));
    if (!silent) GU.ui.toast('Examples cleared. Everything you added yourself is still here.');
  }

  GU.sample = { load, clear };
})();
