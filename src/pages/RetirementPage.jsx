import React, { useEffect, useMemo, useRef, useState } from "react";
import { getTable, setTable } from "../api.js";
import { COLORS, sansFont, serifFont, inputStyle, btnStyle, btnStyleGhost, parseAmount } from "../styles.js";
import { SEED, BASE_EXPENSES, BASE_ITEMS, BASE_ASSETS, BASE_TIERS, BASE_INFL } from "../retirementSeed.js";

const TAB = { cfg: "RetirementConfig", exp: "RetirementExpenses", itm: "RetirementItems", ast: "RetirementAssets" };
const bool = (v) => v === true || String(v).toUpperCase() === "TRUE";
const cr = (v) => (v / 1e7).toFixed(2);
const inr = (v) => Math.round(v).toLocaleString("en-IN");
const now = new Date();
const dobFromAge = (a) => `${now.getFullYear() - a}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const ageOf = (dob) => { const m = /^(\d{4})-(\d{2})/.exec(dob || ""); return m ? Math.max(0, now.getFullYear() - +m[1] - (now.getMonth() + 1 < +m[2] ? 1 : 0)) : 0; };
const DEF_FAMILY = { fName: "Father", mName: "Mother", k1Name: "Kid 1", k2Name: "Kid 2", fDob: dobFromAge(40), mDob: dobFromAge(36), k1Dob: dobFromAge(8), k2Dob: dobFromAge(3), retAge: 44, horizonAge: 90, growToRet: false, ledgerFromToday: true };
let seq = Date.now() % 1e6;
const nid = (p) => `${p}${(seq++).toString(36)}`;

const I = ({ v, on, w = 70, t = "number", ...p }) => (
  <input type={t} value={v ?? ""} onChange={(e) => on(t === "number" ? (e.target.value === "" ? 0 : +e.target.value) : e.target.value)} style={{ ...inputStyle, width: w, padding: "4px 6px" }} {...p} />
);
const S = ({ v, on, opts, w }) => (
  <select value={v} onChange={(e) => on(e.target.value)} style={{ ...inputStyle, width: w || "auto", padding: "4px 6px" }}>
    {opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
  </select>
);
const Chk = ({ v, on, label }) => <label style={{ fontSize: 11, marginRight: 8, whiteSpace: "nowrap" }}><input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} /> {label}</label>;
const Card = ({ children, style }) => <div style={{ background: "#fff", border: `1px solid ${COLORS.line}`, padding: 16, marginBottom: 16, ...style }}>{children}</div>;
const cell = { padding: "6px 5px", borderBottom: `1px solid ${COLORS.lineLight}`, verticalAlign: "top", fontSize: 12 };
const head = { ...cell, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, textAlign: "left" };

function seedInto(expenses, items, family, tiers, infl) {
  const names = new Set(expenses.map((e) => e.name));
  const ex = [...expenses], it = [...items];
  const nm = (t) => t.replace("{k1}", family.k1Name).replace("{k2}", family.k2Name);
  const af = ageOf(family.fDob);
  SEED.forEach((p) => {
    const name = nm(p.n);
    if (names.has(name) || tiers[p.t] === undefined || infl[p.i] === undefined) return;
    const id = nid("e"), st = p.sOff !== undefined ? af + p.sOff : p.s;
    ex.push({ id, tier: p.t, name, desc: "Placeholder estimates — edit in Itemized Costs", baseValue: 0, unit: "/ year", isRecurring: !p.x, startAge: st, endAge: p.e || st, startAtRet: !!p.sr, endAtHorizon: false, infType: p.i, anchor: p.a, active: p.act !== false, every: p.ev || 1 });
    p.it.forEach(([n, v]) => it.push({ id: nid("i"), parentExpenseId: id, name: n, value: v, unit: "/ year" }));
  });
  return { ex, it };
}

export default function RetirementPage() {
  const [tab, setTab] = useState("setup");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("Loading…");
  const [family, setFamily] = useState(DEF_FAMILY);
  const [infl, setInfl] = useState(BASE_INFL);
  const [tiers, setTiers] = useState(BASE_TIERS);
  const [expenses, setExpenses] = useState([]);
  const [items, setItems] = useState([]);
  const [assets, setAssets] = useState([]);
  const lastSaved = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const [cfg, ex, it, as] = await Promise.all([TAB.cfg, TAB.exp, TAB.itm, TAB.ast].map(getTable));
        const c = {};
        cfg.forEach((r) => { try { c[r.id] = JSON.parse(r.valueJSON); } catch (e) {} });
        const fam = { ...DEF_FAMILY, ...(c.family || {}) };
        const inf = c.inflation || BASE_INFL, tr = c.tiers || BASE_TIERS;
        let E, It;
        if (!cfg.length && !ex.length) {
          const s = seedInto(BASE_EXPENSES, BASE_ITEMS, fam, tr, inf); E = s.ex; It = s.it;
          setAssets(BASE_ASSETS);
        } else {
          E = ex.filter((r) => r.id).map((r) => ({ ...r, id: String(r.id), baseValue: parseAmount(r.baseValue), startAge: parseAmount(r.startAge), endAge: parseAmount(r.endAge), every: parseAmount(r.every) || 1, isRecurring: bool(r.isRecurring), startAtRet: bool(r.startAtRet), endAtHorizon: bool(r.endAtHorizon), active: r.active === "" ? true : bool(r.active), anchor: r.anchor || "f" }));
          It = it.filter((r) => r.id).map((r) => ({ ...r, id: String(r.id), parentExpenseId: String(r.parentExpenseId), value: parseAmount(r.value) }));
          setAssets(as.filter((r) => r.id).map((r) => ({ ...r, id: String(r.id), allocated: parseAmount(r.allocated), roi: parseAmount(r.roi), targets: String(r.targets || "").split(",").filter(Boolean) })));
        }
        setFamily(fam); setInfl(inf); setTiers(tr); setExpenses(E); setItems(It);
        setLoaded(true); setStatus("Loaded from Google Sheet");
      } catch (e) { setStatus("⚠ Could not load: " + e.message); }
    })();
  }, []);

  // Debounced whole-table save (same model as every other page: setTable replaces the tab).
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      const tables = {
        [TAB.cfg]: [{ id: "family", valueJSON: JSON.stringify(family) }, { id: "inflation", valueJSON: JSON.stringify(infl) }, { id: "tiers", valueJSON: JSON.stringify(tiers) }],
        [TAB.exp]: expenses, [TAB.itm]: items, [TAB.ast]: assets.map((a) => ({ ...a, targets: a.targets.join(",") })),
      };
      try {
        setStatus("Saving…");
        for (const [sheet, rows] of Object.entries(tables)) {
          const j = JSON.stringify(rows);
          if (lastSaved.current[sheet] === j) continue;
          await setTable(sheet, rows);
          lastSaved.current[sheet] = j;
        }
        setStatus("✓ Saved to Google Sheet");
      } catch (e) { setStatus("⚠ Save failed: " + e.message); }
    }, 1500);
    return () => clearTimeout(t);
  }, [loaded, family, infl, tiers, expenses, items, assets]);

  const ages = { f: ageOf(family.fDob), m: ageOf(family.mDob), k1: ageOf(family.k1Dob), k2: ageOf(family.k2Dob) };
  const people = [["f", family.fName], ["m", family.mName], ["k1", family.k1Name], ["k2", family.k2Name]];
  const annual = (g) => (g.unit === "/ month" ? g.value * 12 : g.value);
  const linkedSum = useMemo(() => { const m = {}; items.forEach((g) => { m[g.parentExpenseId] = (m[g.parentExpenseId] || 0) + annual(g); }); return m; }, [items]);
  const totalL = assets.reduce((s, a) => s + a.allocated, 0);
  const wroi = totalL ? assets.reduce((s, a) => s + a.allocated * a.roi, 0) / totalL : 0;
  const pre = (roi) => (family.ledgerFromToday || !family.growToRet ? 1 : Math.pow(1 + roi / 100, Math.max(0, family.retAge - ages.f)));

  const ledger = useMemo(() => {
    const cur = ages.f, ret = +family.retAge || cur, max = +family.horizonAge || 90;
    let cap = assets.reduce((s, a) => s + a.allocated * 1e5 * pre(a.roi), 0);
    const rows = [];
    for (let f = family.ledgerFromToday ? cur : Math.max(ret, cur); f <= max; f++) {
      const off = f - cur, out = {};
      Object.keys(tiers).forEach((k) => (out[k] = 0));
      expenses.forEach((x) => {
        if (!x.active) return;
        const sh = cur - (ages[x.anchor || "f"] || 0);
        const s = x.startAtRet ? ret : x.startAge + sh, e = x.endAtHorizon ? max : x.endAge + sh, ev = Math.max(1, x.every || 1);
        if (!(x.isRecurring ? f >= s && f <= e && (f - s) % ev === 0 : f === s)) return;
        const linked = linkedSum[x.id] !== undefined;
        let base = linked ? linkedSum[x.id] : x.baseValue || 0;
        if (!linked && x.unit === "/ month") base *= 12;
        if (out[x.tier] !== undefined) out[x.tier] += base * Math.pow(1 + (infl[x.infType] || 0) / 100, off);
      });
      const total = Object.values(out).reduce((a, b) => a + b, 0), after = cap - total, end = after > 0 ? after * (1 + wroi / 100) : after;
      rows.push({ f, m: ages.m + off, k1: ages.k1 + off, k2: ages.k2 + off, start: cap, out, total, end });
      cap = end;
    }
    return rows;
  }, [family, assets, expenses, linkedSum, infl, tiers, wroi]);

  const corpus = useMemo(() => {
    const m = {}; Object.keys(tiers).forEach((k) => (m[k] = 0));
    ledger.forEach((r, i) => Object.keys(tiers).forEach((k) => { m[k] += (r.out[k] || 0) / Math.pow(1 + wroi / 100, i); }));
    return m;
  }, [ledger, tiers, wroi]);
  const alloc = useMemo(() => {
    const m = {}; Object.keys(tiers).forEach((k) => (m[k] = 0));
    assets.forEach((a) => a.targets.forEach((k) => { if (m[k] !== undefined) m[k] += (a.allocated * 1e5 * pre(a.roi)) / a.targets.length; }));
    return m;
  }, [assets, tiers, family]);

  const upd = (set) => (id, patch) => set((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updE = upd(setExpenses), updI = upd(setItems), updA = upd(setAssets);
  const setF = (k) => (v) => setFamily((f) => ({ ...f, [k]: v }));
  const addExpense = (tier) => setExpenses((l) => [...l, { id: nid("e"), tier, name: "New expense line", desc: "", baseValue: 50000, unit: "/ year", isRecurring: true, startAge: family.retAge, endAge: family.horizonAge, startAtRet: true, endAtHorizon: true, infType: "core", anchor: "f", active: true, every: 1 }]);
  const delExpense = (id) => { setExpenses((l) => l.filter((e) => e.id !== id)); setItems((l) => l.filter((g) => g.parentExpenseId !== id)); };
  const addTier = () => {
    const k = (prompt("Short key for the new tier (e.g. wedding, real_estate):") || "").trim();
    if (k && !tiers[k]) setTiers((t) => ({ ...t, [k]: prompt("Descriptive name:") || k }));
  };
  const delTier = (k) => {
    if (!window.confirm("Delete this tier with its expense lines?")) return;
    const ids = expenses.filter((e) => e.tier === k).map((e) => e.id);
    setExpenses((l) => l.filter((e) => e.tier !== k)); setItems((l) => l.filter((g) => !ids.includes(g.parentExpenseId)));
    setAssets((l) => l.map((a) => ({ ...a, targets: a.targets.filter((t) => t !== k) })));
    setTiers((t) => { const n = { ...t }; delete n[k]; return n; });
  };
  const restore = () => { const s = seedInto(expenses, items, family, tiers, infl); setExpenses(s.ex); setItems(s.it); };
  const addInfl = () => { const k = (prompt("Name for the new inflation track:") || "").trim(); if (k && infl[k] === undefined) setInfl((i) => ({ ...i, [k]: 7 })); };
  const delInfl = (k) => { setInfl((i) => { const n = { ...i }; delete n[k]; return n; }); setExpenses((l) => l.map((e) => (e.infType === k ? { ...e, infType: "core" } : e))); };

  const tabs = [["setup", "Family & Inflation"], ["items", "Itemized Costs"], ["tiers", "Tier Aggregations"], ["assets", "Capital Portfolios"], ["ledger", "Cash Runway"]];
  const inflOpts = Object.keys(infl).map((k) => [k, k]);
  const parentOpts = expenses.map((e) => [e.id, e.name]);
  const tierKeys = Object.keys(tiers);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 24, fontFamily: sansFont, color: COLORS.ink }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontFamily: serifFont, fontWeight: 400, fontSize: 24, margin: 0 }}>{family.fName} & {family.mName}'s Retirement Plan</h2>
        <span style={{ fontSize: 12, color: COLORS.muted }}>Portfolio yield {wroi.toFixed(2)}% · {status}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10, marginBottom: 16 }}>
        {tierKeys.map((k) => {
          const ok = (alloc[k] || 0) >= (corpus[k] || 0);
          return (
            <Card key={k} style={{ marginBottom: 0, padding: 12 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", color: COLORS.muted }}>{k}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Needed (NPV): <b>₹{cr(corpus[k] || 0)} Cr</b></div>
              <div style={{ fontSize: 12 }}>Allocated: <b>₹{cr(alloc[k] || 0)} Cr</b></div>
              <div style={{ fontSize: 11, marginTop: 6, color: ok ? COLORS.positive : COLORS.negative }}>{ok ? "Fully funded" : "Deficit shortfall"}</div>
            </Card>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
        {tabs.map(([k, n]) => <button key={k} onClick={() => setTab(k)} style={tab === k ? btnStyle : btnStyleGhost}>{n}</button>)}
      </div>

      {tab === "setup" && (
        <>
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              {[["f", "Father"], ["m", "Mother"], ["k1", "Kid 1"], ["k2", "Kid 2"]].map(([k, l]) => (
                <div key={k}>
                  <div style={{ fontSize: 11, color: COLORS.muted }}>{l} name</div>
                  <I t="text" w="100%" v={family[k + "Name"]} on={setF(k + "Name")} />
                  <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>Birth month / year</div>
                  <I t="month" w="100%" v={family[k + "Dob"]} on={setF(k + "Dob")} />
                  <div style={{ fontSize: 12, marginTop: 4 }}>Age: <b>{ages[k]}</b></div>
                </div>
              ))}
              <div><div style={{ fontSize: 11, color: COLORS.muted }}>{family.fName}'s retirement age</div><I w="100%" v={family.retAge} on={setF("retAge")} /></div>
              <div><div style={{ fontSize: 11, color: COLORS.muted }}>Horizon age</div><I w="100%" v={family.horizonAge} on={setF("horizonAge")} /></div>
            </div>
          </Card>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><b style={{ fontSize: 13 }}>Inflation tracks (% per year)</b><button style={btnStyleGhost} onClick={addInfl}>+ Add track</button></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {Object.keys(infl).map((k) => (
                <div key={k} style={{ fontSize: 12 }}>{k} <I w={60} v={infl[k]} on={(v) => setInfl((i) => ({ ...i, [k]: v }))} step="0.1" />
                  {!["core", "edu", "med"].includes(k) && <a style={{ color: COLORS.negative, cursor: "pointer", marginLeft: 4 }} onClick={() => delInfl(k)}>✕</a>}</div>
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === "items" && (
        <Card style={{ overflowX: "auto" }}>
          <button style={{ ...btnStyle, marginBottom: 8 }} disabled={!expenses.length} onClick={() => setItems((l) => [...l, { id: nid("i"), parentExpenseId: expenses[0].id, name: "New item", value: 1000, unit: "/ month" }])}>+ Add itemized line</button>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>{["Item", "Parent line", "Cycle", "Base cost ₹", "Per year", ""].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id}>
                  <td style={cell}><I t="text" w="100%" v={g.name} on={(v) => updI(g.id, { name: v })} /></td>
                  <td style={cell}><S v={g.parentExpenseId} opts={parentOpts} on={(v) => updI(g.id, { parentExpenseId: v })} w={230} /></td>
                  <td style={cell}><S v={g.unit} opts={[["/ month", "Monthly"], ["/ year", "Annual"]]} on={(v) => updI(g.id, { unit: v })} /></td>
                  <td style={cell}><I w={90} v={g.value} on={(v) => updI(g.id, { value: v })} /></td>
                  <td style={cell}>₹{inr(annual(g))}</td>
                  <td style={cell}><a style={{ color: COLORS.negative, cursor: "pointer" }} onClick={() => setItems((l) => l.filter((x) => x.id !== g.id))}>Delete</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "tiers" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}><button style={btnStyleGhost} onClick={addTier}>+ Create tier</button><button style={btnStyleGhost} onClick={restore}>↻ Restore template items</button></div>
          {tierKeys.map((k) => (
            <Card key={k} style={{ overflowX: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                <b style={{ fontSize: 13, textTransform: "uppercase" }}>{k} <span style={{ fontWeight: 400, textTransform: "none", color: COLORS.muted }}>— {tiers[k]} · NPV ₹{cr(corpus[k] || 0)} Cr</span></b>
                <span><button style={btnStyle} onClick={() => addExpense(k)}>+ Add macro line item</button>{!["survival", "education", "goals", "maintenance", "lifestyle"].includes(k) && <button style={{ ...btnStyleGhost, marginLeft: 6 }} onClick={() => delTier(k)}>Delete tier</button>}</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead><tr>{["Line", "Pattern / inflation", "Timeline (ages of selected person)", "Amount", ""].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                <tbody>
                  {expenses.filter((e) => e.tier === k).map((e) => (
                    <tr key={e.id} style={{ opacity: e.active ? 1 : 0.5 }}>
                      <td style={{ ...cell, width: "26%" }}><I t="text" w="100%" v={e.name} on={(v) => updE(e.id, { name: v })} /></td>
                      <td style={cell}>
                        <S v={e.isRecurring ? "r" : "o"} opts={[["r", "Recurring"], ["o", "One-time"]]} on={(v) => updE(e.id, { isRecurring: v === "r" })} />{" "}
                        <S v={e.infType} opts={inflOpts} on={(v) => updE(e.id, { infType: v })} />
                      </td>
                      <td style={cell}>
                        <S v={e.anchor} opts={people} on={(v) => updE(e.id, { anchor: v })} /> <Chk v={e.active} on={(v) => updE(e.id, { active: v })} label="Active" />
                        <div style={{ marginTop: 4 }}>
                          {e.startAtRet ? <b>{family.retAge}</b> : <I w={50} v={e.startAge} on={(v) => updE(e.id, { startAge: v })} />} <Chk v={e.startAtRet} on={(v) => updE(e.id, { startAtRet: v })} label="at retirement" />
                          {e.isRecurring && <>→ {e.endAtHorizon ? <b>{family.horizonAge}</b> : <I w={50} v={e.endAge} on={(v) => updE(e.id, { endAge: v })} />} <Chk v={e.endAtHorizon} on={(v) => updE(e.id, { endAtHorizon: v })} label="at horizon" /> every <I w={44} v={e.every} on={(v) => updE(e.id, { every: v })} /> yr</>}
                        </div>
                      </td>
                      <td style={cell}>
                        {linkedSum[e.id] !== undefined ? <span>₹{inr(linkedSum[e.id])} /yr <i style={{ color: COLORS.info }}>(from itemized)</i></span> : <>₹<I w={90} v={e.baseValue} on={(v) => updE(e.id, { baseValue: v })} /> <S v={e.unit} opts={[["/ month", "/mo"], ["/ year", "/yr"]]} on={(v) => updE(e.id, { unit: v })} /></>}
                      </td>
                      <td style={cell}><a style={{ color: COLORS.negative, cursor: "pointer" }} onClick={() => window.confirm("Delete this line and its itemized costs?") && delExpense(e.id)}>Delete</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </>
      )}

      {tab === "assets" && (
        <Card style={{ overflowX: "auto" }}>
          <Chk v={family.ledgerFromToday} on={setF("ledgerFromToday")} label="Corpus funds all dated expenses from today (ledger starts today)" />
          <Chk v={family.growToRet} on={setF("growToRet")} label="Capital keeps compounding until retirement (only when the ledger starts at retirement)" />
          <div style={{ margin: "8px 0" }}><button style={btnStyle} onClick={() => setAssets((l) => [...l, { id: nid("a"), name: "New asset", allocated: 50, roi: 8.5, targets: [] }])}>+ Add asset</button></div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>{["Asset", "Principal (Lakhs)", "Growth %", "Funds which tiers", ""].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td style={cell}><I t="text" w="100%" v={a.name} on={(v) => updA(a.id, { name: v })} /></td>
                  <td style={cell}><I w={90} v={a.allocated} on={(v) => updA(a.id, { allocated: v })} /></td>
                  <td style={cell}><I w={60} v={a.roi} on={(v) => updA(a.id, { roi: v })} step="0.1" /></td>
                  <td style={cell}>{tierKeys.map((k) => <Chk key={k} v={a.targets.includes(k)} label={k} on={(c) => updA(a.id, { targets: c ? [...a.targets, k] : a.targets.filter((x) => x !== k) })} />)}</td>
                  <td style={cell}><a style={{ color: COLORS.negative, cursor: "pointer" }} onClick={() => setAssets((l) => l.filter((x) => x.id !== a.id))}>Delete</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "ledger" && (
        <Card style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr>
              {[family.fName, family.mName, family.k1Name, family.k2Name].map((n) => <th key={n} style={head}>{n} age</th>)}
              <th style={head}>Start balance</th>{tierKeys.map((k) => <th key={k} style={head}>{k}</th>)}<th style={head}>Total outlay</th><th style={head}>End balance</th>
            </tr></thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.f}>
                  <td style={cell}><b>{r.f}</b></td><td style={cell}>{r.m}</td><td style={cell}>{r.k1}</td><td style={cell}>{r.k2}</td>
                  <td style={cell}>₹{inr(r.start)}</td>{tierKeys.map((k) => <td key={k} style={cell}>₹{inr(r.out[k] || 0)}</td>)}
                  <td style={{ ...cell, color: COLORS.negative }}>₹{inr(r.total)}</td><td style={{ ...cell, fontWeight: 700, color: r.end < 0 ? COLORS.negative : COLORS.positive }}>₹{inr(r.end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
