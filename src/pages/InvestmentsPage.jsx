import React, { useState, useMemo, useEffect } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  PieChart, Pie, Cell, Legend
} from "recharts";
import { Plus, TrendingUp, TrendingDown, Home, LineChart as LineChartIcon, Landmark, Coins, Pencil, RefreshCcw, Download } from "lucide-react";
import Modal from "../components/Modal.jsx";
import Field from "../components/Field.jsx";
import { getTable, setTable } from "../api.js";
import {
  COLORS, ASSET_COLORS, sansFont, fmt, pct, todayStr, inputStyle, btnStyle, sectionHeading, th, td,
  addMonthsClamped, addDays, toISODate,
} from "../styles.js";

const FREQ_MONTHS = { "Monthly": 1, "Quarterly": 3, "Annually": 12, "None": null };
const FREQ_LABEL = { "Monthly": "mo", "Quarterly": "qtr", "Annually": "yr" };

function effectiveAmountAt(history, dateObj) {
  if (!history || history.length === 0) return 0;
  const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  let amt = sorted[0].amount;
  for (const h of sorted) { if (new Date(h.date) <= dateObj) amt = h.amount; else break; }
  return amt;
}

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
    const periodStart = addMonthsClamped(inv.purchaseDate, (k - 1) * months);
    const payDate = addMonthsClamped(inv.purchaseDate, k * months);
    if (payDate > cutoff) break;
    const periodEnd = addDays(payDate, -1);
    const amount = effectiveAmountAt(inv.returnHistory, periodStart);
    const payDateStr = toISODate(payDate);
    if (amount > 0 && !manualDates.has(payDateStr)) {
      due.push({ id: `auto-${inv.id}-${payDateStr}`, investmentId: inv.id, type: inv.returnType, amount, date: payDateStr, periodStart: toISODate(periodStart), periodEnd: toISODate(periodEnd), source: "auto" });
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
    invested: Number(row.invested) || 0,
    currentValue: Number(row.currentValue) || 0,
    returnHistory: history,
  };
}
function serializeInv(inv) {
  const { returnHistory, ...rest } = inv;
  return { ...rest, returnHistoryJSON: JSON.stringify(returnHistory || []) };
}

