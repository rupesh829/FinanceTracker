import React, { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from "recharts";
import { Plus, Landmark, CreditCard, Car, GraduationCap, Home, HelpCircle, Pencil, Trash2, RefreshCcw, ChevronDown, ChevronUp } from "lucide-react";
import Modal from "../components/Modal.jsx";
import Field from "../components/Field.jsx";
import { getTable, setTable } from "../api.js";
import {
  COLORS, DEBT_COLORS, CURRENCIES, sansFont, fmt, todayStr, currentYearStr, sortRows, parseAmount, splitValidRows, isDuplicateValue, effectiveAmountAt,
  inputStyle, selectStyle, btnStyle, btnStyleGhost, sectionHeading, th, td, addMonthsClamped, toISODate, yearOf,
} from "../styles.js";

const LOAN_TYPES = ["Mortgage", "Auto Loan", "Student Loan", "Personal Loan", "Credit Card", "Other"];
const CLOSURE_REASONS = ["Refinanced", "Paid Off Early", "Other"];
const LOG_CAP = 500;

// Two loan structures are supported:
//
// "Amortizing" (the original/default model): a standard EMI where each
// payment is split into interest (balance * monthlyRate) and principal
// (whatever's left of the payment). The EMI and APR can each change over
// time via emiHistory/aprHistory (effective-at-period-start, same pattern
// as Investments' returnHistory) — useful for step-up EMIs or floating APR.
//
// "Fixed Term": 0% interest, a one-time processing fee, and a fixed monthly
// payment for a set number of months — the kind of loan where the monthly
// payment alone often doesn't fully pay off the principal, so whatever's
// left is due as a lump sum when the term ends ("clear the balance amount").
//
// Both structures share one mechanism for that final payoff: if a loan has
// an `endDate` (the term's natural end, OR an early closure/refinance date
// — see closureReason below) that has arrived and a balance still remains,
// one final "closure" entry is auto-generated for the full remaining
// balance. This is also literally what happens when you refinance or pay a
// loan off early: whatever's left becomes due in one lump sum on that date.
function generateDebtSchedule(debt, manualPaymentsForDebt) {
  const structure = debt.loanStructure || "Amortizing";
  const principal = parseAmount(debt.principal);
  const currency = debt.currency || "INR";
  const fee = parseAmount(debt.processingFee);
  if (!debt.startDate || principal <= 0) return [];

  const manualByDate = new Map(manualPaymentsForDebt.map((p) => [p.date, p]));
  const today = new Date(todayStr());
  const endLimit = debt.endDate ? new Date(debt.endDate) : today;
  const cutoff = endLimit < today ? endLimit : today;

  let balance = principal;
  const schedule = [];

  // One-time processing fee, logged as a "cost of borrowing" the same way
  // interest is — it flows into "Total interest paid" naturally since
  // there's no separate concept needed for a 0%-APR loan's real cost.
  if (fee > 0 && new Date(debt.startDate) <= cutoff && !manualByDate.has(debt.startDate)) {
    schedule.push({ id: `fee-${debt.id}`, debtId: debt.id, date: debt.startDate, amount: fee, principal: 0, interest: fee, balanceAfter: balance, source: "fee", currency });
  }

  let k = 1;
  while (k < 1200 && balance > 0.5) {
    const periodStart = addMonthsClamped(debt.startDate, k - 1);
    const payDate = addMonthsClamped(debt.startDate, k);
    if (payDate > cutoff) break;
    const payDateStr = toISODate(payDate);
    const manual = manualByDate.get(payDateStr);
    const apr = structure === "Fixed Term" ? 0 : effectiveAmountAt(debt.aprHistory, periodStart);
    const interest = balance * (apr / 100 / 12);
    const payment = effectiveAmountAt(debt.emiHistory, periodStart);
    let principalPortion, amount, source;
    if (manual) {
      amount = parseAmount(manual.amount);
      principalPortion = Math.min(Math.max(amount - interest, 0), balance);
      source = "manual";
    } else {
      principalPortion = Math.min(Math.max(payment - interest, 0), balance);
      amount = principalPortion + interest;
      source = "auto";
      if (payment <= 0) { k++; continue; }
    }
    balance = Math.max(0, balance - principalPortion);
    schedule.push({
      id: manual ? manual.id : `auto-${debt.id}-${payDateStr}`,
      debtId: debt.id, date: payDateStr, amount, principal: principalPortion, interest,
      balanceAfter: balance, source, currency,
    });
    k++;
  }

  // The term ended, or the loan was closed early/refinanced — either way,
  // if a balance remains as of endDate, it's due in full right then.
  if (debt.endDate && new Date(debt.endDate) <= today && balance > 0.5 && !manualByDate.has(debt.endDate)) {
    schedule.push({ id: `closure-${debt.id}`, debtId: debt.id, date: debt.endDate, amount: balance, principal: balance, interest: 0, balanceAfter: 0, source: "closure", currency });
  }

  return schedule.sort((a, b) => a.date.localeCompare(b.date));
}

function rebuildPayments(debtList, storedPayments) {
  // Only genuinely manual entries survive a rebuild — "fee" and "closure"
  // rows are just as auto-derived as "auto" EMI rows and regenerate fresh
  // every load, same self-healing model as everywhere else in this app.
  const manual = storedPayments.filter((p) => p.source === "manual");
  let all = [];
  debtList.forEach((debt) => {
    const manualForDebt = manual.filter((p) => p.debtId === debt.id);
    all = all.concat(generateDebtSchedule(debt, manualForDebt));
  });
  return all;
}

// Debts sheet rows are flat; emiHistory/aprHistory (arrays) are serialized
// to/from JSON strings in single cells, same pattern as Investments'
// returnHistoryJSON. Legacy rows (pre-history, flat emi/apr fields) are
// seeded into a single-entry history on load so old loans keep working.
function deserializeDebt(row) {
  let emiHistory = [];
  try { emiHistory = row.emiHistoryJSON ? JSON.parse(row.emiHistoryJSON) : []; } catch (e) { emiHistory = []; }
  let aprHistory = [];
  try { aprHistory = row.aprHistoryJSON ? JSON.parse(row.aprHistoryJSON) : []; } catch (e) { aprHistory = []; }
  if (emiHistory.length === 0 && row.emi !== undefined && row.emi !== "") {
    emiHistory = [{ date: row.startDate || todayStr(), amount: parseAmount(row.emi) }];
  }
  if (aprHistory.length === 0 && row.apr !== undefined && row.apr !== "") {
    aprHistory = [{ date: row.startDate || todayStr(), amount: parseAmount(row.apr) }];
  }
  return {
    ...row,
    principal: parseAmount(row.principal),
    processingFee: parseAmount(row.processingFee),
    currency: row.currency || "INR",
    loanStructure: row.loanStructure || "Amortizing",
    emiHistory, aprHistory,
  };
}
function serializeDebt(debt) {
  const { emiHistory, aprHistory, ...rest } = debt;
  return { ...rest, emiHistoryJSON: JSON.stringify(emiHistory || []), aprHistoryJSON: JSON.stringify(aprHistory || []) };
}

export default function DebtsPage() {
  const [debts, setDebts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoAddedCount, setAutoAddedCount] = useState(0);
  const [showAddDebt, setShowAddDebt] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterCurrency, setFilterCurrency] = useState("All");
  const [chartCurrency, setChartCurrency] = useState("INR");
  const [chartYear, setChartYear] = useState(currentYearStr());
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  // --- payment log: on-demand, not rendered by default ---
  const [showPaymentLog, setShowPaymentLog] = useState(false);
  const [logFilters, setLogFilters] = useState({ from: "", to: "", debtId: "All", source: "All", currency: "All" });

  const blankForm = {
    name: "", lender: "", loanType: "Mortgage", currency: "INR", loanStructure: "Amortizing",
    principal: "", processingFee: "", termMonths: "", startDate: "", endDate: "", notes: "",
    closureReason: "", refinancedFromId: "",
    emiHistory: [], aprHistory: [], emiStart: "", aprStart: "", newEmiDate: "", newEmiAmount: "", newAprDate: "", newAprAmount: "",
  };
  const [form, setForm] = useState(blankForm);
  const [payForm, setPayForm] = useState({ debtId: "", date: "", amount: "" });

  useEffect(() => {
    (async () => {
      try {
        const [debtRows, payRows] = await Promise.all([getTable("Debts"), getTable("DebtPayments")]);
        const { valid: validDebtRows, skipped: skippedDebts } = splitValidRows(debtRows);
        const { valid: validPayRows, skipped: skippedPays } = splitValidRows(payRows);
        const loadedDebts = validDebtRows.map(deserializeDebt);
        const loadedPayments = validPayRows.map((p) => ({ ...p, amount: parseAmount(p.amount), principal: parseAmount(p.principal), interest: parseAmount(p.interest), balanceAfter: parseAmount(p.balanceAfter), currency: p.currency || "INR" }));
        if (skippedDebts || skippedPays) {
          setWarning(`Skipped ${skippedDebts} loan row(s) and ${skippedPays} payment row(s) in the Sheet that are missing an "id" — give every manually-added row a unique id to have it show up here.`);
        }

        const prevAuto = loadedPayments.filter((p) => p.source !== "manual").length;
        const rebuilt = rebuildPayments(loadedDebts, loadedPayments);
        const newAuto = rebuilt.filter((p) => p.source !== "manual").length;

        setDebts(loadedDebts);
        setPayments(rebuilt);
        setAutoAddedCount(Math.max(0, newAuto - prevAuto));
        setPayForm((f) => ({ ...f, debtId: loadedDebts[0]?.id || "" }));

        const presentCurrencies = CURRENCIES.filter((c) => loadedDebts.some((d) => (d.currency || "INR") === c));
        setChartCurrency(presentCurrencies[0] || "INR");

        await setTable("DebtPayments", rebuilt);
      } catch (e) {
        setError("Couldn't load from Google Sheets. Check API_URL in src/api.js. " + e.message);
      } finally { setLoading(false); }
    })();
  }, []);

  const persist = async (nextDebts, nextPayments) => {
    try {
      if (nextDebts) await setTable("Debts", nextDebts.map(serializeDebt));
      if (nextPayments) await setTable("DebtPayments", nextPayments);
    } catch (e) { setError("Save failed: " + e.message); }
  };

  const activeCurrencies = useMemo(() => {
    const present = CURRENCIES.filter((c) => debts.some((d) => (d.currency || "INR") === c));
    return present.length ? present : ["INR"];
  }, [debts]);

  const debtsWithStats = useMemo(() => {
    const list = debts
      .filter((d) => filterCurrency === "All" || (d.currency || "INR") === filterCurrency)
      .map((d) => {
        const payForD = payments.filter((p) => p.debtId === d.id);
        const totalPaid = payForD.reduce((s, p) => s + p.amount, 0);
        const totalInterest = payForD.reduce((s, p) => s + p.interest, 0);
        const totalPrincipalPaid = payForD.reduce((s, p) => s + p.principal, 0);
        const lastPayment = [...payForD].sort((a, b) => b.date.localeCompare(a.date))[0];
        const currentBalance = lastPayment ? lastPayment.balanceAfter : d.principal;
        const isPaidOff = currentBalance <= 0.5;
        const currentEmi = d.emiHistory?.length ? [...d.emiHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-1)[0].amount : 0;
        const currentApr = d.loanStructure === "Fixed Term" ? 0 : (d.aprHistory?.length ? [...d.aprHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-1)[0].amount : 0);
        const refinancedIntoName = debts.find((x) => x.refinancedFromId === d.id)?.name;
        const refinancedFromName = debts.find((x) => x.id === d.refinancedFromId)?.name;
        return { ...d, totalPaid, totalInterest, totalPrincipalPaid, currentBalance, isPaidOff, currentEmi, currentApr, refinancedIntoName, refinancedFromName };
      });
    return sortRows(list, sortField, sortDir);
  }, [debts, payments, filterCurrency, sortField, sortDir]);

  const totalsByCurrency = useMemo(() => {
    const out = {};
    CURRENCIES.forEach((cur) => {
      const debtList = debts.filter((d) => (d.currency || "INR") === cur);
      const payList = payments.filter((p) => (p.currency || "INR") === cur);
      const originalPrincipal = debtList.reduce((s, d) => s + d.principal, 0);
      const currentBalance = debtList.reduce((s, d) => {
        const payForD = payList.filter((p) => p.debtId === d.id);
        const last = [...payForD].sort((a, b) => b.date.localeCompare(a.date))[0];
        return s + (last ? last.balanceAfter : d.principal);
      }, 0);
      const totalPaid = payList.reduce((s, p) => s + p.amount, 0);
      const totalInterest = payList.reduce((s, p) => s + p.interest, 0);
      out[cur] = { originalPrincipal, currentBalance, totalPaid, totalInterest };
    });
    return out;
  }, [debts, payments]);

  const availableYears = useMemo(() => {
    const set = new Set(payments.map((p) => yearOf(p.date)).filter(Boolean));
    return Array.from(set).sort();
  }, [payments]);

  const monthlyPayments = useMemo(() => {
    const filtered = payments.filter((p) =>
      (p.currency || "INR") === chartCurrency && (chartYear === "All" || yearOf(p.date) === chartYear)
    );
    const months = {};
    filtered.forEach((p) => {
      const m = new Date(p.date).toLocaleString("en-US", { month: "short", year: "2-digit" });
      if (!months[m]) months[m] = { month: m, Principal: 0, Interest: 0, sortKey: p.date.slice(0, 7) };
      months[m].Principal += p.principal;
      months[m].Interest += p.interest;
    });
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [payments, chartCurrency, chartYear]);

  const paymentLog = useMemo(() => [...payments].sort((a, b) => b.date.localeCompare(a.date)).map((p) => ({ ...p, debtName: debts.find((d) => d.id === p.debtId)?.name || p.debtId })), [payments, debts]);

  const filteredPaymentLog = useMemo(() => {
    if (!showPaymentLog) return [];
    return paymentLog.filter((p) =>
      (!logFilters.from || p.date >= logFilters.from) &&
      (!logFilters.to || p.date <= logFilters.to) &&
      (logFilters.debtId === "All" || String(p.debtId) === String(logFilters.debtId)) &&
      (logFilters.source === "All" || p.source === logFilters.source) &&
      (logFilters.currency === "All" || (p.currency || "INR") === logFilters.currency)
    );
  }, [paymentLog, logFilters, showPaymentLog]);

  const openAdd = () => { setEditingId(null); setForm(blankForm); setShowAddDebt(true); };
  const openEdit = (d) => {
    setEditingId(d.id);
    setForm({
      name: d.name, lender: d.lender, loanType: d.loanType, currency: d.currency || "INR", loanStructure: d.loanStructure || "Amortizing",
      principal: d.principal, processingFee: d.processingFee || "", termMonths: d.termMonths || "",
      startDate: d.startDate, endDate: d.endDate || "", notes: d.notes || "",
      closureReason: d.closureReason || "", refinancedFromId: d.refinancedFromId || "",
      emiHistory: d.emiHistory || [], aprHistory: d.aprHistory || [],
      emiStart: "", aprStart: "", newEmiDate: "", newEmiAmount: "", newAprDate: "", newAprAmount: "",
    });
    setShowAddDebt(true);
  };

  const addEmiRate = () => {
    if (!form.newEmiDate || !form.newEmiAmount) return;
    const next = [...form.emiHistory, { date: form.newEmiDate, amount: parseAmount(form.newEmiAmount) }].sort((a, b) => new Date(a.date) - new Date(b.date));
    setForm({ ...form, emiHistory: next, newEmiDate: "", newEmiAmount: "" });
  };
  const addAprRate = () => {
    if (!form.newAprDate || !form.newAprAmount) return;
    const next = [...form.aprHistory, { date: form.newAprDate, amount: parseAmount(form.newAprAmount) }].sort((a, b) => new Date(a.date) - new Date(b.date));
    setForm({ ...form, aprHistory: next, newAprDate: "", newAprAmount: "" });
  };
  const fillEndDateFromTerm = () => {
    if (!form.termMonths) return;
    const start = form.startDate || todayStr();
    const end = toISODate(addMonthsClamped(start, parseInt(form.termMonths, 10) || 0));
    setForm({ ...form, endDate: end });
  };

  const saveDebt = async () => {
    if (!form.name || !form.principal || !form.startDate) return;
    if (!editingId && isDuplicateValue(debts, "name", form.name)) {
      if (!window.confirm(`A loan named "${form.name}" already exists. Add another one with the same name anyway?`)) return;
    }
    const emiHistory = editingId ? form.emiHistory : (form.emiStart ? [{ date: form.startDate || todayStr(), amount: parseAmount(form.emiStart) }] : []);
    const aprHistory = form.loanStructure !== "Amortizing" ? [] : (editingId ? form.aprHistory : (form.aprStart ? [{ date: form.startDate || todayStr(), amount: parseAmount(form.aprStart) }] : []));
    const debtData = {
      name: form.name, lender: form.lender, loanType: form.loanType, currency: form.currency, loanStructure: form.loanStructure,
      principal: parseAmount(form.principal), processingFee: parseAmount(form.processingFee), termMonths: form.termMonths,
      startDate: form.startDate, endDate: form.endDate || "", notes: form.notes,
      closureReason: form.endDate ? form.closureReason : "", refinancedFromId: form.refinancedFromId || "",
      emiHistory, aprHistory,
    };
    const thisId = editingId || Date.now().toString();
    let nextDebts;
    if (editingId) nextDebts = debts.map((d) => d.id === editingId ? { ...d, ...debtData } : d);
    else nextDebts = [...debts, { id: thisId, ...debtData }];

    // Keep the refinance link consistent both ways: if this loan says it
    // replaces another one, mark that other loan closed (unless it's
    // already been explicitly closed with its own reason/date).
    if (debtData.refinancedFromId) {
      nextDebts = nextDebts.map((d) => {
        if (d.id !== debtData.refinancedFromId) return d;
        if (d.endDate && d.closureReason) return d; // already closed on its own terms
        return { ...d, endDate: d.endDate || debtData.startDate, closureReason: d.closureReason || "Refinanced" };
      });
    }

    const nextPayments = rebuildPayments(nextDebts, payments);
    setDebts(nextDebts);
    setPayments(nextPayments);
    await persist(nextDebts, nextPayments);
    setShowAddDebt(false);
  };

  const deleteDebt = async (d) => {
    if (!window.confirm(`Delete "${d.name}"? This also removes its ${payments.filter((p) => p.debtId === d.id).length} payment log entries. This can't be undone.`)) return;
    const nextDebts = debts.filter((x) => x.id !== d.id);
    const nextPayments = payments.filter((p) => p.debtId !== d.id);
    setDebts(nextDebts);
    setPayments(nextPayments);
    await persist(nextDebts, nextPayments);
  };

  const addPayment = async () => {
    if (!payForm.debtId || !payForm.amount || !payForm.date) return;
    const manualEntry = { id: Date.now().toString(), debtId: payForm.debtId, date: payForm.date, amount: parseAmount(payForm.amount), source: "manual" };
    const nextStored = [...payments.filter((p) => p.source === "manual"), manualEntry];
    const nextPayments = rebuildPayments(debts, nextStored);
    setPayments(nextPayments);
    await persist(null, nextPayments);
    setPayForm({ debtId: debts[0]?.id || "", date: "", amount: "" });
    setShowAddPayment(false);
  };

  const deletePayment = async (p) => {
    if (p.source !== "manual") { setError(`${p.source === "fee" ? "Fee" : p.source === "closure" ? "Closure" : "Auto-generated"} entries can't be deleted directly — edit the loan's fee/dates instead, or log a manual override for that date.`); return; }
    if (!window.confirm(`Delete this payment of ${fmt(p.amount, p.currency)} on ${p.date}? The auto-generated schedule will resume for that date.`)) return;
    const nextStored = payments.filter((x) => x.source === "manual" && x.id !== p.id);
    const nextPayments = rebuildPayments(debts, nextStored);
    setPayments(nextPayments);
    await persist(null, nextPayments);
  };

  const loanIcon = (type) => {
    if (type === "Mortgage") return <Home size={16} />;
    if (type === "Auto Loan") return <Car size={16} />;
    if (type === "Student Loan") return <GraduationCap size={16} />;
    if (type === "Credit Card") return <CreditCard size={16} />;
    if (type === "Personal Loan") return <Landmark size={16} />;
    return <HelpCircle size={16} />;
  };

  const sourceColor = (source) => {
    if (source === "auto") return COLORS.muted;
    if (source === "manual") return COLORS.positive;
    if (source === "fee") return COLORS.gold;
    if (source === "closure") return COLORS.accent;
    return COLORS.muted;
  };

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading debts…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setError("")}>{error} (click to dismiss)</div>}
      {warning && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.gold, border: `1px solid ${COLORS.gold}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setWarning("")}>{warning} (click to dismiss)</div>}

      {autoAddedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: sansFont, color: COLORS.positive, background: "#E1F5EE", border: `1px solid ${COLORS.positive}`, padding: "8px 12px", margin: "0 0 16px" }}>
          <RefreshCcw size={13} /> Auto-added {autoAddedCount} {autoAddedCount === 1 ? "entry" : "entries"} based on each loan's schedule.
        </div>
      )}

      {activeCurrencies.map((cur) => (
        <div key={cur} style={{ marginBottom: 8 }}>
          <p style={{ fontFamily: sansFont, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 6px" }}>{cur} loans</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 16 }}>
            {[
              { label: "Original principal", value: fmt(totalsByCurrency[cur].originalPrincipal, cur) },
              { label: "Current balance", value: fmt(totalsByCurrency[cur].currentBalance, cur) },
              { label: "Total paid to date", value: fmt(totalsByCurrency[cur].totalPaid, cur) },
              { label: "Total interest & fees paid", value: fmt(totalsByCurrency[cur].totalInterest, cur) },
            ].map((m, idx) => (
              <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
                <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
                <p style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>{m.value}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, margin: "0 0 20px" }}>"Total interest & fees paid" includes one-time processing fees on Fixed Term loans, since that's their real cost of borrowing at 0% APR.</p>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Monthly payments — principal vs interest</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={chartYear} onChange={(e) => setChartYear(e.target.value)} style={selectStyle}>
              <option value="All">All years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={chartCurrency} onChange={(e) => setChartCurrency(e.target.value)} style={selectStyle}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setShowAddPayment(true)} style={btnStyle}><Plus size={13} /> Log a payment</button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyPayments}>
            <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
            <RTooltip formatter={(v) => fmt(v, chartCurrency)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Arial" }} />
            <Bar dataKey="Principal" stackId="a" fill={COLORS.positive} />
            <Bar dataKey="Interest" stackId="a" fill={COLORS.negative} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Loans</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select value={filterCurrency} onChange={(e) => setFilterCurrency(e.target.value)} style={selectStyle}>
              <option value="All">All currencies</option>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={sortField} onChange={(e) => setSortField(e.target.value)} style={selectStyle}>
              <option value="name">Sort: Name</option>
              <option value="startDate">Sort: Start date</option>
              <option value="principal">Sort: Principal</option>
            </select>
            <button onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} style={btnStyleGhost}>{sortDir === "asc" ? "↑ Asc" : "↓ Desc"}</button>
            <button onClick={openAdd} style={btnStyle}><Plus size={13} /> Add loan</button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["", "Loan", "Lender", "APR", "Payment", "Start", "End", "Original", "Paid to date", "Balance"].map((h, i) => <th key={i} style={th(i > 6 ? "right" : "left")}>{h}</th>)}
            <th></th>
          </tr></thead>
          <tbody>
            {debtsWithStats.map((d) => (
              <tr key={d.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={{ ...td(), color: DEBT_COLORS[d.loanType] }}>{loanIcon(d.loanType)}</td>
                <td style={td()}>
                  {d.name}
                  <span style={{ fontSize: 10, color: COLORS.muted, border: `1px solid ${COLORS.line}`, padding: "1px 5px", marginLeft: 6 }}>{d.currency || "INR"}</span>
                  {d.loanStructure === "Fixed Term" && <span style={{ fontSize: 10, color: COLORS.gold, border: `1px solid ${COLORS.gold}`, padding: "1px 5px", marginLeft: 6 }}>Fixed Term</span>}
                  {d.closureReason && <span style={{ fontSize: 10, color: COLORS.accent, border: `1px solid ${COLORS.accent}`, padding: "1px 5px", marginLeft: 6 }}>Closed — {d.closureReason}</span>}
                  {!d.closureReason && d.isPaidOff && <span style={{ fontSize: 10, color: COLORS.positive, border: `1px solid ${COLORS.positive}`, padding: "1px 5px", marginLeft: 6 }}>Paid off</span>}
                  {d.refinancedFromName && <span style={{ fontSize: 10, color: COLORS.accent, border: `1px solid ${COLORS.accent}`, padding: "1px 5px", marginLeft: 6 }}>← Refinanced from {d.refinancedFromName}</span>}
                  {d.refinancedIntoName && <span style={{ fontSize: 10, color: COLORS.accent, border: `1px solid ${COLORS.accent}`, padding: "1px 5px", marginLeft: 6 }}>→ Refinanced into {d.refinancedIntoName}</span>}
                  <div style={{ fontSize: 11, color: COLORS.muted }}>{d.loanType}{d.processingFee ? ` · fee ${fmt(d.processingFee, d.currency)}` : ""}</div>
                </td>
                <td style={td()}>{d.lender}</td>
                <td style={td()}>{d.loanStructure === "Fixed Term" ? "0% (Fixed)" : `${d.currentApr}%`}</td>
                <td style={td()}>{fmt(d.currentEmi, d.currency)}</td>
                <td style={td()}>{d.startDate}</td>
                <td style={td()}>{d.endDate || "—"}</td>
                <td style={td("right")}>{fmt(d.principal, d.currency)}</td>
                <td style={td("right")}>{fmt(d.totalPaid, d.currency)}</td>
                <td style={{ ...td("right"), fontWeight: 700 }}>{fmt(d.currentBalance, d.currency)}</td>
                <td style={td("right")}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Pencil size={14} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEdit(d)} />
                    <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteDebt(d)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={sectionHeading}>Payment log</h3>
          <button onClick={() => setShowPaymentLog((v) => !v)} style={btnStyleGhost}>
            {showPaymentLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showPaymentLog ? "Hide" : "Show"} payment log
          </button>
        </div>
        {showPaymentLog && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontFamily: sansFont, fontSize: 12 }}>
              <input type="date" style={{ ...inputStyle, width: 140 }} value={logFilters.from} onChange={(e) => setLogFilters({ ...logFilters, from: e.target.value })} />
              <input type="date" style={{ ...inputStyle, width: 140 }} value={logFilters.to} onChange={(e) => setLogFilters({ ...logFilters, to: e.target.value })} />
              <select style={selectStyle} value={logFilters.debtId} onChange={(e) => setLogFilters({ ...logFilters, debtId: e.target.value })}>
                <option value="All">All loans</option>
                {debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select style={selectStyle} value={logFilters.source} onChange={(e) => setLogFilters({ ...logFilters, source: e.target.value })}>
                <option value="All">All sources</option>
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
                <option value="fee">Fee</option>
                <option value="closure">Closure</option>
              </select>
              <select style={selectStyle} value={logFilters.currency} onChange={(e) => setLogFilters({ ...logFilters, currency: e.target.value })}>
                <option value="All">All currencies</option>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${COLORS.line}` }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: COLORS.bg }}><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
                  {["Loan", "Date", "Amount", "Principal", "Interest", "Balance after", "Source", ""].map((hd, i) => <th key={i} style={th(i > 1 && i < 6 ? "right" : "left")}>{hd}</th>)}
                </tr></thead>
                <tbody>
                  {filteredPaymentLog.slice(0, LOG_CAP).map((p) => (
                    <tr key={p.id} style={{ borderBottom: `1px solid ${COLORS.lineLight}` }}>
                      <td style={{ padding: 6 }}>{p.debtName}</td>
                      <td style={{ padding: 6 }}>{p.date}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.amount, p.currency)}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.principal, p.currency)}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.interest, p.currency)}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.balanceAfter, p.currency)}</td>
                      <td style={{ padding: 6, color: sourceColor(p.source) }}>{p.source}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{p.source === "manual" && <Trash2 size={13} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deletePayment(p)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredPaymentLog.length > LOG_CAP && <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Showing first {LOG_CAP} of {filteredPaymentLog.length} matching entries — narrow the filters to see more precisely.</p>}
            {filteredPaymentLog.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 6 }}>No entries match those filters.</p>}
          </>
        )}
      </div>

      {showAddDebt && (
        <Modal onClose={() => setShowAddDebt(false)} title={editingId ? "Edit loan" : "Add loan"}>
          <Field label="Loan name"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Home mortgage" /></Field>
          <Field label="Lender / source"><input style={inputStyle} value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} placeholder="e.g. Wells Fargo" /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Loan type"><select style={inputStyle} value={form.loanType} onChange={(e) => setForm({ ...form, loanType: e.target.value })}>{LOAN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Currency"><select style={inputStyle} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <Field label="Loan structure">
            <select style={inputStyle} value={form.loanStructure} onChange={(e) => setForm({ ...form, loanStructure: e.target.value })}>
              <option value="Amortizing">Amortizing — EMI covers interest + principal</option>
              <option value="Fixed Term">Fixed Term — 0% interest, fixed payment, balance due at term end</option>
            </select>
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label={`Original principal (${form.currency})`}><input type="number" style={inputStyle} value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></Field>
            <Field label={`Processing fee (${form.currency}, optional)`}><input type="number" style={inputStyle} value={form.processingFee} onChange={(e) => setForm({ ...form, processingFee: e.target.value })} /></Field>
          </div>

          <div style={{ borderTop: `1px solid ${COLORS.line}`, margin: "14px 0 10px", paddingTop: 10 }}>
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, margin: "0 0 10px" }}>{form.loanStructure === "Fixed Term" ? "Monthly payment" : "EMI"}</p>
            {!editingId ? (
              <Field label={`Starting ${form.loanStructure === "Fixed Term" ? "monthly payment" : "EMI"} (${form.currency})`}><input type="number" style={inputStyle} value={form.emiStart} onChange={(e) => setForm({ ...form, emiStart: e.target.value })} /></Field>
            ) : (
              <>
                {form.emiHistory.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 4px" }}>Payment history</p>
                    {[...form.emiHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).map((h, i) => (
                      <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${COLORS.lineLight}` }}><span>From {h.date}</span><span>{fmt(h.amount, form.currency)}</span></div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <Field label="Effective from"><input type="date" style={inputStyle} value={form.newEmiDate} onChange={(e) => setForm({ ...form, newEmiDate: e.target.value })} /></Field>
                  <Field label={`New amount (${form.currency})`}><input type="number" style={inputStyle} value={form.newEmiAmount} onChange={(e) => setForm({ ...form, newEmiAmount: e.target.value })} /></Field>
                  <button type="button" onClick={addEmiRate} style={{ ...btnStyle, marginBottom: 12 }}>Add</button>
                </div>
              </>
            )}
          </div>

          {form.loanStructure === "Amortizing" && (
            <div style={{ borderTop: `1px solid ${COLORS.line}`, margin: "14px 0 10px", paddingTop: 10 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, margin: "0 0 10px" }}>APR</p>
              {!editingId ? (
                <Field label="Starting APR (%)"><input type="number" step="0.01" style={inputStyle} value={form.aprStart} onChange={(e) => setForm({ ...form, aprStart: e.target.value })} /></Field>
              ) : (
                <>
                  {form.aprHistory.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 4px" }}>APR history</p>
                      {[...form.aprHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).map((h, i) => (
                        <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${COLORS.lineLight}` }}><span>From {h.date}</span><span>{h.amount}%</span></div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                    <Field label="Effective from"><input type="date" style={inputStyle} value={form.newAprDate} onChange={(e) => setForm({ ...form, newAprDate: e.target.value })} /></Field>
                    <Field label="New APR (%)"><input type="number" step="0.01" style={inputStyle} value={form.newAprAmount} onChange={(e) => setForm({ ...form, newAprAmount: e.target.value })} /></Field>
                    <button type="button" onClick={addAprRate} style={{ ...btnStyle, marginBottom: 12 }}>Add</button>
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ borderTop: `1px solid ${COLORS.line}`, margin: "14px 0 10px", paddingTop: 10 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Start date"><input type="date" style={inputStyle} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field>
              <Field label="Term (months, optional)"><input type="number" style={inputStyle} value={form.termMonths} onChange={(e) => setForm({ ...form, termMonths: e.target.value })} placeholder="e.g. 12" /></Field>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <Field label="End date / closure date"><input type="date" style={inputStyle} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
              <button type="button" onClick={fillEndDateFromTerm} style={{ ...btnStyleGhost, marginBottom: 12 }} disabled={!form.termMonths}>Fill from term</button>
            </div>
            <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 10px" }}>If a balance remains as of the end date — whether the term simply ran out (Fixed Term) or the loan was closed early — it's auto-logged as one final payoff on that date.</p>
            {form.endDate && (
              <Field label="Reason this loan ended (optional)">
                <select style={inputStyle} value={form.closureReason} onChange={(e) => setForm({ ...form, closureReason: e.target.value })}>
                  <option value="">— Not specified —</option>
                  {CLOSURE_REASONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </Field>
            )}
            <Field label="This loan replaces an earlier one (refinance), if any">
              <select style={inputStyle} value={form.refinancedFromId} onChange={(e) => setForm({ ...form, refinancedFromId: e.target.value })}>
                <option value="">— Not a refinance —</option>
                {debts.filter((d) => d.id !== editingId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            {form.refinancedFromId && <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 10px" }}>Saving will also mark that loan closed (reason: Refinanced) if it isn't already.</p>}
          </div>

          <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <button onClick={saveDebt} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0" }}>{editingId ? "Save changes" : "Save loan"}</button>
        </Modal>
      )}

      {showAddPayment && (
        <Modal onClose={() => setShowAddPayment(false)} title="Log a payment">
          <Field label="Loan"><select style={inputStyle} value={payForm.debtId} onChange={(e) => setPayForm({ ...payForm, debtId: e.target.value })}>{debts.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.currency || "INR"})</option>)}</select></Field>
          <Field label={`Amount paid (${debts.find((d) => d.id === payForm.debtId)?.currency || "INR"})`}><input type="number" style={inputStyle} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
          <Field label="Date"><input type="date" style={inputStyle} value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} /></Field>
          <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 10px" }}>Use this for extra payments, or if an actual payment differed from the scheduled amount that month — it replaces the auto-generated entry for that date.</p>
          <button onClick={addPayment} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0" }}>Save payment</button>
        </Modal>
      )}
    </div>
  );
}
