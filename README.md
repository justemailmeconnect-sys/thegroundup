# The Ground Up

A private personal assistant for your life admin. Throw anything at it (a photo of a receipt, a PDF invoice, a letter, a quick note) and it works out what it is, pulls out the details and files it in the right place. When something doesn't fit, it starts a new section for it.

Everything lives in your own browser. There is no server and no account, and nothing is uploaded anywhere unless you connect Claude to read your files for you.

## What's inside

| Tab | What it does |
| --- | --- |
| **Home** | Where you stand and where you're heading: what's in each account now, then every payment coming in and going out (income, bills, debt payments, Klarna and PayPal instalments, invoices) day by day with the balance after each, the lowest point, the month-end figure and a warning before any account goes past its overdraft. Switch between the rest of this month, the next 30 days and next month. Tasks and deadlines follow, and you can type a note or drop a file straight onto it. |
| **Inbox** | Throw anything here: files, photos, pasted text or whole folders (subfolders included). The assistant reads each item, files it automatically when it's sure (with undo) and keeps the rest for you to check, with a **File all** button for big batches. Your folder names help: things in a "Car" folder go to a Car section, things in "Work receipts" are tagged Work. |
| **Bank** | Every transaction across your accounts, with each account's current balance and a balance-over-time chart. Import statements from any UK bank; categories are filled in automatically and learn from your corrections. |
| **Bills** | Regular payments with next due dates. Direct debits roll on by themselves; bills you pay by hand wait for you to mark them paid. Bills are also found in your bank statements for you (see below). |
| **Income** | The money you expect (salary, benefits, anything regular) with its next dates; past income is folded away underneath. |
| **Spending** | History: spending by category, monthly budgets with warnings, and your biggest payments. |
| **Debts** | Credit cards, loans, car finance, Klarna, PayPal Pay in 3, Monzo Flex, overdrafts and money owed to people. Your bank statements show what you're paying each one, so the balance left, monthly cost and debt-free date keep themselves up to date. |
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

## Planning ahead

The menu is grouped by what you need: **Home** and **Inbox**; money ahead (**Bills**, **Debts**, **Income**, **To-do**); paperwork (**Receipts**, **Documents**, **Visas**); and history (**Bank**, **Spending**).

Home starts from your balances (from your statements, or what you put in with **Update balances**) and adds everything expected from today: income on its next dates, bills, debt payments, every instalment of a payment schedule and unpaid invoices. Each account is followed separately, so if your income lands in one account and your bills leave another you'll see which one runs short and when.

