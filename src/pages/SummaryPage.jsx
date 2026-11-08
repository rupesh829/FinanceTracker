import React, { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ReferenceLine } from "recharts";
import { LayoutDashboard } from "lucide-react";
import { getTable } from "../api.js";
import { useRate } from "../RateContext.jsx";
import {
  COLORS, sansFont, fmt, currentYearStr, parseAmount, selectStyle, sectionHeading, th, td, yearOf, toINR,
} from "../styles.js";

// Read-only rollup. Every figure is shown in INR: USD records are converted
// with the shared rate from the header (RateContext).
function salaryNetIncome(e) {
  const totalTax = (e.federalTax || 0) + (e.stateTax || 0) + (e.socialSecurityTax || 0) + (e.medicareTax || 0);
  return (e.grossIncome || 0) - totalTax - (e.retirement401k || 0) - (e.otherDeductions || 0);
}

export default function SummaryPage() {
  const { rate } = useRate();
  const [salary, setSalary] = useState([]);
  const [invIncome, setInvIncome] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [debtPayments, setDebtPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chartYear, setChartYear] = useState(currentYearStr());

  useEffect(() => {
    (async () => {
      try {
        const [salaryRows, incRows, expRows, inTransferRows, payRows] = await Promise.all([
          getTable("Salary"), getTable("Income"), getTable("Expenses"), getTable("IncomingTransfers"), getTable("DebtPayments"),
        ]);
        const num = parseAmount;
        const amt = (r) => ({ ...r, amount: num(r.amount), currency: r.currency || "INR" });
        setSalary(salaryRows.map((r) => ({ ...r, currency: r.currency || "INR", grossIncome: num(r.grossIncome), federalTax: num(r.federalTax), stateTax: num(r.stateTax), socialSecurityTax: num(r.socialSecurityTax), medicareTax: num(r.medicareTax), retirement401k: num(r.retirement401k), otherDeductions: num(r.otherDeductions) })));
        setInvIncome(incRows.map(amt));
        setExpenses(expRows.map(amt));
        setIncoming(inTransferRows.map(amt));
        setDebtPayments(payRows.map(amt));
      } catch (e) {
        setError("Couldn't load from Google Sheets. Check API_URL in src/api.js. " + e.message);
      } finally { setLoading(false); }
    })();
  }, []);

  const inr = (r, a = r.amount) => toINR(a, r.currency, rate);

  const availableYears = useMemo(() => {
    const set = new Set([
      ...salary.map((s) => s.year),
      ...invIncome.map((e) => yearOf(e.date)),
      ...expenses.map((e) => yearOf(e.date)),
      ...incoming.map((e) => yearOf(e.date)),
      ...debtPayments.map((e) => yearOf(e.date)),
    ].filter(Boolean));
    return Array.from(set).sort();
  }, [salary, invIncome, expenses, incoming, debtPayments]);

  const t = useMemo(() => {
    const sum = (list, f = (e) => inr(e)) => list.reduce((s, e) => s + f(e), 0);
    const inYear = (e) => yearOf(e.date) === chartYear;
    const salaryTotal = sum(salary.filter((s) => s.year === chartYear), (s) => inr(s, salaryNetIncome(s)));
    const invTotal = sum(invIncome.filter(inYear));
    const incomingTotal = sum(incoming.filter(inYear));
    const expTotal = sum(expenses.filter(inYear));
    const payTotal = sum(debtPayments.filter(inYear));
    const totalIncome = salaryTotal + invTotal + incomingTotal, totalExpense = expTotal + payTotal;
    return { salaryTotal, invTotal, incomingTotal, expTotal, payTotal, totalIncome, totalExpense, net: totalIncome - totalExpense };
  }, [salary, invIncome, expenses, incoming, debtPayments, chartYear, rate]);

  const monthly = useMemo(() => {
    const months = {};
    const bump = (e, key) => {
      if (yearOf(e.date) !== chartYear) return;
      const m = new Date(e.date).toLocaleString("en-US", { month: "short" });
      if (!months[m]) months[m] = { month: m, sortKey: e.date.slice(0, 7), "Investment Income": 0, "Incoming Transfers": 0, Expenses: 0, "Debt Payments": 0 };
      months[m][key] += inr(e);
    };
    invIncome.forEach((e) => bump(e, "Investment Income"));
    incoming.forEach((e) => bump(e, "Incoming Transfers"));
    expenses.forEach((e) => bump(e, "Expenses"));
    debtPayments.forEach((e) => bump(e, "Debt Payments"));
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((m) => ({
      ...m, net: m["Investment Income"] + m["Incoming Transfers"] - (m.Expenses + m["Debt Payments"]),
    }));
  }, [invIncome, incoming, expenses, debtPayments, chartYear, rate]);

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading summary…</div>;

  const cards = [
    { label: "Total income", value: fmt(t.totalIncome, "INR"), sub: `Salary ${fmt(t.salaryTotal, "INR")} · Investments ${fmt(t.invTotal, "INR")} · Transfers ${fmt(t.incomingTotal, "INR")}` },
    { label: "Total expenses", value: fmt(t.totalExpense, "INR"), sub: `Expenses ${fmt(t.expTotal, "INR")} · Debt payments ${fmt(t.payTotal, "INR")}` },
    { label: "Net", value: fmt(t.net, "INR"), color: t.net >= 0 ? COLORS.positive : COLORS.negative },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setError("")}>{error} (click to dismiss)</div>}

      <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, margin: "0 0 20px", display: "flex", alignItems: "center", gap: 6 }}>
        <LayoutDashboard size={14} /> Read-only rollup in INR. USD amounts are converted at ₹{rate} per $ (change it in the header).
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
        <select value={chartYear} onChange={(e) => setChartYear(e.target.value)} style={selectStyle}>
          {availableYears.length === 0 && <option value={chartYear}>{chartYear}</option>}
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <p style={{ fontFamily: sansFont, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 6px" }}>INR — {chartYear}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 8 }}>
        {cards.map((m, idx) => (
          <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
            <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
            <p style={{ fontSize: 24, margin: 0, fontWeight: 400, color: m.color || COLORS.ink }}>{m.value}</p>
            {m.sub && <p style={{ fontSize: 10, color: COLORS.muted, margin: "6px 0 0", fontFamily: sansFont }}>{m.sub}</p>}
          </div>
        ))}
      </div>
      <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, margin: "0 0 30px" }}>Salary is recorded per tax year (not per paycheck), so it's in the year totals but not in the monthly chart/table below.</p>

      <div style={{ marginBottom: 44 }}>
        <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Monthly cash flow — {chartYear}, INR</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={monthly}>
            <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
            <RTooltip formatter={(v) => fmt(v, "INR")} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Arial" }} />
            <ReferenceLine y={0} stroke={COLORS.ink} />
            <Bar dataKey="Investment Income" stackId="income" fill={COLORS.info} />
            <Bar dataKey="Incoming Transfers" stackId="income" fill={COLORS.positive} radius={[3, 3, 0, 0]} />
            <Bar dataKey="Expenses" stackId="expense" fill={COLORS.negative} />
            <Bar dataKey="Debt Payments" stackId="expense" fill={COLORS.gold} />
            <Line type="monotone" dataKey="net" name="Net" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
        {monthly.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, textAlign: "center" }}>No dated income/expense entries for {chartYear}.</p>}
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Month-by-month breakdown</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["Month", "Investment Income", "Incoming Transfers", "Expenses", "Debt Payments", "Net"].map((h, i) => <th key={i} style={th(i > 0 ? "right" : "left")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {monthly.map((m, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={td()}>{m.month}</td>
                <td style={td("right")}>{fmt(m["Investment Income"], "INR")}</td>
                <td style={td("right")}>{fmt(m["Incoming Transfers"], "INR")}</td>
                <td style={td("right")}>{fmt(m.Expenses, "INR")}</td>
                <td style={td("right")}>{fmt(m["Debt Payments"], "INR")}</td>
                <td style={{ ...td("right"), fontWeight: 700, color: m.net >= 0 ? COLORS.positive : COLORS.negative }}>{fmt(m.net, "INR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {monthly.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 10 }}>Nothing to show for this year yet.</p>}
      </div>
    </div>
  );
}
