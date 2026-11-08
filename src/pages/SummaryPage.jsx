import React, { useState, useMemo, useEffect, useRef } from "react";
import { ResponsiveContainer, ComposedChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ReferenceLine } from "recharts";
import { LayoutDashboard } from "lucide-react";
import { getTable, setTable } from "../api.js";
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

const EXPENSE_CATEGORIES = ["Rent", "Utilities", "Groceries", "Subscriptions", "Insurance", "Dining", "Transport", "Healthcare", "Entertainment", "Other"];
const fmtI = (v) => {
  const n = Math.abs(v || 0), s = v < 0 ? "-" : "";
  if (n >= 1e7) return `${s}₹${+(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${s}₹${+(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${s}₹${+(n / 1e3).toFixed(1)} K`;
  return `${s}₹${Math.round(n)}`;
};

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
  const [invs, setInvs] = useState([]);
  const [debts, setDebts] = useState([]);
  const [nwRows, setNwRows] = useState([]);
  const [budgets, setBudgets] = useState({});
  const [recDefs, setRecDefs] = useState([]);
  const [retSum, setRetSum] = useState(null);
  const budgetTimer = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [salaryRows, incRows, expRows, inTransferRows, payRows, invRows, debtRows, nwData, budgetRows, defRows, retRows] = await Promise.all([
          getTable("Salary"), getTable("Income"), getTable("Expenses"), getTable("IncomingTransfers"), getTable("DebtPayments"),
          getTable("Investments"), getTable("Debts"), getTable("NetWorth"), getTable("Budgets"), getTable("RecurringExpenses"), getTable("RetirementSummary"),
        ]);
        const num = parseAmount;
        const amt = (r) => ({ ...r, amount: num(r.amount), currency: r.currency || "INR" });
        setSalary(salaryRows.map((r) => ({ ...r, currency: r.currency || "INR", grossIncome: num(r.grossIncome), federalTax: num(r.federalTax), stateTax: num(r.stateTax), socialSecurityTax: num(r.socialSecurityTax), medicareTax: num(r.medicareTax), retirement401k: num(r.retirement401k), otherDeductions: num(r.otherDeductions) })));
        setInvIncome(incRows.map(amt));
        setExpenses(expRows.map(amt));
        setIncoming(inTransferRows.map(amt));
        setDebtPayments(payRows.map((r) => ({ ...amt(r), balanceAfter: num(r.balanceAfter) })));
        setInvs(invRows.filter((r) => r.id).map((r) => ({ id: String(r.id), current: num(r.currentValue), currency: r.currency || "INR", endDate: r.endDate || "" })));
        setDebts(debtRows.filter((r) => r.id).map((r) => ({ id: String(r.id), principal: num(r.principal), currency: r.currency || "INR" })));
        setNwRows(nwData.filter((r) => r.id));
        setBudgets(Object.fromEntries(budgetRows.filter((r) => r.id).map((r) => [String(r.id), num(r.monthly)])));
        setRecDefs(defRows.map((r) => ({ id: String(r.id), category: r.category })));
        setRetSum(retRows[0] || null);
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

  // ---- Net worth: active investments (INR) minus loan balances (INR), snapshotted once a month ----
  const nw = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const invTotal = invs.filter((i) => !(i.endDate && i.endDate < today)).reduce((s, i) => s + toINR(i.current, i.currency, rate), 0);
    const debtTotal = debts.reduce((s, d) => {
      const last = debtPayments.filter((p) => String(p.debtId) === d.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      return s + toINR(last ? last.balanceAfter : d.principal, d.currency, rate);
    }, 0);
    return { invTotal, debtTotal, net: invTotal - debtTotal };
  }, [invs, debts, debtPayments, rate]);

  useEffect(() => {
    if (loading) return;
    const id = `nw-${new Date().toISOString().slice(0, 7)}`;
    const t = setTimeout(async () => {
      const row = { id, investments: Math.round(nw.invTotal), debts: Math.round(nw.debtTotal), netWorth: Math.round(nw.net) };
      const prev = nwRows.find((r) => String(r.id) === id);
      if (prev && Math.round(parseAmount(prev.netWorth)) === row.netWorth) return;
      const next = [...nwRows.filter((r) => String(r.id) !== id), row].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      try { await setTable("NetWorth", next); setNwRows(next); } catch (e) { /* snapshot is best-effort */ }
    }, 2000);
    return () => clearTimeout(t);
  }, [loading, nw]);

  const nwSeries = useMemo(() => {
    const live = `nw-${new Date().toISOString().slice(0, 7)}`;
    const rows = nwRows.filter((r) => String(r.id) !== live).map((r) => ({ id: String(r.id), investments: parseAmount(r.investments), debts: parseAmount(r.debts), netWorth: parseAmount(r.netWorth) }));
    rows.push({ id: live, investments: Math.round(nw.invTotal), debts: Math.round(nw.debtTotal), netWorth: Math.round(nw.net) });
    return rows.sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ ...r, month: r.id.slice(3) }));
  }, [nwRows, nw]);

  // ---- Budget vs actual (monthly budget per expense category, INR) ----
  const setBudget = (cat, v) => {
    const next = { ...budgets, [cat]: v };
    setBudgets(next);
    clearTimeout(budgetTimer.current);
    budgetTimer.current = setTimeout(() => {
      setTable("Budgets", Object.entries(next).filter(([, m]) => m > 0).map(([id, monthly]) => ({ id, monthly }))).catch(() => {});
    }, 1000);
  };
  const monthsCount = chartYear === currentYearStr() ? new Date().getMonth() + 1 : 12;
  const budgetRows = useMemo(() => {
    const catOf = (e) => e.category || recDefs.find((d) => d.id === String(e.recurringId))?.category || "Other";
    return EXPENSE_CATEGORIES.map((cat) => {
      const monthly = budgets[cat] || 0, planned = monthly * monthsCount;
      const actual = expenses.filter((e) => yearOf(e.date) === chartYear && catOf(e) === cat).reduce((s, e) => s + inr(e), 0);
      return { cat, monthly, planned, actual, diff: planned - actual };
    });
  }, [budgets, expenses, recDefs, chartYear, monthsCount, rate]);

  const savingsRate = t.totalIncome > 0 ? (t.net / t.totalIncome) * 100 : 0;

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading summary…</div>;

  const cards = [
    { label: "Total income", value: fmt(t.totalIncome, "INR"), sub: `Salary ${fmt(t.salaryTotal, "INR")} · Investments ${fmt(t.invTotal, "INR")} · Transfers ${fmt(t.incomingTotal, "INR")}` },
    { label: "Total expenses", value: fmt(t.totalExpense, "INR"), sub: `Expenses ${fmt(t.expTotal, "INR")} · Debt payments ${fmt(t.payTotal, "INR")}` },
    { label: "Net", value: fmt(t.net, "INR"), color: t.net >= 0 ? COLORS.positive : COLORS.negative },
    { label: "Savings rate", value: `${savingsRate.toFixed(1)}%`, color: savingsRate >= 20 ? COLORS.positive : savingsRate >= 0 ? COLORS.gold : COLORS.negative, sub: "Net ÷ total income" },
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 8 }}>
        {cards.map((m, idx) => (
          <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
            <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
            <p style={{ fontSize: 24, margin: 0, fontWeight: 400, color: m.color || COLORS.ink }}>{m.value}</p>
            {m.sub && <p style={{ fontSize: 10, color: COLORS.muted, margin: "6px 0 0", fontFamily: sansFont }}>{m.sub}</p>}
          </div>
        ))}
      </div>
      <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, margin: "0 0 30px" }}>Salary is recorded per tax year (not per paycheck), so it's in the year totals but not in the monthly chart/table below.</p>


      <div style={{ marginBottom: 36 }}>
        <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Net worth (INR)</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 12 }}>
          {[["Investments (active)", nw.invTotal, COLORS.ink], ["Loan balances", nw.debtTotal, COLORS.negative], ["Net worth", nw.net, nw.net >= 0 ? COLORS.positive : COLORS.negative]].map(([l, v, c]) => (
            <div key={l} style={{ background: COLORS.bg, padding: "14px 18px" }}>
              <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 6px", fontFamily: sansFont }}>{l}</p>
              <p style={{ fontSize: 22, margin: 0, color: c }}>{fmt(v, "INR")}</p>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={nwSeries}>
            <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtI(v).replace("₹", "")} />
            <RTooltip formatter={(v) => fmt(v, "INR")} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Arial" }} />
            <Line type="monotone" dataKey="netWorth" name="Net worth" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="investments" name="Investments" stroke={COLORS.info} strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="debts" name="Loans" stroke={COLORS.negative} strokeWidth={1} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, margin: "6px 0 0" }}>One snapshot per month is saved automatically to the NetWorth tab when you open this page. The chart builds up over time.</p>
      </div>

      <div style={{ marginBottom: 36 }}>
        <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Retirement runway</h3>
        {retSum ? (() => {
          const dry = retSum.runsOutYear !== "" && retSum.runsOutYear !== undefined && retSum.runsOutYear !== null;
          return (
            <div style={{ background: "#fff", border: `1px solid ${COLORS.line}`, padding: 16, fontFamily: sansFont, fontSize: 13 }}>
              <div style={{ fontSize: 16, color: dry ? COLORS.negative : COLORS.positive, marginBottom: 6 }}>
                {dry ? `Corpus runs out in ${retSum.runsOutYear} (age ${retSum.runsOutAge})` : `Corpus lasts beyond age ${retSum.horizonAge}`}
              </div>
              <div style={{ color: COLORS.muted, fontSize: 12 }}>
                Projected end balance {fmtI(parseAmount(retSum.endBalance))} · Allocated {fmtI(parseAmount(retSum.allocatedINR))} · Current est. value {fmtI(parseAmount(retSum.currentEstINR))} · Planning yield {parseAmount(retSum.yield)}% · Retirement age {retSum.retAge} · Updated {retSum.updated}
              </div>
            </div>
          );
        })() : <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted }}>Open the Retirement page once to publish its runway here.</p>}
      </div>

      <div style={{ marginBottom: 44 }}>
        <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Budget vs actual — {chartYear} ({monthsCount} {monthsCount === 1 ? "month" : "months"})</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["Category", "Monthly budget (₹)", "Budget to date", "Actual to date", "Under / (over)"].map((h, i) => <th key={i} style={th(i > 0 ? "right" : "left")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {budgetRows.map((r) => (
              <tr key={r.cat} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={td()}>{r.cat}</td>
                <td style={td("right")}><input type="number" value={r.monthly || ""} placeholder="0" onChange={(e) => setBudget(r.cat, e.target.value === "" ? 0 : +e.target.value)} style={{ width: 100, textAlign: "right", padding: "4px 6px", border: `1px solid ${COLORS.line}`, background: "#fff", fontFamily: sansFont, fontSize: 12 }} /></td>
                <td style={td("right")}>{r.monthly ? fmt(r.planned, "INR") : "—"}</td>
                <td style={td("right")}>{fmt(r.actual, "INR")}</td>
                <td style={{ ...td("right"), fontWeight: 700, color: !r.monthly ? COLORS.muted : r.diff >= 0 ? COLORS.positive : COLORS.negative }}>{r.monthly ? fmt(r.diff, "INR") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, marginTop: 8 }}>Budgets are saved to the Budgets tab. Actuals come from the Expenses log (recurring + one-time) converted to INR.</p>
      </div>

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