**Payment schedules:** on the Debts tab, **Add a payment schedule** reads the list of upcoming payments from Klarna, PayPal Pay in 3, Clearpay and others, pasted as text or from screenshots (Claude reads screenshots when it's connected), and you tick the ones to keep. A section named after the lender (for example *Klarna*) with its payments listed under **Coming up** is used as the schedule directly, so it stays in step when that section is updated. Notes that name the paying bank put each instalment against that account.

**Keeping accounts right:** when you import statements, I warn you if a statement looks like it belongs to another bank or repeats what's already in another account. If statements did end up in the wrong account (or one account was imported twice under two names), the Bank tab offers to put it right in one tap, moving them across without counting anything twice. Deleting an account now deletes its transactions instead of quietly moving them, and **Settings → Bank accounts → Merge into…** joins two accounts that are really one.

## Balances and debts

**Account balances** come from the running balance printed on your statements (PDF, the Santander .txt export and HSBC's CSV all have one). Each account on the Bank tab shows its latest balance, how much overdraft is used or left, and how old the figures are. To match your banking apps right now, tap **Update balances** on Today or the Bank tab and type what each account holds (a minus for overdrawn). That figure becomes the starting point and every transaction you import after that date is added on top; it's also how to give a balance to files that don't carry one (Monzo's CSV export, Quicken, OFX). Today shows all your accounts at a glance and warns you when an account is overdrawn, near its overdraft limit, or hasn't had a statement for two weeks.

**Debts** work from what you tell me plus what your statements show:

- Add a debt by hand, or drop a credit card statement, loan or finance agreement, or a Klarna / Pay in 3 screenshot onto the Debts tab or the Inbox. I read the lender, balance, monthly payment, interest rate and payment date. A later statement from the same lender updates that debt instead of adding a new one.
- Payments to the lender are found in your bank transactions by name (KLARNA, PAYPAL PAYIN3, BARCLAYCARD, "Flex" on Monzo and around 25 other UK lenders; you can add your own names). They're labelled **Debt repayments** in your spending.
- **Left to pay** is the balance you gave me, less what you've paid since, plus interest if you gave me the rate, worked out only over days your statements cover. For a fixed-term loan or car finance with no current balance, it's the payments still to make.
- Regular payments to lenders you haven't added show up as **Payments that look like debts**, ready to track in one tap. Plans with no payments for two months are flagged as probably paid off.

## Bills found in your statements

After you import statements (and the first time there's a history to look at), I look for bills in it and add them to the Bills tab under **Found in your bank statements**:

- **Monthly:** a payment to the same company in 3 months in a row on the same day of the month, give or take 3 days for weekends and bank holidays. A month with no statement imported for that account doesn't count as a missed payment.
- **Weekly, fortnightly, every 4 weeks, quarterly or yearly:** payments at that steady spacing.
- **Left out:** anything that has stopped, everyday spending (groceries, eating out, travel, shopping), savings, transfers between your accounts, and debt payments, which live on the Debts tab. The same payment imported twice (two overlapping statements, or the same account under two names) only counts once.

Each one has **Keep**, **Not a bill** (removed and never suggested again), and under **⋯**, **It was a one-off**, **I've cancelled it** or **Change the details**. **Find bills in my statements** looks again at any time.

## Uploading folders

Every tab that holds files has a drop area with **Choose files** and **Choose a folder**: Receipts & invoices, Important documents, Bills, Bank, each visa application and each of your own sections. Files uploaded there stay in that tab; the assistant only reads them to fill in the details. Subfolders are kept as groups.

In the Inbox, your own folder organisation is used: upload a folder such as "My life" containing *Car*, *Receipts/Work*, *Passports*, *Bank statements*, *Debts* and *Schengen visa*, and each file goes where its folder says (a Car section, a work receipt, a Passport document, the statement importer, the Debts tab, that visa application). Plain names like "2024" or "Scans" are ignored, and files with no labelled folder are sorted by what's in them.

## Your data, sync and backups

- **Undo and Recently deleted:** every delete (a bill, debt, receipt, document, visa application, income, task, transaction, section item, a whole section or a bank account) shows **Undo** straight away and goes to **Settings → Recently deleted**, where it can be restored for 30 days on any of your devices. Attached files are only removed for good once those 30 days are up.
- **Downloading what you uploaded:** every row with files (receipts and invoices, documents, bills, debts, visa applications, your own sections and Inbox items) has a download button, as do the file viewer and each attachment in an edit form. One file downloads as itself; a record with several files downloads as one .zip named after it. On claude.ai you confirm each download first, and file types it can't save directly (such as HEIC photos) come inside a .zip. A file that hasn't synced to this device yet can be downloaded from the device that added it.

- **On claude.ai** (opened from your artifact link while signed in) everything syncs across your devices: open the same link on your phone, tablet or another computer and it's all there, and changes appear on your other devices within seconds. Records are kept in your own private space in the artifact's database (`data/users/<you>/`), which nobody else can read even if you share the link. Uploaded files are stored as artifact assets and downloaded to a device the first time you open them there. Word, Excel and HEIC photos can't be stored this way, so they stay on the device that added them. Your Anthropic API key is never synced. **Settings → Sync across your devices** shows the status.
- Each device also keeps a full copy in the browser (`localStorage` for records, IndexedDB for files), so it works offline and catches up when it reconnects. If the same thing is changed on two devices while one is offline, the device that reconnects keeps its version and adds anything new from the other.
- **Anywhere else** (opened as a file or from your own web host) data stays in that browser only. Use **Settings → Export backup** to move it: the backup is a single JSON file that includes your uploaded files, and **Restore from backup** brings everything back on any device.
- Clearing your browser's site data deletes everything, so keep a recent backup somewhere safe.

## Project layout

```
index.html            page shell and script order
css/styles.css        all styling (light and dark themes)
js/util.js            dates, money, CSV parsing
js/store.js           saving, file storage, backup and restore
js/sync.js            syncing records and files across your devices on claude.ai
js/finance.js         categories, auto-categorising rules, recurring dates, totals
js/ui.js              icons, dialogs, forms, attachments, toasts, menus
js/charts.js          monthly column chart, category bars and the balance line
js/agenda.js          the Today timeline, attention list and tab badges
js/brain.js           reading and filing: Claude, API key and offline readers
js/statements.js      bank statements: PDF, CSV, Excel, Santander .txt, QIF and OFX
js/folders.js         using your own folder names to decide where files go
js/debts.js           account balances, lenders, matching debt payments, payoff maths
js/recurring.js       finding regular bills in your bank statements
js/forecast.js        money ahead: income, bills, debts and instalments from today, per account
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
