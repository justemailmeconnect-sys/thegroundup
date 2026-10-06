# The Ground Up

A private personal assistant for your life admin. Throw anything at it (a photo of a receipt, a PDF invoice, a letter, a quick note) and it works out what it is, pulls out the details and files it in the right place. When something doesn't fit, it starts a new section for it.

Everything lives in your own browser. There is no server and no account, and nothing is uploaded anywhere unless you connect Claude to read your files for you.

## What's inside

| Tab | What it does |
| --- | --- |
| **Today** | Your daily briefing: one timeline of everything due (bills, invoices, tasks, visa appointments, document expiries, expected income), plus this month's money, things needing attention and things you're waiting on. Type a note or drop a file straight onto it. |
| **Inbox** | Throw anything here: files, photos, pasted text or whole folders (subfolders included). The assistant reads each item, files it automatically when it's sure (with undo) and keeps the rest for you to check, with a **File all** button for big batches. Your folder names help: things in a "Car" folder go to a Car section, things in "Work receipts" are tagged Work. |
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

## Amazon and other online orders

Online order invoices are filed as **paid invoices**, never as bills to pay, and are matched up by order number so nothing is filed twice.

- **Every order at once:** on Amazon go to *Your Account → Request your data*, choose *Your Orders*, and when the email arrives open the zip and drop the `Retail.OrderHistory` CSV into the Inbox (or use **Receipts → Import Amazon orders**). Each order from the last 3 years (you can change the date) becomes a paid invoice with its items, total and order number. Cancelled orders are skipped.
- **The invoice PDFs:** Amazon has no "download all" for personal accounts. Claude in Chrome can work through your orders while you're signed in and download each invoice. Drop all the PDFs into the Inbox in one go: each becomes its own record, or is attached to its order if you've already imported it.
- **A pasted list:** paste a table that starts with `Order Date,Order ID,Items,Total` into the Inbox and it imports the same way.

## Importing bank statements

Use **Bank → Import statements**, drop statements on the Bank tab, or drop them in the Inbox. You can import one file, several, or a whole folder at once; each statement is matched to an account by its bank.

| Bank | What works |
| --- | --- |
| **Monzo** | PDF statements (Pots are read separately and left out by default, since they mirror "Transfer to Pot" lines) and the CSV export from the app, including Monzo's own categories. |
| **Santander** | PDF statements, and the online banking download as .txt, Excel or Quicken. |
| **HSBC** | PDF statements, and the CSV download in both its current (Date, Type, Description, Amount, Balance, no header) and older layouts, or Excel. |
| Most others | PDF statements with a Date / Description / Money in / Money out / Balance table, CSV, Excel (.xls, .xlsx), Quicken (.qif) and Money (.ofx, .qfx). |

PDF statements are read on your device: the transaction table is found by its column headings, wrapped descriptions are joined back together, years are worked out from the statement period, and every line is checked against the statement's running balance (the import screen tells you if anything doesn't add up). If a PDF can't be read that way and Claude is connected, Claude can read it instead.

Anything you've already imported is skipped, money moved between your own accounts (for example Santander to Monzo) is marked as a transfer rather than spending, and a copy of each PDF can be kept in Important documents.

Live bank connections (Open Banking) need a small server and an account with a provider such as GoCardless Bank Account Data or TrueLayer, so they're not built in yet.

## Uploading folders

Every tab that holds files has a drop area with **Choose files** and **Choose a folder**: Receipts & invoices, Important documents, Bills, Bank, each visa application and each of your own sections. Files uploaded there stay in that tab; the assistant only reads them to fill in the details. Subfolders are kept as groups.

In the Inbox, your own folder organisation is used: upload a folder such as "My life" containing *Car*, *Receipts/Work*, *Passports*, *Bank statements* and *Schengen visa*, and each file goes where its folder says (a Car section, a work receipt, a Passport document, the statement importer, that visa application). Plain names like "2024" or "Scans" are ignored, and files with no labelled folder are sorted by what's in them.

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
js/statements.js      bank statements: PDF, CSV, Excel, Santander .txt, QIF and OFX
js/folders.js         using your own folder names to decide where files go
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
