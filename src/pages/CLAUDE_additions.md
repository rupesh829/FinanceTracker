
29. **USD→INR rate is a shared setting, not a per-record value.** `Settings` tab, row `id=usdInr`, edited in the App header, provided via `RateContext.jsx` (`useRate()`; call it only inside components). `toINR(amount, currency, rate)` in `styles.js`. Records keep their own currency; summaries, rollups and Retirement convert to INR. This supersedes decision #8 for summary-level totals only (per-currency blocks still exist on each page).

30. **Investments: active/inactive, retirement flag, closing amount.** `forRetirement` (default true) and `closingAmount` columns. A holding is inactive once `endDate < today`. Earned for an ended holding = closing amount + income − invested. Save failures now keep the form open and show the error in the form.

31. **Retirement Capital Portfolios = allocations of investments.** `RetirementAssets` rows are allocations: `investmentId` (blank = manual asset), `allocatedINR` (rupees), `roi` (planning growth, post-tax), `startYear/startMonth`, `pctJSON` (% per tier). One investment can have several allocations. The projection starts from each allocation's current estimated value. Ended holdings drop out; a future-ending holding that was reinvested leaves the pool at its end year. One-time corpus additions were removed.

32. **Shared frequencies.** `FREQ_MONTHS`/`FREQ_LABEL` in `styles.js` are the single source; App banner, Investments and Expenses read them.

33. **Backup/Restore** (`components/Backup.jsx`): exports/imports every tab listed in `ALL_TABS` as one JSON. Add any new tab there.

34. **Summary page extras.** Net worth (active investments − loan balances, INR) snapshotted monthly into `NetWorth` (ids like `nw-2026-11`; never use `YYYY-MM` ids, Sheets turns them into dates). `Budgets` tab (`id`=expense category, `monthly` INR) drives budget vs actual. Retirement page publishes a one-row `RetirementSummary` (`id=latest`) that Summary reads for the runway card. Debts has a "What-if payoff" modal (extra monthly / lump sum → interest and months saved).
