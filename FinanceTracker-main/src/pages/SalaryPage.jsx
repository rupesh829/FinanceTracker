import React, { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from "recharts";
import { Plus, Pencil, Trash2, Briefcase } from "lucide-react";
import Modal from "../components/Modal.jsx";
import Field from "../components/Field.jsx";
import { getTable, setTable } from "../api.js";
import { COLORS, CURRENCIES, sansFont, fmt, pct, currentYearStr, sortRows, parseAmount, splitValidRows, isDuplicateValue, inputStyle, selectStyle, btnStyle, btnStyleGhost, sectionHeading, th, td } from "../styles.js";

const FILING_STATUSES = ["Single", "Married Filing Jointly", "Married Filing Separately", "Head of Household"];

export default function SalaryPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [chartCurrency, setChartCurrency] = useState("INR");
  const [chartYear, setChartYear] = useState(currentYearStr());
  const [sortField, setSortField] = useState("employer");
  const [sortDir, setSortDir] = useState("asc");

  const blankForm = {
    year: new Date().getFullYear().toString(), employer: "", filingStatus: "Single", currency: "INR",
    grossIncome: "", federalTax: "", stateTax: "", socialSecurityTax: "", medicareTax: "",
    retirement401k: "", otherDeductions: "", refundOrOwed: "", notes: "",
  };
  const [form, setForm] = useState(blankForm);

  useEffect(() => {
    (async () => {
      try {
        const rows = await getTable("Salary");
        const { valid: validRows, skipped } = splitValidRows(rows);
        const loaded = validRows.map((r) => ({
          ...r,
          currency: r.currency || "INR",
          grossIncome: parseAmount(r.grossIncome), federalTax: parseAmount(r.federalTax), stateTax: parseAmount(r.stateTax),
          socialSecurityTax: parseAmount(r.socialSecurityTax), medicareTax: parseAmount(r.medicareTax),
          retirement401k: parseAmount(r.retirement401k), otherDeductions: parseAmount(r.otherDeductions),
          refundOrOwed: parseAmount(r.refundOrOwed),
        }));
        if (skipped) setWarning(`Skipped ${skipped} row(s) in the Sheet that are missing an "id" — give every manually-added row a unique id to have it show up here.`);
        setEntries(loaded);
        const presentCurrencies = CURRENCIES.filter((c) => loaded.some((e) => (e.currency || "INR") === c));
        setChartCurrency(presentCurrencies[0] || "INR");
      } catch (e) {
        setError("Couldn't load from Google Sheets. Check API_URL in src/api.js. " + e.message);
      } finally { setLoading(false); }
    })();
  }, []);

  const persist = async (next) => {
    try { await setTable("Salary", next); } catch (e) { setError("Save failed: " + e.message); }
  };

  const withCalcs = useMemo(() => {
    const list = entries.map((e) => {
      const totalTax = e.federalTax + e.stateTax + e.socialSecurityTax + e.medicareTax;
      const netIncome = e.grossIncome - totalTax - e.retirement401k - e.otherDeductions;
      const effectiveRate = e.grossIncome ? (totalTax / e.grossIncome) * 100 : 0;
      return { ...e, totalTax, netIncome, effectiveRate };
    });
    return sortRows(list, sortField, sortDir);
  }, [entries, sortField, sortDir]);

  const activeCurrencies = useMemo(() => {
    const present = CURRENCIES.filter((c) => entries.some((e) => (e.currency || "INR") === c));
    return present.length ? present : ["INR"];
  }, [entries]);

  const totalsByCurrency = useMemo(() => {
    const out = {};
    CURRENCIES.forEach((cur) => {
      const list = withCalcs.filter((e) => (e.currency || "INR") === cur);
      const grossIncome = list.reduce((s, e) => s + e.grossIncome, 0);
      const totalTax = list.reduce((s, e) => s + e.totalTax, 0);
      const netIncome = list.reduce((s, e) => s + e.netIncome, 0);
      const refundTotal = list.reduce((s, e) => s + e.refundOrOwed, 0);
      out[cur] = { grossIncome, totalTax, netIncome, refundTotal, effectiveRate: grossIncome ? (totalTax / grossIncome) * 100 : 0 };
    });
    return out;
  }, [withCalcs]);

  const availableYears = useMemo(() => {
    return Array.from(new Set(entries.map((e) => e.year).filter(Boolean))).sort();
  }, [entries]);

  const byYear = useMemo(() => {
    const filtered = withCalcs.filter((e) => (e.currency || "INR") === chartCurrency && (chartYear === "All" || e.year === chartYear));
    const years = {};
    filtered.forEach((e) => {
      if (!years[e.year]) years[e.year] = { year: e.year, grossIncome: 0, totalTax: 0, netIncome: 0 };
      years[e.year].grossIncome += e.grossIncome;
      years[e.year].totalTax += e.totalTax;
      years[e.year].netIncome += e.netIncome;
    });
    return Object.values(years).sort((a, b) => a.year.localeCompare(b.year)).map((y) => ({ ...y, effectiveRate: y.grossIncome ? (y.totalTax / y.grossIncome) * 100 : 0 }));
  }, [withCalcs, chartCurrency, chartYear]);

  const openAdd = () => { setEditingId(null); setForm(blankForm); setShowAdd(true); };
  const openEdit = (e) => {
    setEditingId(e.id);
    setForm({
      year: e.year, employer: e.employer, filingStatus: e.filingStatus, currency: e.currency || "INR", grossIncome: e.grossIncome,
      federalTax: e.federalTax, stateTax: e.stateTax, socialSecurityTax: e.socialSecurityTax, medicareTax: e.medicareTax,
      retirement401k: e.retirement401k, otherDeductions: e.otherDeductions, refundOrOwed: e.refundOrOwed, notes: e.notes || "",
    });
    setShowAdd(true);
  };

  const save = async () => {
    if (!form.year || !form.employer || !form.grossIncome) return;
    if (!editingId && entries.some((e) => e.year === form.year && e.employer.trim().toLowerCase() === form.employer.trim().toLowerCase())) {
      if (!window.confirm(`A ${form.year} W-2 entry for "${form.employer}" already exists. Add another one anyway?`)) return;
    }
    const numericForm = {
      ...form, grossIncome: parseAmount(form.grossIncome), federalTax: parseAmount(form.federalTax), stateTax: parseAmount(form.stateTax),
      socialSecurityTax: parseAmount(form.socialSecurityTax), medicareTax: parseAmount(form.medicareTax),
      retirement401k: parseAmount(form.retirement401k), otherDeductions: parseAmount(form.otherDeductions),
      refundOrOwed: parseAmount(form.refundOrOwed),
    };
    let next;
    if (editingId) next = entries.map((e) => e.id === editingId ? { ...e, ...numericForm } : e);
    else next = [...entries, { id: Date.now().toString(), ...numericForm }];
    setEntries(next);
    await persist(next);
    setShowAdd(false);
  };

  const deleteEntry = async (e) => {
    if (!window.confirm(`Delete the ${e.year} W-2 entry for "${e.employer}"? This can't be undone.`)) return;
    const next = entries.filter((x) => x.id !== e.id);
    setEntries(next);
    await persist(next);
  };

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading salary log…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setError("")}>{error} (click to dismiss)</div>}
      {warning && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.gold, border: `1px solid ${COLORS.gold}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setWarning("")}>{warning} (click to dismiss)</div>}

      {activeCurrencies.map((cur) => (
        <div key={cur} style={{ marginBottom: 8 }}>
          <p style={{ fontFamily: sansFont, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 6px" }}>{cur} income</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 16 }}>
            {[
              { label: "Total gross income", value: fmt(totalsByCurrency[cur].grossIncome, cur) },
              { label: "Total taxes paid", value: fmt(totalsByCurrency[cur].totalTax, cur) },
              { label: "Avg. effective tax rate", value: pct(totalsByCurrency[cur].effectiveRate).replace("+", "") },
              { label: "Net refunds / (owed)", value: fmt(totalsByCurrency[cur].refundTotal, cur) },
            ].map((m, idx) => (
              <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
                <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
                <p style={{ fontSize: 24, margin: 0, fontWeight: 400 }}>{m.value}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, marginTop: 12 }}>
        <select value={chartYear} onChange={(e) => setChartYear(e.target.value)} style={selectStyle}>
          <option value="All">All years</option>
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={chartCurrency} onChange={(e) => setChartCurrency(e.target.value)} style={selectStyle}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, marginBottom: 44 }}>
        <div>
          <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Income & taxes by year</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byYear}>
              <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 1000}k`} />
              <RTooltip formatter={(v) => fmt(v, chartCurrency)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Arial" }} />
              <Bar dataKey="netIncome" name="Net income" fill={COLORS.positive} />
              <Bar dataKey="totalTax" name="Total tax" fill={COLORS.negative} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <h3 style={{ ...sectionHeading, marginBottom: 12 }}>Effective tax rate trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={byYear}>
              <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <RTooltip formatter={(v) => v.toFixed(1) + "%"} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
              <Line type="monotone" dataKey="effectiveRate" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>W-2 log</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select value={sortField} onChange={(e) => setSortField(e.target.value)} style={selectStyle}>
              <option value="employer">Sort: Employer</option>
              <option value="year">Sort: Year</option>
              <option value="grossIncome">Sort: Gross income</option>
            </select>
            <button onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} style={btnStyleGhost}>{sortDir === "asc" ? "↑ Asc" : "↓ Desc"}</button>
            <button onClick={openAdd} style={btnStyle}><Plus size={13} /> Add W-2 entry</button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["", "Year", "Employer", "Gross income", "Total tax", "Net income", "Effective rate", "Refund / (owed)", ""].map((h, i) => <th key={i} style={th(i > 2 && i < 8 ? "right" : "left")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {withCalcs.map((e) => (
              <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={{ ...td(), color: COLORS.accent }}><Briefcase size={16} /></td>
                <td style={td()}>{e.year}</td>
                <td style={td()}>
                  {e.employer}
                  <span style={{ fontSize: 10, color: COLORS.muted, border: `1px solid ${COLORS.line}`, padding: "1px 5px", marginLeft: 6 }}>{e.currency || "INR"}</span>
                  <div style={{ fontSize: 11, color: COLORS.muted }}>{e.filingStatus}</div>
                </td>
                <td style={td("right")}>{fmt(e.grossIncome, e.currency)}</td>
                <td style={td("right")}>{fmt(e.totalTax, e.currency)}</td>
                <td style={td("right")}>{fmt(e.netIncome, e.currency)}</td>
                <td style={td("right")}>{e.effectiveRate.toFixed(1)}%</td>
                <td style={{ ...td("right"), color: e.refundOrOwed >= 0 ? COLORS.positive : COLORS.negative, fontWeight: 700 }}>{fmt(e.refundOrOwed, e.currency)}</td>
                <td style={td("right")}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Pencil size={14} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEdit(e)} />
                    <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteEntry(e)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontFamily: sansFont, fontSize: 11, color: COLORS.muted, marginTop: 10 }}>
          Positive "Refund / (owed)" means a refund received; negative means tax owed to the IRS/state.
        </p>
      </div>

      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title={editingId ? "Edit W-2 entry" : "Add W-2 entry"}>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="Tax year"><input style={inputStyle} value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="2025" /></Field>
            <Field label="Filing status"><select style={inputStyle} value={form.filingStatus} onChange={(e) => setForm({ ...form, filingStatus: e.target.value })}>{FILING_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          </div>
          <Field label="Currency"><select style={inputStyle} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Employer"><input style={inputStyle} value={form.employer} onChange={(e) => setForm({ ...form, employer: e.target.value })} /></Field>
          <Field label={`Gross income / Box 1 wages (${form.currency})`}><input type="number" style={inputStyle} value={form.grossIncome} onChange={(e) => setForm({ ...form, grossIncome: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label={`Federal tax withheld (${form.currency})`}><input type="number" style={inputStyle} value={form.federalTax} onChange={(e) => setForm({ ...form, federalTax: e.target.value })} /></Field>
            <Field label={`State tax withheld (${form.currency})`}><input type="number" style={inputStyle} value={form.stateTax} onChange={(e) => setForm({ ...form, stateTax: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label={`Social Security tax (${form.currency})`}><input type="number" style={inputStyle} value={form.socialSecurityTax} onChange={(e) => setForm({ ...form, socialSecurityTax: e.target.value })} /></Field>
            <Field label={`Medicare tax (${form.currency})`}><input type="number" style={inputStyle} value={form.medicareTax} onChange={(e) => setForm({ ...form, medicareTax: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label={`401(k)/retirement contributions (${form.currency})`}><input type="number" style={inputStyle} value={form.retirement401k} onChange={(e) => setForm({ ...form, retirement401k: e.target.value })} /></Field>
            <Field label={`Other deductions (${form.currency})`}><input type="number" style={inputStyle} value={form.otherDeductions} onChange={(e) => setForm({ ...form, otherDeductions: e.target.value })} /></Field>
          </div>
          <Field label={`Refund received / (amount owed) (${form.currency})`}><input type="number" style={inputStyle} value={form.refundOrOwed} onChange={(e) => setForm({ ...form, refundOrOwed: e.target.value })} placeholder="Positive = refund, negative = owed" /></Field>
          <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <button onClick={save} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0" }}>{editingId ? "Save changes" : "Save entry"}</button>
        </Modal>
      )}
    </div>
  );
}
