import React, { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from "recharts";
import { Plus, Pencil, Trash2, RefreshCcw, ChevronDown, ChevronUp, Receipt, Users } from "lucide-react";
import Modal from "../components/Modal.jsx";
import Field from "../components/Field.jsx";
import { getTable, setTable } from "../api.js";
import {
  COLORS, CURRENCIES, sansFont, fmt, todayStr, currentYearStr, sortRows, parseAmount, splitValidRows, isDuplicateValue, effectiveAmountAt,
  inputStyle, selectStyle, btnStyle, btnStyleGhost, sectionHeading, th, td, addMonthsClamped, toISODate, yearOf,
} from "../styles.js";

const EXPENSE_CATEGORIES = ["Rent", "Utilities", "Groceries", "Subscriptions", "Insurance", "Dining", "Transport", "Healthcare", "Entertainment", "Other"];
const INCOMING_CATEGORIES = ["Loan Repayment", "Reimbursement", "Rent Share", "Gift", "Other"];
const FREQUENCIES = ["One-time", "Monthly", "Quarterly", "Half Yearly", "Annually"];
const FREQ_MONTHS = { "Monthly": 1, "Quarterly": 3, "Half Yearly": 6, "Annually": 12 };
const LOG_CAP = 500;

// Recurring definitions (a subscription, a rent-share arrangement, etc.) are
// self-healing just like Investments/Debts elsewhere in this app: every load
// wipes source:"auto" rows and regenerates them from the schedule. Manual
// entries — including one-time expenses/transfers, which are just a manual
// log row with no recurringId — are never touched. Unlike the investment
// "rent income" model (paid in arrears, see InvestmentsPage), a recurring
// bill/transfer is due ON the anniversary itself, so k starts at 0.
//
// The amount can change over time (a rent increase, a subscription price
// change) via amountHistory — same effective-at-due-date lookup as
// Investments' returnHistory and Debts' emiHistory/aprHistory, so past
// auto-generated entries keep their original amount when the rate changes.
function generateRecurringDue(def, manualForDef) {
  const months = FREQ_MONTHS[def.frequency];
  if (!months || !def.startDate) return [];
  const manualDates = new Set(manualForDef.map((e) => e.date));
  const today = new Date(todayStr());
  const endLimit = def.endDate ? new Date(def.endDate) : today;
  const cutoff = endLimit < today ? endLimit : today;
  const due = [];
  let k = 0;
  while (k < 2400) {
    const dueDateObj = addMonthsClamped(def.startDate, k * months);
    if (dueDateObj > cutoff) break;
    const dueDateStr = toISODate(dueDateObj);
    const amount = effectiveAmountAt(def.amountHistory, dueDateObj);
    if (amount > 0 && !manualDates.has(dueDateStr)) {
      due.push({
        id: `auto-${def.id}-${dueDateStr}`, recurringId: def.id, date: dueDateStr,
        amount, currency: def.currency, source: "auto",
      });
    }
    k++;
  }
  return due;
}

function rebuildLog(defs, storedLog) {
  const manual = storedLog.filter((e) => e.source === "manual");
  let auto = [];
  defs.forEach((def) => {
    const manualForDef = manual.filter((e) => e.recurringId === def.id);
    auto = auto.concat(generateRecurringDue(def, manualForDef));
  });
  return [...manual, ...auto];
}

// Def rows are flat; amountHistory (an array) is serialized to/from a JSON
// string in one cell, same pattern as Investments/Debts. Legacy rows
// (pre-history, flat `amount` field) are seeded into a single-entry history.
function deserializeDef(row) {
  let amountHistory = [];
  try { amountHistory = row.amountHistoryJSON ? JSON.parse(row.amountHistoryJSON) : []; } catch (e) { amountHistory = []; }
  if (amountHistory.length === 0 && row.amount !== undefined && row.amount !== "") {
    amountHistory = [{ date: row.startDate || todayStr(), amount: parseAmount(row.amount) }];
  }
  return { ...row, currency: row.currency || "INR", amountHistory };
}
function serializeDef(def) {
  const { amountHistory, ...rest } = def;
  return { ...rest, amountHistoryJSON: JSON.stringify(amountHistory || []) };
}

export default function ExpensesPage() {
  const [expenseDefs, setExpenseDefs] = useState([]);
  const [expenseLog, setExpenseLog] = useState([]);
  const [incomingDefs, setIncomingDefs] = useState([]);
  const [incomingLog, setIncomingLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoAddedCount, setAutoAddedCount] = useState(0);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddIncoming, setShowAddIncoming] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingIncomingId, setEditingIncomingId] = useState(null);

  const [chartCurrency, setChartCurrency] = useState("INR");
  const [chartYear, setChartYear] = useState(currentYearStr());

  const [expSortField, setExpSortField] = useState("name");
  const [expSortDir, setExpSortDir] = useState("asc");
  const [incSortField, setIncSortField] = useState("person");
  const [incSortDir, setIncSortDir] = useState("asc");

  const [showExpenseLog, setShowExpenseLog] = useState(false);
  const [expLogFilters, setExpLogFilters] = useState({ from: "", to: "", category: "All", source: "All", currency: "All" });
  const [showIncomingLog, setShowIncomingLog] = useState(false);
  const [incLogFilters, setIncLogFilters] = useState({ from: "", to: "", category: "All", person: "All", source: "All", currency: "All" });

  const blankExpenseForm = { name: "", category: "Rent", currency: "INR", amount: "", frequency: "Monthly", date: todayStr(), startDate: "", endDate: "", notes: "", amountHistory: [], newAmountDate: "", newAmountAmount: "" };
  const [expenseForm, setExpenseForm] = useState(blankExpenseForm);
  const blankIncomingForm = { person: "", category: "Reimbursement", currency: "INR", amount: "", frequency: "One-time", date: todayStr(), startDate: "", endDate: "", notes: "", amountHistory: [], newAmountDate: "", newAmountAmount: "" };
  const [incomingForm, setIncomingForm] = useState(blankIncomingForm);

  useEffect(() => {
    (async () => {
      try {
        const [expDefRows, expLogRows, incDefRows, incLogRows] = await Promise.all([
          getTable("RecurringExpenses"), getTable("Expenses"), getTable("RecurringIncoming"), getTable("IncomingTransfers"),
        ]);
        const { valid: validExpDefRows, skipped: skippedExpDefs } = splitValidRows(expDefRows);
        const { valid: validExpLogRows, skipped: skippedExpLog } = splitValidRows(expLogRows);
        const { valid: validIncDefRows, skipped: skippedIncDefs } = splitValidRows(incDefRows);
        const { valid: validIncLogRows, skipped: skippedIncLog } = splitValidRows(incLogRows);
        const loadedExpDefs = validExpDefRows.map(deserializeDef);
        const loadedExpLog = validExpLogRows.map((r) => ({ ...r, amount: parseAmount(r.amount), currency: r.currency || "INR" }));
        const loadedIncDefs = validIncDefRows.map(deserializeDef);
        const loadedIncLog = validIncLogRows.map((r) => ({ ...r, amount: parseAmount(r.amount), currency: r.currency || "INR" }));
        const totalSkipped = skippedExpDefs + skippedExpLog + skippedIncDefs + skippedIncLog;
        if (totalSkipped) {
          setWarning(`Skipped ${totalSkipped} row(s) across the Expenses sheets that are missing an "id" — give every manually-added row a unique id to have it show up here.`);
        }

        const prevAuto = loadedExpLog.filter((e) => e.source === "auto").length + loadedIncLog.filter((e) => e.source === "auto").length;
        const rebuiltExp = rebuildLog(loadedExpDefs, loadedExpLog);
        const rebuiltInc = rebuildLog(loadedIncDefs, loadedIncLog);
        const newAuto = rebuiltExp.filter((e) => e.source === "auto").length + rebuiltInc.filter((e) => e.source === "auto").length;

        setExpenseDefs(loadedExpDefs);
        setExpenseLog(rebuiltExp);
        setIncomingDefs(loadedIncDefs);
        setIncomingLog(rebuiltInc);
        setAutoAddedCount(Math.max(0, newAuto - prevAuto));

        const presentCurrencies = CURRENCIES.filter((c) =>
          loadedExpDefs.some((d) => (d.currency || "INR") === c) || loadedIncDefs.some((d) => (d.currency || "INR") === c)
        );
        setChartCurrency(presentCurrencies[0] || "INR");

        await Promise.all([setTable("Expenses", rebuiltExp), setTable("IncomingTransfers", rebuiltInc)]);
      } catch (e) {
        setError("Couldn't load from Google Sheets. Check API_URL in src/api.js. " + e.message);
      } finally { setLoading(false); }
    })();
  }, []);

  const persist = async (kind, defs, log) => {
    try {
      if (kind === "expense") {
        if (defs) await setTable("RecurringExpenses", defs.map(serializeDef));
        if (log) await setTable("Expenses", log);
      } else {
        if (defs) await setTable("RecurringIncoming", defs.map(serializeDef));
        if (log) await setTable("IncomingTransfers", log);
      }
    } catch (e) { setError("Save failed: " + e.message); }
  };

  const activeCurrencies = useMemo(() => {
    const present = CURRENCIES.filter((c) =>
      expenseLog.some((e) => (e.currency || "INR") === c) || incomingLog.some((e) => (e.currency || "INR") === c)
    );
    return present.length ? present : ["INR"];
  }, [expenseLog, incomingLog]);

  const totalsByCurrency = useMemo(() => {
    const out = {};
    CURRENCIES.forEach((cur) => {
      const expTotal = expenseLog.filter((e) => (e.currency || "INR") === cur).reduce((s, e) => s + e.amount, 0);
      const incTotal = incomingLog.filter((e) => (e.currency || "INR") === cur).reduce((s, e) => s + e.amount, 0);
      out[cur] = { expTotal, incTotal, net: incTotal - expTotal };
    });
    return out;
  }, [expenseLog, incomingLog]);

  const availableYears = useMemo(() => {
    const set = new Set([...expenseLog.map((e) => yearOf(e.date)), ...incomingLog.map((e) => yearOf(e.date))].filter(Boolean));
    return Array.from(set).sort();
  }, [expenseLog, incomingLog]);

  const monthlyExpenseByCategory = useMemo(() => {
    const filtered = expenseLog.filter((e) => (e.currency || "INR") === chartCurrency && (chartYear === "All" || yearOf(e.date) === chartYear));
    const months = {};
    filtered.forEach((e) => {
      const def = expenseDefs.find((d) => d.id === e.recurringId);
      const category = e.category || def?.category || "Other";
      const m = new Date(e.date).toLocaleString("en-US", { month: "short", year: "2-digit" });
      if (!months[m]) months[m] = { month: m, sortKey: e.date.slice(0, 7) };
      months[m][category] = (months[m][category] || 0) + e.amount;
    });
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [expenseLog, expenseDefs, chartCurrency, chartYear]);

  const monthlyIncomingByCategory = useMemo(() => {
    const filtered = incomingLog.filter((e) => (e.currency || "INR") === chartCurrency && (chartYear === "All" || yearOf(e.date) === chartYear));
    const months = {};
    filtered.forEach((e) => {
      const def = incomingDefs.find((d) => d.id === e.recurringId);
      const category = e.category || def?.category || "Other";
      const m = new Date(e.date).toLocaleString("en-US", { month: "short", year: "2-digit" });
      if (!months[m]) months[m] = { month: m, sortKey: e.date.slice(0, 7) };
      months[m][category] = (months[m][category] || 0) + e.amount;
    });
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [incomingLog, incomingDefs, chartCurrency, chartYear]);

  const expenseDefsWithStats = useMemo(() => {
    const list = expenseDefs.map((d) => {
      const total = expenseLog.filter((e) => e.recurringId === d.id).reduce((s, e) => s + e.amount, 0);
      const sortedHist = d.amountHistory?.length ? [...d.amountHistory].sort((a, b) => new Date(a.date) - new Date(b.date)) : [];
      const currentAmount = sortedHist.length ? sortedHist[sortedHist.length - 1].amount : 0;
      return { ...d, total, currentAmount, amountChanged: sortedHist.length > 1 };
    });
    return sortRows(list, expSortField, expSortDir);
  }, [expenseDefs, expenseLog, expSortField, expSortDir]);

  const incomingDefsWithStats = useMemo(() => {
    const list = incomingDefs.map((d) => {
      const total = incomingLog.filter((e) => e.recurringId === d.id).reduce((s, e) => s + e.amount, 0);
      const sortedHist = d.amountHistory?.length ? [...d.amountHistory].sort((a, b) => new Date(a.date) - new Date(b.date)) : [];
      const currentAmount = sortedHist.length ? sortedHist[sortedHist.length - 1].amount : 0;
      return { ...d, total, currentAmount, amountChanged: sortedHist.length > 1 };
    });
    return sortRows(list, incSortField, incSortDir);
  }, [incomingDefs, incomingLog, incSortField, incSortDir]);

  const oneTimeExpenses = useMemo(() => sortRows(expenseLog.filter((e) => !e.recurringId), "date", "desc"), [expenseLog]);
  const oneTimeIncoming = useMemo(() => sortRows(incomingLog.filter((e) => !e.recurringId), "date", "desc"), [incomingLog]);

  const filteredExpenseLog = useMemo(() => {
    if (!showExpenseLog) return [];
    return [...expenseLog].sort((a, b) => b.date.localeCompare(a.date)).filter((e) =>
      (!expLogFilters.from || e.date >= expLogFilters.from) &&
      (!expLogFilters.to || e.date <= expLogFilters.to) &&
      (expLogFilters.category === "All" || (e.category || expenseDefs.find((d) => d.id === e.recurringId)?.category) === expLogFilters.category) &&
      (expLogFilters.source === "All" || e.source === expLogFilters.source) &&
      (expLogFilters.currency === "All" || (e.currency || "INR") === expLogFilters.currency)
    );
  }, [expenseLog, expenseDefs, expLogFilters, showExpenseLog]);

  const filteredIncomingLog = useMemo(() => {
    if (!showIncomingLog) return [];
    return [...incomingLog].sort((a, b) => b.date.localeCompare(a.date)).filter((e) =>
      (!incLogFilters.from || e.date >= incLogFilters.from) &&
      (!incLogFilters.to || e.date <= incLogFilters.to) &&
      (incLogFilters.category === "All" || (e.category || incomingDefs.find((d) => d.id === e.recurringId)?.category) === incLogFilters.category) &&
      (incLogFilters.person === "All" || (e.person || incomingDefs.find((d) => d.id === e.recurringId)?.person) === incLogFilters.person) &&
      (incLogFilters.source === "All" || e.source === incLogFilters.source) &&
      (incLogFilters.currency === "All" || (e.currency || "INR") === incLogFilters.currency)
    );
  }, [incomingLog, incomingDefs, incLogFilters, showIncomingLog]);

  const openAddExpense = () => { setEditingExpenseId(null); setExpenseForm(blankExpenseForm); setShowAddExpense(true); };
  const openEditExpense = (d) => {
    setEditingExpenseId(d.id);
    setExpenseForm({ name: d.name, category: d.category, currency: d.currency || "INR", amount: "", frequency: d.frequency, date: todayStr(), startDate: d.startDate, endDate: d.endDate || "", notes: d.notes || "", amountHistory: d.amountHistory || [], newAmountDate: "", newAmountAmount: "" });
    setShowAddExpense(true);
  };
  const openEditOneTimeExpense = (e) => {
    setEditingExpenseId(e.id);
    setExpenseForm({ name: e.name || "", category: e.category, currency: e.currency || "INR", amount: e.amount, frequency: "One-time", date: e.date, startDate: "", endDate: "", notes: e.notes || "", amountHistory: [], newAmountDate: "", newAmountAmount: "" });
    setShowAddExpense(true);
  };

  const addExpenseAmountChange = () => {
    if (!expenseForm.newAmountDate || !expenseForm.newAmountAmount) return;
    const next = [...expenseForm.amountHistory, { date: expenseForm.newAmountDate, amount: parseAmount(expenseForm.newAmountAmount) }].sort((a, b) => new Date(a.date) - new Date(b.date));
    setExpenseForm({ ...expenseForm, amountHistory: next, newAmountDate: "", newAmountAmount: "" });
  };

  const saveExpense = async () => {
    if (!expenseForm.name) return;
    if (expenseForm.frequency === "One-time") {
      if (!expenseForm.amount || !expenseForm.date) return;
      if (!editingExpenseId && expenseLog.some((e) => !e.recurringId && e.name?.trim().toLowerCase() === expenseForm.name.trim().toLowerCase() && e.date === expenseForm.date)) {
        if (!window.confirm(`A one-time expense named "${expenseForm.name}" on ${expenseForm.date} already exists. Add another one anyway?`)) return;
      }
      const entry = {
        id: editingExpenseId || Date.now().toString(), recurringId: "", date: expenseForm.date, name: expenseForm.name, category: expenseForm.category,
        currency: expenseForm.currency, amount: parseAmount(expenseForm.amount), source: "manual", notes: expenseForm.notes,
      };
      const nextLog = editingExpenseId ? expenseLog.map((e) => e.id === editingExpenseId ? entry : e) : [...expenseLog, entry];
      setExpenseLog(nextLog);
      await persist("expense", null, nextLog);
    } else {
      if (!expenseForm.startDate) return;
      if (!editingExpenseId && isDuplicateValue(expenseDefs, "name", expenseForm.name)) {
        if (!window.confirm(`A recurring expense named "${expenseForm.name}" already exists. Add another one anyway?`)) return;
      }
      const amountHistory = editingExpenseId
        ? expenseForm.amountHistory
        : (expenseForm.amount ? [{ date: expenseForm.startDate, amount: parseAmount(expenseForm.amount) }] : []);
      if (amountHistory.length === 0) return;
      const defData = { name: expenseForm.name, category: expenseForm.category, currency: expenseForm.currency, frequency: expenseForm.frequency, startDate: expenseForm.startDate, endDate: expenseForm.endDate || "", notes: expenseForm.notes, amountHistory };
      let nextDefs;
      if (editingExpenseId) nextDefs = expenseDefs.map((d) => d.id === editingExpenseId ? { ...d, ...defData } : d);
      else nextDefs = [...expenseDefs, { id: Date.now().toString(), ...defData }];
      const nextLog = rebuildLog(nextDefs, expenseLog);
      setExpenseDefs(nextDefs);
      setExpenseLog(nextLog);
      await persist("expense", nextDefs, nextLog);
    }
    setShowAddExpense(false);
  };

  const deleteExpenseDef = async (d) => {
    if (!window.confirm(`Delete "${d.name}"? This also removes its ${expenseLog.filter((e) => e.recurringId === d.id).length} log entries. This can't be undone.`)) return;
    const nextDefs = expenseDefs.filter((x) => x.id !== d.id);
    const nextLog = expenseLog.filter((e) => e.recurringId !== d.id);
    setExpenseDefs(nextDefs);
    setExpenseLog(nextLog);
    await persist("expense", nextDefs, nextLog);
  };

  const deleteOneTimeExpense = async (e) => {
    if (!window.confirm(`Delete this one-time expense of ${fmt(e.amount, e.currency)} on ${e.date}?`)) return;
    const nextLog = expenseLog.filter((x) => x.id !== e.id);
    setExpenseLog(nextLog);
    await persist("expense", null, nextLog);
  };

  const openAddIncoming = () => { setEditingIncomingId(null); setIncomingForm(blankIncomingForm); setShowAddIncoming(true); };
  const openEditIncoming = (d) => {
    setEditingIncomingId(d.id);
    setIncomingForm({ person: d.person, category: d.category, currency: d.currency || "INR", amount: "", frequency: d.frequency, date: todayStr(), startDate: d.startDate, endDate: d.endDate || "", notes: d.notes || "", amountHistory: d.amountHistory || [], newAmountDate: "", newAmountAmount: "" });
    setShowAddIncoming(true);
  };
  const openEditOneTimeIncoming = (e) => {
    setEditingIncomingId(e.id);
    setIncomingForm({ person: e.person || "", category: e.category, currency: e.currency || "INR", amount: e.amount, frequency: "One-time", date: e.date, startDate: "", endDate: "", notes: e.notes || "", amountHistory: [], newAmountDate: "", newAmountAmount: "" });
    setShowAddIncoming(true);
  };

  const addIncomingAmountChange = () => {
    if (!incomingForm.newAmountDate || !incomingForm.newAmountAmount) return;
    const next = [...incomingForm.amountHistory, { date: incomingForm.newAmountDate, amount: parseAmount(incomingForm.newAmountAmount) }].sort((a, b) => new Date(a.date) - new Date(b.date));
    setIncomingForm({ ...incomingForm, amountHistory: next, newAmountDate: "", newAmountAmount: "" });
  };

  const saveIncoming = async () => {
    if (!incomingForm.person) return;
    if (incomingForm.frequency === "One-time") {
      if (!incomingForm.amount || !incomingForm.date) return;
      if (!editingIncomingId && incomingLog.some((e) => !e.recurringId && e.person?.trim().toLowerCase() === incomingForm.person.trim().toLowerCase() && e.date === incomingForm.date)) {
        if (!window.confirm(`A one-time transfer from "${incomingForm.person}" on ${incomingForm.date} already exists. Add another one anyway?`)) return;
      }
      const entry = {
        id: editingIncomingId || Date.now().toString(), recurringId: "", date: incomingForm.date, person: incomingForm.person, category: incomingForm.category,
        currency: incomingForm.currency, amount: parseAmount(incomingForm.amount), source: "manual", notes: incomingForm.notes,
      };
      const nextLog = editingIncomingId ? incomingLog.map((e) => e.id === editingIncomingId ? entry : e) : [...incomingLog, entry];
      setIncomingLog(nextLog);
      await persist("incoming", null, nextLog);
    } else {
      if (!incomingForm.startDate) return;
      if (!editingIncomingId && isDuplicateValue(incomingDefs, "person", incomingForm.person)) {
        if (!window.confirm(`A recurring transfer from "${incomingForm.person}" already exists. Add another one anyway?`)) return;
      }
      const amountHistory = editingIncomingId
        ? incomingForm.amountHistory
        : (incomingForm.amount ? [{ date: incomingForm.startDate, amount: parseAmount(incomingForm.amount) }] : []);
      if (amountHistory.length === 0) return;
      const defData = { person: incomingForm.person, category: incomingForm.category, currency: incomingForm.currency, frequency: incomingForm.frequency, startDate: incomingForm.startDate, endDate: incomingForm.endDate || "", notes: incomingForm.notes, amountHistory };
      let nextDefs;
      if (editingIncomingId) nextDefs = incomingDefs.map((d) => d.id === editingIncomingId ? { ...d, ...defData } : d);
      else nextDefs = [...incomingDefs, { id: Date.now().toString(), ...defData }];
      const nextLog = rebuildLog(nextDefs, incomingLog);
      setIncomingDefs(nextDefs);
      setIncomingLog(nextLog);
      await persist("incoming", nextDefs, nextLog);
    }
    setShowAddIncoming(false);
  };

  const deleteIncomingDef = async (d) => {
    if (!window.confirm(`Delete the recurring transfer from "${d.person}"? This also removes its ${incomingLog.filter((e) => e.recurringId === d.id).length} log entries. This can't be undone.`)) return;
    const nextDefs = incomingDefs.filter((x) => x.id !== d.id);
    const nextLog = incomingLog.filter((e) => e.recurringId !== d.id);
    setIncomingDefs(nextDefs);
    setIncomingLog(nextLog);
    await persist("incoming", nextDefs, nextLog);
  };

  const deleteOneTimeIncoming = async (e) => {
    if (!window.confirm(`Delete this one-time transfer of ${fmt(e.amount, e.currency)} from "${e.person}" on ${e.date}?`)) return;
    const nextLog = incomingLog.filter((x) => x.id !== e.id);
    setIncomingLog(nextLog);
    await persist("incoming", null, nextLog);
  };

  const people = useMemo(() => Array.from(new Set([...incomingDefs.map((d) => d.person), ...incomingLog.map((e) => e.person).filter(Boolean)])).sort(), [incomingDefs, incomingLog]);

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading expenses…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setError("")}>{error} (click to dismiss)</div>}
      {warning && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.gold, border: `1px solid ${COLORS.gold}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setWarning("")}>{warning} (click to dismiss)</div>}

      {autoAddedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: sansFont, color: COLORS.positive, background: "#E1F5EE", border: `1px solid ${COLORS.positive}`, padding: "8px 12px", margin: "0 0 16px" }}>
          <RefreshCcw size={13} /> Auto-added {autoAddedCount} recurring {autoAddedCount === 1 ? "entry" : "entries"}.
        </div>
      )}

      {activeCurrencies.map((cur) => (
        <div key={cur} style={{ marginBottom: 8 }}>
          <p style={{ fontFamily: sansFont, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 6px" }}>{cur}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 16 }}>
            {[
              { label: "Total expenses", value: fmt(totalsByCurrency[cur].expTotal, cur) },
              { label: "Total received from individuals", value: fmt(totalsByCurrency[cur].incTotal, cur) },
              { label: "Net", value: fmt(totalsByCurrency[cur].net, cur), positive: totalsByCurrency[cur].net >= 0 },
            ].map((m, idx) => (
              <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
                <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
                <p style={{ fontSize: 24, margin: 0, fontWeight: 400, color: m.positive === undefined ? COLORS.ink : (m.positive ? COLORS.positive : COLORS.negative) }}>{m.value}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20, marginTop: 12 }}>
        <select value={chartYear} onChange={(e) => setChartYear(e.target.value)} style={selectStyle}>
          <option value="All">All years</option>
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={chartCurrency} onChange={(e) => setChartCurrency(e.target.value)} style={selectStyle}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 44 }}>
        <div>
          <h3 style={{ ...sectionHeading, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Receipt size={14} /> Monthly expenses by category</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyExpenseByCategory}>
              <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
              <RTooltip formatter={(v) => fmt(v, chartCurrency)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
              {EXPENSE_CATEGORIES.map((cat, i) => <Bar key={cat} dataKey={cat} stackId="a" fill={["#993C1D", "#854F0B", "#185FA5", "#534AB7", "#0F6E56", "#3E7CB1", "#B1653E", "#5C8A3E", "#8A3E6E", "#6B675C"][i % 10]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <h3 style={{ ...sectionHeading, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Users size={14} /> Monthly incoming by category</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyIncomingByCategory}>
              <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
              <RTooltip formatter={(v) => fmt(v, chartCurrency)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
              {INCOMING_CATEGORIES.map((cat, i) => <Bar key={cat} dataKey={cat} stackId="a" fill={["#0F6E56", "#185FA5", "#534AB7", "#854F0B", "#993C1D"][i % 5]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Recurring & scheduled expenses</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select value={expSortField} onChange={(e) => setExpSortField(e.target.value)} style={selectStyle}>
              <option value="name">Sort: Name</option>
              <option value="startDate">Sort: Start date</option>
              <option value="currentAmount">Sort: Amount</option>
            </select>
            <button onClick={() => setExpSortDir((d) => (d === "asc" ? "desc" : "asc"))} style={btnStyleGhost}>{expSortDir === "asc" ? "↑ Asc" : "↓ Desc"}</button>
            <button onClick={openAddExpense} style={btnStyle}><Plus size={13} /> Add expense</button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["Name", "Category", "Frequency", "Start", "End", "Amount", "Total to date", ""].map((h, i) => <th key={i} style={th(i > 4 && i < 7 ? "right" : "left")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {expenseDefsWithStats.map((d) => (
              <tr key={d.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={td()}>{d.name} <span style={{ fontSize: 10, color: COLORS.muted, border: `1px solid ${COLORS.line}`, padding: "1px 5px", marginLeft: 4 }}>{d.currency || "INR"}</span></td>
                <td style={{ ...td(), fontSize: 12, color: COLORS.muted }}>{d.category}</td>
                <td style={td()}>{d.frequency}</td>
                <td style={td()}>{d.startDate}</td>
                <td style={td()}>{d.endDate || "—"}</td>
                <td style={td("right")}>{fmt(d.currentAmount, d.currency)}{d.amountChanged && <span style={{ fontSize: 10, color: COLORS.muted }}> · changed</span>}</td>
                <td style={td("right")}>{fmt(d.total, d.currency)}</td>
                <td style={td("right")}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Pencil size={14} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEditExpense(d)} />
                    <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteExpenseDef(d)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {expenseDefsWithStats.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 10 }}>No recurring expenses yet — one-time expenses are logged directly via "Add expense" too (choose frequency "One-time").</p>}
        {oneTimeExpenses.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>One-time expenses</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 12 }}>
              <tbody>
                {oneTimeExpenses.slice(0, 10).map((e) => (
                  <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.lineLight}` }}>
                    <td style={{ padding: 6 }}>{e.date}</td>
                    <td style={{ padding: 6 }}>{e.name}</td>
                    <td style={{ padding: 6, color: COLORS.muted }}>{e.category}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{fmt(e.amount, e.currency)}</td>
                    <td style={{ padding: 6, color: COLORS.muted }}>{e.notes}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Pencil size={13} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEditOneTimeExpense(e)} />
                        <Trash2 size={13} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteOneTimeExpense(e)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {oneTimeExpenses.length > 10 && <p style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Showing the 10 most recent — open the full log below to see all {oneTimeExpenses.length}.</p>}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Recurring & scheduled transfers from individuals</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select value={incSortField} onChange={(e) => setIncSortField(e.target.value)} style={selectStyle}>
              <option value="person">Sort: Person</option>
              <option value="startDate">Sort: Start date</option>
              <option value="currentAmount">Sort: Amount</option>
            </select>
            <button onClick={() => setIncSortDir((d) => (d === "asc" ? "desc" : "asc"))} style={btnStyleGhost}>{incSortDir === "asc" ? "↑ Asc" : "↓ Desc"}</button>
            <button onClick={openAddIncoming} style={btnStyle}><Plus size={13} /> Add transfer</button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["Person", "Category", "Frequency", "Start", "End", "Amount", "Total to date", ""].map((h, i) => <th key={i} style={th(i > 4 && i < 7 ? "right" : "left")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {incomingDefsWithStats.map((d) => (
              <tr key={d.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={td()}>{d.person} <span style={{ fontSize: 10, color: COLORS.muted, border: `1px solid ${COLORS.line}`, padding: "1px 5px", marginLeft: 4 }}>{d.currency || "INR"}</span></td>
                <td style={{ ...td(), fontSize: 12, color: COLORS.muted }}>{d.category}</td>
                <td style={td()}>{d.frequency}</td>
                <td style={td()}>{d.startDate}</td>
                <td style={td()}>{d.endDate || "—"}</td>
                <td style={td("right")}>{fmt(d.currentAmount, d.currency)}{d.amountChanged && <span style={{ fontSize: 10, color: COLORS.muted }}> · changed</span>}</td>
                <td style={{ ...td("right"), color: COLORS.positive, fontWeight: 700 }}>{fmt(d.total, d.currency)}</td>
                <td style={td("right")}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Pencil size={14} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEditIncoming(d)} />
                    <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteIncomingDef(d)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {incomingDefsWithStats.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 10 }}>No recurring transfers yet — one-time transfers are logged directly via "Add transfer" too (choose frequency "One-time").</p>}
        {oneTimeIncoming.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>One-time transfers</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 12 }}>
              <tbody>
                {oneTimeIncoming.slice(0, 10).map((e) => (
                  <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.lineLight}` }}>
                    <td style={{ padding: 6 }}>{e.date}</td>
                    <td style={{ padding: 6 }}>{e.person}</td>
                    <td style={{ padding: 6, color: COLORS.muted }}>{e.category}</td>
                    <td style={{ padding: 6, textAlign: "right", color: COLORS.positive }}>{fmt(e.amount, e.currency)}</td>
                    <td style={{ padding: 6, color: COLORS.muted }}>{e.notes}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Pencil size={13} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEditOneTimeIncoming(e)} />
                        <Trash2 size={13} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteOneTimeIncoming(e)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {oneTimeIncoming.length > 10 && <p style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Showing the 10 most recent — open the full log below to see all {oneTimeIncoming.length}.</p>}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={sectionHeading}>Expense log</h3>
          <button onClick={() => setShowExpenseLog((v) => !v)} style={btnStyleGhost}>
            {showExpenseLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showExpenseLog ? "Hide" : "Show"} expense log
          </button>
        </div>
        {showExpenseLog && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontFamily: sansFont, fontSize: 12 }}>
              <input type="date" style={{ ...inputStyle, width: 140 }} value={expLogFilters.from} onChange={(e) => setExpLogFilters({ ...expLogFilters, from: e.target.value })} />
              <input type="date" style={{ ...inputStyle, width: 140 }} value={expLogFilters.to} onChange={(e) => setExpLogFilters({ ...expLogFilters, to: e.target.value })} />
              <select style={selectStyle} value={expLogFilters.category} onChange={(e) => setExpLogFilters({ ...expLogFilters, category: e.target.value })}>
                <option value="All">All categories</option>
                {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select style={selectStyle} value={expLogFilters.source} onChange={(e) => setExpLogFilters({ ...expLogFilters, source: e.target.value })}>
                <option value="All">All sources</option>
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
              <select style={selectStyle} value={expLogFilters.currency} onChange={(e) => setExpLogFilters({ ...expLogFilters, currency: e.target.value })}>
                <option value="All">All currencies</option>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${COLORS.line}` }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: COLORS.bg }}><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
                  {["Name", "Category", "Date", "Amount", "Source"].map((hd, i) => <th key={i} style={th(i === 3 ? "right" : "left")}>{hd}</th>)}
                </tr></thead>
                <tbody>
                  {filteredExpenseLog.slice(0, LOG_CAP).map((e) => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.lineLight}` }}>
                      <td style={{ padding: 6 }}>{expenseDefs.find((d) => d.id === e.recurringId)?.name || e.name || "One-time"}</td>
                      <td style={{ padding: 6, color: COLORS.muted }}>{e.category || expenseDefs.find((d) => d.id === e.recurringId)?.category}</td>
                      <td style={{ padding: 6 }}>{e.date}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{fmt(e.amount, e.currency)}</td>
                      <td style={{ padding: 6, color: e.source === "auto" ? COLORS.muted : COLORS.positive }}>{e.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredExpenseLog.length > LOG_CAP && <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Showing first {LOG_CAP} of {filteredExpenseLog.length} matching entries — narrow the filters to see more precisely.</p>}
            {filteredExpenseLog.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 6 }}>No entries match those filters.</p>}
          </>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={sectionHeading}>Incoming transfer log</h3>
          <button onClick={() => setShowIncomingLog((v) => !v)} style={btnStyleGhost}>
            {showIncomingLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showIncomingLog ? "Hide" : "Show"} incoming log
          </button>
        </div>
        {showIncomingLog && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontFamily: sansFont, fontSize: 12 }}>
              <input type="date" style={{ ...inputStyle, width: 140 }} value={incLogFilters.from} onChange={(e) => setIncLogFilters({ ...incLogFilters, from: e.target.value })} />
              <input type="date" style={{ ...inputStyle, width: 140 }} value={incLogFilters.to} onChange={(e) => setIncLogFilters({ ...incLogFilters, to: e.target.value })} />
              <select style={selectStyle} value={incLogFilters.category} onChange={(e) => setIncLogFilters({ ...incLogFilters, category: e.target.value })}>
                <option value="All">All categories</option>
                {INCOMING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select style={selectStyle} value={incLogFilters.person} onChange={(e) => setIncLogFilters({ ...incLogFilters, person: e.target.value })}>
                <option value="All">All people</option>
                {people.map((p) => <option key={p}>{p}</option>)}
              </select>
              <select style={selectStyle} value={incLogFilters.source} onChange={(e) => setIncLogFilters({ ...incLogFilters, source: e.target.value })}>
                <option value="All">All sources</option>
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
              <select style={selectStyle} value={incLogFilters.currency} onChange={(e) => setIncLogFilters({ ...incLogFilters, currency: e.target.value })}>
                <option value="All">All currencies</option>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${COLORS.line}` }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: COLORS.bg }}><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
                  {["Person", "Category", "Date", "Amount", "Source"].map((hd, i) => <th key={i} style={th(i === 3 ? "right" : "left")}>{hd}</th>)}
                </tr></thead>
                <tbody>
                  {filteredIncomingLog.slice(0, LOG_CAP).map((e) => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.lineLight}` }}>
                      <td style={{ padding: 6 }}>{e.person || incomingDefs.find((d) => d.id === e.recurringId)?.person}</td>
                      <td style={{ padding: 6, color: COLORS.muted }}>{e.category || incomingDefs.find((d) => d.id === e.recurringId)?.category}</td>
                      <td style={{ padding: 6 }}>{e.date}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{fmt(e.amount, e.currency)}</td>
                      <td style={{ padding: 6, color: e.source === "auto" ? COLORS.muted : COLORS.positive }}>{e.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredIncomingLog.length > LOG_CAP && <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Showing first {LOG_CAP} of {filteredIncomingLog.length} matching entries — narrow the filters to see more precisely.</p>}
            {filteredIncomingLog.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 6 }}>No entries match those filters.</p>}
          </>
        )}
      </div>

      {showAddExpense && (
        <Modal onClose={() => setShowAddExpense(false)} title={editingExpenseId ? "Edit expense" : "Add expense"}>
          <Field label="Name"><input style={inputStyle} value={expenseForm.name} onChange={(e) => setExpenseForm({ ...expenseForm, name: e.target.value })} placeholder="e.g. Netflix, Apartment rent" /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Category"><select style={inputStyle} value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Currency"><select style={inputStyle} value={expenseForm.currency} onChange={(e) => setExpenseForm({ ...expenseForm, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Frequency"><select style={inputStyle} value={expenseForm.frequency} onChange={(e) => setExpenseForm({ ...expenseForm, frequency: e.target.value })}>{FREQUENCIES.map((f) => <option key={f}>{f}</option>)}</select></Field>
            {expenseForm.frequency === "One-time" && <Field label={`Amount (${expenseForm.currency})`}><input type="number" style={inputStyle} value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></Field>}
          </div>
          {expenseForm.frequency === "One-time" ? (
            <Field label="Date"><input type="date" style={inputStyle} value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} /></Field>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Start date"><input type="date" style={inputStyle} value={expenseForm.startDate} onChange={(e) => setExpenseForm({ ...expenseForm, startDate: e.target.value })} /></Field>
              <Field label="End date (optional)"><input type="date" style={inputStyle} value={expenseForm.endDate} onChange={(e) => setExpenseForm({ ...expenseForm, endDate: e.target.value })} /></Field>
            </div>
          )}
          {expenseForm.frequency !== "One-time" && (
            <div style={{ borderTop: `1px solid ${COLORS.line}`, margin: "10px 0", paddingTop: 10 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, margin: "0 0 10px" }}>Amount</p>
              {!editingExpenseId ? (
                <Field label={`Starting amount (${expenseForm.currency})`}><input type="number" style={inputStyle} value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></Field>
              ) : (
                <>
                  {expenseForm.amountHistory.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 4px" }}>Amount history</p>
                      {[...expenseForm.amountHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).map((h, i) => (
                        <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${COLORS.lineLight}` }}><span>From {h.date}</span><span>{fmt(h.amount, expenseForm.currency)}</span></div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                    <Field label="Effective from"><input type="date" style={inputStyle} value={expenseForm.newAmountDate} onChange={(e) => setExpenseForm({ ...expenseForm, newAmountDate: e.target.value })} /></Field>
                    <Field label={`New amount (${expenseForm.currency})`}><input type="number" style={inputStyle} value={expenseForm.newAmountAmount} onChange={(e) => setExpenseForm({ ...expenseForm, newAmountAmount: e.target.value })} /></Field>
                    <button type="button" onClick={addExpenseAmountChange} style={{ ...btnStyle, marginBottom: 12 }}>Add</button>
                  </div>
                </>
              )}
            </div>
          )}
          <Field label="Notes"><input style={inputStyle} value={expenseForm.notes} onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })} /></Field>
          {expenseForm.frequency !== "One-time" && <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 10px" }}>Recurring expenses are auto-logged on each anniversary of the start date, up to today (or the end date), using whichever amount was in effect at that date — a price change never rewrites past entries. Log an actual amount separately if a specific date differs from the schedule — that replaces the auto-generated entry for that date.</p>}
          <button onClick={saveExpense} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0" }}>{editingExpenseId ? "Save changes" : "Save expense"}</button>
        </Modal>
      )}

      {showAddIncoming && (
        <Modal onClose={() => setShowAddIncoming(false)} title={editingIncomingId ? "Edit transfer" : "Add transfer from a person"}>
          <Field label="Person"><input style={inputStyle} value={incomingForm.person} onChange={(e) => setIncomingForm({ ...incomingForm, person: e.target.value })} placeholder="e.g. Roommate name" /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Category"><select style={inputStyle} value={incomingForm.category} onChange={(e) => setIncomingForm({ ...incomingForm, category: e.target.value })}>{INCOMING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Currency"><select style={inputStyle} value={incomingForm.currency} onChange={(e) => setIncomingForm({ ...incomingForm, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Frequency"><select style={inputStyle} value={incomingForm.frequency} onChange={(e) => setIncomingForm({ ...incomingForm, frequency: e.target.value })}>{FREQUENCIES.map((f) => <option key={f}>{f}</option>)}</select></Field>
            {incomingForm.frequency === "One-time" && <Field label={`Amount (${incomingForm.currency})`}><input type="number" style={inputStyle} value={incomingForm.amount} onChange={(e) => setIncomingForm({ ...incomingForm, amount: e.target.value })} /></Field>}
          </div>
          {incomingForm.frequency === "One-time" ? (
            <Field label="Date"><input type="date" style={inputStyle} value={incomingForm.date} onChange={(e) => setIncomingForm({ ...incomingForm, date: e.target.value })} /></Field>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Start date"><input type="date" style={inputStyle} value={incomingForm.startDate} onChange={(e) => setIncomingForm({ ...incomingForm, startDate: e.target.value })} /></Field>
              <Field label="End date (optional)"><input type="date" style={inputStyle} value={incomingForm.endDate} onChange={(e) => setIncomingForm({ ...incomingForm, endDate: e.target.value })} /></Field>
            </div>
          )}
          {incomingForm.frequency !== "One-time" && (
            <div style={{ borderTop: `1px solid ${COLORS.line}`, margin: "10px 0", paddingTop: 10 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, margin: "0 0 10px" }}>Amount</p>
              {!editingIncomingId ? (
                <Field label={`Starting amount (${incomingForm.currency})`}><input type="number" style={inputStyle} value={incomingForm.amount} onChange={(e) => setIncomingForm({ ...incomingForm, amount: e.target.value })} /></Field>
              ) : (
                <>
                  {incomingForm.amountHistory.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 4px" }}>Amount history</p>
                      {[...incomingForm.amountHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).map((h, i) => (
                        <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${COLORS.lineLight}` }}><span>From {h.date}</span><span>{fmt(h.amount, incomingForm.currency)}</span></div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                    <Field label="Effective from"><input type="date" style={inputStyle} value={incomingForm.newAmountDate} onChange={(e) => setIncomingForm({ ...incomingForm, newAmountDate: e.target.value })} /></Field>
                    <Field label={`New amount (${incomingForm.currency})`}><input type="number" style={inputStyle} value={incomingForm.newAmountAmount} onChange={(e) => setIncomingForm({ ...incomingForm, newAmountAmount: e.target.value })} /></Field>
                    <button type="button" onClick={addIncomingAmountChange} style={{ ...btnStyle, marginBottom: 12 }}>Add</button>
                  </div>
                </>
              )}
            </div>
          )}
          <Field label="Notes"><input style={inputStyle} value={incomingForm.notes} onChange={(e) => setIncomingForm({ ...incomingForm, notes: e.target.value })} /></Field>
          <button onClick={saveIncoming} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0" }}>{editingIncomingId ? "Save changes" : "Save transfer"}</button>
        </Modal>
      )}
    </div>
  );
}
