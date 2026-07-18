import React, { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from "recharts";
import { Plus, Landmark, CreditCard, Car, GraduationCap, Home, HelpCircle, Pencil, RefreshCcw } from "lucide-react";
import Modal from "../components/Modal.jsx";
import Field from "../components/Field.jsx";
import { getTable, setTable } from "../api.js";
import { COLORS, DEBT_COLORS, sansFont, fmt, todayStr, inputStyle, btnStyle, sectionHeading, th, td, addMonthsClamped, toISODate } from "../styles.js";

const LOAN_TYPES = ["Mortgage", "Auto Loan", "Student Loan", "Personal Loan", "Credit Card", "Other"];

// Amortization: given original principal, APR, and a fixed EMI, generates
// one payment per month from the start date, splitting each into principal
// vs. interest and carrying the declining balance forward. Only months whose
// pay date has actually arrived are generated (no in-progress month).
// Manual payments for a given date are respected and skipped in auto-gen —
// but since amortization needs a *running balance*, we replay manual and
// auto payments together in date order so the balance stays correct either way.
function generateDebtSchedule(debt, manualPaymentsForDebt) {
  const monthlyRate = (Number(debt.apr) || 0) / 100 / 12;
  const emi = Number(debt.emi) || 0;
  const principal = Number(debt.principal) || 0;
  if (!debt.startDate || principal <= 0) return [];

  const manualByDate = new Map(manualPaymentsForDebt.map((p) => [p.date, p]));
  const today = new Date(todayStr());
  const endLimit = debt.endDate ? new Date(debt.endDate) : today;
  const cutoff = endLimit < today ? endLimit : today;

  let balance = principal;
  const schedule = [];
  let k = 1;
  while (k < 1200 && balance > 0.5) {
    const payDate = addMonthsClamped(debt.startDate, k);
    if (payDate > cutoff) break;
    const payDateStr = toISODate(payDate);
    const manual = manualByDate.get(payDateStr);
    const interest = balance * monthlyRate;
    let principalPortion, amount, source;
    if (manual) {
      amount = Number(manual.amount);
      principalPortion = Math.min(Math.max(amount - interest, 0), balance);
      source = "manual";
    } else {
      principalPortion = Math.min(Math.max(emi - interest, 0), balance);
      amount = principalPortion + interest;
      source = "auto";
      if (emi <= 0) { k++; continue; }
    }
    balance = Math.max(0, balance - principalPortion);
    schedule.push({
      id: manual ? manual.id : `auto-${debt.id}-${payDateStr}`,
      debtId: debt.id, date: payDateStr, amount, principal: principalPortion, interest,
      balanceAfter: balance, source,
    });
    k++;
  }
  return schedule;
}

function rebuildPayments(debtList, storedPayments) {
  const manual = storedPayments.filter((p) => p.source !== "auto");
  let all = [];
  debtList.forEach((debt) => {
    const manualForDebt = manual.filter((p) => p.debtId === debt.id);
    all = all.concat(generateDebtSchedule(debt, manualForDebt));
  });
  return all;
}

export default function DebtsPage() {
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoAddedCount, setAutoAddedCount] = useState(0);
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  const blankForm = { name: "", lender: "", loanType: "Mortgage", principal: "", apr: "", emi: "", startDate: "", endDate: "", notes: "" };
  const [form, setForm] = useState(blankForm);
  const [payForm, setPayForm] = useState({ debtId: "", date: "", amount: "" });

  useEffect(() => {
    (async () => {
      try {
        const [debtRows, payRows] = await Promise.all([getTable("Debts"), getTable("DebtPayments")]);
        const loadedDebts = debtRows.map((d) => ({ ...d, principal: Number(d.principal) || 0, apr: Number(d.apr) || 0, emi: Number(d.emi) || 0 }));
        const loadedPayments = payRows.map((p) => ({ ...p, amount: Number(p.amount) || 0, principal: Number(p.principal) || 0, interest: Number(p.interest) || 0, balanceAfter: Number(p.balanceAfter) || 0 }));

        const prevAuto = loadedPayments.filter((p) => p.source === "auto").length;
        const rebuilt = rebuildPayments(loadedDebts, loadedPayments);
        const newAuto = rebuilt.filter((p) => p.source === "auto").length;

        setDebts(loadedDebts);
        setPayments(rebuilt);
        setAutoAddedCount(Math.max(0, newAuto - prevAuto));
        setPayForm((f) => ({ ...f, debtId: loadedDebts[0]?.id || "" }));
        await setTable("DebtPayments", rebuilt);
      } catch (e) {
        setError("Couldn't load from Google Sheets. Check API_URL in src/api.js. " + e.message);
      } finally { setLoading(false); }
    })();
  }, []);

  const persist = async (nextDebts, nextPayments) => {
    try {
      if (nextDebts) await setTable("Debts", nextDebts);
      if (nextPayments) await setTable("DebtPayments", nextPayments);
    } catch (e) { setError("Save failed: " + e.message); }
  };

  const debtsWithStats = useMemo(() => {
    return debts.map((d) => {
      const payForD = payments.filter((p) => p.debtId === d.id);
      const totalPaid = payForD.reduce((s, p) => s + p.amount, 0);
      const totalInterest = payForD.reduce((s, p) => s + p.interest, 0);
      const totalPrincipalPaid = payForD.reduce((s, p) => s + p.principal, 0);
      const lastPayment = [...payForD].sort((a, b) => b.date.localeCompare(a.date))[0];
      const currentBalance = lastPayment ? lastPayment.balanceAfter : d.principal;
      const isPaidOff = currentBalance <= 0.5;
      return { ...d, totalPaid, totalInterest, totalPrincipalPaid, currentBalance, isPaidOff };
    }).sort((a, b) => a.loanType.localeCompare(b.loanType) || a.name.localeCompare(b.name));
  }, [debts, payments]);

  const totals = useMemo(() => {
    const originalPrincipal = debts.reduce((s, d) => s + d.principal, 0);
    const currentBalance = debtsWithStats.reduce((s, d) => s + d.currentBalance, 0);
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const totalInterest = payments.reduce((s, p) => s + p.interest, 0);
    return { originalPrincipal, currentBalance, totalPaid, totalInterest };
  }, [debts, debtsWithStats, payments]);

  const monthlyPayments = useMemo(() => {
    const months = {};
    payments.forEach((p) => {
      const m = new Date(p.date).toLocaleString("en-US", { month: "short", year: "2-digit" });
      if (!months[m]) months[m] = { month: m, Principal: 0, Interest: 0, sortKey: p.date.slice(0, 7) };
      months[m].Principal += p.principal;
      months[m].Interest += p.interest;
    });
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [payments]);

  const paymentLog = useMemo(() => [...payments].sort((a, b) => b.date.localeCompare(a.date)).map((p) => ({ ...p, debtName: debts.find((d) => d.id === p.debtId)?.name || p.debtId })), [payments, debts]);

  const openAdd = () => { setEditingId(null); setForm(blankForm); setShowAddDebt(true); };
  const openEdit = (d) => {
    setEditingId(d.id);
    setForm({ name: d.name, lender: d.lender, loanType: d.loanType, principal: d.principal, apr: d.apr, emi: d.emi, startDate: d.startDate, endDate: d.endDate || "", notes: d.notes || "" });
    setShowAddDebt(true);
  };

  const saveDebt = async () => {
    if (!form.name || !form.principal || !form.startDate) return;
    let nextDebts;
    if (editingId) {
      nextDebts = debts.map((d) => d.id === editingId ? { ...d, ...form, principal: Number(form.principal), apr: Number(form.apr), emi: Number(form.emi) } : d);
    } else {
      nextDebts = [...debts, { id: Date.now().toString(), ...form, principal: Number(form.principal), apr: Number(form.apr), emi: Number(form.emi) }];
    }
    const nextPayments = rebuildPayments(nextDebts, payments);
    setDebts(nextDebts);
    setPayments(nextPayments);
    await persist(nextDebts, nextPayments);
    setShowAddDebt(false);
  };

  const addPayment = async () => {
    if (!payForm.debtId || !payForm.amount || !payForm.date) return;
    const manualEntry = { id: Date.now().toString(), debtId: payForm.debtId, date: payForm.date, amount: Number(payForm.amount), source: "manual" };
    const nextStored = [...payments.filter((p) => p.source === "manual"), manualEntry];
    const nextPayments = rebuildPayments(debts, nextStored);
    setPayments(nextPayments);
    await persist(null, nextPayments);
    setPayForm({ debtId: debts[0]?.id || "", date: "", amount: "" });
    setShowAddPayment(false);
  };

  const loanIcon = (type) => {
    if (type === "Mortgage") return <Home size={16} />;
    if (type === "Auto Loan") return <Car size={16} />;
    if (type === "Student Loan") return <GraduationCap size={16} />;
    if (type === "Credit Card") return <CreditCard size={16} />;
    if (type === "Personal Loan") return <Landmark size={16} />;
    return <HelpCircle size={16} />;
  };

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading debts…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16 }}>{error}</div>}

      {autoAddedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: sansFont, color: COLORS.positive, background: "#E1F5EE", border: `1px solid ${COLORS.positive}`, padding: "8px 12px", margin: "0 0 16px" }}>
          <RefreshCcw size={13} /> Auto-added {autoAddedCount} EMI {autoAddedCount === 1 ? "payment" : "payments"} based on each loan's amortization schedule.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 30, marginTop: 8 }}>
        {[
          { label: "Original principal", value: fmt(totals.originalPrincipal) },
          { label: "Current balance", value: fmt(totals.currentBalance) },
          { label: "Total paid to date", value: fmt(totals.totalPaid) },
          { label: "Total interest paid", value: fmt(totals.totalInterest) },
        ].map((m, idx) => (
          <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
            <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
            <p style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>{m.value}</p>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h3 style={sectionHeading}>Monthly payments — principal vs interest</h3>
          <button onClick={() => setShowAddPayment(true)} style={btnStyle}><Plus size={13} /> Log a payment</button>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyPayments}>
            <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v / 1000}k`} />
            <RTooltip formatter={(v) => fmt(v)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Arial" }} />
            <Bar dataKey="Principal" stackId="a" fill={COLORS.positive} />
            <Bar dataKey="Interest" stackId="a" fill={COLORS.negative} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <h3 style={sectionHeading}>Loans</h3>
          <button onClick={openAdd} style={btnStyle}><Plus size={13} /> Add loan</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["", "Loan", "Lender", "APR", "EMI", "Start", "End", "Original", "Paid to date", "Balance"].map((h, i) => <th key={i} style={th(i > 6 ? "right" : "left")}>{h}</th>)}
            <th></th>
          </tr></thead>
          <tbody>
            {debtsWithStats.map((d) => (
              <tr key={d.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={{ ...td(), color: DEBT_COLORS[d.loanType] }}>{loanIcon(d.loanType)}</td>
                <td style={td()}>
                  {d.name}
                  {d.isPaidOff && <span style={{ fontSize: 10, color: COLORS.positive, border: `1px solid ${COLORS.positive}`, padding: "1px 5px", marginLeft: 6 }}>Paid off</span>}
                  <div style={{ fontSize: 11, color: COLORS.muted }}>{d.loanType}</div>
                </td>
                <td style={td()}>{d.lender}</td>
                <td style={td()}>{d.apr}%</td>
                <td style={td()}>{fmt(d.emi)}</td>
                <td style={td()}>{d.startDate}</td>
                <td style={td()}>{d.endDate || "—"}</td>
                <td style={td("right")}>{fmt(d.principal)}</td>
                <td style={td("right")}>{fmt(d.totalPaid)}</td>
                <td style={{ ...td("right"), fontWeight: 700 }}>{fmt(d.currentBalance)}</td>
                <td style={td("right")}><Pencil size={14} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEdit(d)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Payment log</h3>
        <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${COLORS.line}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, background: COLORS.bg }}><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
              {["Loan", "Date", "Amount", "Principal", "Interest", "Balance after", "Source"].map((hd, i) => <th key={i} style={th(i > 1 && i < 6 ? "right" : "left")}>{hd}</th>)}
            </tr></thead>
            <tbody>
              {paymentLog.map((p) => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${COLORS.lineLight}` }}>
                  <td style={{ padding: 6 }}>{p.debtName}</td>
                  <td style={{ padding: 6 }}>{p.date}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.amount)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.principal)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.interest)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.balanceAfter)}</td>
                  <td style={{ padding: 6, color: p.source === "auto" ? COLORS.muted : COLORS.positive }}>{p.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddDebt && (
        <Modal onClose={() => setShowAddDebt(false)} title={editingId ? "Edit loan" : "Add loan"}>
          <Field label="Loan name"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Home mortgage" /></Field>
          <Field label="Lender / source"><input style={inputStyle} value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} placeholder="e.g. Wells Fargo" /></Field>
          <Field label="Loan type"><select style={inputStyle} value={form.loanType} onChange={(e) => setForm({ ...form, loanType: e.target.value })}>{LOAN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Original principal (₹)"><input type="number" style={inputStyle} value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></Field>
            <Field label="APR (%)"><input type="number" step="0.01" style={inputStyle} value={form.apr} onChange={(e) => setForm({ ...form, apr: e.target.value })} /></Field>
          </div>
          <Field label="Monthly EMI (₹)"><input type="number" style={inputStyle} value={form.emi} onChange={(e) => setForm({ ...form, emi: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Start date"><input type="date" style={inputStyle} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
            <Field label="End date (if closed/paid off early)"><input type="date" style={inputStyle} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 10px" }}>EMI payments are auto-logged monthly from the start date using standard amortization (interest first, remainder to principal). Log actual/extra payments separately if they differ.</p>
          <button onClick={saveDebt} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0" }}>{editingId ? "Save changes" : "Save loan"}</button>
        </Modal>
      )}

      {showAddPayment && (
        <Modal onClose={() => setShowAddPayment(false)} title="Log a payment">
          <Field label="Loan"><select style={inputStyle} value={payForm.debtId} onChange={(e) => setPayForm({ ...payForm, debtId: e.target.value })}>{debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
          <Field label="Amount paid (₹)"><input type="number" style={inputStyle} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" style={inputStyle} value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} /></Field>
          <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 10px" }}>Use this for extra payments, or if an actual EMI differed from the scheduled amount that month — it replaces the auto-generated entry for that date.</p>
          <button onClick={addPayment} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0" }}>Save payment</button>
        </Modal>
      )}
    </div>
  );
}
