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

export const ASSET_COLORS = {
  "Real Estate": COLORS.positive,
  "Equity": COLORS.info,
  "Mutual Fund": COLORS.accent,
  "Fixed Deposit": COLORS.gold,
  "Crypto": COLORS.negative,
};

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

export const fmt = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
export const pct = (n) => (n >= 0 ? "+" : "") + (n || 0).toFixed(1) + "%";
export const todayStr = () => new Date().toISOString().slice(0, 10);

export const inputStyle = {
  width: "100%", padding: "8px 10px", border: `1px solid ${COLORS.ink}`,
  background: "#fff", fontSize: 13, fontFamily: sansFont, boxSizing: "border-box",
};
export const btnStyle = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontFamily: sansFont,
  padding: "7px 12px", border: `1px solid ${COLORS.ink}`, background: COLORS.ink, color: COLORS.bg, cursor: "pointer",
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
