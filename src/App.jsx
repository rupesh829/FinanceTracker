import React, { useState, useEffect } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { LineChart, Landmark, Wallet, X, Calendar, Sunset, BarChart3, ArrowLeftRight, Receipt } from "lucide-react";
import InvestmentsPage from "./pages/InvestmentsPage.jsx";
import DebtsPage from "./pages/DebtsPage.jsx";
import SalaryPage from "./pages/SalaryPage.jsx";
import SummaryPage from "./pages/SummaryPage.jsx";
import TransfersPage from "./pages/TransfersPage.jsx";
import ExpensesPage from "./pages/ExpensesPage.jsx";
import RetirementPage from "./pages/RetirementPage.jsx";
import Backup from "./components/Backup.jsx";
import { RateContext } from "./RateContext.jsx";
import { getTable, setTable } from "./api.js";
import { COLORS, sansFont, serifFont, fmt, nextDueDate, daysUntil, parseAmount, FREQ_MONTHS, inputStyle } from "./styles.js";

const tabs = [
  { to: "/summary", label: "Summary", icon: BarChart3 },
  { to: "/investments", label: "Investments", icon: LineChart },
  { to: "/debts", label: "Debt Tracker", icon: Landmark },
  { to: "/salary", label: "Salary Log", icon: Wallet },
  { to: "/transfers", label: "Transfers", icon: ArrowLeftRight },
  { to: "/expenses", label: "Expenses", icon: Receipt },
  { to: "/retirement", label: "Retirement", icon: Sunset },
];

const UPCOMING_WINDOW_DAYS = 14;
const latest = (hist) => (hist.length ? [...hist].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-1)[0].amount : 0);
const parseHist = (json) => { try { const h = json ? JSON.parse(json) : []; return Array.isArray(h) ? h : []; } catch (e) { return []; } };

