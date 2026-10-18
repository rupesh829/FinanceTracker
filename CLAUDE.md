# CLAUDE.md — Project Context for Finance Tracker

This file exists so a future Claude session (or you) can pick up this project without re-explaining everything. If you're starting a new chat, paste this file's contents in, or upload it, before asking for changes.

## What this is

A personal finance web app with six modules: **Summary**, **Investments**, **Debt Tracker**, **Salary Log**, **Transfers**, **Expenses**. Single React app, static-hosted on GitHub Pages, data stored in a Google Sheet (via a Google Apps Script bridge acting as a REST API).

- **Live URL:** https://rupesh829.github.io/FinanceTracker/
- **GitHub repo:** (local path `/Users/nirup/git/finance-tracker`, pushed to GitHub under `rupesh829`)
- **Local project path:** `/Users/nirup/git/finance-tracker`

## Architecture

```
GitHub Pages (static React/Vite site)
        │  fetch()
        ▼
Google Apps Script Web App  (REST-ish bridge: GET/POST)
        │
        ▼
Google Sheet — 11 tabs: Investments, Income, Debts, DebtPayments, Salary, AssetClasses, Transfers,
                         RecurringExpenses, Expenses, RecurringIncoming, IncomingTransfers
```

- Front end: React + Vite + `react-router-dom` (HashRouter — required because GitHub Pages has no server-side rewrites) + `recharts` for charts + `lucide-react` for icons.
- Backend: `apps-script/Code.gs`, deployed as a Web App bound to the Google Sheet. `doGet(?sheet=X)` returns all rows of tab X as JSON. `doPost({sheet, rows})` **overwrites the entire tab** with the given rows (whole-table replace, not incremental — simplest model for a single-user tool, mirrors how the original in-page storage worked). Unchanged by the currency/transfers work below — it's already generic over sheet name, so no `.gs` edits were needed for the new tabs.
- `src/api.js` holds `API_URL` (the Apps Script deployment URL) and `getTable()`/`setTable()` — every page calls through these, nothing talks to Sheets directly.

## Key design decisions (read before changing core logic)

1. **Auto-generated income/payments are self-healing, not incremental.** Every page load (and every edit save), the code wipes all `source: "auto"` rows for investments/debts and regenerates them fresh from the schedule (rate history / amortization). Manually-logged entries (`source: "manual"`) are never touched. **Do not** change this to an incremental "append only if missing" model — that was the original bug (see History below) and caused runaway/incorrect totals.

2. **Rent/dividend/interest amounts are a history, not a single field.** `investment.returnHistory = [{date, amount}, ...]`. Each auto-generated period looks up whichever rate was in effect at that period's *start* date. This was added specifically because applying a *current* rate retroactively to historical months was silently inflating totals. Editing a holding lets you append a new `{date, amount}` — it never mutates past entries.

3. **Income/payment cycles are anniversary-based, not calendar-month-based.** A holding/loan that starts on the 15th generates periods like `7/15–8/14`, paid `8/15` — not aligned to calendar month boundaries. Implemented via `addMonthsClamped()` in `src/styles.js`, which manually computes target year/month/day instead of relying on JS `Date.setMonth()` (which silently drifts on month-end dates, e.g. Jan 31 + 1 month → Mar 3 in native JS).

