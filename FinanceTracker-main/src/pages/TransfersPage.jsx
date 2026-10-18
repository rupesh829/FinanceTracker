import React, { useState, useMemo, useEffect } from "react";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend } from "recharts";
import { Plus, Pencil, Trash2, ArrowRightLeft } from "lucide-react";
import Modal from "../components/Modal.jsx";
import Field from "../components/Field.jsx";
import { getTable, setTable } from "../api.js";
import { COLORS, CURRENCIES, sansFont, fmt, todayStr, currentYearStr, sortRows, parseAmount, splitValidRows, isDuplicateValue, inputStyle, selectStyle, btnStyle, btnStyleGhost, sectionHeading, th, td, yearOf } from "../styles.js";

// A transfer converts an amount in one currency into another (e.g. USD ->
// INR). The rate is always derived from what was actually sent/received,
// never entered directly, so it reflects the real rate you got (including
// any spread/fees) rather than a market quote.
export default function TransfersPage() {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [chartYear, setChartYear] = useState(currentYearStr());
  const [chartDirection, setChartDirection] = useState("All");
  const [sortField, setSortField] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  const blankForm = { date: todayStr(), fromCurrency: "USD", toCurrency: "INR", amountSent: "", amountReceived: "", notes: "" };
  const [form, setForm] = useState(blankForm);

  useEffect(() => {
    (async () => {
      try {
        const rows = await getTable("Transfers");
        const { valid: validRows, skipped } = splitValidRows(rows);
        const loaded = validRows.map((r) => ({ ...r, amountSent: parseAmount(r.amountSent), amountReceived: parseAmount(r.amountReceived) }));
        if (skipped) setWarning(`Skipped ${skipped} row(s) in the Sheet that are missing an "id" — give every manually-added row a unique id to have it show up here.`);
        setTransfers(loaded);
      } catch (e) {
        setError("Couldn't load from Google Sheets. Check API_URL in src/api.js. " + e.message);
      } finally { setLoading(false); }
    })();
  }, []);

  const persist = async (next) => {
    try { await setTable("Transfers", next); } catch (e) { setError("Save failed: " + e.message); }
  };

  const withRate = useMemo(() => {
    const list = transfers.map((t) => ({
      ...t,
      rate: t.amountSent ? t.amountReceived / t.amountSent : 0,
      direction: `${t.fromCurrency} → ${t.toCurrency}`,
    }));
    return sortRows(list, sortField, sortDir);
  }, [transfers, sortField, sortDir]);

  const directions = useMemo(() => Array.from(new Set(withRate.map((t) => t.direction))).sort(), [withRate]);

  const totalsByDirection = useMemo(() => {
    const out = {};
    withRate.forEach((t) => {
      if (!out[t.direction]) out[t.direction] = { sent: 0, received: 0, count: 0, fromCurrency: t.fromCurrency, toCurrency: t.toCurrency };
      out[t.direction].sent += t.amountSent;
      out[t.direction].received += t.amountReceived;
      out[t.direction].count += 1;
    });
    Object.keys(out).forEach((k) => { out[k].avgRate = out[k].sent ? out[k].received / out[k].sent : 0; });
    return out;
  }, [withRate]);

  const availableYears = useMemo(() => Array.from(new Set(transfers.map((t) => yearOf(t.date)).filter(Boolean))).sort(), [transfers]);

  const chartData = useMemo(() => {
    const filtered = withRate.filter((t) =>
      (chartYear === "All" || yearOf(t.date) === chartYear) && (chartDirection === "All" || t.direction === chartDirection)
    );
    const months = {};
    filtered.forEach((t) => {
      const m = new Date(t.date).toLocaleString("en-US", { month: "short", year: "2-digit" });
      if (!months[m]) months[m] = { month: m, sortKey: t.date.slice(0, 7), amountReceived: 0, rateSum: 0, rateCount: 0 };
      months[m].amountReceived += t.amountReceived;
      months[m].rateSum += t.rate;
      months[m].rateCount += 1;
    });
    return Object.values(months).sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((m) => ({ ...m, avgRate: m.rateCount ? m.rateSum / m.rateCount : 0 }));
  }, [withRate, chartYear, chartDirection]);

  const openAdd = () => { setEditingId(null); setForm(blankForm); setShowAdd(true); };
  const openEdit = (t) => {
    setEditingId(t.id);
    setForm({ date: t.date, fromCurrency: t.fromCurrency, toCurrency: t.toCurrency, amountSent: t.amountSent, amountReceived: t.amountReceived, notes: t.notes || "" });
    setShowAdd(true);
  };

  const save = async () => {
    if (!form.date || !form.amountSent || !form.amountReceived || form.fromCurrency === form.toCurrency) return;
    if (!editingId && transfers.some((t) => t.date === form.date && t.fromCurrency === form.fromCurrency && t.toCurrency === form.toCurrency && parseAmount(t.amountSent) === parseAmount(form.amountSent))) {
      if (!window.confirm(`A transfer of the same amount, direction, and date already exists. Add another one anyway?`)) return;
    }
    const numericForm = { ...form, amountSent: parseAmount(form.amountSent), amountReceived: parseAmount(form.amountReceived) };
    let next;
    if (editingId) next = transfers.map((t) => t.id === editingId ? { ...t, ...numericForm } : t);
    else next = [...transfers, { id: Date.now().toString(), ...numericForm }];
    setTransfers(next);
    await persist(next);
    setShowAdd(false);
  };

  const deleteTransfer = async (t) => {
    if (!window.confirm(`Delete this transfer of ${fmt(t.amountSent, t.fromCurrency)} → ${fmt(t.amountReceived, t.toCurrency)} on ${t.date}?`)) return;
    const next = transfers.filter((x) => x.id !== t.id);
    setTransfers(next);
    await persist(next);
  };

  if (loading) return <div style={{ fontFamily: sansFont, padding: 60, textAlign: "center", color: COLORS.muted }}>Loading transfers…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 80px", color: COLORS.ink }}>
      {error && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.negative, border: `1px solid ${COLORS.negative}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setError("")}>{error} (click to dismiss)</div>}
      {warning && <div style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.gold, border: `1px solid ${COLORS.gold}`, padding: "8px 12px", marginBottom: 16, cursor: "pointer" }} onClick={() => setWarning("")}>{warning} (click to dismiss)</div>}

      {Object.keys(totalsByDirection).length === 0 ? (
        <p style={{ fontFamily: sansFont, fontSize: 13, color: COLORS.muted, margin: "8px 0 30px" }}>No transfers logged yet — add your first USD ↔ INR conversion below.</p>
      ) : (
        Object.entries(totalsByDirection).map(([direction, t]) => (
          <div key={direction} style={{ marginBottom: 8 }}>
            <p style={{ fontFamily: sansFont, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 6px" }}>{direction}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: COLORS.ink, marginBottom: 16 }}>
              {[
                { label: `Total sent`, value: fmt(t.sent, t.fromCurrency) },
                { label: `Total received`, value: fmt(t.received, t.toCurrency) },
                { label: "Transfers logged", value: t.count },
                { label: "Average rate", value: `1 ${t.fromCurrency} = ${t.avgRate.toFixed(4)} ${t.toCurrency}` },
              ].map((m, idx) => (
                <div key={idx} style={{ background: COLORS.bg, padding: "18px 20px" }}>
                  <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: COLORS.muted, margin: "0 0 8px", fontFamily: sansFont }}>{m.label}</p>
                  <p style={{ fontSize: 22, margin: 0, fontWeight: 400 }}>{m.value}</p>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <div style={{ marginBottom: 44, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Transfer volume & rate over time</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={chartYear} onChange={(e) => setChartYear(e.target.value)} style={selectStyle}>
              <option value="All">All years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={chartDirection} onChange={(e) => setChartDirection(e.target.value)} style={selectStyle}>
              <option value="All">All directions</option>
              {directions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <button onClick={openAdd} style={btnStyle}><Plus size={13} /> Log a transfer</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
          <div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} />
                <RTooltip contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
                <Bar dataKey="amountReceived" name="Amount received" fill={COLORS.info} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="2 4" stroke={COLORS.line} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={{ stroke: COLORS.line }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: COLORS.muted, fontFamily: "Arial" }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
                <RTooltip formatter={(v) => v.toFixed(4)} contentStyle={{ fontFamily: sansFont, fontSize: 12, border: `1px solid ${COLORS.ink}`, borderRadius: 4 }} />
                <Line type="monotone" dataKey="avgRate" name="Avg. rate" stroke={COLORS.accent} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        {chartData.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, textAlign: "center", marginTop: 8 }}>No transfers match this filter.</p>}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={sectionHeading}>Transfer log</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select value={sortField} onChange={(e) => setSortField(e.target.value)} style={selectStyle}>
              <option value="date">Sort: Date</option>
              <option value="amountSent">Sort: Amount sent</option>
            </select>
            <button onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))} style={btnStyleGhost}>{sortDir === "asc" ? "↑ Asc" : "↓ Desc"}</button>
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: sansFont, fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `2px solid ${COLORS.ink}` }}>
            {["", "Date", "Direction", "Sent", "Received", "Rate", "Notes", ""].map((h, i) => <th key={i} style={th(i > 2 && i < 6 ? "right" : "left")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {withRate.map((t) => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.line}` }}>
                <td style={{ ...td(), color: COLORS.accent }}><ArrowRightLeft size={16} /></td>
                <td style={td()}>{t.date}</td>
                <td style={td()}>{t.direction}</td>
                <td style={td("right")}>{fmt(t.amountSent, t.fromCurrency)}</td>
                <td style={td("right")}>{fmt(t.amountReceived, t.toCurrency)}</td>
                <td style={td("right")}>{t.rate.toFixed(4)}</td>
                <td style={{ ...td(), fontSize: 12, color: COLORS.muted }}>{t.notes}</td>
                <td style={td("right")}>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Pencil size={14} style={{ cursor: "pointer", color: COLORS.muted }} onClick={() => openEdit(t)} />
                    <Trash2 size={14} style={{ cursor: "pointer", color: COLORS.negative }} onClick={() => deleteTransfer(t)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {withRate.length === 0 && <p style={{ fontFamily: sansFont, fontSize: 12, color: COLORS.muted, marginTop: 10 }}>No transfers logged yet.</p>}
      </div>

      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title={editingId ? "Edit transfer" : "Log a transfer"}>
          <Field label="Date"><input type="date" style={inputStyle} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="From currency"><select style={inputStyle} value={form.fromCurrency} onChange={(e) => setForm({ ...form, fromCurrency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="To currency"><select style={inputStyle} value={form.toCurrency} onChange={(e) => setForm({ ...form, toCurrency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          {form.fromCurrency === form.toCurrency && <p style={{ fontSize: 11, color: COLORS.negative, margin: "-8px 0 10px" }}>From and to currency must be different.</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <Field label={`Amount sent (${form.fromCurrency})`}><input type="number" style={inputStyle} value={form.amountSent} onChange={(e) => setForm({ ...form, amountSent: e.target.value })} /></Field>
            <Field label={`Amount received (${form.toCurrency})`}><input type="number" style={inputStyle} value={form.amountReceived} onChange={(e) => setForm({ ...form, amountReceived: e.target.value })} /></Field>
          </div>
          {form.amountSent > 0 && form.amountReceived > 0 && (
            <p style={{ fontSize: 12, color: COLORS.muted, margin: "-8px 0 10px" }}>
              Effective rate: 1 {form.fromCurrency} = {(Number(form.amountReceived) / Number(form.amountSent)).toFixed(4)} {form.toCurrency}
            </p>
          )}
          <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Wise transfer, bank wire" /></Field>
          <button onClick={save} style={{ ...btnStyle, width: "100%", justifyContent: "center", padding: "10px 0" }}>{editingId ? "Save changes" : "Save transfer"}</button>
        </Modal>
      )}
    </div>
  );
}
