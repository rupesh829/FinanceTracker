import React from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { LineChart, Landmark, Wallet } from "lucide-react";
import InvestmentsPage from "./pages/InvestmentsPage.jsx";
import DebtsPage from "./pages/DebtsPage.jsx";
import SalaryPage from "./pages/SalaryPage.jsx";
import { COLORS, sansFont, serifFont } from "./styles.js";

const tabs = [
  { to: "/investments", label: "Investments", icon: LineChart },
  { to: "/debts", label: "Debt Tracker", icon: Landmark },
  { to: "/salary", label: "Salary Log", icon: Wallet },
];

export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 24px 0" }}>
        <p style={{ fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 4px", fontFamily: sansFont }}>
          Personal Finance
        </p>
        <h1 style={{ fontFamily: serifFont, fontSize: 30, fontWeight: 400, margin: "0 0 18px", color: COLORS.ink }}>
          Financial Overview
        </h1>
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
      </Routes>
    </div>
  );
}
