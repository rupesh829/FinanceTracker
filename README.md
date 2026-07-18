# Personal Finance Tracker

Three modules, one app: **Investments**, **Debt Tracker**, **Salary Log**. Data lives in a Google Sheet you control; the site itself is static and hosted on GitHub Pages.

## Architecture

```
GitHub Pages (static React site)
        │  fetch()
        ▼
Google Apps Script Web App  (acts as a tiny REST API)
        │
        ▼
Your Google Sheet  (5 tabs: Investments, Income, Debts, DebtPayments, Salary)
```

GitHub Pages can't write to Google Sheets directly (that needs OAuth). The Apps Script Web App solves this: it's deployed under your own Google account and reads/writes the Sheet on your behalf. Since only you will use this, it's deployed with "Execute as: me" — no login flow needed for the site itself.

---

## Part 1 — Set up the Google Sheet + Apps Script

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet. Name it something like "Finance Tracker Data."
2. In the sheet, go to **Extensions → Apps Script**.
3. Delete the placeholder code in `Code.gs`, and paste in the contents of `apps-script/Code.gs` from this project.
4. Click **Deploy → New deployment**.
5. Click the gear icon next to "Select type" and choose **Web app**.
6. Configure:
   - **Execute as:** Me
   - **Who has access:** Anyone (this makes the URL reachable from your GitHub Pages site — it's not discoverable/guessable, and only your own front end will know the URL, but treat the URL itself as a secret)
7. Click **Deploy**. Google will ask you to authorize the script — approve it (it's your own script acting on your own Sheet).
8. Copy the **Web app URL** it gives you (looks like `https://script.google.com/macros/s/AKfycb.../exec`). You'll need this in Part 2.

You don't need to pre-create the tabs (Investments, Income, Debts, DebtPayments, Salary) — the script creates each one automatically the first time the app saves data to it.

> **Note on "Anyone" access:** this doesn't mean anyone can find it — it means the URL itself isn't gated behind a Google login prompt. Nobody without the URL can reach it. If you want tighter security later, Apps Script also supports an API-key check inside `doGet`/`doPost` that we can add.

---

## Part 2 — Configure the front end

1. Open `src/api.js` in this project.
2. Replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the Web app URL from Part 1.

```js
export const API_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

That's the only code change needed to connect to your Sheet.

---

## Part 3 — Run it locally (optional, to test before deploying)

```bash
npm install
npm run dev
```

Visit the local URL it prints. Try adding an investment, a loan, or a W-2 entry — then check your Google Sheet; you should see the tabs populate.

---

## Part 4 — Deploy to GitHub Pages

1. Update `vite.config.js` — set `base` to match your GitHub repo name:

```js
export default defineConfig({
  plugins: [react()],
  base: '/your-repo-name/',
})
```

2. Create a new GitHub repo (public or private — Pages works with both on paid plans; public repos get Pages free).

3. Push this project:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

4. Install the deploy tool and deploy:

```bash
npm install
npm run deploy
```

This builds the site and pushes it to a `gh-pages` branch.

5. In your repo: **Settings → Pages → Source**, select the `gh-pages` branch, folder `/ (root)`.

6. Your app will be live at:

```
https://<your-username>.github.io/<your-repo-name>/
```

Accessible from any device, any browser — the data lives in your Google Sheet, not the browser, so it's the same data everywhere you open the link.

---

## Updating later

Whenever you change the code:

```bash
npm run deploy
```

That's it — no need to touch GitHub Pages settings again.

---

## Sheet structure reference

| Tab | Columns |
|---|---|
| **Investments** | id, name, assetClass, invested, currentValue, purchaseDate, endDate, returnFrequency, returnType, reinvestedFromId, returnHistoryJSON |
| **Income** | id, investmentId, type, amount, date, periodStart, periodEnd, source |
| **Debts** | id, name, lender, loanType, principal, apr, emi, startDate, endDate, notes |
| **DebtPayments** | id, debtId, date, amount, principal, interest, balanceAfter, source |
| **Salary** | id, year, employer, filingStatus, grossIncome, federalTax, stateTax, socialSecurityTax, medicareTax, retirement401k, otherDeductions, refundOrOwed, notes |

`returnHistoryJSON` stores the rent/dividend/interest rate-change history as a JSON string in one cell (Sheets rows are flat, so a nested array gets serialized). You generally won't need to edit these tabs by hand — the app manages them — but they're plain data if you ever want to.

## A note on the amortization + auto-income logic

Both the Investments and Debt Tracker pages regenerate their "auto" rows from scratch on every load, based on each holding/loan's schedule — this makes the numbers self-healing (if the schedule changes, past drift/errors get corrected automatically) rather than accumulating. Anything you log manually is preserved untouched. If you ever want to reset a holding's auto-generated history, just delete rows with `source = auto` for it directly in the Sheet — they'll regenerate correctly next load.