export default function InvestmentsPage() {
  const [investments, setInvestments] = useState([]);
  const [income, setIncome] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoAddedCount, setAutoAddedCount] = useState(0);
  const [showAddInvestment, setShowAddInvestment] = useState(false);
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [filterClass, setFilterClass] = useState("All");
  const [error, setError] = useState("");

  const blankInvForm = {
    name: "", assetClass: "Equity", invested: "", currentValue: "", purchaseDate: "", endDate: "",
    returnFrequency: "None", returnType: "Rent", initialAmount: "", returnHistory: [],
    reinvestedFromId: "", newRateDate: "", newRateAmount: "",
  };
  const [invForm, setInvForm] = useState(blankInvForm);
  const [incForm, setIncForm] = useState({ investmentId: "", date: "", type: "Rent", amount: "", periodStart: "", periodEnd: "" });

  useEffect(() => {
    (async () => {
      try {
        const [invRows, incRows] = await Promise.all([getTable("Investments"), getTable("Income")]);
        const loadedInv = invRows.map(deserializeInv);
        const loadedInc = incRows.map((r) => ({ ...r, amount: Number(r.amount) || 0 }));

        const prevAutoCount = loadedInc.filter((e) => e.source === "auto").length;
        const rebuilt = rebuildIncome(loadedInv, loadedInc);
        const newAutoCount = rebuilt.filter((e) => e.source === "auto").length;

        setInvestments(loadedInv);
        setIncome(rebuilt);
        setAutoAddedCount(Math.max(0, newAutoCount - prevAutoCount));
        setIncForm((f) => ({ ...f, investmentId: loadedInv[0]?.id || "" }));

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

  const totals = useMemo(() => {
    const invested = investments.filter((i) => !i.reinvestedFromId).reduce((s, i) => s + i.invested, 0);
    const current = investments.reduce((s, i) => s + i.currentValue, 0);
    const totalIncome = income.reduce((s, i) => s + i.amount, 0);
    const capitalGain = current - investments.reduce((s, i) => s + i.invested, 0);
    const totalReturn = capitalGain + totalIncome;
    return { invested, current, totalIncome, totalReturn, returnPct: invested ? (totalReturn / invested) * 100 : 0 };
  }, [investments, income]);

  const allocation = useMemo(() => {
    const byClass = {};
    investments.forEach((i) => { byClass[i.assetClass] = (byClass[i.assetClass] || 0) + i.currentValue; });
    return Object.entries(byClass).map(([name, value]) => ({ name, value }));
  }, [investments]);

  const monthlyIncomeByType = useMemo(() => {
    const months = {};
    income.forEach((entry) => {
      const m = new Date(entry.date).toLocaleString("en-US", { month: "short", year: "2-digit" });
      if (!months[m]) months[m] = { month: m, Rent: 0, Dividend: 0, Interest: 0, sortKey: entry.date.slice(0, 7) };
      months[m][entry.type] = (months[m][entry.type] || 0) + entry.amount;
    });
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [income]);

  const holdingsWithReturn = useMemo(() => {
    return investments
      .filter((inv) => filterClass === "All" || inv.assetClass === filterClass)
      .map((inv) => {
        const incomeForInv = income.filter((i) => i.investmentId === inv.id).reduce((s, i) => s + i.amount, 0);
        const capGain = inv.currentValue - inv.invested;
        const totalRet = capGain + incomeForInv;
        const currentRate = inv.returnHistory && inv.returnHistory.length ? [...inv.returnHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-1)[0].amount : 0;
        return { ...inv, incomeForInv, capGain, totalRet, totalRetPct: inv.invested ? (totalRet / inv.invested) * 100 : 0, currentRate };
      })
      .sort((a, b) => a.assetClass.localeCompare(b.assetClass) || a.name.localeCompare(b.name));
  }, [investments, income, filterClass]);

  const incomeLog = useMemo(() => {
    return [...income].sort((a, b) => b.date.localeCompare(a.date)).map((e) => ({
      ...e, investmentName: investments.find((i) => i.id === e.investmentId)?.name || e.investmentId,
    }));
  }, [income, investments]);

  const openAddInvestment = () => { setEditingId(null); setInvForm(blankInvForm); setShowAddInvestment(true); };
  const openEditInvestment = (inv) => {
    setEditingId(inv.id);
    setInvForm({
      name: inv.name, assetClass: inv.assetClass, invested: inv.invested, currentValue: inv.currentValue,
      purchaseDate: inv.purchaseDate, endDate: inv.endDate || "", returnFrequency: inv.returnFrequency, returnType: inv.returnType,
      initialAmount: "", returnHistory: inv.returnHistory || [], reinvestedFromId: inv.reinvestedFromId || "",
      newRateDate: "", newRateAmount: "",
    });
    setShowAddInvestment(true);
  };

  const addRateChange = () => {
    if (!invForm.newRateDate || !invForm.newRateAmount) return;
    const nextHistory = [...invForm.returnHistory, { date: invForm.newRateDate, amount: Number(invForm.newRateAmount) }].sort((a, b) => new Date(a.date) - new Date(b.date));
    setInvForm({ ...invForm, returnHistory: nextHistory, newRateDate: "", newRateAmount: "" });
  };

  const saveInvestment = async () => {
    if (!invForm.name || !invForm.invested || !invForm.currentValue) return;
    let nextInv;
    if (editingId) {
      nextInv = investments.map((inv) => inv.id === editingId ? {
        ...inv, name: invForm.name, assetClass: invForm.assetClass, invested: Number(invForm.invested),
        currentValue: Number(invForm.currentValue), purchaseDate: invForm.purchaseDate, endDate: invForm.endDate || "",
        returnFrequency: invForm.returnFrequency, returnType: invForm.returnType, returnHistory: invForm.returnHistory,
        reinvestedFromId: invForm.reinvestedFromId || "",
      } : inv);
    } else {
      const history = invForm.returnFrequency !== "None" && invForm.initialAmount
        ? [{ date: invForm.purchaseDate || todayStr(), amount: Number(invForm.initialAmount) }] : [];
      nextInv = [...investments, {
        id: Date.now().toString(), name: invForm.name, assetClass: invForm.assetClass,
        invested: Number(invForm.invested), currentValue: Number(invForm.currentValue),
        purchaseDate: invForm.purchaseDate || todayStr(), endDate: invForm.endDate || "",
        returnFrequency: invForm.returnFrequency, returnType: invForm.returnType, returnHistory: history,
        reinvestedFromId: invForm.reinvestedFromId || "",
      }];
    }
    const nextInc = rebuildIncome(nextInv, income);
    setInvestments(nextInv);
    setIncome(nextInc);
    await persist(nextInv, nextInc);
    setShowAddInvestment(false);
  };

  const addIncome = async () => {
    if (!incForm.investmentId || !incForm.amount || !incForm.date) return;
    const nextInc = [...income, {
      id: Date.now().toString(), investmentId: incForm.investmentId, type: incForm.type, amount: Number(incForm.amount),
      date: incForm.date, periodStart: incForm.periodStart || incForm.date, periodEnd: incForm.periodEnd || incForm.date, source: "manual",
    }];
    setIncome(nextInc);
    await persist(null, nextInc);
    setIncForm({ investmentId: investments[0]?.id || "", date: "", type: "Rent", amount: "", periodStart: "", periodEnd: "" });
    setShowAddIncome(false);
  };

  const exportCSV = () => {
    const invRows = [
      ["Type", "Name", "Asset Class", "Invested", "Current Value", "Start Date", "End Date", "Reinvested From", "Return Frequency", "Return Type", "Current Rate"],
      ...holdingsWithReturn.map((i) => ["Investment", i.name, i.assetClass, i.invested, i.currentValue, i.purchaseDate, i.endDate || "", investments.find((x) => x.id === i.reinvestedFromId)?.name || "", i.returnFrequency, i.returnType, i.currentRate]),
    ];
    const rateRows = [["Type", "Investment Name", "Effective Date", "Amount"], ...investments.flatMap((i) => (i.returnHistory || []).map((h) => ["Rate change", i.name, h.date, h.amount]))];
    const incRows = [["Type", "Investment Name", "Income Type", "Amount", "Date", "Period Start", "Period End", "Source"], ...income.map((e) => { const inv = investments.find((i) => i.id === e.investmentId); return ["Income", inv ? inv.name : e.investmentId, e.type, e.amount, e.date, e.periodStart || "", e.periodEnd || "", e.source || "manual"]; })];
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
    return <LineChartIcon size={16} />;
  };

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading investments…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16 }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button onClick={exportCSV} style={btnStyle}><Download size={13} /> Export CSV</button>
      </div>

      {autoAddedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: sansFont, color: COLORS.positive, background: "#E1F5EE", border: `1px solid ${COLORS.positive}`, padding: "8px 12px", margin: "0 0 16px" }}>
          <RefreshCcw size={13} /> Auto-added {autoAddedCount} income {autoAddedCount === 1 ? "entry" : "entries"}.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 8 }}>
        {[
          { label: "Total invested", value: fmt(totals.invested) },
          { label: "Current value", value: fmt(totals.current) },
          { label: "Income to date", value: fmt(totals.totalIncome) },
          { label: "Total return", value: fmt(totals.totalReturn), sub: pct(totals.returnPct) },
        ].map((m, idx) => (
          <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
            <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
            <p style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>{m.value}</p>
            {m.sub && <p style={{ fontSize: 13, margin: "4px 0 0", color: totals.returnPct >= 0 ? COLORS.positive : COLORS.negative, display: "flex", alignItems: "center", gap: 4, fontFamily: sansFont }}>{totals.returnPct >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {m.sub}</p>}
          </div>
        ))}
      </div>
      {investments.some((i) => i.reinvestedFromId) && <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, margin: "0 0 30px" }}>Total invested excludes holdings marked as funded by reinvestment from another holding.</p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24, marginBottom: 36, marginTop: investments.some((i) => i.reinvestedFromId) ? 0 : 30 }}>
        <div>
          <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Allocation by asset class</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={allocation} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {allocation.map((a, i) => <Cell key={i} fill={ASSET_COLORS[a.name] || "#888780"} />)}
              </Pie>
              <RTooltip formatter={(v) => fmt(v)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <h3 style={sectionHeading}>Monthly income — rent, dividends & interest</h3>
          <button onClick={() => setShowAddIncome(true)} style={btnStyle}><Plus size={13} /> Log one-off income</button>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyIncomeByType}>
            <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v / 1000}k`} />
            <RTooltip formatter={(v) => fmt(v)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
            <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Arial" }} />
            <Bar dataKey="Rent" stackId="a" fill={COLORS.positive} />
            <Bar dataKey="Dividend" stackId="a" fill={COLORS.info} />
            <Bar dataKey="Interest" stackId="a" fill={COLORS.gold} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <h3 style={sectionHeading}>Holdings</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={{ fontFamily: "Arial", fontSize: 12, padding: "6px 8px", border: `1px solid ${COLORS.ink}`, background: COLORS.bg }}>
              <option>All</option>
              {Object.keys(ASSET_COLORS).map((c) => <option key={c}>{c}</option>)}
            </select>
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
                <td style={{ ...td(), color: ASSET_COLORS[h.assetClass] }}>{assetIcon(h.assetClass)}</td>
                <td style={td()}>
                  {h.name}
                  {h.endDate && new Date(h.endDate) < new Date(todayStr()) && <span style={{ fontSize: 10, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "1px 5px", marginLeft: 6 }}>Ended</span>}
                  {h.reinvestedFromId && <span style={{ fontSize: 10, color: COLORS.accent, border: `1px solid ${COLORS.accent}`, padding: "1px 5px", marginLeft: 6 }}>Reinvested</span>}
                  <div style={{ fontSize: 11, color: COLORS.muted }}>{h.assetClass}</div>
                </td>
                <td style={{ ...td(), fontSize: 12, color: COLORS.muted }}>{h.returnFrequency !== "None" && h.currentRate ? `${h.returnType} · ${fmt(h.currentRate)} / ${FREQ_LABEL[h.returnFrequency]}${h.returnHistory.length > 1 ? " · changed" : ""}` : "—"}</td>
                <td style={td()}>{h.purchaseDate}</td>
                <td style={td()}>{h.endDate || "—"}</td>
                <td style={td("right")}>{fmt(h.invested)}</td>
                <td style={td("right")}>{fmt(h.incomeForInv)}</td>
                <td style={{ ...td("right"), fontWeight: 700, color: h.totalRet >= 0 ? COLORS.positive : COLORS.negative }}>{pct(h.totalRetPct)}</td>
                <td style={td("right")}><Pencil size={14} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEditInvestment(h)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Income log</h3>
        <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${COLORS.line}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, background: COLORS.bg }}><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
              {["Investment", "Type", "Period", "Paid on", "Amount", "Source"].map((hd, i) => <th key={i} style={th(i === 4 ? "right" : "left")}>{hd}</th>)}
            </tr></thead>
            <tbody>
              {incomeLog.map((e) => (
                <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.lineLight}` }}>
                  <td style={{ padding: 6 }}>{e.investmentName}</td>
                  <td style={{ padding: 6 }}>{e.type}</td>
                  <td style={{ padding: 6, color: COLORS.muted }}>{e.periodStart} → {e.periodEnd}</td>
                  <td style={{ padding: 6 }}>{e.date}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(e.amount)}</td>
                  <td style={{ padding: 6, color: e.source === "auto" ? COLORS.muted : COLORS.positive }}>{e.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddInvestment && (
        <Modal onClose={() => setShowAddInvestment(false)} title={editingId ? "Edit investment" : "Add investment"}>
          <Field label="Name"><input style={inputStyle} value={invForm.name} onChange={(e) => setInvForm({ ...invForm, name: e.target.value })} /></Field>
          <Field label="Asset class"><select style={inputStyle} value={invForm.assetClass} onChange={(e) => setInvForm({ ...invForm, assetClass: e.target.value })}>{Object.keys(ASSET_COLORS).map((c) => <option key={c}>{c}</option>)}</select></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Amount invested (₹)"><input type="number" style={inputStyle} value={invForm.invested} onChange={(e) => setInvForm({ ...invForm, invested: e.target.value })} /></Field>
            <Field label="Current value (₹)"><input type="number" style={inputStyle} value={invForm.currentValue} onChange={(e) => setInvForm({ ...invForm, currentValue: e.target.value })} /></Field>
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
              <Field label="Frequency"><select style={inputStyle} value={invForm.returnFrequency} onChange={(e) => setInvForm({ ...invForm, returnFrequency: e.target.value })}><option>None</option><option>Monthly</option><option>Quarterly</option><option>Annually</option></select></Field>
              <Field label="Type"><select style={inputStyle} value={invForm.returnType} onChange={(e) => setInvForm({ ...invForm, returnType: e.target.value })}><option>Rent</option><option>Dividend</option><option>Interest</option></select></Field>
            </div>
            {!editingId ? (
              <Field label="Starting amount per period (₹)"><input type="number" style={inputStyle} value={invForm.initialAmount} onChange={(e) => setInvForm({ ...invForm, initialAmount: e.target.value })} /></Field>
            ) : (
              <>
                {invForm.returnHistory.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <p style={{ fontSize: 11, color: COLORS.muted, margin: "0 0 4px" }}>Rate history</p>
                    {[...invForm.returnHistory].sort((a, b) => new Date(a.date) - new Date(b.date)).map((h, i) => (
                      <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: `1px solid ${COLORS.lineLight}` }}><span>From {h.date}</span><span>{fmt(h.amount)}</span></div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <Field label="Effective from"><input type="date" style={inputStyle} value={invForm.newRateDate} onChange={(e) => setInvForm({ ...invForm, newRateDate: e.target.value })} /></Field>
                  <Field label="New amount (₹)"><input type="number" style={inputStyle} value={invForm.newRateAmount} onChange={(e) => setInvForm({ ...invForm, newRateAmount: e.target.value })} /></Field>
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
          <Field label="Investment"><select style={inputStyle} value={incForm.investmentId} onChange={(e) => setIncForm({ ...incForm, investmentId: e.target.value })}>{investments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
          <Field label="Type"><select style={inputStyle} value={incForm.type} onChange={(e) => setIncForm({ ...incForm, type: e.target.value })}><option>Rent</option><option>Dividend</option><option>Interest</option></select></Field>
          <Field label="Amount (₹)"><input type="number" style={inputStyle} value={incForm.amount} onChange={(e) => setIncForm({ ...incForm, amount: e.target.value })} /></Field>
          <Field label="Paid on"><input type="date" style={inputStyle} value={incForm.date} onChange={(e) => setIncForm({ ...incForm, date: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Period start"><input type="date" style={inputStyle} value={incForm.periodStart} onChange={(e) => setIncForm({ ...incForm, periodStart: e.target.value })} /></Field>
            <Field label="Period end"><input type="date" style={inputStyle} value={incForm.periodEnd} onChange={(e) => setIncForm({ ...incForm, periodEnd: e.target.value })} /></Field>
          </div>
          <button onClick={addIncome} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0", marginTop: 8 }}>Save entry</button>
        </Modal>
      )}
    </div>
  );
}
