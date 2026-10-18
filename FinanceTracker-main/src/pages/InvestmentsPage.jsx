import React, { useState, useMemo, useEffect } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  PieChart, Pie, Cell, Legend
} from "recharts";
import {
  Plus, TrendingUp, TrendingDown, Home, LineChart as LineChartIcon, Landmark, Coins, Pencil,
  RefreshCcw, Download, Settings, Trash2, ChevronDown, ChevronUp, Layers,
} from "lucide-react";
import Modal from "../components/Modal.jsx";
import Field from "../components/Field.jsx";
import { getTable, setTable } from "../api.js";
import {
  COLORS, CURRENCIES, colorForClass, sansFont, fmt, pct, todayStr, currentYearStr, sortRows, parseAmount, splitValidRows, isDuplicateValue, effectiveAmountAt,
  inputStyle, selectStyle, btnStyle, btnStyleGhost, sectionHeading, th, td, addMonthsClamped, addDays, toISODate, yearOf,
} from "../styles.js";

const FREQ_MONTHS = { "Monthly": 1, "Quarterly": 3, "Half Yearly": 6, "Annually": 12, "None": null };
const FREQ_LABEL = { "Monthly": "mo", "Quarterly": "qtr", "Half Yearly": "6mo", "Annually": "yr" };
const DEFAULT_ASSET_CLASSES = ["Real Estate", "Equity", "Mutual Fund", "Fixed Deposit", "Crypto"];
const INCOME_TYPES = ["Rent", "Dividend", "Interest"];
const LOG_CAP = 500;

// effectiveAmountAt is now shared in styles.js (used by Debts' EMI/APR
// history and Expenses' recurring-amount history too).

function generateAutoEntries(inv, manualEntriesForInv) {
  const months = FREQ_MONTHS[inv.returnFrequency];
  if (!months || !inv.returnHistory || inv.returnHistory.length === 0 || !inv.purchaseDate) return [];
  const manualDates = new Set(manualEntriesForInv.map((e) => e.date));
  const today = new Date(todayStr());
  const endLimit = inv.endDate ? new Date(inv.endDate) : today;
  const cutoff = endLimit < today ? endLimit : today;
  const due = [];
  let k = 1;
  while (k < 2000) {
    // A period runs from the day AFTER one anniversary through the next
    // anniversary (inclusive), paid the day after that — e.g. a holding
    // anniversary'd on the 1st logs period 6/1-6/30, paid 7/1. (Previously
    // this ran anniversary-to-anniversary and paid on the closing anniversary
    // itself, e.g. 5/31-6/29 paid 6/30 — off by one day throughout.)
    const periodStart = addDays(addMonthsClamped(inv.purchaseDate, (k - 1) * months), 1);
    const payDate = addDays(addMonthsClamped(inv.purchaseDate, k * months), 1);
    if (payDate > cutoff) break;
    const periodEnd = addDays(payDate, -1);
    const amount = effectiveAmountAt(inv.returnHistory, periodStart);
    const payDateStr = toISODate(payDate);
    if (amount > 0 && !manualDates.has(payDateStr)) {
      due.push({
        id: `auto-${inv.id}-${payDateStr}`, investmentId: inv.id, type: inv.returnType, amount, date: payDateStr,
        periodStart: toISODate(periodStart), periodEnd: toISODate(periodEnd), source: "auto",
        currency: inv.currency || "INR",
      });
    }
    k++;
  }
  return due;
}

function rebuildIncome(invList, storedIncome) {
  const manual = storedIncome.filter((e) => e.source !== "auto");
  let auto = [];
  invList.forEach((inv) => {
    const manualForInv = manual.filter((e) => e.investmentId === inv.id);
    auto = auto.concat(generateAutoEntries(inv, manualForInv));
  });
  return [...manual, ...auto];
}

// Sheets stores flat rows; returnHistory (an array) is serialized to/from a
// JSON string in a single cell.
function deserializeInv(row) {
  let history = [];
  try { history = row.returnHistoryJSON ? JSON.parse(row.returnHistoryJSON) : []; } catch (e) { history = []; }
  return {
    ...row,
    invested: parseAmount(row.invested),
    currentValue: parseAmount(row.currentValue),
    returnHistory: history,
    currency: row.currency || "INR", // legacy rows predate the currency field
  };
}
function serializeInv(inv) {
  const { returnHistory, ...rest } = inv;
  return { ...rest, returnHistoryJSON: JSON.stringify(returnHistory || []) };
}

