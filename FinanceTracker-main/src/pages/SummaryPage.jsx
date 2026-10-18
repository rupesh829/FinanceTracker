import React, { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ReferenceLine } from "recharts";
import { LayoutDashboard } from "lucide-react";
import { getTable } from "../api.js";
import {
  COLORS, CURRENCIES, sansFont, fmt, currentYearStr, parseAmount, selectStyle, sectionHeading, th, td, yearOf,
} from "../styles.js";

// This page is read-only — it never writes anything back to any sheet, it
// just aggregates data that's already maintained on the other four pages:
// Salary (annual W-2 records — no per-month date, so it's shown as a
// year-level figure, not part of the monthly chart), Income (investment
// rent/dividend/interest, dated), Expenses (dated), IncomingTransfers
// (dated), and DebtPayments (dated). "Income" here = Salary net + investment
// income + incoming transfers from individuals. "Expenses" = Expenses log +
// debt payments. Never summed/converted across currencies — pick one at a
// time, same as everywhere else in this app.
function salaryNetIncome(e) {
  const totalTax = (e.federalTax || 0) + (e.stateTax || 0) + (e.socialSecurityTax || 0) + (e.medicareTax || 0);
  return (e.grossIncome || 0) - totalTax - (e.retirement401k || 0) - (e.otherDeductions || 0);
}

