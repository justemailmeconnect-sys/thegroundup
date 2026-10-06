# The Ground Up

A private personal assistant for your life admin. Throw anything at it (a photo of a receipt, a PDF invoice, a letter, a quick note) and it works out what it is, pulls out the details and files it in the right place. When something doesn't fit, it starts a new section for it.

Everything lives in your own browser. There is no server and no account, and nothing is uploaded anywhere unless you connect Claude to read your files for you.

## What's inside

| Tab | What it does |
| --- | --- |
| **Today** | Your daily briefing: one timeline of everything due (bills, invoices, tasks, visa appointments, document expiries, expected income), plus this month's money, things needing attention and things you're waiting on. Type a note or drop a file straight onto it. |
| **Inbox** | Throw anything here. The assistant reads each item, files it automatically when it's sure (with undo) and keeps the rest for you to check. |
| **Bank** | Every transaction across your accounts. Import CSV statements from any UK bank; categories are filled in automatically and learn from your corrections. |
| **Bills** | Regular payments with next due dates. Direct debits roll on by themselves; bills you pay by hand wait for you to mark them paid. |
| **In** (Incomings) | Money coming in, by source and month, plus regular income you expect (salary, retainers). |
| **Out** (Outgoings) | Spending by category, monthly budgets with warnings, and your biggest payments. |
| **Receipts** | Receipts, invoices you need to pay, invoices someone owes you, paid invoices and warranties, for home and for work, each with its photo or PDF. |
| **Documents** | Passports, licences, certificates, contracts and policies, with scans, where the original is kept, and reminders before anything expires. Reference numbers stay hidden until you tap Show. |
| **Visas** | Each application from planning to decision: stage, document checklist, appointments, notes and files, and a warning before an approved visa runs out. |
| **To-do** | Several lists, Today and Upcoming views, and quick add that understands "tomorrow", "on Friday" or "14 Nov". |
| **Your sections** | Extra drawers like Car, Pets or Kids & school, made by you or by the assistant when something doesn't fit anywhere else. |

## Running it

There's nothing to install or build.

- **On your computer:** download or clone this repository and open `index.html` in Chrome, Edge, Firefox or Safari. For the most reliable experience serve the folder instead, for example `python3 -m http.server 8000` and then open <http://localhost:8000>.
- **On the web:** host the folder anywhere that serves static files, such as GitHub Pages (Settings → Pages → deploy from this branch) or Netlify. Your data still stays in each browser you use it in.

The first time it opens it loads clearly marked example data so you can see how everything works. Press **Clear examples** on the banner (or in Settings) and anything you've added yourself is kept.

## How the assistant reads things

It picks the best reader available:

1. **Claude inside the Claude app.** When the app is opened as a Claude artifact, it reads your photos and documents with Claude through your Claude account. No setup.
2. **Claude with your own API key.** Anywhere else, add an Anthropic API key in Settings → *How your assistant reads things*. The key is stored only in your browser and sent only to Anthropic, together with the item being read. It uses `claude-opus-5-5` by default (changeable in Settings) and costs roughly a penny or two per item.
3. **Offline reader.** With neither, it reads text from PDFs and (optionally) photos on your own device and sorts them with keyword rules. Clear receipts, invoices and letters work well; messy photos less so.

It files an item automatically when it's confident and shows an Undo button; anything it's unsure about waits in the Inbox with buttons to file it, choose somewhere else or check the details first. If a letter asks you to do something by a date, it also adds a follow-up task.

## Importing bank statements

Download a statement from your online banking as a **CSV** file and either drop it in the Inbox or use **Bank → Import statement**. The importer guesses the date, description and amount columns (including banks with separate "paid in" and "paid out" columns, and files with no header row), shows a preview, and skips anything you've already imported. Transfers between your own accounts are left out of your in/out totals.

Live bank connections (Open Banking) need a small server and an account with a provider such as GoCardless Bank Account Data or TrueLayer, so they're not built in yet.

## Your data and backups

- Records are kept in the browser's `localStorage`; uploaded files are kept in IndexedDB. Large photos are scaled down to save space.
- Data does not sync between devices or browsers. Use **Settings → Export backup** regularly. The backup is a single JSON file that includes your uploaded files, and **Restore from backup** brings everything back on any device.
- Clearing your browser's site data deletes everything, so keep a recent backup somewhere safe.

## Project layout

```
index.html            page shell and script order
css/styles.css        all styling (light and dark themes)
js/util.js            dates, money, CSV parsing
js/store.js           saving, file storage, backup and restore
js/finance.js         categories, auto-categorising rules, recurring dates, totals
js/ui.js              icons, dialogs, forms, attachments, toasts, menus
js/charts.js          monthly column chart and category bars
js/agenda.js          the Today timeline, attention list and tab badges
js/brain.js           reading and filing: Claude, API key and offline readers
js/sample.js          example data
js/app.js             the icon rail, routing and redraws
js/tabs/*.js          one file per tab
```

No frameworks and no build step: plain HTML, CSS and JavaScript. PDF text is read with pdf.js, photo text with Tesseract.js and Claude is called through the official Anthropic SDK, all loaded from public CDNs only when needed.

## Ideas for next steps

- Encrypt everything stored in the browser with a passcode.
- Sync between your phone and computer.
- Live bank feeds through an Open Banking provider.
- Forward emails (receipts, letters) straight into the Inbox.