4. **Only fully-completed periods are ever auto-logged** — the loop breaks if the computed pay date is after today (or after the holding/loan's `endDate`). No partial/in-progress period is ever included.

5. **Debt amortization** (`DebtsPage.jsx`, `generateDebtSchedule`): given `principal`, `apr`, `emi`, `startDate`, it walks month by month, computing `interest = balance * monthlyRate`, `principalPortion = min(emi - interest, balance)`, decrementing balance. Manual payments for a specific date override the auto-calculated amount for that date but the schedule is *replayed in order* so the running balance stays consistent either way. **Superseded/extended by decision #21** — this is now one of two supported loan structures, and `emi`/`apr` are now histories, not flat fields.

6. **Reinvestment double-counting fix:** an investment can have `reinvestedFromId` pointing at another investment's id. If set, that holding's `invested` amount is excluded from the portfolio-level "Total invested" card (still shown per-row, still counts toward current value/return) — this avoids double-counting capital that moved from one holding into another.

7. **`returnHistory` (an array) is stored as a JSON string in one Sheet cell** (`returnHistoryJSON` column), since Sheets rows are flat. Serialize/deserialize helpers are in `InvestmentsPage.jsx` (`serializeInv`/`deserializeInv`).

8. **Currency handling: tag, never convert.** Investments, debts, and salary entries each carry a `currency` field (`"INR"` or `"USD"`, list is `CURRENCIES` in `styles.js`). Totals, cards, and charts are always computed **per currency** and shown side by side (e.g. "INR holdings" / "USD holdings" as separate rows of summary cards) — amounts in different currencies are never summed or converted together anywhere in the app. This was a deliberate choice over auto-converting to a single display currency, to avoid baking in an exchange rate assumption that goes stale. Auto-generated income/payment rows inherit their `currency` from the parent investment/debt at generation time. `fmt(amount, currency)` in `styles.js` now takes a currency and picks the right symbol/locale — **always pass the record's currency explicitly**, don't rely on the INR default except for genuinely legacy/untagged rows. Legacy rows without a `currency` field are treated as `"INR"` on load (`row.currency || "INR"`).

9. **Currency conversions are their own log, not income/expense.** The new `Transfers` tab (`TransfersPage.jsx`) records USD↔INR (or any currency pair) conversions: `date, fromCurrency, toCurrency, amountSent, amountReceived, notes`. The exchange rate is **always derived** (`amountReceived / amountSent`), never entered directly — this captures the real rate actually received, including spread/fees, rather than a market quote. Transfers are purely a log; they do not feed into Investments/Debts/Salary totals or income (moving money between your own currencies isn't income).

10. **Asset classes are a user-managed list, not a hardcoded enum.** Stored in the `AssetClasses` sheet tab as `{id, name}` rows, seeded on first load (if the tab is empty) with the original five (`Real Estate, Equity, Mutual Fund, Fixed Deposit, Crypto`). Managed via "Manage asset classes" on the Investments page (add / rename / delete). Investments reference a class **by name string** (no id foreign key) for simplicity. Renaming cascades: every investment with the old name is updated to the new name in the same save. Deleting is blocked if any investment still uses that class (surfaced as an error banner) — no silent reassignment. Colors are no longer a static name→color map (`ASSET_COLORS` is gone); `colorForClass(name, orderedClassNames)` in `styles.js` cycles through a fixed palette (`CLASS_PALETTE`) based on the class's position in the current list, so new/renamed classes always get a stable-ish color without needing a code change. Debt "Loan Type" and Salary "Filing Status" were deliberately **left as static hardcoded lists** — only Asset Class was made user-editable, by request.

11. **Charts are year- and currency-filterable, not "show everything at once."** Investments' monthly income chart, Debts' monthly payments chart, Salary's by-year chart, and Transfers' volume/rate chart all have a year `<select>` (`"All years"` or a specific year) and, where currency is involved, a currency `<select>` (no "All" option here — you can't stack bars of two currencies meaningfully, so a currency must be chosen). These are separate from the `filterClass`/`filterCurrency` filters on the underlying data tables, which support "All" since a table just lists rows rather than summing them.

12. **Income/payment logs are on-demand, not rendered by default.** The Investments "Income log" and Debts "Payment log" tables (which can have hundreds of auto-generated rows) are collapsed behind a "Show log" toggle. When expanded, they show filter controls (date range, type/source/currency, and investment/loan) and only then compute+render the filtered table, capped at `LOG_CAP = 500` rows with a note if more match — narrow the filters to see the rest. This was purely a page-load-performance fix; the underlying data was already loaded into state regardless (needed for the auto-regeneration logic in decision #1), so nothing changed about *when* data is fetched, only when the big table is *rendered*. Salary's "W-2 log" was left always-visible since those entries are manual/few and don't have this problem.

## File map

```
finance-tracker/
  README.md                  ← full setup/deploy instructions (Google Sheet + Apps Script + GitHub Pages)
  apps-script/Code.gs         ← paste this into Apps Script editor (Extensions > Apps Script in the Sheet)
  vite.config.js              ← base path MUST match GitHub repo name exactly, case-sensitive
  src/
    api.js                    ← API_URL constant + getTable()/setTable()
    styles.js                 ← shared colors, CURRENCIES/fmt (currency-aware), colorForClass (dynamic asset-class colors), yearOf, addMonthsClamped (the date-drift fix), inputStyle/selectStyle/btnStyle
    App.jsx                   ← tab nav shell (Summary | Investments | Debt Tracker | Salary Log | Transfers | Expenses); "/" redirects to Summary
    components/Modal.jsx      ← shared modal (uses onMouseDown + target===currentTarget check — NOT onClick+stopPropagation, that was the original "modal closes when using a dropdown" bug)
    components/Field.jsx      ← shared labeled form field wrapper
    pages/SummaryPage.jsx     ← read-only rollup: income (Salary + Investment income + Incoming transfers) vs expenses (Expenses + Debt payments), by month/year/currency
    pages/InvestmentsPage.jsx ← also owns Asset Class CRUD (Manage asset classes modal)
    pages/DebtsPage.jsx       ← also owns loan structure (Amortizing/Fixed Term), processing fees, and closure/refinance tracking
    pages/SalaryPage.jsx
    pages/TransfersPage.jsx   ← USD↔INR (or any pair) currency conversion log
    pages/ExpensesPage.jsx    ← personal expenses (recurring + one-time) and incoming transfers from individuals
```

## History / bugs already fixed (don't reintroduce)

- **Modal closing on dropdown click:** was caused by `onClick={onClose}` on the overlay + `stopPropagation()` on the inner div — native `<select>` dropdowns can still bubble in ways that defeat this. Fixed with `onMouseDown` + `e.target === e.currentTarget` check instead. Any new modal should reuse `components/Modal.jsx` rather than reinvent this.
- **Date drift in recurring calculations:** native `Date.setMonth()` repeated in a loop silently rolls over on month-end dates (e.g. day 31 purchase date). Fixed via `addMonthsClamped()`. Always use this helper for any "N months from X" calculation — never call `.setMonth()` directly in a loop.
- **Rate applied retroactively:** see design decision #2 above.
- **Total invested double-counted reinvested capital:** see design decision #6.
- **Mixing currencies into one total:** don't. See design decision #8 — always compute per-currency, never sum/convert USD and INR together.

13. **Charts default to the current year, not "All years."** Every chart with a year selector (`chartYear`) initializes to `currentYearStr()` (from `styles.js`) rather than `"All"`. "All years" is still selectable — this only changes the default. If a chart looks empty right after load, it usually just means there's no data yet for the current year; switch the year dropdown to check.

14. **List/table sections have a "Sort by" control**, not a fixed sort order. Holdings (Investments), Loans (Debts), the W-2 log (Salary), the Transfer log (Transfers), and both expense/incoming tables (Expenses) each have a `sortField`/`sortDir` state pair and a small "Sort: X" dropdown + asc/desc toggle button next to their "Add" button. Sorting itself goes through `sortRows(rows, field, direction)` in `styles.js` — a generic comparator that numeric-sorts if both values parse as numbers, else falls back to string comparison (so ISO date strings like `startDate` sort correctly without special-casing).

15. **Rent/dividend/interest period math was off by one day — fixed.** `generateAutoEntries` in `InvestmentsPage.jsx` previously computed a period as anniversary(k-1) → anniversary(k)-1, paid on anniversary(k) itself — e.g. a holding anniversary'd on the 1st logged period `5/31–6/29`, paid `6/30`, instead of `6/1–6/30` paid `7/1`. Fixed by shifting both the period-start and pay-date anniversaries forward by one day before use (`addDays(addMonthsClamped(...), 1)`), so a period now runs the day *after* one anniversary through the next anniversary, paid the day after that. This only affected Investments' income entries (Rent/Dividend/Interest all go through the same function). Debts' EMI dates were not affected — they don't have a period concept, just a single `date` per payment, already correct.

16. **Google Sheets silently coerces numeric-looking id strings to numbers — normalized on read.** All ids (`id`, `investmentId`, `debtId`, `recurringId`) are generated as `Date.now().toString()`, a long digit string. Google Sheets' default "Automatic" cell format auto-detects these as numbers when written via `setValues`, so they come back from `getDataRange()` as JS numbers on the next load — even though they were written as strings. This silently broke any filter comparing such a field against a value from a `<select>` element (DOM `value`s are always strings), e.g. picking a specific investment in the Income log filter showed nothing, while "All" (a literal string, trivially matched) worked fine. Fixed centrally in `api.js`'s `getTable()`, which now normalizes every `ID_FIELDS` entry to a string right after fetch — nothing downstream needs to think about it. Filter comparisons in the pages also defensively wrap both sides in `String(...)` as a second line of defense. **If you add a new foreign-key-style id field to any table, add its name to `ID_FIELDS` in `api.js`.**

17. **New: Expenses page (`ExpensesPage.jsx`), tracking money going out (personal expenses) and money coming in from individuals (not currency conversion — see decision #9 for that).** Follows the same self-healing auto-regeneration pattern as Investments/Debts, applied to two independent pairs of sheet tabs:
    - `RecurringExpenses` (definitions: name, category, currency, amount, frequency, startDate, endDate, notes) → `Expenses` (log, auto-regenerated + manual, plus one-time expenses logged directly with no definition).
    - `RecurringIncoming` (definitions: person, category, currency, amount, frequency, startDate, endDate, notes) → `IncomingTransfers` (log, same pattern), for money received from a named individual (loan repayments, reimbursements, rent share, gifts).

    Unlike Investments' rent (paid in arrears — see decision #3), a recurring expense/incoming-transfer is due *on* the anniversary itself, so the generation loop starts at `k=0` instead of `k=1`. "One-time" is a `frequency` option that skips the recurring-definition step entirely — saving one just appends a single manual log row directly (`recurringId: ""`), it never creates a row in the `RecurringExpenses`/`RecurringIncoming` tabs. Totals, charts (by category, stacked), and logs follow the same per-currency / default-current-year / on-demand-log patterns as the rest of the app (decisions #8, #12, #13). This page intentionally does **not** feed into Investments/Debts/Salary totals, and is separate from the currency-conversion Transfers page (decision #9) — "Transfers" is currency↔currency, "Expenses" incoming-transfers is person↔you.

18. **Every list/table now has delete, and new entries are guarded against accidental duplicates.** Previously nothing in the app could be deleted or de-duplicated — easy to end up with two "Chitty_Kiran" recurring expenses with different amounts and no way to remove the wrong one. Fixed app-wide:
    - **Delete** (trash icon) exists on: Investments holdings (cascades to that investment's income entries) and manual income log rows; Debts loans (cascades to that loan's payments) and manual payment log rows; Salary W-2 entries; Transfers log rows; Expenses' recurring expense/incoming definitions (cascades to their log entries) and one-time expense/incoming entries. Auto-generated log rows (income, EMI payments, recurring expense/incoming occurrences) can't be deleted directly since they'd just regenerate on next load — delete the parent definition instead, or log a manual entry for that specific date to override it (existing pattern, see decisions #1/#5). Every delete asks `window.confirm()` first; cascading deletes say how many child rows will go with it.
    - **Duplicate guard**: before saving a *new* entry (never on edit), each page checks whether an entry with the same identifying field already exists (Investments: name; Debts: name; Salary: employer+year; Transfers: date+direction+amount; Expenses: name for expense defs, person for incoming defs, name+date for one-time expenses, person+date for one-time incoming) and asks via `window.confirm()` before proceeding — it's a nudge, not a hard block, since legitimately having two entries with the same name is sometimes valid. Implemented via `isDuplicateValue(list, field, value)` in `styles.js` for the simple single-field cases; combo checks (Salary, Transfers, one-time Expenses) are inline since they need more than one field.

19. **Added "Half Yearly" as a frequency option** everywhere a recurring frequency is chosen: Investments' return frequency (`FREQ_MONTHS`/`FREQ_LABEL` in `InvestmentsPage.jsx`) and Expenses' recurring frequency (`FREQUENCIES`/`FREQ_MONTHS` in `ExpensesPage.jsx`). Debts intentionally has no frequency selector — EMI schedules are always monthly by design (decision #5) — so there was nothing to add there. Salary and Transfers have no recurrence concept either.

20. **Manually editing the Google Sheet directly is supported, but two things silently broke it — both fixed.** (1) Typing an amount with a currency symbol or thousands separator (e.g. `₹10,000` or `1,00,000`) made `Number(x)` return `NaN`, which every page's old `Number(x) || 0` fallback turned into a silent `0` — this is almost certainly why a manually-entered Debts row showed `Total paid` as 0: a zeroed-out `principal` makes `generateDebtSchedule` bail out immediately (`principal <= 0`) and generate no payments at all. (2) Leaving the `id` column blank on a manually-added row breaks every foreign-key match (income→investment, payments→debt, log→recurring definition) since those all key off `id`. Both are now handled centrally in `styles.js`:
    - `parseAmount(v)` strips anything that isn't a digit/dot/minus before parsing, so formatted numbers parse correctly. Used everywhere a numeric field is read from a Sheet row or a form (replacing the old `Number(x) || 0` pattern throughout, including `SummaryPage.jsx`).
    - `splitValidRows(rows)` filters out rows missing a non-empty `id` and returns a skip count; every page's load effect uses this and shows a dismissible warning banner (distinct color from the error banner) naming how many rows were skipped, so a manual-entry mistake is visible instead of silently invisible.
    - **If you add data directly in the Sheet:** always give the row a unique `id` (any non-empty text works, e.g. a random string or a timestamp), and type amounts as plain numbers with no currency symbol or thousands separator.

21. **Debts support two loan structures, and EMI/APR are histories, not flat fields.** `debt.loanStructure` is `"Amortizing"` (default, original model) or `"Fixed Term"`. Fixed Term is for 0%-interest loans with a one-time processing fee and a fixed monthly payment for a set number of months, where the payments alone often don't fully retire the principal — see decision #23 for how the leftover balance gets cleared. Both structures now store `emiHistory`/`aprHistory` (`[{date, amount}, ...]`) instead of flat `emi`/`apr` fields, using the same effective-at-period-start lookup as Investments' `returnHistory` (see decision #22) — so a step-up EMI or a floating-rate change doesn't retroactively alter past auto-generated payments. `apr`/`aprHistory` are ignored (treated as 0%) whenever `loanStructure === "Fixed Term"`, regardless of what's stored. A one-time `processingFee` (any structure, not just Fixed Term) is auto-logged as a `source: "fee"` entry on the start date with `principal: 0, interest: fee` — it flows into "Total interest & fees paid" naturally, since for a 0%-APR loan the fee *is* the real cost of borrowing. Legacy rows with only flat `emi`/`apr` (pre-history) are seeded into a single-entry history on load in `deserializeDebt`, so old loans keep working unchanged.

22. **`effectiveAmountAt(history, dateObj)` is now shared in `styles.js`**, not duplicated per page. It's the one mechanism behind "change a recurring value over time without rewriting history" everywhere it shows up: Investments' rent/dividend/interest rate (`returnHistory`), Debts' EMI and APR (`emiHistory`/`aprHistory`, decision #21), and Expenses' recurring expense/incoming-transfer amount (`amountHistory`, e.g. a rent increase or subscription price change). All four follow the identical pattern: an array of `{date, amount}`, looked up by "whichever entry's date is the latest one `<=` the date in question," edited via an "Effective from / New amount" mini-form that *appends* rather than mutates, serialized to a `...HistoryJSON` string column since Sheet rows are flat (`serializeInv`/`serializeDebt`/`serializeDef`-equivalent helpers in each page). If a new page needs a value that can change over time while preserving past auto-generated entries, reuse this rather than inventing a new mechanism.

23. **Closing a loan (paid off early or refinanced) reuses the same `endDate`-triggers-a-final-payoff mechanism as a Fixed Term loan reaching its natural term end** (decision #21) — there's no separate "close" code path. Concretely: `debt.endDate` doubles as "the date this loan is fully done, one way or another." If a balance remains as of that date (checked after the normal payment loop, once per load), `generateDebtSchedule` auto-appends one `source: "closure"` entry for the full remaining balance — this is literally what a refinance or early payoff *is*: whatever's left becomes due in one lump sum. Two purely-metadata fields distinguish *why* a loan ended, for the badge shown on the loans table (`Closed — {closureReason}` vs. plain `Paid off` for a loan that amortized to zero on its own):
    - `closureReason`: `""` (default/unset) | `"Refinanced"` | `"Paid Off Early"` | `"Other"`. Only meaningful once `endDate` is set; cleared automatically if `endDate` is cleared (see `saveDebt`).
    - `refinancedFromId`: set on the **new** loan, pointing at the **old** one it replaces — mirrors Investments' `reinvestedFromId` direction/convention (decision #6) for consistency. Saving a loan with `refinancedFromId` set also cross-updates the *other* (old) loan in the same save: if it doesn't already have its own `endDate`/`closureReason`, it's stamped `closureReason: "Refinanced"` with `endDate` defaulting to the new loan's `startDate`. This keeps the link consistent both ways without a separate "close this loan" flow — closing/refinancing is just filling in fields on the normal Add/Edit Loan form. `refinancedFromId` is a Sheets round-trip id like any other, so it's included in `api.js`'s `ID_FIELDS` (decision #16) to avoid the same numeric-coercion bug. Note: unlike Investments' reinvestment exclusion (decision #6), a refinanced loan's principal is **not** excluded from the "Original principal" total — showing both the old and new loan's principal is considered accurate (you did borrow both amounts, sequentially), just don't be surprised if it looks like more than you actually owed at any one time; "Current balance" is unaffected either way since the old loan's balance goes to 0 on closure.

24. **New: Summary page (`SummaryPage.jsx`), a read-only rollup of the other pages, by month/year/currency.** Aggregates: Salary (net income, per tax year — no per-month date, so it's in the year totals but not the monthly chart/table), Investment income (`Income` sheet), Expenses, and Incoming Transfers (money from individuals) as "income" vs. "expense" — Debt payments count as an expense too. Never fetches from `Investments`/`Debts`/`AssetClasses`/etc. directly, only the *log* sheets that already have per-transaction dates and amounts, since those are what a cash-flow view needs. Like every other page: per-currency (no conversion, decision #8), year-selectable defaulting to the current year (decision #13), `parseAmount` throughout (decision #20). It has no forms, no `setTable` calls, and no delete/edit — purely `getTable` + aggregation; the person is directed back to the relevant page to change any underlying number. Wired as the default landing route (`"/"` → `/summary`) and the first tab, since it's the most useful "what's my overall picture" view.

## Known open items / possible next steps

- No CSV → Sheets import path yet for migrating pre-existing data the user had in the old in-page-storage version (that data was lost when the backend moved to Sheets, since it was a fresh start).
- No auth/secret on the Apps Script URL beyond obscurity (deployed as "Anyone" access, not password protected). Fine for personal single-user use; could add a shared-secret query param check in `Code.gs` if desired.
- Bundle size warning at build time (`index-*.js` ~630KB) — not urgent, but could code-split by route (`React.lazy` per page) if it ever matters.
- No automated tests.
- `Portfolio value over time` chart on the Investments page still uses static seed data (`seedHistory` in the original artifact version) — worth checking whether `InvestmentsPage.jsx` in the deployed project computes this from real data or still has a placeholder; if placeholder, that's a good next enhancement (derive from historical `currentValue` snapshots, which would need a new "valuation log" similar to the income log).
- CSV export only exists on the Investments page — Debts/Salary/Transfers/Expenses/Summary pages don't have an "Export CSV" button yet.
- Debt "Loan Type" and Salary "Filing Status" are still hardcoded lists (see decision #10) — only do the same editable-list treatment for these if explicitly asked, it was deliberately skipped.

## Deploy workflow reminder

```bash
cd /Users/nirup/git/finance-tracker
# after any code change:
git add .
git commit -m "description"
git push                # updates source on GitHub (main branch)
npm run deploy           # rebuilds + pushes static site to gh-pages branch — THIS is what makes it live
```

Editing files directly on github.com does **not** update the live site — `npm run deploy` must be run locally after any change that should go live.

25. **New: Retirement page (`RetirementPage.jsx`, seed data in `retirementSeed.js`).** A port of a standalone Vue retirement planner. Data is in four Sheet tabs, saved with the same whole-table `setTable` model after a 1.5s debounce: `RetirementConfig` (rows `id` = `family` / `inflation` / `tiers`, with `valueJSON` — JSON strings are used so Sheets can't coerce birth months like `1985-06` into dates), `RetirementExpenses` (parent/aggregate lines with timeline fields: `anchor` = whose age the start/end use [f/m/k1/k2], `startAtRet`, `endAtHorizon`, `every`, `active`), `RetirementItems` (itemized costs; `parentExpenseId` is in `ID_FIELDS`; an expense with any items is auto-linked and its amount is the sum of them), `RetirementAssets` (`targets` stored comma-separated). Ids are non-numeric strings (`e…`, `i…`, `a…`) so Sheets never coerces them. Ages are computed from birth month/year. Costs are in today's rupees and inflate from today; the ledger starts today by default (`family.ledgerFromToday`) so pre-retirement dated items (house, school fees) are counted. Amounts are INR-only and never mixed with the other pages' totals. First load with empty tabs seeds the template; "Restore template items" re-adds deleted template lines by name.