export default function InvestmentsPage() {
  const [investments, setInvestments] = useState([]);
  const [income, setIncome] = useState([]);
  const [assetClasses, setAssetClasses] = useState([]); // [{id, name}]
  const [loading, setLoading] = useState(true);
  const [autoAddedCount, setAutoAddedCount] = useState(0);
  const [showAddInvestment, setShowAddInvestment] = useState(false);
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [showManageClasses, setShowManageClasses] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterClass, setFilterClass] = useState("All");
  const [filterCurrency, setFilterCurrency] = useState("All");
  const [chartCurrency, setChartCurrency] = useState("INR");
  const [chartYear, setChartYear] = useState(currentYearStr());
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  // --- income log: on-demand, not rendered by default (was slow with lots
  // of auto-generated rows) ---
  const [showIncomeLog, setShowIncomeLog] = useState(false);
  const [logFilters, setLogFilters] = useState({ from: "", to: "", type: "All", investmentId: "All", source: "All", currency: "All" });

  const blankInvForm = {
    name: "", assetClass: "", currency: "INR", invested: "", currentValue: "", purchaseDate: "", endDate: "",
    returnFrequency: "None", returnType: "Rent", initialAmount: "", returnHistory: [],
    reinvestedFromId: "", newRateDate: "", newRateAmount: "",
  };
  const [invForm, setInvForm] = useState(blankInvForm);
  const [incForm, setIncForm] = useState({ investmentId: "", date: "", type: "Rent", amount: "", periodStart: "", periodEnd: "" });
  const [newClassName, setNewClassName] = useState("");
  const [renameDrafts, setRenameDrafts] = useState({}); // {classId: draftName}

  useEffect(() => {
    (async () => {
      try {
        const [invRows, incRows, classRows] = await Promise.all([
          getTable("Investments"), getTable("Income"), getTable("AssetClasses"),
        ]);
        const { valid: validInvRows, skipped: skippedInv } = splitValidRows(invRows);
        const { valid: validIncRows, skipped: skippedInc } = splitValidRows(incRows);
        const loadedInv = validInvRows.map(deserializeInv);
        const loadedInc = validIncRows.map((r) => ({ ...r, amount: parseAmount(r.amount), currency: r.currency || "INR" }));
        if (skippedInv || skippedInc) {
          setWarning(`Skipped ${skippedInv} investment row(s) and ${skippedInc} income row(s) in the Sheet that are missing an "id" — give every manually-added row a unique id to have it show up here.`);
        }

        let loadedClasses = classRows.map((r) => ({ id: r.id, name: r.name }));
        if (loadedClasses.length === 0) {
          loadedClasses = DEFAULT_ASSET_CLASSES.map((name, i) => ({ id: `seed-${i}`, name }));
          await setTable("AssetClasses", loadedClasses);
        }

        const prevAutoCount = loadedInc.filter((e) => e.source === "auto").length;
        const rebuilt = rebuildIncome(loadedInv, loadedInc);
        const newAutoCount = rebuilt.filter((e) => e.source === "auto").length;

        setInvestments(loadedInv);
        setIncome(rebuilt);
        setAssetClasses(loadedClasses);
        setAutoAddedCount(Math.max(0, newAutoCount - prevAutoCount));
        setIncForm((f) => ({ ...f, investmentId: loadedInv[0]?.id || "" }));
        setInvForm((f) => ({ ...f, assetClass: loadedClasses[0]?.name || "" }));

        const presentCurrencies = CURRENCIES.filter((c) => loadedInv.some((i) => (i.currency || "INR") === c));
        setChartCurrency(presentCurrencies[0] || "INR");

        await Promise.all([setTable("Income", rebuilt)]);
      } catch (e) {
        setError("Couldn't load from Google Sheets. Check API_URL in src/api.js and that the Apps Script is deployed. " + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = async (nextInv, nextInc) => {
    try {
      if (nextInv) await setTable("Investments", nextInv.map(serializeInv));
      if (nextInc) await setTable("Income", nextInc);
    } catch (e) { setError("Save failed: " + e.message); }
  };
  const persistClasses = async (next) => {
    try { await setTable("AssetClasses", next); } catch (e) { setError("Save failed: " + e.message); }
  };

  const classNames = useMemo(() => assetClasses.map((c) => c.name), [assetClasses]);
  const activeCurrencies = useMemo(() => {
    const present = CURRENCIES.filter((c) => investments.some((i) => (i.currency || "INR") === c));
    return present.length ? present : ["INR"];
  }, [investments]);

  const totalsByCurrency = useMemo(() => {
    const out = {};
    CURRENCIES.forEach((cur) => {
      const invList = investments.filter((i) => (i.currency || "INR") === cur);
      const incList = income.filter((e) => (e.currency || "INR") === cur);
      const invested = invList.filter((i) => !i.reinvestedFromId).reduce((s, i) => s + i.invested, 0);
      const current = invList.reduce((s, i) => s + i.currentValue, 0);
      const totalIncome = incList.reduce((s, i) => s + i.amount, 0);
      const capitalGain = current - invList.reduce((s, i) => s + i.invested, 0);
      const totalReturn = capitalGain + totalIncome;
      out[cur] = { invested, current, totalIncome, totalReturn, returnPct: invested ? (totalReturn / invested) * 100 : 0 };
    });
    return out;
  }, [investments, income]);

  const allocation = useMemo(() => {
    const byClass = {};
    investments.filter((i) => (i.currency || "INR") === chartCurrency).forEach((i) => {
      byClass[i.assetClass] = (byClass[i.assetClass] || 0) + i.currentValue;
    });
    return Object.entries(byClass).map(([name, value]) => ({ name, value }));
  }, [investments, chartCurrency]);

  const availableYears = useMemo(() => {
    const set = new Set(income.map((e) => yearOf(e.date)).filter(Boolean));
    return Array.from(set).sort();
  }, [income]);

  const monthlyIncomeByType = useMemo(() => {
    const filtered = income.filter((e) =>
      (e.currency || "INR") === chartCurrency && (chartYear === "All" || yearOf(e.date) === chartYear)
    );
    const months = {};
    filtered.forEach((entry) => {
      const m = new Date(entry.date).toLocaleString("en-US", { month: "short", year: "2-digit" });
      if (!months[m]) months[m] = { month: m, Rent: 0, Dividend: 0, Interest: 0, sortKey: entry.date.slice(0, 7) };
      months[m][entry.type] = (months[m][entry.type] || 0) + entry.amount;
    });
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [income, chartCurrency, chartYear]);

  const holdingsWithReturn = useMemo(() => {
    const list = investments
      .filter((inv) => (filterClass === "All" || inv.assetClass === filterClass) && (filterCurrency === "All" || (inv.currency || "INR") === filterCurrency))
      .map((inv) => {
        const incomeForInv = income.filter((i) => i.investmentId === inv.id).reduce((s, i) => s + i.amount, 0);
        const capGain = inv.currentValue - inv.invested;
        const totalRet = capGain + incomeForInv;
        const currentRate = inv.returnHistory && inv.returnHistory.length ? [...inv.returnHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-1)[0].amount : 0;
        return { ...inv, incomeForInv, capGain, totalRet, totalRetPct: inv.invested ? (totalRet / inv.invested) * 100 : 0, currentRate };
      });
    return sortRows(list, sortField, sortDir);
  }, [investments, income, filterClass, filterCurrency, sortField, sortDir]);

  const incomeLog = useMemo(() => {
    return [...income].sort((a, b) => b.date.localeCompare(a.date)).map((e) => ({
      ...e, investmentName: investments.find((i) => i.id === e.investmentId)?.name || e.investmentId,
    }));
  }, [income, investments]);

  const filteredIncomeLog = useMemo(() => {
    if (!showIncomeLog) return [];
    return incomeLog.filter((e) =>
      (!logFilters.from || e.date >= logFilters.from) &&
      (!logFilters.to || e.date <= logFilters.to) &&
      (logFilters.type === "All" || e.type === logFilters.type) &&
      (logFilters.investmentId === "All" || String(e.investmentId) === String(logFilters.investmentId)) &&
      (logFilters.source === "All" || e.source === logFilters.source) &&
      (logFilters.currency === "All" || (e.currency || "INR") === logFilters.currency)
    );
  }, [incomeLog, logFilters, showIncomeLog]);

  const openAddInvestment = () => { setEditingId(null); setInvForm({ ...blankInvForm, assetClass: classNames[0] || "" }); setShowAddInvestment(true); };
  const openEditInvestment = (inv) => {
    setEditingId(inv.id);
    setInvForm({
      name: inv.name, assetClass: inv.assetClass, currency: inv.currency || "INR", invested: inv.invested, currentValue: inv.currentValue,
      purchaseDate: inv.purchaseDate, endDate: inv.endDate || "", returnFrequency: inv.returnFrequency, returnType: inv.returnType,
      initialAmount: "", returnHistory: inv.returnHistory || [], reinvestedFromId: inv.reinvestedFromId || "",
      newRateDate: "", newRateAmount: "",
    });
    setShowAddInvestment(true);
  };

  const addRateChange = () => {
    if (!invForm.newRateDate || !invForm.newRateAmount) return;
    const nextHistory = [...invForm.returnHistory, { date: invForm.newRateDate, amount: parseAmount(invForm.newRateAmount) }].sort((a, b) => new Date(a.date) - new Date(b.date));
    setInvForm({ ...invForm, returnHistory: nextHistory, newRateDate: "", newRateAmount: "" });
  };

  const saveInvestment = async () => {
    if (!invForm.name || !invForm.invested || !invForm.currentValue || !invForm.assetClass) return;
    if (!editingId && isDuplicateValue(investments, "name", invForm.name)) {
      if (!window.confirm(`An investment named "${invForm.name}" already exists. Add another one with the same name anyway?`)) return;
    }
    let nextInv;
    if (editingId) {
      nextInv = investments.map((inv) => inv.id === editingId ? {
        ...inv, name: invForm.name, assetClass: invForm.assetClass, currency: invForm.currency, invested: parseAmount(invForm.invested),
        currentValue: parseAmount(invForm.currentValue), purchaseDate: invForm.purchaseDate, endDate: invForm.endDate || "",
        returnFrequency: invForm.returnFrequency, returnType: invForm.returnType, returnHistory: invForm.returnHistory,
        reinvestedFromId: invForm.reinvestedFromId || "",
      } : inv);
    } else {
      const history = invForm.returnFrequency !== "None" && invForm.initialAmount
        ? [{ date: invForm.purchaseDate || todayStr(), amount: parseAmount(invForm.initialAmount) }] : [];
      nextInv = [...investments, {
        id: Date.now().toString(), name: invForm.name, assetClass: invForm.assetClass, currency: invForm.currency,
        invested: parseAmount(invForm.invested), currentValue: parseAmount(invForm.currentValue),
        purchaseDate: invForm.purchaseDate || todayStr(), endDate: invForm.endDate || "",
        returnFrequency: invForm.returnFrequency, returnType: invForm.returnType, returnHistory: history,
        reinvestedFromId: invForm.reinvestedFromId || "",
      }];
    }
    // Auto income entries carry the currency of their parent investment,
    // so if currency was just changed on edit, regenerate to pick it up.
    const nextInc = rebuildIncome(nextInv, income);
    setInvestments(nextInv);
    setIncome(nextInc);
    await persist(nextInv, nextInc);
    setShowAddInvestment(false);
  };

  const deleteInvestment = async (inv) => {
    if (!window.confirm(`Delete "${inv.name}"? This also removes its ${income.filter((e) => e.investmentId === inv.id).length} income log entries. This can't be undone.`)) return;
    const nextInv = investments.filter((i) => i.id !== inv.id);
    const nextInc = income.filter((e) => e.investmentId !== inv.id);
    setInvestments(nextInv);
    setIncome(nextInc);
    await persist(nextInv, nextInc);
  };

  const deleteIncomeEntry = async (entry) => {
    if (entry.source === "auto") { setError("Auto-generated entries can't be deleted directly — edit the holding's rate/dates instead, or log a manual override for that date."); return; }
    if (!window.confirm(`Delete this ${entry.type} entry of ${fmt(entry.amount, entry.currency)} on ${entry.date}?`)) return;
    const nextInc = income.filter((e) => e.id !== entry.id);
    setIncome(nextInc);
    await persist(null, nextInc);
  };

  const addIncome = async () => {
    if (!incForm.investmentId || !incForm.amount || !incForm.date) return;
    const parentInv = investments.find((i) => i.id === incForm.investmentId);
    const nextInc = [...income, {
      id: Date.now().toString(), investmentId: incForm.investmentId, type: incForm.type, amount: parseAmount(incForm.amount),
      date: incForm.date, periodStart: incForm.periodStart || incForm.date, periodEnd: incForm.periodEnd || incForm.date,
      source: "manual", currency: parentInv?.currency || "INR",
    }];
    setIncome(nextInc);
    await persist(null, nextInc);
    setIncForm({ investmentId: investments[0]?.id || "", date: "", type: "Rent", amount: "", periodStart: "", periodEnd: "" });
    setShowAddIncome(false);
  };

  // --- asset class management ---
  const addClass = async () => {
    const name = newClassName.trim();
    if (!name || classNames.includes(name)) return;
    const next = [...assetClasses, { id: Date.now().toString(), name }];
    setAssetClasses(next);
    await persistClasses(next);
    setNewClassName("");
  };
  const renameClass = async (id) => {
    const draft = (renameDrafts[id] || "").trim();
    const cls = assetClasses.find((c) => c.id === id);
    if (!cls || !draft || draft === cls.name) return;
    if (classNames.includes(draft)) { setError(`A class named "${draft}" already exists.`); return; }
    const nextClasses = assetClasses.map((c) => c.id === id ? { ...c, name: draft } : c);
    const nextInv = investments.map((inv) => inv.assetClass === cls.name ? { ...inv, assetClass: draft } : inv);
    setAssetClasses(nextClasses);
    setInvestments(nextInv);
    setRenameDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
    await Promise.all([persistClasses(nextClasses), persist(nextInv, null)]);
  };
  const deleteClass = async (id) => {
    const cls = assetClasses.find((c) => c.id === id);
    if (!cls) return;
    const inUse = investments.some((inv) => inv.assetClass === cls.name);
    if (inUse) { setError(`Can't delete "${cls.name}" — it's still used by one or more holdings. Reassign or delete those holdings first.`); return; }
    const next = assetClasses.filter((c) => c.id !== id);
    setAssetClasses(next);
    await persistClasses(next);
  };

  const exportCSV = () => {
    const invRows = [
      ["Type", "Name", "Asset Class", "Currency", "Invested", "Current Value", "Start Date", "End Date", "Reinvested From", "Return Frequency", "Return Type", "Current Rate"],
      ...holdingsWithReturn.map((i) => ["Investment", i.name, i.assetClass, i.currency || "INR", i.invested, i.currentValue, i.purchaseDate, i.endDate || "", investments.find((x) => x.id === i.reinvestedFromId)?.name || "", i.returnFrequency, i.returnType, i.currentRate]),
    ];
    const rateRows = [["Type", "Investment Name", "Effective Date", "Amount"], ...investments.flatMap((i) => (i.returnHistory || []).map((h) => ["Rate change", i.name, h.date, h.amount]))];
    const incRows = [["Type", "Investment Name", "Income Type", "Amount", "Currency", "Date", "Period Start", "Period End", "Source"], ...income.map((e) => { const inv = investments.find((i) => i.id === e.investmentId); return ["Income", inv ? inv.name : e.investmentId, e.type, e.amount, e.currency || "INR", e.date, e.periodStart || "", e.periodEnd || "", e.source || "manual"]; })];
    const escapeCell = (c) => { const s = String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [...invRows, [], ...rateRows, [], ...incRows].map((row) => row.map(escapeCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `investments-export-${todayStr()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const assetIcon = (cls) => {
    if (cls === "Real Estate") return <Home size={16} />;
    if (cls === "Fixed Deposit") return <Landmark size={16} />;
    if (cls === "Crypto") return <Coins size={16} />;
    if (cls === "Equity" || cls === "Mutual Fund") return <LineChartIcon size={16} />;
    return <Layers size={16} />;
  };

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading investments…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setError("")}>{error} (click to dismiss)</div>}
      {warning && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.gold, border: `1px solid ${COLORS.gold}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setWarning("")}>{warning} (click to dismiss)</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 8 }}>
        <button onClick={() => setShowManageClasses(true)} style={btnStyleGhost}><Settings size={13} /> Manage asset classes</button>
        <button onClick={exportCSV} style={btnStyle}><Download size={13} /> Export CSV</button>
      </div>

      {autoAddedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: sansFont, color: COLORS.positive, background: "#E1F5EE", border: `1px solid ${COLORS.positive}`, padding: "8px 12px", margin: "0 0 16px" }}>
          <RefreshCcw size={13} /> Auto-added {autoAddedCount} income {autoAddedCount === 1 ? "entry" : "entries"}.
        </div>
      )}

      {activeCurrencies.map((cur) => (
        <div key={cur} style={{ marginBottom: 8 }}>
          <p style={{ fontFamily: sansFont, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 6px" }}>{cur} holdings</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 16 }}>
            {[
              { label: "Total invested", value: fmt(totalsByCurrency[cur].invested, cur) },
              { label: "Current value", value: fmt(totalsByCurrency[cur].current, cur) },
              { label: "Income to date", value: fmt(totalsByCurrency[cur].totalIncome, cur) },
              { label: "Total return", value: fmt(totalsByCurrency[cur].totalReturn, cur), sub: pct(totalsByCurrency[cur].returnPct) },
            ].map((m, idx) => (
              <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
                <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
                <p style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>{m.value}</p>
                {m.sub && <p style={{ fontSize: 13, margin: "4px 0 0", color: totalsByCurrency[cur].returnPct >= 0 ? COLORS.positive : COLORS.negative, display: "flex", alignItems: "center", gap: 4, fontFamily: sansFont }}>{totalsByCurrency[cur].returnPct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {m.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {investments.some((i) => i.reinvestedFromId) && <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, margin: "0 0 30px" }}>Total invested excludes holdings marked as funded by reinvestment from another holding.</p>}

      <div style={{ marginBottom: 36, marginTop: investments.some((i) => i.reinvestedFromId) ? 0 : 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Allocation by asset class</h3>
          <select value={chartCurrency} onChange={(e) => setChartCurrency(e.target.value)} style={selectStyle}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
              {allocation.map((a, i) => <Cell key={i} fill={colorForClass(a.name, classNames)} />)}
            </Pie>
            <RTooltip formatter={(v) => fmt(v, chartCurrency)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
          </PieChart>
        </ResponsiveContainer>
        {allocation.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, textAlign: "center" }}>No {chartCurrency} holdings yet.</p>}
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Monthly income — rent, dividends & interest</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={chartYear} onChange={(e) => setChartYear(e.target.value)} style={selectStyle}>
              <option value="All">All years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={chartCurrency} onChange={(e) => setChartCurrency(e.target.value)} style={selectStyle}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setShowAddIncome(true)} style={btnStyle}><Plus size={13} /> Log one-off income</button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyIncomeByType}>
            <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
            <RTooltip formatter={(v) => fmt(v, chartCurrency)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Arial" }} />
            <Bar dataKey="Rent" stackId="a" fill={COLORS.positive} />
            <Bar dataKey="Dividend" stackId="a" fill={COLORS.info} />
            <Bar dataKey="Interest" stackId="a" fill={COLORS.gold} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Holdings</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <select value={filterCurrency} onChange={(e) => setFilterCurrency(e.target.value)} style={selectStyle}>
              <option value="All">All currencies</option>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={selectStyle}>
              <option>All</option>
              {classNames.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={sortField} onChange={(e) => setSortField(e.target.value)} style={selectStyle}>
              <option value="name">Sort: Name</option>
              <option value="purchaseDate">Sort: Start date</option>
              <option value="invested">Sort: Invested</option>
            </select>
            <button onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} style={btnStyleGhost}>{sortDir === "asc" ? "↑ Asc" : "↓ Desc"}</button>
            <button onClick={openAddInvestment} style={btnStyle}><Plus size={13} /> Add investment</button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["", "Name", "Return schedule", "Start date", "End date", "Invested", "Income earned", "Total return", ""].map((h, i) => <th key={i} style={th(i > 4 && i < 8 ? "right" : "left")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {holdingsWithReturn.map((h) => (
              <tr key={h.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={{ ...td(), color: colorForClass(h.assetClass, classNames) }}>{assetIcon(h.assetClass)}</td>
                <td style={td()}>
                  {h.name}
                  <span style={{ fontSize: 10, color: COLORS.muted, border: `1px solid ${COLORS.line}`, padding: "1px 5px", marginLeft: 6 }}>{h.currency || "INR"}</span>
                  {h.endDate && new Date(h.endDate) < new Date(todayStr()) && <span style={{ fontSize: 10, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "1px 5px", marginLeft: 6 }}>Ended</span>}
                  {h.reinvestedFromId && <span style={{ fontSize: 10, color: COLORS.accent, border: `1px solid ${COLORS.accent}`, padding: "1px 5px", marginLeft: 6 }}>Reinvested</span>}
                  <div style={{ fontSize: 11, color: COLORS.muted }}>{h.assetClass}</div>
                </td>
                <td style={{ ...td(), fontSize: 12, color: COLORS.muted }}>{h.returnFrequency !== "None" && h.currentRate ? `${h.returnType} · ${fmt(h.currentRate, h.currency)} / ${FREQ_LABEL[h.returnFrequency]}${h.returnHistory.length > 1 ? " · changed" : ""}` : "—"}</td>
                <td style={td()}>{h.purchaseDate}</td>
                <td style={td()}>{h.endDate || "—"}</td>
                <td style={td("right")}>{fmt(h.invested, h.currency)}</td>
                <td style={td("right")}>{fmt(h.incomeForInv, h.currency)}</td>
                <td style={{ ...td("right"), fontWeight: 700, color: h.totalRet >= 0 ? COLORS.positive : COLORS.negative }}>{pct(h.totalRetPct)}</td>
                <td style={td("right")}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Pencil size={14} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEditInvestment(h)} />
                    <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteInvestment(h)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={sectionHeading}>Income log</h3>
          <button onClick={() => setShowIncomeLog((v) => !v)} style={btnStyleGhost}>
            {showIncomeLog ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {showIncomeLog ? "Hide" : "Show"} income log
          </button>
        </div>
        {showIncomeLog && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontFamily: sansFont, fontSize: 12 }}>
              <input type="date" style={{ ...inputStyle, width: 140 }} value={logFilters.from} onChange={(e) => setLogFilters({ ...logFilters, from: e.target.value })} placeholder="From" />
              <input type="date" style={{ ...inputStyle, width: 140 }} value={logFilters.to} onChange={(e) => setLogFilters({ ...logFilters, to: e.target.value })} placeholder="To" />
              <select style={selectStyle} value={logFilters.type} onChange={(e) => setLogFilters({ ...logFilters, type: e.target.value })}>
                <option value="All">All types</option>
                {INCOME_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <select style={selectStyle} value={logFilters.investmentId} onChange={(e) => setLogFilters({ ...logFilters, investmentId: e.target.value })}>
                <option value="All">All investments</option>
                {investments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <select style={selectStyle} value={logFilters.source} onChange={(e) => setLogFilters({ ...logFilters, source: e.target.value })}>
                <option value="All">All sources</option>
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
              <select style={selectStyle} value={logFilters.currency} onChange={(e) => setLogFilters({ ...logFilters, currency: e.target.value })}>
                <option value="All">All currencies</option>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${COLORS.line}` }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: COLORS.bg }}><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
                  {["Investment", "Type", "Period", "Paid on", "Amount", "Source", ""].map((hd, i) => <th key={i} style={th(i === 4 ? "right" : "left")}>{hd}</th>)}
                </tr></thead>
                <tbody>
                  {filteredIncomeLog.slice(0, LOG_CAP).map((e) => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.lineLight}` }}>
                      <td style={{ padding: 6 }}>{e.investmentName}</td>
                      <td style={{ padding: 6 }}>{e.type}</td>
                      <td style={{ padding: 6, color: COLORS.muted }}>{e.periodStart} → {e.periodEnd}</td>
                      <td style={{ padding: 6 }}>{e.date}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{fmt(e.amount, e.currency)}</td>
                      <td style={{ padding: 6, color: e.source === "auto" ? COLORS.muted : COLORS.positive }}>{e.source}</td>
                      <td style={{ padding: 6, textAlign: "right" }}>{e.source === "manual" && <Trash2 size={13} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteIncomeEntry(e)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredIncomeLog.length > LOG_CAP && <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Showing first {LOG_CAP} of {filteredIncomeLog.length} matching entries — narrow the filters to see more precisely.</p>}
            {filteredIncomeLog.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 6 }}>No entries match those filters.</p>}
          </>
        )}
      </div>

      {showAddInvestment && (
        <Modal onClose={() => setShowAddInvestment(false)} title={editingId ? "Edit investment" : "Add investment"}>
          <Field label="Name"><input style={inputStyle} value={invForm.name} onChange={(e) => setInvForm({ ...invForm, name: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Asset class"><select style={inputStyle} value={invForm.assetClass} onChange={(e) => setInvForm({ ...invForm, assetClass: e.target.value })}>{classNames.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Currency"><select style={inputStyle} value={invForm.currency} onChange={(e) => setInvForm({ ...invForm, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label={`Amount invested (${invForm.currency})`}><input type="number" style={inputStyle} value={invForm.invested} onChange={(e) => setInvForm({ ...invForm, invested: e.target.value })} /></Field>
            <Field label={`Current value (${invForm.currency})`}><input type="number" style={inputStyle} value={invForm.currentValue} onChange={(e) => setInvForm({ ...invForm, currentValue: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Start date"><input type="date" style={inputStyle} value={invForm.purchaseDate} onChange={(e) => setInvForm({ ...invForm, purchaseDate: e.target.value })} /></Field>
            <Field label="End date"><input type="date" style={inputStyle} value={invForm.endDate} onChange={(e) => setInvForm({ ...invForm, endDate: e.target.value })} /></Field>
          </div>
          <Field label="Reinvested from (optional)">
            <select style={inputStyle} value={invForm.reinvestedFromId} onChange={(e) => setInvForm({ ...invForm, reinvestedFromId: e.target.value })}>
              <option value="">Not reinvested — new capital</option>
              {investments.filter((i) => i.id !== editingId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </Field>
          <div style={{ borderTop: `1px solid ${COLORS.line}`, margin: "14px 0 10px", paddingTop: 10 }}>
            <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, margin: "0 0 10px" }}>Recurring return (optional)</p>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Frequency"><select style={inputStyle} value={invForm.returnFrequency} onChange={(e) => setInvForm({ ...invForm, returnFrequency: e.target.value })}><option>None</option><option>Monthly</option><option>Quarterly</option><option>Half Yearly</option><option>Annually</option></select></Field>
              <Field label="Type"><select style={inputStyle} value={invForm.returnType} onChange={(e) => setInvForm({ ...invForm, returnType: e.target.value })}>{INCOME_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            </div>
            {!editingId ? (
              <Field label={`Starting amount per period (${invForm.currency})`}><input type="number" style={inputStyle} value={invForm.initialAmount} onChange={(e) => setInvForm({ ...invForm, initialAmount: e.target.value })} /></Field>
            ) : (
              <>
                {invForm.returnHistory.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 4px" }}>Rate history</p>
                    {[...invForm.returnHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).map((h, i) => (
                      <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${COLORS.lineLight}` }}><span>From {h.date}</span><span>{fmt(h.amount, invForm.currency)}</span></div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <Field label="Effective from"><input type="date" style={inputStyle} value={invForm.newRateDate} onChange={(e) => setInvForm({ ...invForm, newRateDate: e.target.value })} /></Field>
                  <Field label={`New amount (${invForm.currency})`}><input type="number" style={inputStyle} value={invForm.newRateAmount} onChange={(e) => setInvForm({ ...invForm, newRateAmount: e.target.value })} /></Field>
                  <button type="button" onClick={addRateChange} style={{ ...btnStyle, marginBottom: 12 }}>Add</button>
                </div>
              </>
            )}
          </div>
          <button onClick={saveInvestment} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0", marginTop: 8 }}>{editingId ? "Save changes" : "Save investment"}</button>
        </Modal>
      )}

      {showAddIncome && (
        <Modal onClose={() => setShowAddIncome(false)} title="Log one-off income">
          <Field label="Investment"><select style={inputStyle} value={incForm.investmentId} onChange={(e) => setIncForm({ ...incForm, investmentId: e.target.value })}>{investments.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.currency || "INR"})</option>)}</select></Field>
          <Field label="Type"><select style={inputStyle} value={incForm.type} onChange={(e) => setIncForm({ ...incForm, type: e.target.value })}>{INCOME_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label={`Amount (${investments.find((i) => i.id === incForm.investmentId)?.currency || "INR"})`}><input type="number" style={inputStyle} value={incForm.amount} onChange={(e) => setIncForm({ ...incForm, amount: e.target.value })} /></Field>
          <Field label="Paid on"><input type="date" style={inputStyle} value={incForm.date} onChange={(e) => setIncForm({ ...incForm, date: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Period start"><input type="date" style={inputStyle} value={incForm.periodStart} onChange={(e) => setIncForm({ ...incForm, periodStart: e.target.value })} /></Field>
            <Field label="Period end"><input type="date" style={inputStyle} value={incForm.periodEnd} onChange={(e) => setIncForm({ ...incForm, periodEnd: e.target.value })} /></Field>
          </div>
          <button onClick={addIncome} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0", marginTop: 8 }}>Save entry</button>
        </Modal>
      )}

      {showManageClasses && (
        <Modal onClose={() => setShowManageClasses(false)} title="Manage asset classes">
          <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, margin: "0 0 14px" }}>
            Renaming updates every holding that uses this class. A class in use by any holding can't be deleted — reassign or remove those holdings first.
          </p>
          {assetClasses.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                value={renameDrafts[c.id] !== undefined ? renameDrafts[c.id] : c.name}
                onChange={(e) => setRenameDrafts({ ...renameDrafts, [c.id]: e.target.value })}
              />
              <button onClick={() => renameClass(c.id)} style={btnStyleGhost}>Save</button>
              <Trash2 size={16} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteClass(c.id)} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 14, borderTop: `1px solid ${COLORS.line}`, paddingTop: 14 }}>
            <input style={{ ...inputStyle, flex: 1 }} placeholder="New class name" value={newClassName} onChange={(e) => setNewClassName(e.target.value)} />
            <button onClick={addClass} style={btnStyle}><Plus size={13} /> Add</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
