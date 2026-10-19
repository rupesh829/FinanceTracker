import React, { useEffect, useMemo, useRef, useState } from "react";
import { getTable, setTable } from "../api.js";
import { COLORS, sansFont, serifFont, inputStyle, btnStyle, btnStyleGhost, parseAmount } from "../styles.js";
import { SEED, BASE_ASSETS, BASE_TIERS, BASE_INFL } from "../retirementSeed.js";

const TAB = { cfg: "RetirementConfig", exp: "RetirementExpenses", itm: "RetirementItems", ast: "RetirementAssets" };
const bool = (v) => v === true || String(v).toUpperCase() === "TRUE";
// Indian short format: K / L (lakh) / Cr (crore)
const fmtI = (v) => {
  const n = Math.abs(v || 0), s = v < 0 ? "-" : "";
  if (n >= 1e7) return `${s}₹${+(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${s}₹${+(n / 1e5).toFixed(2)} L`;
  if (n >= 1e3) return `${s}₹${+(n / 1e3).toFixed(1)} K`;
  return `${s}₹${Math.round(n)}`;
};
const now = new Date();
const dobFromAge = (a) => `${now.getFullYear() - a}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const ageOf = (dob) => { const m = /^(\d{4})-(\d{2})/.exec(dob || ""); return m ? Math.max(0, now.getFullYear() - +m[1] - (now.getMonth() + 1 < +m[2] ? 1 : 0)) : 0; };
const DEF_FAMILY = { fName: "Father", mName: "Mother", k1Name: "Kid 1", k2Name: "Kid 2", fDob: dobFromAge(40), mDob: dobFromAge(36), k1Dob: dobFromAge(8), k2Dob: dobFromAge(3), retAge: 44, horizonAge: 90, growToRet: false, ledgerFromToday: true };
let seq = Date.now() % 1e6;
const nid = (p) => `${p}${(seq++).toString(36)}`;
const gk = (t, g) => `${t}|${g}`;
const PROTECTED = ["survival", "education", "goals", "maintenance", "lifestyle"];

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
const Del = ({ on, children = "Delete" }) => <a style={{ color: COLORS.negative, cursor: "pointer", fontSize: 12 }} onClick={on}>{children}</a>;
const cell = { padding: "6px 5px", borderBottom: `1px solid ${COLORS.lineLight}`, verticalAlign: "top", fontSize: 12 };
const head = { ...cell, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, textAlign: "left" };

function seedInto(items, groups, family, tiers, infl) {
  const have = new Set(items.map((x) => `${x.parentLine}|${x.name}`));
  const it = [...items], gr = [...groups];
  const nm = (t) => t.replace(/\{k1\}/g, family.k1Name).replace(/\{k2\}/g, family.k2Name);
  const af = ageOf(family.fDob);
  SEED.forEach((p) => {
    if (tiers[p.t] === undefined || infl[p.i] === undefined) return;
    const g = nm(p.g), pl = nm(p.n), st = p.sOff !== undefined ? af + p.sOff : p.s;
    if (!gr.some((x) => x.tier === p.t && x.name === g)) gr.push({ tier: p.t, name: g });
    p.it.forEach(([n, v, u]) => {
      if (have.has(`${pl}|${n}`)) return;
      it.push({ id: nid("i"), name: n, tier: p.t, group: g, parentLine: pl, unit: u || "/ year", value: v, isRecurring: !p.x, startAge: st ?? 0, endAge: p.e || st || 0, startAtRet: !!p.sr, endAtHorizon: !!p.eh, infType: p.i, anchor: p.a, active: p.act !== false, every: p.ev || 1 });
    });
  });
  return { it, gr };
}

// Old format (RetirementExpenses parents + items with parentExpenseId) -> flat items.
function migrate(exp, itm, family) {
  const byId = {}; exp.forEach((e) => (byId[String(e.id)] = e));
  const gmap = {};
  SEED.forEach((p) => (gmap[p.n.replace(/\{k1\}/g, family.k1Name).replace(/\{k2\}/g, family.k2Name)] = p.g.replace(/\{k1\}/g, family.k1Name).replace(/\{k2\}/g, family.k2Name)));
  const tl = (e) => ({ tier: e.tier, parentLine: e.name, group: gmap[e.name] || e.name, isRecurring: bool(e.isRecurring), startAge: parseAmount(e.startAge), endAge: parseAmount(e.endAge), startAtRet: bool(e.startAtRet), endAtHorizon: bool(e.endAtHorizon), infType: e.infType || "core", anchor: e.anchor || "f", active: e.active === "" || e.active === undefined ? true : bool(e.active), every: parseAmount(e.every) || 1 });
  const out = [], used = new Set();
  itm.forEach((g) => { const e = byId[String(g.parentExpenseId)]; if (!e) return; used.add(String(e.id)); out.push({ id: String(g.id), name: g.name, unit: g.unit, value: parseAmount(g.value), ...tl(e) }); });
  exp.forEach((e) => { if (!used.has(String(e.id))) out.push({ id: String(e.id), name: `${e.name} – amount`, unit: e.unit || "/ year", value: parseAmount(e.baseValue), ...tl(e) }); });
  return out;
}

export default function RetirementPage() {
  const [tab, setTab] = useState("setup");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("Loading…");
  const [family, setFamily] = useState(DEF_FAMILY);
  const [infl, setInfl] = useState(BASE_INFL);
  const [tiers, setTiers] = useState(BASE_TIERS);
  const [groups, setGroups] = useState([]);
  const [items, setItems] = useState([]);
  const [assets, setAssets] = useState([]);
  const [open, setOpen] = useState({});
  const [fTier, setFTier] = useState("all");
  const [fGroup, setFGroup] = useState("all");
  const [q, setQ] = useState("");
  const lastSaved = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const [cfg, ex, it, as] = await Promise.all([TAB.cfg, TAB.exp, TAB.itm, TAB.ast].map(getTable));
        const c = {};
        cfg.forEach((r) => { try { c[r.id] = JSON.parse(r.valueJSON); } catch (e) {} });
        const fam = { ...DEF_FAMILY, ...(c.family || {}) };
        const inf = c.inflation || BASE_INFL, tr = c.tiers || BASE_TIERS;
        let I2, G = c.groups || [];
        if (!cfg.length && !ex.length && !it.length) {
          const s = seedInto([], [], fam, tr, inf); I2 = s.it; G = s.gr; setAssets(BASE_ASSETS);
        } else {
          I2 = it.filter((r) => r.id && r.tier).length ? it.filter((r) => r.id).map((r) => ({ ...r, id: String(r.id), value: parseAmount(r.value), startAge: parseAmount(r.startAge), endAge: parseAmount(r.endAge), every: parseAmount(r.every) || 1, isRecurring: bool(r.isRecurring), startAtRet: bool(r.startAtRet), endAtHorizon: bool(r.endAtHorizon), active: r.active === "" ? true : bool(r.active), anchor: r.anchor || "f", group: String(r.group || ""), parentLine: String(r.parentLine || "") })) : migrate(ex.filter((r) => r.id), it.filter((r) => r.id), fam);
          setAssets(as.filter((r) => r.id).map((r) => ({ ...r, id: String(r.id), allocated: parseAmount(r.allocated), roi: parseAmount(r.roi), targets: String(r.targets || "").split(",").filter(Boolean) })));
        }
        I2.forEach((x) => { if (!G.some((g) => g.tier === x.tier && g.name === x.group)) G.push({ tier: x.tier, name: x.group }); });
        setFamily(fam); setInfl(inf); setTiers(tr); setGroups(G); setItems(I2);
        setLoaded(true); setStatus("Loaded from Google Sheet");
      } catch (e) { setStatus("⚠ Could not load: " + e.message); }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      const tables = {
        [TAB.cfg]: ["family", "inflation", "tiers", "groups"].map((id, i) => ({ id, valueJSON: JSON.stringify([family, infl, tiers, groups][i]) })),
        [TAB.exp]: [], [TAB.itm]: items, [TAB.ast]: assets.map((a) => ({ ...a, targets: a.targets.join(",") })),
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
  }, [loaded, family, infl, tiers, groups, items, assets]);

  const ages = { f: ageOf(family.fDob), m: ageOf(family.mDob), k1: ageOf(family.k1Dob), k2: ageOf(family.k2Dob) };
  const people = [["f", family.fName], ["m", family.mName], ["k1", family.k1Name], ["k2", family.k2Name]];
  const annual = (x) => (x.unit === "/ month" ? x.value * 12 : x.value);
  const totalL = assets.reduce((s, a) => s + a.allocated, 0);
  const wroi = totalL ? assets.reduce((s, a) => s + a.allocated * a.roi, 0) / totalL : 0;
  const pre = (roi) => (family.ledgerFromToday || !family.growToRet ? 1 : Math.pow(1 + roi / 100, Math.max(0, family.retAge - ages.f)));
  const tierKeys = Object.keys(tiers);

  const calc = useMemo(() => {
    const cur = ages.f, ret = +family.retAge || cur, max = +family.horizonAge || 90, r = wroi / 100;
    let cap = assets.reduce((s, a) => s + a.allocated * 1e5 * pre(a.roi), 0);
    const rows = [], tierNpv = {}, gNpv = {}, gTot = {};
    tierKeys.forEach((k) => (tierNpv[k] = 0));
    let idx = 0;
    for (let f = family.ledgerFromToday ? cur : Math.max(ret, cur); f <= max; f++, idx++) {
      const off = f - cur, out = {}, disc = Math.pow(1 + r, idx);
      tierKeys.forEach((k) => (out[k] = 0));
      items.forEach((x) => {
        if (!x.active || out[x.tier] === undefined) return;
        const sh = cur - (ages[x.anchor || "f"] || 0);
        const s = x.startAtRet ? ret : x.startAge + sh, e = x.endAtHorizon ? max : x.endAge + sh, ev = Math.max(1, x.every || 1);
        if (!(x.isRecurring ? f >= s && f <= e && (f - s) % ev === 0 : f === s)) return;
        const v = annual(x) * Math.pow(1 + (infl[x.infType] || 0) / 100, off), key = gk(x.tier, x.group);
        out[x.tier] += v; tierNpv[x.tier] += v / disc; gNpv[key] = (gNpv[key] || 0) + v / disc; gTot[key] = (gTot[key] || 0) + v;
      });
      const total = Object.values(out).reduce((a, b) => a + b, 0), after = cap - total, end = after > 0 ? after * (1 + r) : after;
      rows.push({ f, m: ages.m + off, k1: ages.k1 + off, k2: ages.k2 + off, start: cap, out, total, end });
      cap = end;
    }
    return { rows, tierNpv, gNpv, gTot };
  }, [family, assets, items, infl, tiers, wroi]);

  const alloc = useMemo(() => {
    const m = {}; tierKeys.forEach((k) => (m[k] = 0));
    assets.forEach((a) => a.targets.forEach((k) => { if (m[k] !== undefined) m[k] += (a.allocated * 1e5 * pre(a.roi)) / a.targets.length; }));
    return m;
  }, [assets, tiers, family]);

  const upd = (id, patch) => setItems((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updA = (id, patch) => setAssets((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setF = (k) => (v) => setFamily((f) => ({ ...f, [k]: v }));
  const groupsOf = (t) => groups.filter((g) => g.tier === t).map((g) => g.name);
  const ensureGroup = (tier, name) => setGroups((l) => (l.some((g) => g.tier === tier && g.name === name) ? l : [...l, { tier, name }]));
  const newGroup = (tier) => {
    const t = tier || (fTier !== "all" ? fTier : prompt(`Tier for the new group (${tierKeys.join(", ")}):`));
    if (!t || tiers[t] === undefined) return null;
    const n = (prompt("New group name:") || "").trim();
    if (n) ensureGroup(t, n);
    return n ? { t, n } : null;
  };
  const addItem = () => {
    const tier = fTier !== "all" ? fTier : tierKeys[0];
    const group = fGroup !== "all" ? fGroup : groupsOf(tier)[0] || "General";
    ensureGroup(tier, group);
    setItems((l) => [...l, { id: nid("i"), name: "New item", tier, group, parentLine: "", unit: "/ month", value: 1000, isRecurring: true, startAge: family.retAge, endAge: family.horizonAge, startAtRet: true, endAtHorizon: true, infType: "core", anchor: "f", active: true, every: 1 }]);
  };
  const changeTier = (id, tier) => { const g = groupsOf(tier)[0] || "General"; ensureGroup(tier, g); upd(id, { tier, group: g }); };
  const delGroup = (t, n) => {
    if (items.some((x) => x.tier === t && x.group === n)) return alert("Move or delete its items first.");
    setGroups((l) => l.filter((g) => !(g.tier === t && g.name === n)));
  };
  const addTier = () => {
    const k = (prompt("Short key for the new tier (e.g. wedding, real_estate):") || "").trim();
    if (k && !tiers[k]) setTiers((t) => ({ ...t, [k]: prompt("Descriptive name:") || k }));
  };
  const delTier = (k) => {
    if (!window.confirm("Delete this tier with its groups and items?")) return;
    setItems((l) => l.filter((x) => x.tier !== k)); setGroups((l) => l.filter((g) => g.tier !== k));
    setAssets((l) => l.map((a) => ({ ...a, targets: a.targets.filter((t) => t !== k) })));
    setTiers((t) => { const n = { ...t }; delete n[k]; return n; });
  };
  const restore = () => { const s = seedInto(items, groups, family, tiers, infl); setItems(s.it); setGroups(s.gr); };
  const addInfl = () => { const k = (prompt("Name for the new inflation track:") || "").trim(); if (k && infl[k] === undefined) setInfl((i) => ({ ...i, [k]: 7 })); };
  const delInfl = (k) => { setInfl((i) => { const n = { ...i }; delete n[k]; return n; }); setItems((l) => l.map((x) => (x.infType === k ? { ...x, infType: "core" } : x))); };

  const tabs = [["setup", "Family & Inflation"], ["items", "Itemized Costs"], ["tiers", "Tier Summary"], ["assets", "Capital Portfolios"], ["ledger", "Cash Runway"]];
  const inflOpts = Object.keys(infl).map((k) => [k, k]);
  const shown = items.filter((x) => (fTier === "all" || x.tier === fTier) && (fGroup === "all" || x.group === fGroup) && (!q || `${x.name} ${x.parentLine} ${x.group}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => tierKeys.indexOf(a.tier) - tierKeys.indexOf(b.tier) || a.group.localeCompare(b.group));
  const parentLines = [...new Set(items.map((x) => x.parentLine).filter(Boolean))];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 24, fontFamily: sansFont, color: COLORS.ink }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontFamily: serifFont, fontWeight: 400, fontSize: 24, margin: 0 }}>{family.fName} & {family.mName}'s Retirement Plan</h2>
        <span style={{ fontSize: 12, color: COLORS.muted }}>Portfolio yield {wroi.toFixed(2)}% · {status}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10, marginBottom: 16 }}>
        {tierKeys.map((k) => {
          const ok = (alloc[k] || 0) >= (calc.tierNpv[k] || 0);
          return (
            <Card key={k} style={{ marginBottom: 0, padding: 12 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", color: COLORS.muted }}>{k}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Needed (NPV): <b>{fmtI(calc.tierNpv[k] || 0)}</b></div>
              <div style={{ fontSize: 12 }}>Allocated: <b>{fmtI(alloc[k] || 0)}</b></div>
              <div style={{ fontSize: 11, marginTop: 6, color: ok ? COLORS.positive : COLORS.negative }}>{ok ? "Fully funded" : `Shortfall ${fmtI((calc.tierNpv[k] || 0) - (alloc[k] || 0))}`}</div>
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
                  {!["core", "edu", "med"].includes(k) && <Del on={() => delInfl(k)}> ✕</Del>}</div>
              ))}
            </div>
          </Card>
        </>
      )}

      {tab === "items" && (
        <Card style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <S v={fTier} opts={[["all", "All tiers"], ...tierKeys.map((k) => [k, k])]} on={(v) => { setFTier(v); setFGroup("all"); }} />
            <S v={fGroup} opts={[["all", "All groups"], ...(fTier === "all" ? [...new Set(groups.map((g) => g.name))] : groupsOf(fTier)).map((g) => [g, g])]} on={setFGroup} w={220} />
            <I t="text" w={160} v={q} on={setQ} placeholder="Search…" />
            <button style={btnStyle} onClick={addItem}>+ Add item</button>
            <button style={btnStyleGhost} onClick={() => newGroup()}>+ New group</button>
            <button style={btnStyleGhost} onClick={restore}>↻ Restore template</button>
            <span style={{ fontSize: 11, color: COLORS.muted }}>{shown.length} of {items.length} items</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead><tr>{["Item", "Tier", "Group", "Parent line", "Cycle", "Base cost ₹", "Cost per year"].map((h) => <th key={h} style={head}>{h}</th>)}<th style={head}></th></tr></thead>
            <datalist id="plines">{parentLines.map((p) => <option key={p} value={p} />)}</datalist>
            <tbody>
              {shown.map((x) => (
                <React.Fragment key={x.id}>
                  <tr style={{ opacity: x.active ? 1 : 0.5 }}>
                    <td style={{ ...cell, borderBottom: "none" }}><I t="text" w="100%" v={x.name} on={(v) => upd(x.id, { name: v })} /></td>
                    <td style={{ ...cell, borderBottom: "none" }}><S v={x.tier} opts={tierKeys.map((k) => [k, k])} on={(v) => changeTier(x.id, v)} /></td>
                    <td style={{ ...cell, borderBottom: "none" }}>
                      <S v={x.group} opts={groupsOf(x.tier).map((g) => [g, g])} on={(v) => upd(x.id, { group: v })} w={190} />{" "}
                      <Del on={() => { const r = newGroup(x.tier); if (r) upd(x.id, { group: r.n }); }}>+ new</Del>
                    </td>
                    <td style={{ ...cell, borderBottom: "none" }}><I t="text" w="100%" v={x.parentLine} on={(v) => upd(x.id, { parentLine: v })} list="plines" /></td>
                    <td style={{ ...cell, borderBottom: "none" }}><S v={x.unit} opts={[["/ month", "Monthly"], ["/ year", "Annual"]]} on={(v) => upd(x.id, { unit: v })} /></td>
                    <td style={{ ...cell, borderBottom: "none" }}><I w={90} v={x.value} on={(v) => upd(x.id, { value: v })} /><div style={{ fontSize: 10, color: COLORS.muted }}>= {fmtI(x.value)}</div></td>
                    <td style={{ ...cell, borderBottom: "none" }}><b>{fmtI(annual(x))}</b></td>
                    <td style={{ ...cell, borderBottom: "none" }}><Del on={() => setItems((l) => l.filter((y) => y.id !== x.id))} /></td>
                  </tr>
                  <tr style={{ opacity: x.active ? 1 : 0.5 }}>
                    <td colSpan={8} style={{ ...cell, paddingTop: 0, color: COLORS.muted }}>
                      <S v={x.isRecurring ? "r" : "o"} opts={[["r", "Recurring"], ["o", "One-time"]]} on={(v) => upd(x.id, { isRecurring: v === "r" })} />{" "}
                      <S v={x.infType} opts={inflOpts} on={(v) => upd(x.id, { infType: v })} /> · ages of <S v={x.anchor} opts={people} on={(v) => upd(x.id, { anchor: v })} />{" "}
                      {x.isRecurring ? "from" : "at"} {x.startAtRet ? <b>{family.retAge}</b> : <I w={50} v={x.startAge} on={(v) => upd(x.id, { startAge: v })} />} <Chk v={x.startAtRet} on={(v) => upd(x.id, { startAtRet: v })} label="at retirement" />
                      {x.isRecurring && <>to {x.endAtHorizon ? <b>{family.horizonAge}</b> : <I w={50} v={x.endAge} on={(v) => upd(x.id, { endAge: v })} />} <Chk v={x.endAtHorizon} on={(v) => upd(x.id, { endAtHorizon: v })} label="at horizon" /> every <I w={44} v={x.every} on={(v) => upd(x.id, { every: v })} /> yr </>}
                      <Chk v={x.active} on={(v) => upd(x.id, { active: v })} label="Active" />
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "tiers" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button style={btnStyleGhost} onClick={() => setOpen(Object.fromEntries(tierKeys.map((k) => [k, true])))}>Expand all</button>
            <button style={btnStyleGhost} onClick={() => setOpen({})}>Collapse all</button>
            <button style={btnStyleGhost} onClick={addTier}>+ Create tier</button>
          </div>
          {tierKeys.map((k) => (
            <Card key={k} style={{ padding: 0 }}>
              <div onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))} style={{ cursor: "pointer", padding: "12px 16px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <b style={{ fontSize: 13, textTransform: "uppercase" }}>{open[k] ? "▼" : "▶"} {k} <span style={{ fontWeight: 400, textTransform: "none", color: COLORS.muted }}>— {tiers[k]}</span></b>
                <span style={{ fontSize: 12 }}>Needed (NPV) <b>{fmtI(calc.tierNpv[k] || 0)}</b> · {groupsOf(k).length} groups</span>
              </div>
              {open[k] && (
                <div style={{ padding: "0 16px 12px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                    <thead><tr>{["Group", "Items", "Needed (NPV)", "Lifetime total", ""].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                    <tbody>
                      {groupsOf(k).map((g) => (
                        <tr key={g}>
                          <td style={cell}>{g}</td>
                          <td style={cell}>{items.filter((x) => x.tier === k && x.group === g).length}</td>
                          <td style={cell}><b>{fmtI(calc.gNpv[gk(k, g)] || 0)}</b></td>
                          <td style={cell}>{fmtI(calc.gTot[gk(k, g)] || 0)}</td>
                          <td style={cell}><Del on={() => delGroup(k, g)} /></td>
                        </tr>
                      ))}
                      {!groupsOf(k).length && <tr><td colSpan={5} style={{ ...cell, color: COLORS.muted }}>No groups yet.</td></tr>}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button style={btnStyleGhost} onClick={() => newGroup(k)}>+ New group</button>
                    <button style={btnStyleGhost} onClick={() => { setFTier(k); setFGroup("all"); setTab("items"); }}>Edit items →</button>
                    {!PROTECTED.includes(k) && <button style={btnStyleGhost} onClick={() => delTier(k)}>Delete tier</button>}
                  </div>
                </div>
              )}
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
                  <td style={cell}><I w={90} v={a.allocated} on={(v) => updA(a.id, { allocated: v })} /><div style={{ fontSize: 10, color: COLORS.muted }}>= {fmtI(a.allocated * 1e5)}</div></td>
                  <td style={cell}><I w={60} v={a.roi} on={(v) => updA(a.id, { roi: v })} step="0.1" /></td>
                  <td style={cell}>{tierKeys.map((k) => <Chk key={k} v={a.targets.includes(k)} label={k} on={(c) => updA(a.id, { targets: c ? [...a.targets, k] : a.targets.filter((x) => x !== k) })} />)}</td>
                  <td style={cell}><Del on={() => setAssets((l) => l.filter((x) => x.id !== a.id))} /></td>
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
              {[family.fName, family.mName, family.k1Name, family.k2Name].map((n, i) => <th key={i} style={head}>{n} age</th>)}
              <th style={head}>Start balance</th>{tierKeys.map((k) => <th key={k} style={head}>{k}</th>)}<th style={head}>Total outlay</th><th style={head}>End balance</th>
            </tr></thead>
            <tbody>
              {calc.rows.map((r) => (
                <tr key={r.f}>
                  <td style={cell}><b>{r.f}</b></td><td style={cell}>{r.m}</td><td style={cell}>{r.k1}</td><td style={cell}>{r.k2}</td>
                  <td style={cell}>{fmtI(r.start)}</td>{tierKeys.map((k) => <td key={k} style={cell}>{fmtI(r.out[k] || 0)}</td>)}
                  <td style={{ ...cell, color: COLORS.negative }}>{fmtI(r.total)}</td><td style={{ ...cell, fontWeight: 700, color: r.end < 0 ? COLORS.negative : COLORS.positive }}>{fmtI(r.end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
