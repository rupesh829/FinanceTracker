export const COLORS = {
  bg: "#F7F5EF",
  ink: "#22201B",
  muted: "#6B675C",
  line: "#D8D4C6",
  lineLight: "#EDEBE1",
  positive: "#0F6E56",
  negative: "#993C1D",
  info: "#185FA5",
  accent: "#534AB7",
  gold: "#854F0B",
};

// Asset classes are now a user-managed list (see AssetClasses sheet tab /
// InvestmentsPage "Manage classes"), so colors are assigned by cycling
// through a fixed palette based on list position rather than a static
// name->color map. Use colorForClass(name, orderedClassNames) instead of
// indexing a static object.
export const CLASS_PALETTE = [
  COLORS.positive, COLORS.info, COLORS.accent, COLORS.gold, COLORS.negative,
  "#3E7CB1", "#B1653E", "#5C8A3E", "#8A3E6E", "#3E8A80",
];
export function colorForClass(name, orderedClassNames) {
  const idx = (orderedClassNames || []).indexOf(name);
  return CLASS_PALETTE[idx >= 0 ? idx % CLASS_PALETTE.length : 0];
}

export const DEBT_COLORS = {
  "Mortgage": COLORS.positive,
  "Auto Loan": COLORS.info,
  "Student Loan": COLORS.accent,
  "Personal Loan": COLORS.gold,
  "Credit Card": COLORS.negative,
  "Other": COLORS.muted,
};

export const serifFont = "Georgia, 'Times New Roman', serif";
export const sansFont = "Arial, sans-serif";

// --- Currency support -------------------------------------------------
// Records (investments, debts, salary entries, transfers) each carry their
// own `currency` field ("INR" | "USD"). Amounts are never converted/summed
// across currencies — totals and charts are always computed per-currency
// and shown side by side. See CLAUDE.md "Currency handling" for the reasons.
export const CURRENCIES = ["INR", "USD"];
export const CURRENCY_SYMBOLS = { INR: "₹", USD: "$" };
export const CURRENCY_LOCALE = { INR: "en-IN", USD: "en-US" };

export const fmt = (n, currency = "INR") =>
  (CURRENCY_SYMBOLS[currency] || "₹") + Math.round(n || 0).toLocaleString(CURRENCY_LOCALE[currency] || "en-IN");

export const pct = (n) => (n >= 0 ? "+" : "") + (n || 0).toFixed(1) + "%";
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const yearOf = (dateStr) => (dateStr || "").slice(0, 4);
export const currentYearStr = () => new Date().getFullYear().toString();

// Generic comparator for the "Sort by" controls on list/table sections
// (holdings, loans, W-2 entries, transfers, expenses, etc). Handles numbers
// and strings/dates (ISO date strings sort correctly as strings).
export function compareValues(a, b) {
  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && a !== "" && b !== "") return an - bn;
  return String(a ?? "").localeCompare(String(b ?? ""));
}
export function sortRows(rows, field, direction = "asc") {
  const sorted = [...rows].sort((a, b) => compareValues(a[field], b[field]));
  return direction === "desc" ? sorted.reverse() : sorted;
}

// Manually editing the Google Sheet is supported, but two things commonly
// break it: (1) typing amounts with currency symbols/commas (e.g. "₹10,000")
// makes Number(x) return NaN, which every page falls back to 0 for — so the
// row silently stops counting toward totals; (2) leaving the `id` column
// blank breaks every foreign-key match (income->investment, payments->debt,
// log->recurring definition) since those all key off `id`. parseAmount()
// strips anything that isn't a digit/dot/minus before parsing, and
// splitValidRows() filters out + reports rows missing an id so they don't
// silently corrupt totals instead of just being invisible.
export function parseAmount(v) {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^0-9.-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}
export function splitValidRows(rows) {
  const valid = rows.filter((r) => r.id !== undefined && r.id !== null && String(r.id).trim() !== "");
  return { valid, skipped: rows.length - valid.length };
}

// Duplicate-entry guard: used before saving a *new* row (never on edit) to
// catch accidental double-adds like two "Chitty_Kiran" expenses. Not a hard
// block — callers should confirm() with the user, since legitimately having
// two entries with the same name is sometimes valid.
export function isDuplicateValue(list, field, value, excludeId) {
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  if (!norm(value)) return false;
  return list.some((item) => item.id !== excludeId && norm(item[field]) === norm(value));
}

// Shared "rate history" lookup: given a {date, amount} history array (sorted
// or not), returns whichever amount was in effect at dateObj — i.e. the most
// recent entry whose date is <= dateObj. This is the shared mechanism behind
// "change the value over time while preserving history" wherever it shows up:
// Investments' rent/dividend/interest rate, Debts' EMI/APR, and Expenses'
// recurring amount all use this instead of a single flat field, so a
// rate/amount change doesn't retroactively alter past auto-generated entries.
export function effectiveAmountAt(history, dateObj) {
  if (!history || history.length === 0) return 0;
  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  let amt = sorted[0].amount;
  for (const h of sorted) { if (new Date(h.date) <= dateObj) amt = h.amount; else break; }
  return amt;
}

export const inputStyle = {
  width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.ink}`,
  background: "#fff", fontSize: 13, fontFamily: sansFont, boxSizing: "border-box",
};
export const selectStyle = {
  fontFamily: "Arial", fontSize: 12, padding: "6px 8px", border: `1px solid ${COLORS.ink}`, background: COLORS.bg,
};
export const btnStyle = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontFamily: sansFont,
  padding: "7px 12px", border: `1px solid ${COLORS.ink}`, background: COLORS.ink, color: COLORS.bg, cursor: "pointer",
};
export const btnStyleGhost = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontFamily: sansFont,
  padding: "7px 12px", border: `1px solid ${COLORS.ink}`, background: "transparent", color: COLORS.ink, cursor: "pointer",
};
export const sectionHeading = {
  fontSize: 15, fontWeight: 400, fontFamily: sansFont, textTransform: "uppercase",
  letterSpacing: "0.08em", color: COLORS.muted, margin: 0,
};
export const th = (align = "left") => ({
  textAlign: align, padding: "8px 6px", color: COLORS.muted, fontWeight: 400,
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em",
});
export const td = (align = "left") => ({ padding: "10px 6px", textAlign: align });

// Adds N months to a date without JS's day-rollover drift (e.g. Jan 31 + 1mo
// silently becoming Mar 3, which compounds into wrong periods over time).
export function addMonthsClamped(dateStr, monthsToAdd) {
  const d = new Date(dateStr);
  const day = d.getDate();
  const totalMonthIndex = d.getMonth() + monthsToAdd;
  const targetYear = d.getFullYear() + Math.floor(totalMonthIndex / 12);
  const targetMonth = ((totalMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  return new Date(targetYear, targetMonth, Math.min(day, daysInTargetMonth));
}
export function addDays(dateObj, n) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + n);
  return d;
}
export function toISODate(d) { return d.toISOString().slice(0, 10); }
