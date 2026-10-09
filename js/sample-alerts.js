/* The Ground Up: example transactions that show the charge alerts (js/alerts.js). Two made-up companies in the example
   current account: a streaming subscription that went up in price three weeks ago, and a leisure club that took the
   same payment twice four days ago. Both are marked demo, so Clear examples removes them with everything else. The
   account's starting balance is moved by what they add up to, so the balance you see on Today stays as it was. */
(function () {
  'use strict';
  const GU = window.GU;
  const { uid, addMonths, round2 } = GU.util;

  GU.sample.extra.push(function (state, ctx) {
    const acct = (state.accounts || []).find((a) => a.id === 'acc-demo-current');
    if (!acct) return;
    const d = (n) => ctx.addDays(ctx.today, n);
    let added = 0;
    const add = (date, description, amount, category) => {
      if (date > ctx.today) return;
      state.transactions.push(Object.assign({ id: 't-' + uid(), account: acct.id, notes: '', source: 'import' }, ctx.demo, { date, description, amount, category }));
      added = round2(added + amount);
    };

    // A steady £9.99 a month for four months, then £11.99 from three weeks ago: about £24 a year more.
    const rose = d(-22);
    for (let k = 4; k >= 1; k--) add(addMonths(rose, -k), 'STREAMLY PLUS', -9.99, 'Subscriptions');
    add(rose, 'STREAMLY PLUS', -11.99, 'Subscriptions');

    // The same £24.00 taken twice on one day.
    add(d(-4), 'OAKWOOD LEISURE CLUB', -24, 'Entertainment');
    add(d(-4), 'OAKWOOD LEISURE CLUB', -24, 'Entertainment');

    // The balance on Today stays what it was.
    if (acct.balanceAnchor && added) acct.balanceAnchor.amount = round2(acct.balanceAnchor.amount - added);
    // Anything you did to an example alert before goes when the examples are loaded again.
    state.alertStates = (state.alertStates || []).filter((r) => !r.demo);
  });
})();
