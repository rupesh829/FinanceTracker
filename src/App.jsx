import React, { useState, useEffect, useMemo } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
<<<<<<< HEAD
import { LineChart, Landmark, Wallet, X, Calendar , Sunset } from "lucide-react";
import InvestmentsPage from "./pages/InvestmentsPage.jsx";
import DebtsPage from "./pages/DebtsPage.jsx";
import SalaryPage from "./pages/SalaryPage.jsx";
import RetirementPage from "./pages/RetirementPage.jsx";
=======
import { LineChart, Landmark, Wallet, X, Calendar, Sunset } from "lucide-react";
import InvestmentsPage from "./pages/InvestmentsPage.jsx";
import DebtsPage from "./pages/DebtsPage.jsx";
import SalaryPage from "./pages/SalaryPage.jsx";
import RetirementPage from "./pages/RetirementPage.jsx";
>>>>>>> 5a88851 (Add Retirement page)
import { getTable } from "./api.js";
import { COLORS, sansFont, serifFont, fmt, nextDueDate, daysUntil } from "./styles.js";

const tabs = [
  { to: "/investments", label: "Investments", icon: LineChart },
  { to: "/debts", label: "Debt Tracker", icon: Landmark },
  { to: "/salary", label: "Salary Log", icon: Wallet },
  { to: "/retirement", label: "Retirement", icon: Sunset },
<<<<<<< HEAD
=======
  { to: "/retirement", label: "Retirement", icon: Sunset },
>>>>>>> 5a88851 (Add Retirement page)
];

const FREQ_MONTHS = { "Monthly": 1, "Quarterly": 3, "Annually": 12, "None": null };
const UPCOMING_WINDOW_DAYS = 14;

export default function App() {
  const [upcoming, setUpcoming] = useState([]);
  const [dismissed, setDismissed] = useState(false);

  // Lightweight fetch just to compute the "coming up" banner — independent
  // of whatever each page loads for itself, so this shows on every tab.
  useEffect(() => {
    (async () => {
      try {
        const [invRows, debtRows] = await Promise.all([getTable("Investments"), getTable("Debts")]);
        const events = [];

        invRows.forEach((inv) => {
          let history = [];
          try { history = inv.returnHistoryJSON ? JSON.parse(inv.returnHistoryJSON) : []; } catch (e) {}
          const freqMonths = FREQ_MONTHS[inv.returnFrequency];
          if (freqMonths && history.length > 0 && inv.purchaseDate) {
            const due = nextDueDate(inv.purchaseDate, freqMonths, inv.endDate);
            if (due) {
              const d = daysUntil(due);
              if (d >= 0 && d <= UPCOMING_WINDOW_DAYS) {
                const rate = [...history].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-1)[0]?.amount || 0;
                events.push({ label: `${inv.returnType} due — ${inv.name}`, detail: `${fmt(rate)} on ${due.toDateString().slice(4)}`, days: d });
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
          if (d.startDate && Number(d.emi) > 0) {
            const due = nextDueDate(d.startDate, 1, d.endDate);
            if (due) {
              const days = daysUntil(due);
              if (days >= 0 && days <= UPCOMING_WINDOW_DAYS) {
                events.push({ label: `EMI due — ${d.name}`, detail: `${fmt(Number(d.emi))} on ${due.toDateString().slice(4)}`, days });
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
      } catch (e) {
        // Silently skip the banner if Sheets isn't reachable — each page's
        // own error banner will already surface the connection issue.
      }
    })();
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 24px 0" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 4px", fontFamily: sansFont }}>
          Personal Finance
        </p>
        <h1 style={{ fontFamily: serifFont, fontSize: 30, fontWeight: 400, margin: "0 0 18px", color: COLORS.ink }}>
          Financial Overview
        </h1>

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

        <nav style={{ display: "flex", gap: 4, borderBottom: `2px solid ${COLORS.ink}` }}>
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
        <Route path="/" element={<Navigate to="/investments" replace />} />
        <Route path="/investments" element={<InvestmentsPage />} />
        <Route path="/debts" element={<DebtsPage />} />
        <Route path="/salary" element={<SalaryPage />} />
        <Route path="/retirement" element={<RetirementPage />} />
<<<<<<< HEAD
=======
        <Route path="/retirement" element={<RetirementPage />} />
>>>>>>> 5a88851 (Add Retirement page)
      </Routes>
    </div>
  );
}
