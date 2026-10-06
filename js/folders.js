/* The Ground Up: using your own folder organisation.
   When you upload a folder with labelled subfolders ("Car", "Receipts", "Passports", "Bank statements"…),
   each file goes where its folder says, instead of being guessed from its contents. */
(function () {
  'use strict';
  const GU = window.GU;
  const store = GU.store;

  /* Folder names that don't say anything about where things belong. */
  const GENERIC = /^(life admin|admin|home admin|paperwork|personal|my stuff|important stuff|downloads?|documents and settings|my documents|desktop|new folder.*|untitled folder.*|scans?|scanned.*|photos?|pictures?|images?|camera roll|camera|dcim|files?|misc|miscellaneous|other|others|stuff|inbox|uploads?|onedrive|google drive|icloud drive|icloud|dropbox|archive|backups?|old|temp|tmp|done|to sort|sort|unsorted|everything|all|my files|\d{1,4}|\d{4}[-_ ]\d{1,2}|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*( \d{2,4})?|q[1-4]( \d{2,4})?)$/i;
  const meaningful = (name) => !!name && !GENERIC.test(name.trim());

  const DOC_TYPES = [
    [/passport/i, 'Passport'], [/licen[cs]e|identity|\bid\b|id card/i, 'ID card or driving licence'], [/residence|evisa|\bbrp\b/i, 'Residence permit or eVisa'],
    [/birth|marriage|death|certificates?/i, 'Birth, marriage or death certificate'], [/degree|diploma|qualification|education|school cert|transcript/i, 'Education and qualifications'],
    [/payslip|p60|p45|employment|contract of employment|job/i, 'Employment and payslips'], [/tax|hmrc|self.?assessment/i, 'Tax'], [/insurance|polic(y|ies)/i, 'Insurance policy'],
    [/tenancy|lease|mortgage|house|property|deeds?/i, 'Home and tenancy'], [/vehicle|v5c|logbook|\bmot\b/i, 'Vehicle'], [/medical|health|nhs|doctor|hospital/i, 'Medical and health'],
    [/pension|savings|isa\b/i, 'Bank, savings and pension'], [/\bwill\b|power of attorney|legal/i, 'Legal (will, power of attorney)'],
  ];

  /* What a folder name means. Returns null when the folder is just a container. */
  function meaning(name) {
    const n = String(name || '').trim();
    if (!meaningful(n)) return null;
    const low = n.toLowerCase();
    const sec = (store.state.sections || []).find((x) => x.name.toLowerCase() === low);
    if (sec) return { kind: 'section', sectionId: sec.id, name: sec.name, strong: true };
    if (/statement|^bank|\bbank\b|monzo|santander|hsbc|barclays|lloyds|natwest|nationwide|starling|revolut|halifax|first direct|credit card/i.test(n)) return { kind: 'statements', name: n, strong: true };
    if (/warrant|guarantee/i.test(n)) return { kind: 'paperwork', paperKind: 'warranty', name: n, strong: true };
    if (/receipt/i.test(n)) return { kind: 'paperwork', paperKind: 'receipt', name: n, strong: true };
    if (/invoice|bills?\b|utilit/i.test(n)) return { kind: 'paperwork', paperKind: 'invoice', name: n, strong: true };
    if (/visa|immigration|home office|ukvi|evisa|\bbrp\b|schengen/i.test(n)) {
      const v = store.state.visas.find((x) => [x.visaType, x.country].filter(Boolean).some((w) => w.toLowerCase().split(/[\s,]+/).some((p) => p.length > 3 && low.includes(p))));
      return { kind: 'visa', visaId: v ? v.id : null, name: n, strong: true };
    }
    const doc = DOC_TYPES.find(([re]) => re.test(n));
    if (doc || /important|documents?|records/i.test(n)) return { kind: 'documents', docType: doc ? doc[1] : null, name: n, strong: true };
    const topic = (GU.brain && GU.brain.TOPICS || []).find((x) => x.name.toLowerCase() === low || x.name.toLowerCase().split(' & ')[0] === low);
    if (topic) return { kind: 'section', sectionId: null, name: topic.name, strong: true };
    return { kind: 'section', sectionId: null, name: n.replace(/(^|\s)([a-z])/g, (m, a, b) => a + b.toUpperCase()), strong: false };
  }

  /* Splits a batch of files by their folders.
     If the upload has several subfolders, the folder you picked is just a container and the subfolders are the labels;
     if everything sits in one folder, that folder is the label. */
  function plan(files) {
    const paths = files.map((f) => GU.ui.pathOf(f).split('/'));
    // Decide once per top folder whether it is a label ("Car") or just a container ("Life admin").
    const rootIsLabel = {};
    for (const p of paths) {
      if (p.length < 2 || p[0] in rootIsLabel) continue;
      const m = meaning(p[0]);
      const hasSubs = paths.some((q) => q[0] === p[0] && q.length > 2);
      rootIsLabel[p[0]] = !!m && (m.strong || !hasSubs);
    }
    return files.map((file, i) => {
      const segs = paths[i].slice(0, -1);
      const labelled = segs.length && !rootIsLabel[segs[0]] ? segs.slice(1) : segs;
      let label = null;
      let rest = [];
      for (let k = 0; k < labelled.length; k++) {
        const m = meaning(labelled[k]);
        if (m) {
          label = m;
          rest = labelled.slice(k + 1).filter(meaningful);
          break;
        }
      }
      // Home / Work anywhere in the path is a strong hint for receipts and invoices.
      const context = segs.some((x) => /\bwork\b|business|office|company|clients?/i.test(x)) ? 'work' : segs.some((x) => /\bhome\b|household|personal/i.test(x)) ? 'home' : null;
      return { file, label, sub: rest.join(' › '), context };
    });
  }

  /* For uploads into a specific section: the subfolders below the folder you picked. */
  function subPath(file) {
    const segs = GU.ui.pathOf(file).split('/').slice(1, -1);
    return segs.filter(meaningful).join(' › ');
  }

  GU.folders = { plan, meaning, subPath, meaningful, DOC_TYPES };
})();