export default function SummaryPage() {
  const [salary, setSalary] = useState([]);
  const [invIncome, setInvIncome] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [debtPayments, setDebtPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chartYear, setChartYear] = useState(currentYearStr());
  const [chartCurrency, setChartCurrency] = useState("INR");

  useEffect(() => {
    (async () => {
      try {
        const [salaryRows, incRows, expRows, inTransferRows, payRows] = await Promise.all([
          getTable("Salary"), getTable("Income"), getTable("Expenses"), getTable("IncomingTransfers"), getTable("DebtPayments"),
        ]);
        const num = parseAmount;
        const loadedSalary = salaryRows.map((r) => ({ ...r, currency: r.currency || "INR", grossIncome: num(r.grossIncome), federalTax: num(r.federalTax), stateTax: num(r.stateTax), socialSecurityTax: num(r.socialSecurityTax), medicareTax: num(r.medicareTax), retirement401k: num(r.retirement401k), otherDeductions: num(r.otherDeductions) }));
        const loadedInc = incRows.map((r) => ({ ...r, amount: num(r.amount), currency: r.currency || "INR" }));
        const loadedExp = expRows.map((r) => ({ ...r, amount: num(r.amount), currency: r.currency || "INR" }));
        const loadedIncoming = inTransferRows.map((r) => ({ ...r, amount: num(r.amount), currency: r.currency || "INR" }));
        const loadedPayments = payRows.map((r) => ({ ...r, amount: num(r.amount), currency: r.currency || "INR" }));

        setSalary(loadedSalary);
        setInvIncome(loadedInc);
        setExpenses(loadedExp);
        setIncoming(loadedIncoming);
        setDebtPayments(loadedPayments);

        const present = CURRENCIES.filter((c) =>
          loadedSalary.some((r) => r.currency === c) || loadedInc.some((r) => r.currency === c) ||
          loadedExp.some((r) => r.currency === c) || loadedIncoming.some((r) => r.currency === c) || loadedPayments.some((r) => r.currency === c)
        );
        setChartCurrency(present[0] || "INR");
      } catch (e) {
        setError("Couldn't load from Google Sheets. Check API_URL in src/api.js. " + e.message);
      } finally { setLoading(false); }
    })();
  }, []);

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

  const activeCurrencies = useMemo(() => {
    const present = CURRENCIES.filter((c) =>
      salary.some((r) => r.currency === c) || invIncome.some((r) => r.currency === c) ||
      expenses.some((r) => r.currency === c) || incoming.some((r) => r.currency === c) || debtPayments.some((r) => r.currency === c)
    );
    return present.length ? present : ["INR"];
  }, [salary, invIncome, expenses, incoming, debtPayments]);

  const yearTotals = useMemo(() => {
    const out = {};
    CURRENCIES.forEach((cur) => {
      const salaryTotal = salary.filter((s) => s.currency === cur && s.year === chartYear).reduce((sum, s) => sum + salaryNetIncome(s), 0);
      const invTotal = invIncome.filter((e) => e.currency === cur && yearOf(e.date) === chartYear).reduce((s, e) => s + e.amount, 0);
      const incomingTotal = incoming.filter((e) => e.currency === cur && yearOf(e.date) === chartYear).reduce((s, e) => s + e.amount, 0);
      const expTotal = expenses.filter((e) => e.currency === cur && yearOf(e.date) === chartYear).reduce((s, e) => s + e.amount, 0);
      const payTotal = debtPayments.filter((e) => e.currency === cur && yearOf(e.date) === chartYear).reduce((s, e) => s + e.amount, 0);
      const totalIncome = salaryTotal + invTotal + incomingTotal;
      const totalExpense = expTotal + payTotal;
      out[cur] = { salaryTotal, invTotal, incomingTotal, expTotal, payTotal, totalIncome, totalExpense, net: totalIncome - totalExpense };
    });
    return out;
  }, [salary, invIncome, expenses, incoming, debtPayments, chartYear]);

  const monthly = useMemo(() => {
    const months = {};
    const bump = (dateStr, key, amount) => {
      if (yearOf(dateStr) !== chartYear) return;
      const m = new Date(dateStr).toLocaleString("en-US", { month: "short" });
      const sortKey = dateStr.slice(0, 7);
      if (!months[m]) months[m] = { month: m, sortKey, "Investment Income": 0, "Incoming Transfers": 0, Expenses: 0, "Debt Payments": 0 };
      months[m][key] += amount;
    };
    invIncome.filter((e) => e.currency === chartCurrency).forEach((e) => bump(e.date, "Investment Income", e.amount));
    incoming.filter((e) => e.currency === chartCurrency).forEach((e) => bump(e.date, "Incoming Transfers", e.amount));
    expenses.filter((e) => e.currency === chartCurrency).forEach((e) => bump(e.date, "Expenses", e.amount));
    debtPayments.filter((e) => e.currency === chartCurrency).forEach((e) => bump(e.date, "Debt Payments", e.amount));
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((m) => ({
      ...m,
      incomeTotal: m["Investment Income"] + m["Incoming Transfers"],
      expenseTotalNeg: -(m["Expenses"] + m["Debt Payments"]),
      net: (m["Investment Income"] + m["Incoming Transfers"]) - (m["Expenses"] + m["Debt Payments"]),
    }));
  }, [invIncome, incoming, expenses, debtPayments, chartYear, chartCurrency]);

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading summary…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setError("")}>{error} (click to dismiss)</div>}

      <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, margin: "0 0 20px", display: "flex", alignItems: "center", gap: 6 }}>
        <LayoutDashboard size={14} /> A read-only rollup of Salary, Investment Income, Expenses, and Incoming Transfers — nothing here can be edited; go to the relevant page to add or change an entry.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
        <select value={chartYear} onChange={(e) => setChartYear(e.target.value)} style={selectStyle}>
          {availableYears.length === 0 && <option value={chartYear}>{chartYear}</option>}
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={chartCurrency} onChange={(e) => setChartCurrency(e.target.value)} style={selectStyle}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {activeCurrencies.map((cur) => (
        <div key={cur} style={{ marginBottom: 8 }}>
          <p style={{ fontFamily: sansFont, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 6px" }}>{cur} — {chartYear}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 8 }}>
            {[
              { label: "Total income", value: fmt(yearTotals[cur].totalIncome, cur), sub: `Salary ${fmt(yearTotals[cur].salaryTotal, cur)} · Investments ${fmt(yearTotals[cur].invTotal, cur)} · Transfers ${fmt(yearTotals[cur].incomingTotal, cur)}` },
              { label: "Total expenses", value: fmt(yearTotals[cur].totalExpense, cur), sub: `Expenses ${fmt(yearTotals[cur].expTotal, cur)} · Debt payments ${fmt(yearTotals[cur].payTotal, cur)}` },
              { label: "Net", value: fmt(yearTotals[cur].net, cur), color: yearTotals[cur].net >= 0 ? COLORS.positive : COLORS.negative },
            ].map((m, idx) => (
              <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
                <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
                <p style={{ fontSize: 24, margin: 0, fontWeight: 400, color: m.color || COLORS.ink }}>{m.value}</p>
                {m.sub && <p style={{ fontSize: 10, color: COLORS.muted, margin: "6px 0 0", fontFamily: sansFont }}>{m.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, margin: "0 0 30px" }}>Salary is recorded per tax year (not per paycheck), so it's included in the year totals above but not in the monthly chart/table below.</p>

      <div style={{ marginBottom: 44 }}>
        <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Monthly cash flow — {chartYear}, {chartCurrency}</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={monthly}>
            <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
            <RTooltip formatter={(v) => fmt(v, chartCurrency)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Arial" }} />
            <ReferenceLine y={0} stroke={COLORS.ink} />
            <Bar dataKey="Investment Income" stackId="income" fill={COLORS.info} />
            <Bar dataKey="Incoming Transfers" stackId="income" fill={COLORS.positive} radius={[3, 3, 0, 0]} />
            <Bar dataKey="Expenses" stackId="expense" fill={COLORS.negative} />
            <Bar dataKey="Debt Payments" stackId="expense" fill={COLORS.gold} />
            <Line type="monotone" dataKey="net" name="Net" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
        {monthly.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, textAlign: "center" }}>No dated income/expense entries for {chartYear} in {chartCurrency}.</p>}
        <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, marginTop: 8 }}>Expense bars are shown below the zero line so income and outflow are easy to compare at a glance; the line is the net for that month.</p>
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
                <td style={td("right")}>{fmt(m["Investment Income"], chartCurrency)}</td>
                <td style={td("right")}>{fmt(m["Incoming Transfers"], chartCurrency)}</td>
                <td style={td("right")}>{fmt(m["Expenses"], chartCurrency)}</td>
                <td style={td("right")}>{fmt(m["Debt Payments"], chartCurrency)}</td>
                <td style={{ ...td("right"), fontWeight: 700, color: m.net >= 0 ? COLORS.positive : COLORS.negative }}>{fmt(m.net, chartCurrency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {monthly.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 10 }}>Nothing to show for this year/currency yet.</p>}
      </div>
    </div>
  );
}