export default function App() {
  const [upcoming, setUpcoming] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const [rate, setRateState] = useState(83);
  const [rateDraft, setRateDraft] = useState("83");
  const [rateMsg, setRateMsg] = useState("");

  const setRate = (v) => { setRateState(v); setRateDraft(String(v)); };

  useEffect(() => {
    (async () => {
      try {
        const rows = await getTable("Settings");
        const r = rows.find((x) => x.id === "usdInr");
        if (r && parseAmount(r.value) > 0) setRate(parseAmount(r.value));
      } catch (e) { /* keep default */ }
    })();
  }, []);

  const saveRate = async () => {
    const v = parseAmount(rateDraft);
    if (!(v > 0)) { setRateDraft(String(rate)); return; }
    setRateState(v);
    try { setRateMsg("Saving…"); await setTable("Settings", [{ id: "usdInr", value: v }]); setRateMsg("✓"); }
    catch (e) { setRateMsg("⚠ not saved"); }
    setTimeout(() => setRateMsg(""), 2000);
  };

  useEffect(() => {
    (async () => {
      try {
        const [invRows, debtRows] = await Promise.all([getTable("Investments"), getTable("Debts")]);
        const events = [];

        invRows.forEach((inv) => {
          const history = parseHist(inv.returnHistoryJSON);
          const cur = inv.currency || "INR";
          const freqMonths = FREQ_MONTHS[inv.returnFrequency];
          if (freqMonths && history.length > 0 && inv.purchaseDate) {
            const due = nextDueDate(inv.purchaseDate, freqMonths, inv.endDate);
            if (due) {
              const d = daysUntil(due);
              if (d >= 0 && d <= UPCOMING_WINDOW_DAYS) {
                events.push({ label: `${inv.returnType} due — ${inv.name}`, detail: `${fmt(latest(history), cur)} on ${due.toDateString().slice(4)}`, days: d });
              }
            }
          }
          if (inv.endDate) {
            const end = new Date(inv.endDate);
            const d = daysUntil(end);
            if (d >= 0 && d <= UPCOMING_WINDOW_DAYS) {
              const label = inv.assetClass === "Fixed Deposit" ? "matures" : "ends";
              events.push({ label: `${inv.name} ${label}`, detail: end.toDateString().slice(4), days: d });
            }
          }
        });

        debtRows.forEach((d) => {
          const hist = parseHist(d.emiHistoryJSON);
          const emi = hist.length ? latest(hist) : parseAmount(d.emi);
          const cur = d.currency || "INR";
          if (d.startDate && emi > 0) {
            const due = nextDueDate(d.startDate, 1, d.endDate);
            if (due) {
              const days = daysUntil(due);
              if (days >= 0 && days <= UPCOMING_WINDOW_DAYS) {
                events.push({ label: `EMI due — ${d.name}`, detail: `${fmt(emi, cur)} on ${due.toDateString().slice(4)}`, days });
              }
            }
          }
          if (d.endDate) {
            const end = new Date(d.endDate);
            const days = daysUntil(end);
            if (days >= 0 && days <= UPCOMING_WINDOW_DAYS) {
              events.push({ label: `${d.name} payoff date`, detail: end.toDateString().slice(4), days });
            }
          }
        });

        events.sort((a, b) => a.days - b.days);
        setUpcoming(events);
      } catch (e) { /* each page shows its own error */ }
    })();
  }, []);

  return (
    <RateContext.Provider value={{ rate, setRate }}>
      <div style={{ minHeight: "100vh", background: COLORS.bg }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 24px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <p style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 4px", fontFamily: sansFont }}>
                Personal Finance
              </p>
              <h1 style={{ fontFamily: serifFont, fontSize: 30, fontWeight: 400, margin: "0 0 18px", color: COLORS.ink }}>
                Financial Overview
              </h1>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <label style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, display: "flex", alignItems: "center", gap: 6 }}>
                1 USD = ₹
                <input type="number" step="0.01" value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} onBlur={saveRate}
                  onKeyDown={(e) => e.key === "Enter" && e.target.blur()} style={{ ...inputStyle, width: 80, padding: "4px 6px" }} />
                <span>{rateMsg}</span>
              </label>
              <Backup />
            </div>
          </div>

          {!dismissed && upcoming.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontFamily: sansFont, fontSize: 12, color: COLORS.ink, background: "#FBF3E3", border: `1px solid ${COLORS.gold}`, padding: "10px 14px", marginBottom: 16 }}>
              <Calendar size={15} style={{ color: COLORS.gold, marginTop: 1, flexShrink: 0 }} />
              <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
                {upcoming.map((e, i) => (
                  <span key={i}>
                    <strong>{e.days === 0 ? "Today" : e.days === 1 ? "Tomorrow" : `In ${e.days} days`}</strong> — {e.label} <span style={{ color: COLORS.muted }}>({e.detail})</span>
                  </span>
                ))}
              </div>
              <X size={14} style={{ cursor: "pointer", color: COLORS.muted, flexShrink: 0 }} onClick={() => setDismissed(true)} />
            </div>
          )}

          <nav style={{ display: "flex", flexWrap: "wrap", gap: 4, borderBottom: `2px solid ${COLORS.ink}` }}>
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                style={({ isActive }) => ({
                  display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", fontFamily: sansFont,
                  fontSize: 13, textDecoration: "none", color: isActive ? COLORS.bg : COLORS.ink,
                  background: isActive ? COLORS.ink : "transparent", border: `1px solid ${COLORS.ink}`,
                  borderBottom: isActive ? "none" : `1px solid ${COLORS.ink}`, marginBottom: -2,
                })}
              >
                <t.icon size={14} /> {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <Routes>
          <Route path="/" element={<Navigate to="/summary" replace />} />
          <Route path="/summary" element={<SummaryPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/investments" element={<InvestmentsPage />} />
          <Route path="/debts" element={<DebtsPage />} />
          <Route path="/salary" element={<SalaryPage />} />
          <Route path="/retirement" element={<RetirementPage />} />
        </Routes>
      </div>
    </RateContext.Provider>
  );
}
