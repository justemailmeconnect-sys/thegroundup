/* The Ground Up: example data, so a first visit shows how everything works.
   Every example record is marked demo: true and can be cleared in one click.
   Home is an ordinary London life with a little freelance work on the side (invoices you send are Home).
   Work is a made-up employer, Acme Care Ltd: one invoice Acme pays itself, things you paid for and are
   getting back (one already sent, with Acme's repayment waiting to be confirmed), and a monthly work bill
   that comes out of your account. */
(function () {
  'use strict';
  const GU = window.GU;
  const { today, addDays, addMonths, uid, money, monthLabel } = GU.util;
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
    const WORK_OUT = (GU.finance && GU.finance.WORK_OUT) || 'Work expenses';
    const WORK_IN = (GU.finance && GU.finance.WORK_IN) || 'Work reimbursements';
    // The work bill you pay yourself: paid 5 days ago, and a month before that.
    const rotaId = 'b-' + uid();
    const rotaDay = d(-5);
    const rotaLast = addMonths(rotaDay, -1);

    /* transactions: about six months of an ordinary London life */
    const tx = [];
    const push = (date, description, amount, category, account) => {
      if (date > t) return null;
      const rec = Object.assign({ id: 't-' + uid(), date, description, amount, category, account: account || cur, notes: '', source: 'import' }, D);
      tx.push(rec);
      return rec;
    };
    for (let k = -5; k <= 0; k++) {
      const m = addMonths(t.slice(0, 8) + '01', k).slice(0, 8);
      const at = (dd) => m + String(dd).padStart(2, '0');
      push(at(25), 'ACME CARE LTD SALARY', 2850, 'Salary');
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
      // One month of the savings statement is missing, so the Bank page has a gap to point out.
      if (k !== -3) push(at(26), 'TRANSFER FROM CURRENT', 300, 'Transfers', sav);
      for (const dd of [2, 9, 16, 23]) push(at(dd), pick(['TESCO STORES 2041', "SAINSBURY'S S/MKTS", 'LIDL GB LONDON', 'TESCO EXPRESS']), -amt(32, 92), 'Groceries');
      for (const dd of [4, 11, 17, 22, 27]) push(at(dd), pick(['PRET A MANGER', "NANDO'S BRIXTON", 'COSTA COFFEE', 'DELIVEROO', 'WAGAMAMA']), -amt(4.5, 38), 'Eating out');
      for (const dd of [6, 13, 20, 27]) push(at(dd), 'TFL TRAVEL CHARGE', -amt(22, 34), 'Transport');
      push(at(8), 'AMAZON.CO.UK*MK3', -amt(12, 58), 'Shopping');
      push(at(19), 'AMZN MKTP UK', -amt(9, 40), 'Shopping');
      push(at(15), 'BOOTS 1123', -amt(6, 22), 'Health & fitness');
      if (k % 2 === 0) push(at(15), pick(['BLOOM BAKERY LTD', 'KITE CYCLES LTD']), amt(380, 650), 'Freelance & side work');
      push(at(14), 'HMRC CHILD BENEFIT', 104.2, 'Benefits'); // so Home › Tax year has a benefit to show
      if (k === -4) push(at(10), 'HOME OFFICE UKVI VISA FEE', -827, 'Visa & immigration');
      if (k === -1) push(at(21), 'TRAINLINE.COM', -amt(48, 96), 'Transport');
      push(at(7), 'BARCLAYCARD PAYMENT', -120, 'Debt repayments');
      if (k >= -1) push(at(15), 'KLARNA*ASOS.COM', -33.33, 'Debt repayments');
    }
    push(d(-3), 'SQ *BRIXTON MARKET STALL', -14, '');
    push(d(-6), 'PAYPAL *JSMITH', -25, '');
    push(d(-11), 'CARD PAYMENT 0042 ZETTLE', -9.5, '');

    const first = tx.reduce((m, x) => (x.date < m ? x.date : m), t);
    const next15 = t.slice(8) < '15' ? t.slice(0, 8) + '15' : addMonths(t.slice(0, 8) + '01', 1).slice(0, 8) + '15';
    const debts = [
      Object.assign({ id: 'debt-' + uid(), name: 'Barclaycard', lender: 'Barclaycard', type: 'Credit card', balance: 2860, balanceDate: addDays(first, -1), startBalance: 3400, apr: 24.9, monthlyPayment: 120, paymentDay: 7,
        notes: '0% on balance transfers ended in January.', history: [] }, D),
      // A second card, so the debt-free plan can show which one an extra payment should go to first.
      Object.assign({ id: 'debt-' + uid(), name: 'Tesco Bank card', lender: 'Tesco Bank', type: 'Credit card', balance: 640, balanceDate: t, startBalance: 900, apr: 19.9, monthlyPayment: 45, paymentDay: 20, history: [] }, D),
      Object.assign({ id: 'debt-' + uid(), name: 'Klarna (ASOS order)', lender: 'Klarna', type: 'Buy now pay later', balance: 99.99, balanceDate: addMonths(t.slice(0, 8) + '01', -1).slice(0, 8) + '14', monthlyPayment: 33.33, paymentDay: 15, history: [],
        schedule: [{ id: 'in-demo-1', date: next15, amount: 33.33, merchant: 'ASOS', n: 2, of: 3 }, { id: 'in-demo-2', date: addMonths(next15, 1), amount: 33.34, merchant: 'ASOS', n: 3, of: 3 }] }, D),
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
      // A work cost that comes out of your account: Acme pays it back, and each payment joins Get paid back.
      bill({ id: rotaId, name: 'Staff rota app', payee: 'RotaCloud', amount: 35, frequency: 'monthly', nextDue: addMonths(rotaDay, 1), method: 'Card (automatic)', category: WORK_OUT, context: 'work', payer: 'me',
        history: [{ date: rotaLast, amount: 35 }, { date: rotaDay, amount: 35 }] }),
    ];

    const salaryId = 'i-' + uid();
    const incomeSources = [
      Object.assign({ id: salaryId, name: 'Salary', from: 'Acme Care Ltd', amount: 2850, frequency: 'monthly', nextDate: nextDay(25), anchorDay: 25, account: cur }, D),
      Object.assign({ id: 'i-' + uid(), name: 'Freelance retainer', from: 'Kite Cycles', amount: 300, frequency: 'monthly', nextDate: nextDay(15), anchorDay: 15, account: cur }, D),
      Object.assign({ id: 'i-' + uid(), name: 'Child Benefit', from: 'HMRC', amount: 104.2, frequency: 'monthly', nextDate: nextDay(14), anchorDay: 14, account: cur }, D),
    ];

    /* Work money with Acme. A monthly rota app comes out of your account and Acme pays it back: last month's is
       paid back, this month's is waiting to be sent. A train ticket was sent with a claim and Acme's payment
       for it has just come in (I ask before ticking it off, as the reference doesn't name it). */
    const rotaOut = [push(rotaLast, 'ROTACLOUD.COM', -35, WORK_OUT), push(rotaDay, 'ROTACLOUD.COM', -35, WORK_OUT)];
    const rotaBack = push(addDays(rotaLast, 9), 'ACME CARE LTD ROTACLOUD', 35, WORK_IN);
    const trainOut = push(d(-16), 'TRAINLINE.COM', -48.6, WORK_OUT);
    push(d(-2), 'ACME CARE LTD EXPENSES', 48.6, WORK_IN);
    const lunchOut = push(d(-2), 'PRET A MANGER KINGS CROSS', -18.45, WORK_OUT);
    const pack = 'ACME-' + d(-12);

    const P = (o) => Object.assign({ id: 'p-' + uid(), status: '', dueDate: '', paidDate: '', warrantyUntil: '', reference: '', notes: '', files: [] }, D, o);
    // Things you paid for and get back: payer 'me', at a stage, linked to your bank payment (and Acme's repayment).
    const claim = (o) => P(Object.assign({ kind: 'receipt', context: 'work', payer: 'me', claim: true, claimed: o.claimStatus !== 'to-send' }, o));
    const paperwork = [
      P({ kind: 'receipt', context: 'home', title: 'Samsung 55in TV', party: 'Currys', amount: 549, date: d(-240), warrantyUntil: addMonths(d(-240), 24), category: 'Shopping', reference: 'CUR-88412',
        files: await attach('currys-tv-receipt.svg', { shop: 'CURRYS', sub: 'Croydon Megastore', date: GU.util.fmtDate(d(-240)), lines: [['SAMSUNG 55" QLED', '549.00'], ['2 YR GUARANTEE', 'INCL']], total: '£549.00', foot: 'Keep this receipt for your guarantee' }) }),
      P({ kind: 'receipt', context: 'home', title: 'Weekly shop', party: 'Tesco', amount: 64.2, date: d(-4), category: 'Groceries',
        files: await attach('tesco-receipt.svg', { shop: 'TESCO', sub: 'Brixton Superstore', date: GU.util.fmtDate(d(-4)), lines: [['SEMI SKIMMED MILK', '1.45'], ['SOURDOUGH LOAF', '1.90'], ['CHICKEN THIGHS', '4.75'], ['MIXED VEG', '6.10'], ['OTHER ITEMS x23', '50.00']], total: '£64.20' }) }),
      // Things you might send back: the last day to return each is on the receipt (Work's is waiting to go to Acme).
      P({ kind: 'receipt', context: 'home', title: 'Bluetooth speaker', party: 'Argos', amount: 59.99, date: d(-24), category: 'Shopping', returnBy: d(6) }),
      P({ kind: 'receipt', context: 'home', title: 'Running shoes', party: 'JD Sports', amount: 84, date: d(-11), category: 'Shopping', returnBy: d(19) }),
      claim({ title: 'Desk fan for the office', party: 'Argos', amount: 24.99, date: d(-4), claimStatus: 'to-send', returnBy: d(5) }),
      claim({ title: 'Lunch for the training day', party: 'Pret A Manger', amount: 18.45, date: d(-2), claimStatus: 'to-send', purchaseTx: lunchOut && lunchOut.id, purchaseWas: 'Eating out',
        files: await attach('pret-receipt.svg', { shop: 'PRET A MANGER', sub: 'Kings Cross', date: GU.util.fmtDate(d(-2)), lines: [['CHICKEN CAESAR', '6.95'], ['FLAT WHITE x2', '7.30'], ['CROISSANT', '4.20']], total: '£18.45' }) }),
      claim({ title: 'Train to the Leeds office', party: 'Trainline', amount: 48.6, date: d(-16), claimStatus: 'sent', claimedDate: d(-12), packId: pack, purchaseTx: trainOut && trainOut.id, purchaseWas: 'Transport',
        files: await attach('trainline-ticket.svg', { kind: 'E-TICKET', shop: 'TRAINLINE', sub: 'London Kings Cross to Leeds', date: GU.util.fmtDate(d(-16)), lines: [['Off-peak return', '48.60'], ['Railcard', 'none']], total: '£48.60' }) }),
      claim({ id: 'p-bill-' + rotaId + '-' + rotaLast, title: 'Staff rota app (' + monthLabel(rotaLast.slice(0, 7)) + ')', party: 'RotaCloud', amount: 35, date: rotaLast, billId: rotaId,
        claimStatus: 'paid-back', claimedDate: addDays(rotaLast, 1), packId: 'ACME-' + addDays(rotaLast, 1), repaidDate: addDays(rotaLast, 9), repaidTx: rotaBack && rotaBack.id, purchaseTx: rotaOut[0] && rotaOut[0].id }),
      claim({ id: 'p-bill-' + rotaId + '-' + rotaDay, title: 'Staff rota app (' + monthLabel(rotaDay.slice(0, 7)) + ')', party: 'RotaCloud', amount: 35, date: rotaDay, billId: rotaId,
        claimStatus: 'to-send', purchaseTx: rotaOut[1] && rotaOut[1].id }),
      // Acme's own money: an order waiting for Acme to pay, and something Acme has paid for.
      P({ kind: 'invoice-in', context: 'work', payer: 'company', title: 'Office chairs', party: 'Viking', amount: 318, date: d(-6), dueDate: d(8), status: 'unpaid', reference: 'VK-55120',
        files: await attach('viking-invoice.svg', { kind: 'INVOICE VK-55120', shop: 'VIKING', sub: 'Office supplies', date: GU.util.fmtDate(d(-6)), lines: [['Mesh office chair x2', '265.00'], ['VAT', '53.00']], total: '£318.00', foot: 'Bill to: Acme Care Ltd' }) }),
      P({ kind: 'receipt', context: 'work', payer: 'company', title: 'First aid kits', party: 'St John Ambulance', amount: 64.8, date: d(-20) }),
      P({ kind: 'invoice-in', context: 'home', title: 'Boiler repair', party: 'Hart & Sons Plumbing', amount: 180, date: d(-10), dueDate: d(4), status: 'unpaid', reference: 'HS-2231', category: 'Housing',
        files: await attach('hart-invoice.svg', { kind: 'INVOICE HS-2231', shop: 'HART & SONS PLUMBING', sub: 'Gas Safe reg. 512345', date: GU.util.fmtDate(d(-10)), lines: [['Call-out', '60.00'], ['Replace diverter valve', '120.00']], total: '£180.00', foot: 'Payment due within 14 days' }) }),
      P({ kind: 'invoice-in', context: 'home', title: 'Self assessment 2025/26', party: 'Clarke Accountancy', amount: 240, date: d(-36), dueDate: d(-6), status: 'unpaid', reference: 'CA-1093', category: 'Fees & charges' }),
      P({ kind: 'invoice-in', context: 'home', title: 'Kitchen sockets', party: 'Spark Electrical', amount: 95, date: d(-40), dueDate: d(-26), status: 'paid', paidDate: d(-33), reference: 'SE-772', category: 'Housing' }),
      // Your own side work: invoices you send are Home (Owed to you), not Work.
      P({ kind: 'invoice-out', context: 'home', title: 'Website redesign', party: 'Bloom Bakery', amount: 650, date: d(-40), dueDate: d(-10), status: 'unpaid', reference: 'INV-0042' }),
      P({ kind: 'invoice-out', context: 'home', title: 'Logo refresh', party: 'Kite Cycles', amount: 300, date: d(-48), dueDate: d(-18), status: 'paid', paidDate: d(-20), reference: 'INV-0041' }),
      P({ kind: 'warranty', context: 'home', title: 'Dyson V11 vacuum', party: 'Dyson', amount: 399.99, date: d(-710), warrantyUntil: d(20), warrantyMonths: 24, reference: 'DY-V11-55821', notes: 'Two-year guarantee, registered online.' }),
      // More warranties, so the Warranties page shows every state: ends in about four months, in about two years, ended last month, and no end date yet.
      P({ kind: 'warranty', context: 'home', title: 'Bosch dishwasher', party: 'AO.com', amount: 429, date: addMonths(d(122), -24), warrantyUntil: addMonths(addMonths(d(122), -24), 24), warrantyMonths: 24, reference: 'SMS4HVI45G-FD2210', notes: 'Two-year parts and labour.',
        files: await attach('bosch-warranty-card.svg', { kind: 'WARRANTY CARD', shop: 'BOSCH', sub: 'Home appliances guarantee', date: GU.util.fmtDate(addMonths(d(122), -24)), lines: [['SMS4HVI45G dishwasher', '429.00'], ['Parts and labour', '2 YEARS']], total: '£429.00', foot: 'Keep with your proof of purchase' }) }),
      P({ kind: 'warranty', context: 'home', title: 'Worcester Bosch boiler', party: 'Hart & Sons Plumbing', amount: 2450, date: addMonths(d(730), -60), warrantyUntil: addMonths(addMonths(d(730), -60), 60), warrantyMonths: 60, reference: 'WB-GR-0042', notes: 'Five-year guarantee, registered with the maker. Needs a service every year to stay valid.',
        files: await attach('boiler-guarantee.svg', { kind: 'GUARANTEE', shop: 'WORCESTER BOSCH', sub: 'Greenstar boiler', date: GU.util.fmtDate(addMonths(d(730), -60)), lines: [['Greenstar 4000', '2450.00'], ['Guarantee', '5 YEARS']], total: '£2,450.00', foot: 'Annual service required' }) }),
      P({ kind: 'warranty', context: 'home', title: 'AirPods Pro', party: 'Apple', amount: 229, date: addMonths(d(-35), -12), warrantyUntil: addMonths(addMonths(d(-35), -12), 12), warrantyMonths: 12, reference: 'GX7K2LQ9N7' }),
      P({ kind: 'warranty', context: 'home', title: 'Kenwood stand mixer', party: 'John Lewis', amount: 189, date: d(-95), notes: 'The guarantee card is in the box. I haven’t found the end date yet.' }),
      P({ kind: 'warranty', context: 'work', payer: 'company', title: 'Work laptop (AppleCare+)', party: 'Apple', amount: 1199, date: d(-300), warrantyUntil: d(430) }),
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
      DOC({ title: 'Freelance agreement with Bloom Bakery', type: 'Contract or agreement', holder: 'Bloom Bakery', issueDate: d(-120), expiryDate: d(50), context: 'home', notes: '30 days’ notice either side. Day rate £300.' }),
      // Acme's own papers live in Work › Contracts & documents.
      DOC({ title: 'Employers’ liability insurance', type: 'Insurance policy', holder: 'Acme Care Ltd', reference: 'EL-2209184', expiryDate: d(48), location: 'Office filing cabinet', context: 'work' }),
      DOC({ title: 'Lease for the new office', type: 'Contract or agreement', holder: 'Acme Care Ltd', issueDate: d(-20), expiryDate: d(1075), location: 'Scanned', context: 'work', notes: 'Three months’ notice. Rent reviewed every year.' }),
    ];
    // The last three months' statements and payslips, so the evidence pack (Home › Tax year › Evidence pack) has something to gather.
    // Earlier months are left out on purpose, so its preview shows what a gap looks like.
    for (let k = -3; k <= -1; k++) {
      const first = addMonths(t.slice(0, 8) + '01', k);
      const last = addDays(addMonths(first, 1), -1);
      const shortD = (x) => GU.util.fmtDate(x, { short: true });
      const label = monthLabel(first.slice(0, 7), true);
      documents.push(
        DOC({ title: 'Monzo statement ' + shortD(first) + ' to ' + shortD(last), type: 'Bank, savings and pension', location: 'Uploaded', issueDate: last, statementBatch: 'imp-demo-' + first.slice(0, 7),
          files: await attach('monzo-statement-' + first.slice(0, 7) + '.svg', { kind: 'STATEMENT', shop: 'MONZO', sub: 'Current account', date: shortD(first) + ' to ' + shortD(last), lines: [['Statement period', shortD(first) + ' to ' + shortD(last)]], total: 'Example statement', foot: 'Made up for the examples' }) }),
        DOC({ title: 'Payslip ' + label, type: 'Employment and payslips', holder: 'Me', issueDate: first.slice(0, 8) + '25', location: 'Scanned',
          files: await attach('payslip-' + first.slice(0, 7) + '.svg', { kind: 'PAYSLIP', shop: 'ACME CARE LTD', sub: label, date: GU.util.fmtDate(first.slice(0, 8) + '25'), lines: [['Employer', 'Acme Care Ltd'], ['Net pay', '2,850.00']], total: '£2,850.00', foot: 'Made up for the examples' }) }),
      );
    }
    const officeFolder = { id: 'wf-demo-office', area: 'projects', name: 'Office move', created: d(-20), demo: true };
    const projects = [
      { id: 'pj-' + uid(), name: 'Move to the new office', client: 'Acme Care', status: 'Booked', start: d(12), deadline: d(55), workFolder: officeFolder.id, notes: 'Book the van, and tell suppliers and the bank the new address.', files: [], created: d(-14), demo: true },
      { id: 'pj-' + uid(), name: 'New staff rota', client: 'Acme Care', status: 'In progress', start: d(-9), deadline: d(6), notes: 'Everyone on the rota app by the end of the month.', files: [], created: d(-20), demo: true },
      { id: 'pj-' + uid(), name: 'Get ready for the next inspection', status: 'Idea', notes: 'Training records and policies in one folder.', files: [], created: d(-5), demo: true },
      // Jobs at home (Home › Home projects), marked as home.
      { id: 'pj-' + uid(), context: 'home', name: 'Paint the garage', client: 'Dad', status: 'In progress', start: d(-3), deadline: d(9), value: 150, notes: 'Two coats of masonry paint, doors last. Dad has the ladder.', files: [], created: d(-6), demo: true },
      { id: 'pj-' + uid(), context: 'home', name: 'Fix the garden gate', client: 'Gran', status: 'Booked', start: d(16), deadline: d(24), value: 60, notes: 'New hinges and a latch from the hardware shop.', files: [], created: d(-2), demo: true },
    ];
    // Ideas to save for: your own, in Home › Plans. (What the business wants you to get is in Work › To buy.)
    const idea = (o) => Object.assign({ id: 'ci-' + uid(), context: 'home', status: 'open', files: [], demo: true }, o);
    const costIdeas = [
      idea({ name: 'New laptop', cost: 1200, priority: 'must', wantBy: d(75), notes: 'The old one is slowing down.', created: d(-6) }),
      idea({ name: 'Weekend in Lisbon', cost: 450, priority: 'could', wantBy: d(120), created: d(-3) }),
    ];
    const workNotes = [
      { id: 'wn-' + uid(), area: 'projects', folder: officeFolder.id, title: 'Call with the landlord', body: 'Keys on the 1st. Two parking spaces.\nSend the signed lease back by Friday.', created: d(-3), updated: d(-3), demo: true },
    ];

    const lists = store.state.todoLists;
    const L = (re) => (lists.find((l) => re.test(l.name)) || lists[0] || {}).id;
    const workList = (GU.parts && GU.parts.workListId(store.state)) || 'list-work';
    const K = (o) => Object.assign({ id: 'k-' + uid(), priority: 'normal', notes: '', done: false, due: '' }, D, o);
    const tasks = [
      K({ title: 'Book passport photos', due: d(1), listId: L(/admin/i), priority: 'high' }),
      K({ title: 'Call Octopus about the meter reading', due: d(-2), listId: L(/admin/i) }),
      K({ title: 'Pay Clarke Accountancy invoice', due: d(-1), listId: L(/admin/i), priority: 'high' }),
      K({ title: 'Chase Bloom Bakery for invoice INV-0042', due: t, listId: L(/admin/i), priority: 'high' }),
      K({ title: 'Update the staff rota for half term', due: d(-1), listId: workList, context: 'work', priority: 'high' }),
      K({ title: 'Order chairs for the new office', due: d(2), listId: workList, context: 'work' }),
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
          date: t, due_date: d(18), expiry_date: null, reference: null, context: 'home', category: 'Family & kids', document_type: null, frequency: null, paid: false, section_id: null,
          new_section_name: 'Kids & school', task_title: 'Pay £35 and sign consent slip for school trip', task_due: d(16), notes: null, via: 'offline' } }, D),
    ];
    const byTitle = (title) => (paperwork.find((p) => p.title === title) || {}).id;
    // Things the business has asked you to get (Work › To buy), with what they come to: several to order (one with no price yet),
    // one on its way, and one bought (its receipt is the lunch claim above). The price is for one; qty × price is the line.
    const ask = (o) => Object.assign({ id: 'rq-' + uid(), note: '', link: '', estimate: null, priceEach: true, qty: 1, askedDate: t, needBy: '', payer: 'me', status: 'asked', orderedDate: '', boughtDate: '', paperId: '' }, D, o);
    const requests = [
      ask({ title: 'Printer toner', note: 'The black XL one for the office printer.', estimate: 35, askedDate: d(-2), needBy: d(2) }),
      ask({ title: 'Nitrile gloves', note: 'Medium, two boxes.', estimate: 12, qty: 2, askedDate: d(-1), needBy: d(8), link: 'https://www.example.com/products/nitrile-gloves-medium-100-pack' }),
      ask({ title: 'Fire exit signs', note: 'Going on the company card.', estimate: 14, qty: 2, askedDate: d(-1), needBy: d(15), payer: 'company' }),
      ask({ title: 'Sign-in tablet for reception', note: 'For visitors to sign in. The business is buying it.', estimate: 350, askedDate: d(-4), needBy: d(40), payer: 'company' }),
      ask({ title: 'First aid course', note: 'I’ll book it and claim it back.', estimate: 95, askedDate: d(-2), needBy: d(25) }),
      ask({ title: 'Label printer', askedDate: d(-2) }),
      ask({ title: 'Cleaning supplies for the new office', estimate: 64, askedDate: d(-6), needBy: d(5), status: 'ordered', orderedDate: d(-3) }),
      ask({ title: 'Lunch for the training day', estimate: 20, askedDate: d(-5), needBy: d(-2), status: 'bought', boughtDate: d(-2), paperId: byTitle('Lunch for the training day') }),
    ];
    const filedLog = [
      Object.assign({ id: 'log-' + uid(), date: d(-2), summary: 'Receipt from Pret A Manger for lunch on the training day, £18.45. You paid, so it’s in Get paid back.', title: 'Lunch for the training day', label: 'Work › Get paid back', tab: 'work-back', ref: { c: 'paperwork', id: byTitle('Lunch for the training day') }, via: 'offline' }, D),
      Object.assign({ id: 'log-' + uid(), date: d(-4), summary: 'Receipt from Tesco for your weekly shop, £64.20.', title: 'Weekly shop', label: 'Home › Receipts', tab: 'receipts', ref: { c: 'paperwork', id: byTitle('Weekly shop') }, via: 'offline' }, D),
      Object.assign({ id: 'log-' + uid(), date: d(-10), summary: 'Invoice from Hart & Sons Plumbing for a boiler repair, £180.00, due in 14 days.', title: 'Boiler repair', label: 'Home › Receipts', tab: 'receipts', ref: { c: 'paperwork', id: byTitle('Boiler repair') }, via: 'offline' }, D),
      Object.assign({ id: 'log-' + uid(), date: d(-30), summary: 'Your MOT certificate. I started a Car category for it.', title: 'MOT certificate', label: 'Car', tab: 's-' + carId, ref: { c: 'sectionItems', id: sectionItems[0].id }, via: 'offline' }, D),
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
      s.tasks.push(...tasks);
      s.projects.push(...projects);
      s.workFolders.push(officeFolder);
      s.workNotes.push(...workNotes);
      s.costIdeas.push(...costIdeas);
      s.requests = (s.requests || []).concat(requests);
      s.sections.push(...sections);
      s.sectionItems.push(...sectionItems);
      s.inbox.push(...inbox);
      s.filedLog.unshift(...filedLog);
      if (!Object.keys(s.settings.budgets).length) {
        s.settings.budgets = { Groceries: 320, 'Eating out': 120, Shopping: 90, Transport: 140 };
        s.meta.demoBudgets = true;
      }
      if (!s.todoLists.some((l) => l.id === workList)) s.todoLists.push({ id: workList, name: 'Work' });
      // The example employer, unless you've set up your own. Marked demo so clearing the examples removes it.
      if (!s.settings.employer) {
        s.settings.employer = { name: 'Acme Care Ltd', short: 'Acme', about: 'Family business', match: ['acme care'], wageSource: salaryId, payInto: cur,
          repayDays: 10, nudgeDays: 3, chaseDays: 21, since: t, demo: true };
      }
      // The examples are already sorted into Home and Work, so the one-off re-sort has nothing to do. Cleared
      // with the examples, so it can still sort your own records later.
      if (!s.meta.refileV1) s.meta.refileV1 = { at: t, skipped: true, demo: true };
      // Other features add their own example records: GU.sample.extra.push(function (state, ctx) { ...state.xyz.push({ ...ctx.demo }) }).
      for (const fn of GU.sample.extra) {
        try {
          fn(s, { today: t, demo: D, addDays });
        } catch (e) {
          console.error(e);
        }
      }
    }, { history: false });
  }

  // 'visas' stays here so old examples that were loaded before the Visas page went can still be cleared.
  const COLLECTIONS = ['transactions', 'debts', 'bills', 'incomeSources', 'paperwork', 'documents', 'visas', 'tasks', 'sections', 'sectionItems', 'inbox', 'filedLog', 'projects', 'workFolders', 'workNotes', 'costIdeas', 'requests'];
  function clear(silent) {
    const s = store.state;
    const files = [];
    // Claims made later by an example work bill go with it.
    const demoBills = new Set((s.bills || []).filter((b) => b.demo).map((b) => b.id));
    const isDemo = (c, x) => x.demo || (c === 'paperwork' && x.billId && demoBills.has(x.billId));
    for (const c of COLLECTIONS) for (const x of s[c] || []) if (isDemo(c, x)) (x.files || []).forEach((f) => files.push(f.id));
    store.commit((st) => {
      for (const c of COLLECTIONS) st[c] = (st[c] || []).filter((x) => !isDemo(c, x));
      st.accounts = st.accounts.filter((a) => !a.demo || st.transactions.some((t) => t.account === a.id));
      if (!st.accounts.length) st.accounts.push({ id: 'acc-main', name: 'Current account' });
      if (st.meta.demoBudgets) {
        st.settings.budgets = {};
        delete st.meta.demoBudgets;
      }
      if (st.settings.employer && st.settings.employer.demo) st.settings.employer = null;
      if (st.meta.refileV1 && st.meta.refileV1.demo) delete st.meta.refileV1;
    }, { history: false });
    files.forEach((id) => GU.files.erase(id));
    if (silent) return;
    GU.ui.toast('Examples cleared. Everything you added yourself is still here.');
    // The one-off Home/Work re-sort waits while there are examples; with only your own records left, it can run.
    try {
      if (GU.refile && GU.refile.run) GU.refile.run();
    } catch (e) {
      console.error(e);
    }
  }

  GU.sample = { load, clear, extra: [] };
})();
