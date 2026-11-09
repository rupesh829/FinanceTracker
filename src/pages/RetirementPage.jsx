import React, { useEffect, useMemo, useRef, useState } from "react";
import { getTable, setTable } from "../api.js";
import { useRate } from "../RateContext.jsx";
import { COLORS, sansFont, serifFont, inputStyle, btnStyle, btnStyleGhost, parseAmount, todayStr, fmt } from "../styles.js";
import { SEED, BASE_ASSETS, BASE_TIERS, BASE_INFL } from "../retirementSeed.js";

const TAB = { cfg: "RetirementConfig", exp: "RetirementExpenses", itm: "RetirementItems", ast: "RetirementAssets", act: "RetirementActuals" };
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
const DEF_FAMILY = { fName: "Father", mName: "Mother", k1Name: "Kid 1", k2Name: "Kid 2", fDob: dobFromAge(40), mDob: dobFromAge(36), k1Dob: dobFromAge(8), k2Dob: dobFromAge(3), retAge: 44, horizonAge: 90, growToRet: false, ledgerFromToday: true, planStartYear: now.getFullYear() };
let seq = Date.now() % 1e6;
const nid = (p) => `${p}${(seq++).toString(36)}`;
const gk = (t, g) => `${t}|${g}`;
const PROTECTED = ["survival", "education", "goals", "maintenance", "lifestyle"];
const ym = (d) => (d ? d.slice(0, 7) : "—");

// ---- tier % allocation helpers ----
const eqPct = (t) => { const n = t.length; let s = 0; return Object.fromEntries(t.map((k, i) => { const v = i === n - 1 ? +(100 - s).toFixed(2) : +(100 / n).toFixed(2); s += v; return [k, v]; })); };
const pctTotal = (p) => Object.values(p || {}).reduce((a, b) => a + (+b || 0), 0);
const pctPatch = (pct) => ({ pct, targets: Object.keys(pct).filter((k) => pct[k] > 0) });
const pctText = (p) => Object.entries(p || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}(${+v}%)`).join(", ") || "Not allocated";
const yrsSince = (d) => (Date.now() - new Date(d).getTime()) / 31557600000;

// An allocation = a slice of one investment (investmentId set) or a manual asset (investmentId empty).
const normA = (r) => {
  const targets = Array.isArray(r.targets) ? r.targets : String(r.targets || "").split(",").filter(Boolean);
  let pct = {}; try { pct = JSON.parse(r.pctJSON); } catch (e) {}
  if (!pct || typeof pct !== "object" || !Object.keys(pct).length) pct = eqPct(targets);
  const hasInr = r.allocatedINR !== undefined && r.allocatedINR !== "";
  return {
    id: String(r.id), name: r.name || "", investmentId: String(r.investmentId ?? ""),
    allocatedINR: hasInr ? parseAmount(r.allocatedINR) : parseAmount(r.allocated) * 1e5,
    roi: parseAmount(r.roi), startYear: parseAmount(r.startYear), startMonth: parseAmount(r.startMonth) || 1, ...pctPatch(pct),
  };
};

const I = ({ v, on, w = 70, t = "number", ...p }) => (
  <input type={t} value={v ?? ""} onChange={(e) => on(t === "number" ? (e.target.value === "" ? 0 : +e.target.value) : e.target.value)} style={{ ...inputStyle, width: w, padding: "4px 6px" }} {...p} />
);
const S = ({ v, on, opts, w }) => (
  <select value={v} onChange={(e) => on(e.target.value)} style={{ ...inputStyle, width: w || "auto", padding: "4px 6px" }}>
    {opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
  </select>
);
const Chk = ({ v, on, label }) => <label style={{ fontSize: 11, marginRight: 8, whiteSpace: "nowrap" }}><input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} /> {label}</label>;

const PctEditor = ({ tierKeys, pct, onChange }) => {
  const safePct = pct || {};
  const t = pctTotal(safePct), ok = Math.abs(t - 100) < 0.05;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: "130px" }}>
      {tierKeys.map((k) => {
        const v = safePct[k] || 0;
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginRight: 4 }}>{k}:</span>
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <input 
                type="number" 
                value={v ?? ""} 
                onChange={(e) => {
                  const newVal = e.target.value === "" ? 0 : +e.target.value;
                  onChange({ ...safePct, [k]: newVal });
                }} 
                style={{ 
                  width: "36px", 
                  border: "none", 
                  borderBottom: "1px dashed #ced4da", 
                  background: "transparent", 
                  textAlign: "right", 
                  fontSize: 11, 
                  padding: "1px 0",
                  outline: "none" 
                }} 
              />
              <span style={{ marginLeft: 2 }}>%</span>
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 9, marginTop: 2, color: ok ? COLORS.positive : COLORS.negative }}>
        Total {+t.toFixed(2)}%{ok ? "" : " — should be 100"}
      </div>
    </div>
  );
};

const Card = ({ children, style }) => <div style={{ background: "#fff", border: `1px solid ${COLORS.line}`, padding: 16, marginBottom: 16, ...style }}>{children}</div>;
const Del = ({ on, children = "Delete" }) => <a style={{ color: COLORS.negative, cursor: "pointer", fontSize: 12 }} onClick={on}>{children}</a>;
const cell = { padding: "6px 5px", borderBottom: `1px solid ${COLORS.lineLight}`, verticalAlign: "top", fontSize: 12 };
const head = { ...cell, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.muted, textAlign: "left" };
const banner = { background: "#E9E4F5", border: `1px solid ${COLORS.accent}`, padding: "6px 10px", fontSize: 13, fontWeight: 700, textAlign: "center", letterSpacing: "0.1em", margin: "14px 0 0" };

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
  const { rate } = useRate();
  const [tab, setTab] = useState("setup");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("Loading…");
  const [family, setFamily] = useState(DEF_FAMILY);
  const [infl, setInfl] = useState(BASE_INFL);
  const [tiers, setTiers] = useState(BASE_TIERS);
  const [groups, setGroups] = useState([]);
  const [items, setItems] = useState([]);
  const [assetsRaw, setAssets] = useState([]);
  const [invsRaw, setInvsRaw] = useState([]);
  const [actuals, setActuals] = useState([]);
  const [actualCorpus, setActualCorpus] = useState({});
  const [incomes, setIncomes] = useState([]);
  const [ySel, setYSel] = useState(now.getFullYear());
  const [yTier, setYTier] = useState("all");
  const [yGroup, setYGroup] = useState("all");
  const [open, setOpen] = useState({});
  const [fTier, setFTier] = useState("all");
  const [fGroup, setFGroup] = useState("all");
  const [q, setQ] = useState("");
  const lastSaved = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const [cfg, ex, it, as, ac, invRows, incRows] = await Promise.all([TAB.cfg, TAB.exp, TAB.itm, TAB.ast, TAB.act, "Investments", "Income"].map((t) => getTable(t)));
        const incBy = {}; incRows.forEach((r) => { incBy[r.investmentId] = (incBy[r.investmentId] || 0) + parseAmount(r.amount); });
        const invList = invRows.filter((r) => r.id).map((r) => {
          const initialInv = parseAmount(r.invested);
          const inv = parseAmount(r.currentValue), cur = parseAmount(r.currentValue), y = yrsSince(r.purchaseDate), g = cur - initialInv + (incBy[r.id] || 0); 
          return {
            id: String(r.id), name: r.name, ccy: r.currency || "INR", invested: inv, current: cur, closing: parseAmount(r.closingAmount) || cur,
            purchaseDate: r.purchaseDate || "", endDate: r.endDate || "",
            forRetirement: r.forRetirement === undefined || r.forRetirement === "" ? true : bool(r.forRetirement),
            reinvestedInto: invRows.find((x) => String(x.reinvestedFromId) === String(r.id))?.name || "",
            actual: inv > 0 && y >= 0.5 ? (Math.pow(Math.max(0, 1 + g / inv), 1 / y) - 1) * 100 : null,
          };
        });
        setInvsRaw(invList);

        const c = {};
        cfg.forEach((r) => { try { c[r.id] = JSON.parse(r.valueJSON); } catch (e) {} });
        const fam = { ...DEF_FAMILY, ...(c.family || {}) };
        const inf = c.inflation || BASE_INFL, tr = c.tiers || BASE_TIERS;
        let I2, G = c.groups || [];
        if (!cfg.length && !ex.length && !it.length) {
          const s = seedInto([], [], fam, tr, inf); I2 = s.it; G = s.gr; setAssets(BASE_ASSETS.map(normA));
        } else {
          I2 = it.filter((r) => r.id && r.tier).length ? it.filter((r) => r.id).map((r) => ({ ...r, id: String(r.id), value: parseAmount(r.value), startAge: parseAmount(r.startAge), endAge: parseAmount(r.endAge), every: parseAmount(r.every) || 1, isRecurring: bool(r.isRecurring), startAtRet: bool(r.startAtRet), endAtHorizon: bool(r.endAtHorizon), active: r.active === "" ? true : bool(r.active), anchor: r.anchor || "f", group: String(r.group || ""), parentLine: String(r.parentLine || "") })) : migrate(ex.filter((r) => r.id), it.filter((r) => r.id), fam);
          setAssets(as.filter((r) => r.id).flatMap((r) => {
            let L = []; try { L = JSON.parse(r.linkedJSON); } catch (e) {}
            if (!r.investmentId && Array.isArray(L) && L.length) {
              return L.map(String).map((iid) => { const iv = invList.find((x) => x.id === iid); return normA({ ...r, id: `${r.id}_${iid}`, investmentId: iid, name: iv?.name, allocatedINR: iv ? iv.invested * (iv.ccy === "USD" ? rate : 1) : 0 }); });
            }
            return [normA(r)];
          }));
        }
        I2.forEach((x) => { if (!G.some((g) => g.tier === x.tier && g.name === x.group)) G.push({ tier: x.tier, name: x.group }); });
        setFamily(fam); setInfl(inf); setTiers(tr); setGroups(G); setItems(I2); setActualCorpus(c.actualCorpus || {});
        setIncomes((c.income || []).map((x) => ({ ...x, ranges: Array.isArray(x.ranges) ? x.ranges : [], ...pctPatch(x.pct || eqPct(x.targets || [])) })));
        setActuals(ac.filter((x) => x.itemId).map((x) => ({ id: String(x.id), itemId: String(x.itemId), year: parseAmount(x.year), amount: parseAmount(x.amount) })));
        setLoaded(true); setStatus("Loaded from Google Sheet");
      } catch (e) { setStatus("⚠ Could not load: " + e.message); }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      const tables = {
        [TAB.cfg]: ["family", "inflation", "tiers", "groups", "actualCorpus", "income"].map((id, i) => ({ id, valueJSON: JSON.stringify([family, infl, tiers, groups, actualCorpus, incomes][i]) })),
        [TAB.exp]: [], [TAB.act]: actuals, [TAB.itm]: items,
        [TAB.ast]: assetsRaw.map((a) => ({ id: a.id, name: a.name, investmentId: a.investmentId, allocatedINR: a.allocatedINR, roi: a.roi, startYear: a.startYear, startMonth: a.startMonth, targets: a.targets.join(","), pctJSON: JSON.stringify(a.pct || {}) })),
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
  }, [loaded, family, infl, tiers, groups, items, assetsRaw, actuals, actualCorpus, incomes]);

  const ages = { f: ageOf(family.fDob), m: ageOf(family.mDob), k1: ageOf(family.k1Dob), k2: ageOf(family.k2Dob) };
  const people = [["f", family.fName], ["m", family.mName], ["k1", family.k1Name], ["k2", family.k2Name]];
  const annual = (x) => (x.unit === "/ month" ? x.value * 12 : x.value);
  const todayS = todayStr();
  const curY = now.getFullYear();
  const psY = family.planStartYear || curY;
  const base = ages.f - Math.max(0, curY - psY);
  const fo = (family.ledgerFromToday ? base : Math.max(+family.retAge || ages.f, ages.f)) - base;
  const yoOf = (y) => (y > 0 ? Math.max(0, y - psY) : 0);

  const invById = useMemo(() => Object.fromEntries(invsRaw.map((i) => {
    const k = i.ccy === "USD" ? rate : 1;
    return [i.id, { ...i, investedINR: i.invested * k, currentINR: i.current * k, closingINR: i.closing * k, ended: !!i.endDate && i.endDate < todayS }];
  })), [invsRaw, rate]);

  const allAssets = useMemo(() => assetsRaw.map((a) => {
    if (!a.investmentId) return { ...a, manual: true, include: true, ended: false, allocated: a.allocatedINR / 1e5, currentINR: a.allocatedINR, actual: null };
    const inv = invById[a.investmentId];
    if (!inv) return null;
    const share = inv.investedINR ? Math.min(1, a.allocatedINR / inv.investedINR) : 0;
    const currentINR = share * (inv.ended ? inv.closingINR : inv.currentINR);
    return { ...a, name: inv.name, inv, share, include: inv.forRetirement, ended: inv.ended, currentINR, allocated: currentINR / 1e5, actual: inv.actual, endYear: inv.endDate ? +inv.endDate.slice(0, 4) : 0, reinvested: !!inv.reinvestedInto };
  }).filter(Boolean), [assetsRaw, invById]);

  const assets = useMemo(() => allAssets.filter((a) => a.manual || (a.include && !a.ended)), [allAssets]);

  const totalL = assets.reduce((s, a) => s + a.allocated, 0);
  const wroi = totalL ? assets.reduce((s, a) => s + a.allocated * a.roi, 0) / totalL : 0;
  const actW = assets.filter((a) => a.actual != null).reduce((s, a) => s + a.allocated, 0);
  const wActual = actW ? assets.filter((a) => a.actual != null).reduce((s, a) => s + a.allocated * a.actual, 0) / actW : null;
  const totalPrincipal = assets.reduce((s, a) => s + a.allocatedINR, 0);
  const flaggedInvs = Object.values(invById).filter((i) => i.forRetirement);
  const unallocByInv = (inv) => Math.max(0, inv.investedINR - allAssets.filter((a) => a.investmentId === inv.id).reduce((s, a) => s + a.allocatedINR, 0));
  const totalUnalloc = flaggedInvs.filter((i) => !i.ended).reduce((s, i) => s + unallocByInv(i), 0);

  const actMap = useMemo(() => { const m = {}; actuals.forEach((a) => (m[`${a.itemId}|${a.year}`] = a.amount)); return m; }, [actuals]);
  const plannedOf = (x, f) => {
    if (!x.active) return 0;
    const max = +family.horizonAge || 90, ret = +family.retAge || ages.f, sh = ages.f - (ages[x.anchor || "f"] || 0);
    const s0 = x.startAtRet ? ret : x.startAge + sh, e0 = x.endAtHorizon ? max : x.endAge + sh, ev = Math.max(1, x.every || 1);
    if (!(x.isRecurring ? f >= s0 && f <= e0 && (f - s0) % ev === 0 : f === s0)) return 0;
    return annual(x) * Math.pow(1 + (infl[x.infType] || 0) / 100, f - base);
  };
  // Side income: amount (today's rupees) paid while the chosen person's age is inside any of the ranges.
  const incomeOf = (x, f) => {
    if (!x.active) return 0;
    const sh = ages.f - (ages[x.anchor || "f"] || 0);
    if (!(x.ranges || []).some((g) => f >= g.from + sh && f <= g.to + sh)) return 0;
    return (x.unit === "/ month" ? x.amount * 12 : x.amount) * Math.pow(1 + (x.growth || 0) / 100, f - base);
  };
  const grow = (roi, yo) => (family.ledgerFromToday || !family.growToRet ? 1 : Math.pow(1 + roi / 100, Math.max(0, fo - yo)));
  const tierKeys = Object.keys(tiers);

  const calc = useMemo(() => {
    const max = +family.horizonAge || 90, rd = wroi / 100, first = base + fo;
    let cap = 0, capP = 0;
    const joins = {};
    const place = (amt, yo, month, roi, dated) => {
      if (yo < fo) { const v = amt * grow(roi, yo); cap += v; capP += v; }
      else (joins[yo] = joins[yo] || []).push({ amt, frac: dated ? (13 - (month || 1)) / 12 : 1 });
    };
    assets.forEach((a) => place(a.allocated * 1e5, yoOf(a.startYear), a.startMonth, a.roi, a.startYear > 0));
    assets.forEach((a) => {
      if (!a.reinvested || !a.endYear) return;
      const yo = yoOf(a.endYear);
      if (yo < fo) return;
      const years = Math.max(0, yo - Math.max(yoOf(a.startYear), fo));
      (joins[yo] = joins[yo] || []).push({ amt: -(a.allocated * 1e5 * Math.pow(1 + a.roi / 100, years)), frac: 1 });
    });
    const rateAt = (ro) => {
      const act = assets.filter((a) => yoOf(a.startYear) <= ro), L = act.reduce((t, a) => t + a.allocated, 0);
      return L ? act.reduce((t, a) => t + a.allocated * a.roi, 0) / L / 100 : rd;
    };
    const rows = [], tierNpv = {}, gNpv = {}, gTot = {}, incNpv = {};
    tierKeys.forEach((k) => (tierNpv[k] = 0));
    for (let f = first, idx = 0; f <= max; f++, idx++) {
      const off = f - base, yr = psY + off, out = {}, outAct = {}, disc = Math.pow(1 + rd, idx), r = rateAt(off), adds = joins[off] || [];
      let plan = 0, total = 0, totalActual = 0, incTotal = 0;
      tierKeys.forEach((k) => { out[k] = 0; outAct[k] = 0; });
      items.forEach((x) => {
        if (out[x.tier] === undefined) return;
        const pv = plannedOf(x, f), a = actMap[`${x.id}|${yr}`], v = a !== undefined ? a : pv, key = gk(x.tier, x.group);
        plan += pv;
        total += pv;
        totalActual += v;
        out[x.tier] += pv;
        outAct[x.tier] += v;
        if (v) {
          tierNpv[x.tier] += v / disc; 
          gNpv[key] = (gNpv[key] || 0) + v / disc; 
          gTot[key] = (gTot[key] || 0) + v;
        }
      });
      incomes.forEach((x) => { const v = incomeOf(x, f); incTotal += v; incNpv[x.id] = (incNpv[x.id] || 0) + v / disc; });
      const addSum = adds.reduce((t, a) => t + a.amt, 0);
      const growAdj = adds.reduce((t, a) => t + a.amt * ((1 + r) - Math.pow(1 + r, a.frac)), 0);
      
      const outlay = (yr <= curY && Object.keys(actMap).length > 0) ? totalActual : total;
      const fin = (c, t) => { const after = c + addSum - t; return after > 0 ? after * (1 + r) - growAdj : after; };
      const end = fin(cap, outlay - incTotal), endP = fin(capP, plan - incTotal);
      rows.push({ f, year: yr, m: ages.m + (f - ages.f), k1: ages.k1 + (f - ages.f), k2: ages.k2 + (f - ages.f), start: cap, added: addSum, out, total, totalActual, plan, inc: incTotal, end, endP });
      cap = end; capP = endP;
    }
    return { rows, tierNpv, gNpv, gTot, incNpv };
  }, [family, assets, items, infl, tiers, wroi, actMap, curY, incomes]);

  // Publish a one-row runway summary so the Summary page can show it.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(async () => {
      const rows = calc.rows, dry = rows.find((x) => x.end < 0), last = rows[rows.length - 1];
      const row = [{ id: "latest", runsOutYear: dry ? dry.year : "", runsOutAge: dry ? dry.f : "", endBalance: Math.round(last ? last.end : 0), horizonAge: family.horizonAge, retAge: family.retAge, yield: +wroi.toFixed(2), allocatedINR: Math.round(totalPrincipal), currentEstINR: Math.round(totalL * 1e5), updated: todayStr() }];
      const js = JSON.stringify(row);
      if (lastSaved.current.RetirementSummary === js) return;
      try { await setTable("RetirementSummary", row); lastSaved.current.RetirementSummary = js; } catch (e) { /* summary is best-effort */ }
    }, 2500);
    return () => clearTimeout(t);
  }, [loaded, calc, wroi, totalPrincipal, totalL, family.horizonAge, family.retAge]);

  const alloc = useMemo(() => {
    const m = {}; tierKeys.forEach((k) => (m[k] = 0));
    const dc = (yo) => 1 / Math.pow(1 + wroi / 100, Math.max(0, yo - fo));
    assets.forEach((a) => {
      const yo = yoOf(a.startYear), v = a.allocated * 1e5 * (yo < fo ? grow(a.roi, yo) : dc(yo));
      Object.entries(a.pct || {}).forEach(([k, p]) => { if (m[k] !== undefined) m[k] += (v * p) / 100; });
    });
    incomes.forEach((x) => Object.entries(x.pct || {}).forEach(([k, p]) => { if (m[k] !== undefined) m[k] += ((calc.incNpv[x.id] || 0) * p) / 100; }));
    return m;
  }, [assets, tiers, family, wroi, calc, incomes]);

  const alerts = useMemo(() => {
    const m = {};
    calc.rows.forEach((row) => {
      if (row.year < curY || row.year > curY + 2) return;
      items.forEach((x) => {
        if (x.isRecurring && (x.every || 1) <= 1) return;
        const pv = plannedOf(x, row.f); if (pv <= 0) return;
        const k = `${x.parentLine || x.name}|${row.year}`; m[k] = (m[k] || 0) + pv;
      });
    });
    return Object.entries(m).filter(([, v]) => v >= 2e5).map(([k, v]) => { const [n, y] = k.split("|"); return { n, y: +y, v }; }).sort((a, b) => a.y - b.y || b.v - a.v);
  }, [calc, items]);

  const insights = useMemo(() => {
    const good = [], warn = [], info = [], rows = calc.rows, last = rows[rows.length - 1];
    tierKeys.forEach((k) => {
      const need = calc.tierNpv[k] || 0, have = alloc[k] || 0;
      if (need > 0 && have < need) warn.push({ t: `${k}: underfunded by ${fmtI(need - have)}`, d: `Assigned capital covers ${Math.round((have / need) * 100)}% of what ${k} needs. Raise the ${k} % on some allocations, add capital, push some costs later, or trim its largest group.` });
      else if (need > 0) good.push({ t: `${k}: fully funded`, d: `${fmtI(need)} needed, ${fmtI(have - need)} to spare.` });
    });
    const dry = rows.find((x) => x.end < 0);
    if (dry) warn.push({ t: `Corpus runs out in ${dry.year} (age ${dry.f})`, d: "Options: delay retirement, allocate more investments, raise savings, cut Lifestyle costs, or move big goals later." });
    else if (last) good.push({ t: `Corpus lasts beyond age ${last.f}`, d: `Projected balance at the end: ${fmtI(last.end)}.` });
    const real = wroi - (infl.core || 0);
    if (totalL && real < 2) warn.push({ t: `Real return is only ${real.toFixed(1)}%`, d: `Planning yield ${wroi.toFixed(1)}% vs core inflation ${infl.core}%. Review asset mix or inflation assumptions.` });
    else if (totalL) good.push({ t: `Real return ${real.toFixed(1)}% above inflation`, d: `Planning yield ${wroi.toFixed(1)}% vs core inflation ${infl.core}%.` });
    const unalloc = assets.filter((a) => !a.targets.length);
    if (unalloc.length) warn.push({ t: `${unalloc.length} allocation(s) fund no tier`, d: `${unalloc.map((a) => a.name).join(", ")} count in the runway but not in tier funding. Set a % for the tiers they fund.` });
    const badPct = assets.filter((a) => a.targets.length && Math.abs(pctTotal(a.pct) - 100) >= 0.05);
    if (badPct.length) warn.push({ t: `${badPct.length} allocation(s) don't total 100% across tiers`, d: `${badPct.map((a) => a.name).join(", ")} — tier percentages should total 100.` });
    if (totalUnalloc > 1) warn.push({ t: `${fmtI(totalUnalloc)} of retirement-flagged investments is not allocated`, d: "Open Capital Portfolios and allocate it, or untick 'Use for retirement' on the investment." });
    const big = assets.find((a) => totalL && a.allocated / totalL > 0.5);
    if (big) info.push({ t: `${big.name} is ${Math.round((big.allocated / totalL) * 100)}% of capital`, d: "Heavy concentration in one asset; consider spreading risk." });
    const gs = Object.entries(calc.gNpv).sort((a, b) => b[1] - a[1]), tot = gs.reduce((t, g) => t + g[1], 0);
    if (gs.length && tot) info.push({ t: `Biggest need: ${gs[0][0].split("|")[1]} (${Math.round((gs[0][1] / tot) * 100)}% of total)`, d: `Next: ${gs.slice(1, 3).map((g) => g[0].split("|")[1]).join(", ")}. Trimming here moves the plan most.` });
    const past = rows.filter((x) => x.year <= curY && actuals.some((a) => a.year === x.year));
    if (past.length) {
      const v = past.reduce((t, x) => t + (x.plan - x.totalActual), 0), od = {};
      actuals.filter((a) => a.year <= curY).forEach((a) => { const x = items.find((i) => i.id === a.itemId); if (!x) return; const k = x.group; od[k] = (od[k] || 0) + a.amount - plannedOf(x, base + (a.year - psY)); });
      const worst = Object.entries(od).sort((a, b) => b[1] - a[1])[0];
      if (v >= 0) good.push({ t: `Spending under plan by ${fmtI(v)} so far`, d: "Surplus is already reflected in the runway." });
      else warn.push({ t: `Overspent plan by ${fmtI(-v)} so far`, d: worst && worst[1] > 0 ? `Largest overspend: ${worst[0]} (${fmtI(worst[1])}). Adjust that budget or the plan.` : "Review the Year Review tab." });
    }
    const ky = Object.keys(actualCorpus).map(Number).filter((y) => rows.some((x) => x.year === y)).sort().pop();
    if (ky) { const gap = actualCorpus[ky] - rows.find((x) => x.year === ky).endP; (gap >= 0 ? good : warn).push({ t: `Savings ${gap >= 0 ? "ahead of" : "behind"} target by ${fmtI(Math.abs(gap))} (${ky})`, d: gap >= 0 ? "Keep the current pace." : "Allocate more investments or raise monthly investing to catch up." }); }
    if (alerts.length) info.push({ t: `${alerts.length} big cost(s) due within 2 years`, d: alerts.slice(0, 3).map((a) => `${a.n} ${fmtI(a.v)} (${a.y})`).join("; ") + ". Keep this money liquid." });
    return { good, warn, info };
  }, [calc, alloc, assets, actuals, actualCorpus, alerts, items, infl, wroi, totalUnalloc]);

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
    setAssets((l) => l.map((a) => { const pct = { ...a.pct }; delete pct[k]; return { ...a, ...pctPatch(pct) }; }));
    setTiers((t) => { const n = { ...t }; delete n[k]; return n; });
  };
  const restore = () => { const s = seedInto(items, groups, family, tiers, infl); setItems(s.it); setGroups(s.gr); };
  const addInfl = () => { const k = (prompt("Name for the new inflation track:") || "").trim(); if (k && infl[k] === undefined) setInfl((i) => ({ ...i, [k]: 7 })); };
  const delInfl = (k) => { setInfl((i) => { const n = { ...i }; delete n[k]; return n; }); setItems((l) => l.map((x) => (x.infType === k ? { ...x, infType: "core" } : x))); };

  const allocate = (inv, amount) => setAssets((l) => [...l, {
    id: nid("a"), name: inv.name, investmentId: inv.id, allocatedINR: Math.round(amount),
    roi: inv.actual > 0 ? +inv.actual.toFixed(1) : 8, startYear: +(inv.purchaseDate || "").slice(0, 4) || 0, startMonth: +(inv.purchaseDate || "").slice(5, 7) || 1, targets: [], pct: {},
  }]);

  const tabs = [["setup", "Family & Inflation"], ["items", "Itemized Costs"], ["tiers", "Tier Summary"], ["assets", "Capital Portfolios"], ["income", "Income"], ["yearly", "Yearly Expenses"], ["review", "Year Review"], ["tips", "Suggestions"], ["ledger", "Cash Runway"]];
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

      {alerts.length > 0 && (
        <div style={{ background: "#FBF3E3", border: `1px solid ${COLORS.gold}`, padding: "10px 14px", marginBottom: 14, fontSize: 12 }}>
          {alerts.map((a, i) => <div key={i}>⚠ <b>{a.n}</b> — {fmtI(a.v)} due {a.y === curY ? "this year" : `in ${a.y} (${a.y - curY} yr)`}</div>)}
        </div>
      )}
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
              <div><div style={{ fontSize: 11, color: COLORS.muted }}>Plan start year</div><I w="100%" v={family.planStartYear} on={setF("planStartYear")} /></div>
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

      {tab === "assets" && (() => {
        const retAge = +family.retAge || ages.f;
        const atRet = (a) => a.currentINR * Math.pow(1 + a.roi / 100, Math.max(0, retAge - ages.f));
        const activeInvs = flaggedInvs.filter((i) => !i.ended).sort((a, b) => a.name.localeCompare(b.name));
        const endedInvs = flaggedInvs.filter((i) => i.ended).sort((a, b) => a.name.localeCompare(b.name));
        const manual = allAssets.filter((a) => a.manual);
        const amounts = (inv) => (
          <div>Invested : {inv.ccy === "USD" ? `${fmt(inv.invested, "USD")} (≈${fmtI(inv.investedINR)})` : fmtI(inv.investedINR)}</div>
        );
        const sum = [
          ["Total allocated for retirement", fmtI(totalPrincipal)],
          ["Current est. value", fmtI(totalL * 1e5)],
          ["Avg. growth (planning)", `${wroi.toFixed(2)}%`],
          ["Avg. actual return", wActual == null ? "—" : `${wActual.toFixed(2)}%`],
          ["Not yet allocated", fmtI(totalUnalloc)],
        ];
        return (
          <Card style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 1, background: COLORS.ink, marginBottom: 12 }}>
              {sum.map(([l, v]) => (
                <div key={l} style={{ background: COLORS.bg, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.muted }}>{l}</div>
                  <div style={{ fontSize: 18, marginTop: 4, color: l === "Not yet allocated" && totalUnalloc > 1 ? COLORS.negative : COLORS.ink }}>{v}</div>
                </div>
              ))}
            </div>
            <Chk v={family.ledgerFromToday} on={setF("ledgerFromToday")} label="Corpus funds all dated expenses from today (ledger starts today)" />
            <Chk v={family.growToRet} on={setF("growToRet")} label="Capital keeps compounding until retirement (only when the ledger starts at retirement)" />
            <div style={{ fontSize: 11, color: COLORS.muted, margin: "6px 0" }}>Investments appear here when "Use for retirement" is ticked on the Investments page. Amounts in INR (USD at ₹{rate}). The projection starts from each slice's current estimated value, using the planning growth %.</div>

            <div style={banner}>ACTIVE</div>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
              <thead><tr>{["Asset", "Principal", "Growth % (planning)", "Available from", "Available till", "Funds tiers (% each)", "Current est. value", ""].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {activeInvs.map((inv) => {
                  const rows = allAssets.filter((a) => a.investmentId === inv.id), un = unallocByInv(inv);
                  if (!rows.length) return (
                    <tr key={inv.id}>
                      <td style={cell}>{inv.name}</td>
                      <td style={cell}>{amounts(inv)}<div>Allocated :</div></td>
                      <td style={cell} colSpan={3}></td>
                      <td style={{ ...cell, color: COLORS.negative }}>Not allocated, <a style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => allocate(inv, inv.investedINR)}>edit to change</a></td>
                      <td style={cell}></td><td style={cell}></td>
                    </tr>
                  );
                  return rows.map((a, i) => (
                    <tr key={a.id}>
                      <td style={cell}>{i === 0 ? inv.name : <span style={{ color: COLORS.muted }}>↳ split</span>}
                        {i === rows.length - 1 && <div><Del on={() => allocate(inv, un)}>+ Split</Del>{un > 1 && <span style={{ fontSize: 10, color: COLORS.negative }}> · {fmtI(un)} unallocated</span>}</div>}
                      </td>
                      <td style={cell}>
                        {i === 0 && amounts(inv)}
                        <div style={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                          Allocated : 
                          <input 
                            type="number" 
                            value={a.allocatedINR ?? ""} 
                            onChange={(e) => updA(a.id, { allocatedINR: e.target.value === "" ? 0 : +e.target.value })} 
                            style={{ 
                              width: "90px", 
                              border: "none", 
                              borderBottom: "1px dashed #ced4da", 
                              background: "transparent", 
                              fontSize: 11, 
                              padding: "1px 0",
                              outline: "none" 
                            }} 
                          />
                        </div>
                        <div style={{ fontSize: 10, color: COLORS.muted }}>= {fmtI(a.allocatedINR)}</div>
                      </td>
                      <td style={cell}>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={a.roi ?? ""} 
                            onChange={(e) => updA(a.id, { roi: e.target.value === "" ? 0 : +e.target.value })} 
                            style={{ 
                              width: "40px", 
                              border: "none", 
                              borderBottom: "1px dashed #ced4da", 
                              background: "transparent", 
                              textAlign: "right", 
                              fontSize: 11, 
                              padding: "1px 0",
                              outline: "none" 
                            }} 
                          />%
                        </div>
                        <div style={{ fontSize: 10, color: COLORS.muted }}>actual : {a.actual != null ? `${a.actual.toFixed(1)}%` : "—"}</div>
                      </td>
                      <td style={cell}>
                        <input 
                          type="month" 
                          value={a.startYear ? `${a.startYear}-${String(a.startMonth || 1).padStart(2, "0")}` : ""} 
                          onChange={(e) => { 
                            const m = /^(\d{4})-(\d{2})/.exec(e.target.value); 
                            updA(a.id, m ? { startYear: +m[1], startMonth: +m[2] } : { startYear: 0, startMonth: 1 }); 
                          }} 
                          style={{ 
                            width: "120px", 
                            border: "none", 
                            borderBottom: "1px dashed #ced4da", 
                            background: "transparent", 
                            fontSize: 11, 
                            padding: "1px 0",
                            outline: "none" 
                          }} 
                        />
                      </td>
                      <td style={cell}>{ym(inv.endDate)}</td>
                      <td style={cell}><PctEditor tierKeys={tierKeys} pct={a.pct} onChange={(p) => updA(a.id, pctPatch(p))} /></td>
                      <td style={cell}><b>{fmtI(a.currentINR)}</b><div style={{ fontSize: 10, color: COLORS.muted }}>at retirement ≈ {fmtI(atRet(a))}</div></td>
                      <td style={cell}><Del on={() => setAssets((l) => l.filter((x) => x.id !== a.id))} /></td>
                    </tr>
                  ));
                })}
                {!activeInvs.length && <tr><td colSpan={8} style={{ ...cell, color: COLORS.muted }}>No active investments flagged for retirement.</td></tr>}
              </tbody>
            </table>

            <div style={{ margin: "14px 0 6px", display: "flex", gap: 10, alignItems: "center" }}>
              <b style={{ fontSize: 13 }}>Manual assets (PF, cash, etc.)</b>
              <button style={btnStyle} onClick={() => setAssets((l) => [...l, { id: nid("a"), name: "New asset", investmentId: "", allocatedINR: 5e6, roi: 7, startYear: 0, startMonth: 1, targets: [], pct: {} }])}>+ Add manual asset</button>
            </div>
            {manual.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
                <thead><tr>{["Asset", "Principal (₹)", "Growth % (planning)", "Available from", "Funds tiers (% each)", ""].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                <tbody>
                  {manual.map((a) => (
                    <tr key={a.id}>
                      <td style={cell}><I t="text" w="100%" v={a.name} on={(v) => updA(a.id, { name: v })} /></td>
                      <td style={cell}>
                        <input 
                          type="number" 
                          value={a.allocatedINR ?? ""} 
                          onChange={(e) => updA(a.id, { allocatedINR: e.target.value === "" ? 0 : +e.target.value })} 
                          style={{ 
                            width: "90px", 
                            border: "none", 
                            borderBottom: "1px dashed #ced4da", 
                            background: "transparent", 
                            fontSize: 11, 
                            padding: "1px 0",
                            outline: "none" 
                          }} 
                        />
                        <div style={{ fontSize: 10, color: COLORS.muted }}>= {fmtI(a.allocatedINR)}</div>
                      </td>
                      <td style={cell}>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <input 
                            type="number" 
                            step="0.1" 
                            value={a.roi ?? ""} 
                            onChange={(e) => updA(a.id, { roi: e.target.value === "" ? 0 : +e.target.value })} 
                            style={{ 
                              width: "40px", 
                              border: "none", 
                              borderBottom: "1px dashed #ced4da", 
                              background: "transparent", 
                              textAlign: "right", 
                              fontSize: 11, 
                              padding: "1px 0",
                              outline: "none" 
                            }} 
                          />%
                        </div>
                      </td>
                      <td style={cell}>
                        <input 
                          type="month" 
                          value={a.startYear ? `${a.startYear}-${String(a.startMonth || 1).padStart(2, "0")}` : ""} 
                          onChange={(e) => { 
                            const m = /^(\d{4})-(\d{2})/.exec(e.target.value); 
                            updA(a.id, m ? { startYear: +m[1], startMonth: +m[2] } : { startYear: 0, startMonth: 1 }); 
                          }} 
                          style={{ 
                            width: "120px", 
                            border: "none", 
                            borderBottom: "1px dashed #ced4da", 
                            background: "transparent", 
                            fontSize: 11, 
                            padding: "1px 0",
                            outline: "none" 
                          }} 
                        />
                        <div style={{ fontSize: 10, color: COLORS.muted }}>blank = available today</div>
                      </td>
                      <td style={cell}><PctEditor tierKeys={tierKeys} pct={a.pct} onChange={(p) => updA(a.id, pctPatch(p))} /></td>
                      <td style={cell}><Del on={() => setAssets((l) => l.filter((x) => x.id !== a.id))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={banner}>INACTIVE</div>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
              <thead><tr>{["Asset", "Invested / Allocated", "Total contributed", "Available from", "Available till", "Funds tiers (% each)", "Re-invested", "Amount at closing"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {endedInvs.map((inv) => {
                  const rows = allAssets.filter((a) => a.investmentId === inv.id);
                  const reinv = inv.reinvestedInto ? `Yes (${inv.reinvestedInto})` : "No";
                  if (!rows.length) return (
                    <tr key={inv.id}>
                      <td style={cell}>{inv.name}</td><td style={cell}>{amounts(inv)}</td><td style={cell}>—</td><td style={cell}>{ym(inv.purchaseDate)}</td><td style={cell}>{ym(inv.endDate)}</td>
                      <td style={cell}>Not allocated</td><td style={cell}>{reinv}</td><td style={cell}>{fmtI(inv.closingINR)}</td>
                    </tr>
                  );
                  return rows.map((a, i) => (
                    <tr key={a.id}>
                      <td style={cell}>{inv.name}</td>
                      <td style={cell}>{i === 0 && amounts(inv)}<div>Allocated : {fmtI(a.allocatedINR)}</div></td>
                      <td style={cell}>{fmtI(a.allocatedINR)}</td>
                      <td style={cell}>{a.startYear ? `${a.startYear}-${String(a.startMonth || 1).padStart(2, "0")}` : ym(inv.purchaseDate)}</td>
                      <td style={cell}>{ym(inv.endDate)}</td>
                      <td style={cell}>{pctText(a.pct)}</td>
                      <td style={cell}>{reinv}</td>
                      <td style={cell}>{fmtI(a.currentINR)}</td>
                    </tr>
                  ));
                })}
                {!endedInvs.length && <tr><td colSpan={8} style={{ ...cell, color: COLORS.muted }}>No ended investments flagged for retirement.</td></tr>}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 8 }}>Ended holdings drop out of the projection. If one was reinvested, allocate the new investment and it takes over from its own start date; a still-running reinvested holding leaves the pool on its end date. If an ended holding wasn't reinvested, add its closing amount as a manual asset.</div>
          </Card>
        );
      })()}

      {tab === "income" && (() => {
        const upI = (id, patch) => setIncomes((l) => l.map((y) => (y.id === id ? { ...y, ...patch } : y)));
        const addStream = () => setIncomes((l) => [...l, { id: nid("n"), name: "Part-time / routine work", amount: 20000, unit: "/ month", anchor: "f", ranges: [{ from: +family.retAge || ages.f, to: 60 }], growth: 0, active: true, ...pctPatch({ [tierKeys.includes("survival") ? "survival" : tierKeys[0]]: 100 }) }]);
        const life = (x) => calc.rows.reduce((t, r) => t + incomeOf(x, r.f), 0);
        const totalNpv = incomes.reduce((t, x) => t + (calc.incNpv[x.id] || 0), 0);
        return (
          <Card style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <button style={btnStyle} onClick={addStream}>+ Add income stream</button>
              <span style={{ fontSize: 12 }}>Lifetime (all streams) <b>{fmtI(incomes.reduce((t, x) => t + life(x), 0))}</b> · Present value <b>{fmtI(totalNpv)}</b></span>
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 10 }}>Amounts are in today's rupees and grow by the yearly % shown. Income is paid only while the chosen person's age is inside a range, so add a separate range for each stretch (e.g. 45–50, then 52–60). It reduces yearly outlay in Cash Runway, and its present value counts toward the tiers you assign.</div>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead><tr>{["Income", "Amount ₹", "Person", "Active age ranges", "Growth %/yr", "Funds tiers (% each)", "Lifetime", ""].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {incomes.map((x) => (
                  <tr key={x.id} style={{ opacity: x.active ? 1 : 0.5 }}>
                    <td style={cell}><I t="text" w="100%" v={x.name} on={(v) => upI(x.id, { name: v })} /><div style={{ marginTop: 4 }}><Chk v={x.active} on={(v) => upI(x.id, { active: v })} label="Active" /></div></td>
                    <td style={cell}><I w={90} v={x.amount} on={(v) => upI(x.id, { amount: v })} /> <S v={x.unit} opts={[["/ month", "/ month"], ["/ year", "/ year"]]} on={(v) => upI(x.id, { unit: v })} /><div style={{ fontSize: 10, color: COLORS.muted }}>= {fmtI(x.unit === "/ month" ? x.amount * 12 : x.amount)} / year</div></td>
                    <td style={cell}><S v={x.anchor} opts={people} on={(v) => upI(x.id, { anchor: v })} /></td>
                    <td style={cell}>
                      {(x.ranges || []).map((g, i) => (
                        <div key={i} style={{ marginBottom: 3, whiteSpace: "nowrap" }}>
                          <I w={50} v={g.from} on={(v) => upI(x.id, { ranges: x.ranges.map((y, j) => (j === i ? { ...y, from: v } : y)) })} /> to <I w={50} v={g.to} on={(v) => upI(x.id, { ranges: x.ranges.map((y, j) => (j === i ? { ...y, to: v } : y)) })} />
                          {g.to < g.from && <span style={{ fontSize: 10, color: COLORS.negative }}> end &lt; start</span>} <Del on={() => upI(x.id, { ranges: x.ranges.filter((_, j) => j !== i) })}>✕</Del>
                        </div>
                      ))}
                      <Del on={() => { const last = (x.ranges || []).slice(-1)[0]; upI(x.id, { ranges: [...(x.ranges || []), last ? { from: last.to + 2, to: last.to + 8 } : { from: +family.retAge || ages.f, to: 60 }] }); }}>+ Add range</Del>
                    </td>
                    <td style={cell}><I w={60} v={x.growth || 0} on={(v) => upI(x.id, { growth: v })} step="0.5" />%</td>
                    <td style={cell}><PctEditor tierKeys={tierKeys} pct={x.pct} onChange={(p) => upI(x.id, pctPatch(p))} /></td>
                    <td style={cell}>{fmtI(life(x))}<div style={{ fontSize: 10, color: COLORS.muted }}>PV {fmtI(calc.incNpv[x.id] || 0)}</div></td>
                    <td style={cell}><Del on={() => setIncomes((l) => l.filter((y) => y.id !== x.id))} /></td>
                  </tr>
                ))}
                {!incomes.length && <tr><td colSpan={8} style={{ ...cell, color: COLORS.muted }}>No income streams yet. Add part-time work, consulting or any routine income.</td></tr>}
              </tbody>
            </table>
          </Card>
        );
      })()}

      {tab === "yearly" && (() => {
        const yrs = [...new Set(calc.rows.map((x) => x.year))], yy = yrs.includes(ySel) ? ySel : yrs[0];
        const f = base + (yy - psY), row = calc.rows.find((x) => x.year === yy);
        const setActual = (itemId, val) => setActuals((l) => { const id = `${itemId}_${yy}`, rest = l.filter((x) => x.id !== id); return val === "" ? rest : [...rest, { id, itemId, year: yy, amount: +val }]; });
        const list = items.filter((x) => (yTier === "all" || x.tier === yTier) && (yGroup === "all" || x.group === yGroup)).map((x) => ({ x, pv: plannedOf(x, f), a: actMap[`${x.id}|${yy}`] }));
        const secs = {}; list.forEach((o) => { const k = gk(o.x.tier, o.x.group); (secs[k] = secs[k] || []).push(o); });
        const keys = Object.keys(secs).sort((a, b) => tierKeys.indexOf(a.split("|")[0]) - tierKeys.indexOf(b.split("|")[0]) || a.localeCompare(b));
        const eff = (o) => (o.a !== undefined ? o.a : o.pv), vc = (v) => (v >= 0 ? COLORS.positive : COLORS.negative);
        return (
          <>
            <Card>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <S v={yy} opts={yrs.map((y) => [y, `${y} (age ${base + (y - psY)})`])} on={(v) => setYSel(+v)} />
                <S v={yTier} opts={[["all", "All tiers"], ...tierKeys.map((k) => [k, k])]} on={(v) => { setYTier(v); setYGroup("all"); }} />
                <S v={yGroup} opts={[["all", "All groups"], ...(yTier === "all" ? [...new Set(groups.map((g) => g.name))] : groupsOf(yTier)).map((g) => [g, g])]} on={setYGroup} w={220} />
              </div>
              {row && <div style={{ fontSize: 13 }}>Planned <b>{fmtI(row.plan)}</b> · With actuals <b>{fmtI(row.totalActual)}</b> · <b style={{ color: vc(row.plan - row.totalActual) }}>{row.plan - row.totalActual >= 0 ? "Surplus" : "Deficit"} {fmtI(Math.abs(row.plan - row.totalActual))}</b> <span style={{ color: COLORS.muted, fontSize: 11 }}>(surplus/deficit automatically adjusts the corpus balance)</span></div>}
            </Card>
            <Card style={{ overflowX: "auto", padding: 0 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead><tr>{["Item", "Planned", "Actual ₹ (this year)", "Surplus / Deficit"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                <tbody>
                  {keys.map((k) => {
                    const os = secs[k], P = os.reduce((t, o) => t + o.pv, 0), E = os.reduce((t, o) => t + eff(o), 0);
                    return (
                      <React.Fragment key={k}>
                        <tr style={{ background: COLORS.lineLight }}><td style={{ ...cell, fontWeight: 700 }}>{k.replace("|", " › ")}</td><td style={cell}><b>{fmtI(P)}</b></td><td style={cell}><b>{fmtI(E)}</b></td><td style={{ ...cell, color: vc(P - E) }}><b>{fmtI(P - E)}</b></td></tr>
                        {os.map((o) => (
                          <tr key={o.x.id}>
                            <td style={{ ...cell, paddingLeft: 18 }}>{o.x.name}</td>
                            <td style={cell}>{fmtI(o.pv)}</td>
                            <td style={cell}><I w={110} v={o.a ?? ""} on={(v) => setActual(o.x.id, v === 0 && o.a === undefined ? "" : v)} placeholder="Type actual…" /> <Del on={() => setActual(o.x.id, String(Math.round(o.pv)))}>use plan</Del>{o.a !== undefined && <> · <Del on={() => setActual(o.x.id, "")}>clear</Del></>}</td>
                            <td style={{ ...cell, color: o.a !== undefined ? vc(o.pv - o.a) : COLORS.muted }}>{o.a !== undefined ? fmtI(o.pv - o.a) : "–"}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                  {!keys.length && <tr><td colSpan={4} style={{ ...cell, color: COLORS.muted }}>No planned costs in {yy} for this filter.</td></tr>}
                </tbody>
              </table>
            </Card>
          </>
        );
      })()}

      {tab === "review" && (() => {
        const past = calc.rows.filter((x) => x.year <= curY);
        let cum = 0;
        return (
          <Card style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead><tr>{["Year", "Planned spend", "Spend with actuals", "Surplus / Deficit", "Cumulative", "Target corpus (plan)", "Actual corpus (Lakhs)", "Ahead / Behind"].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
              <tbody>
                {past.map((x) => {
                  const v = x.plan - x.totalActual; cum += v;
                  const ac = actualCorpus[x.year], gap = ac !== undefined ? ac - x.endP : null;
                  return (
                    <tr key={x.year}>
                      <td style={cell}><b>{x.year}</b></td><td style={cell}>{fmtI(x.plan)}</td><td style={cell}>{fmtI(x.totalActual)}</td>
                      <td style={{ ...cell, color: v >= 0 ? COLORS.positive : COLORS.negative }}>{fmtI(v)}</td>
                      <td style={{ ...cell, color: cum >= 0 ? COLORS.positive : COLORS.negative }}>{fmtI(cum)}</td>
                      <td style={cell}>{fmtI(x.endP)}</td>
                      <td style={cell}><I w={100} v={ac !== undefined ? ac / 1e5 : ""} placeholder="not entered" on={(val) => setActualCorpus((m) => { const n = { ...m }; if (!val) delete n[x.year]; else n[x.year] = val * 1e5; return n; })} /></td>
                      <td style={{ ...cell, color: gap === null ? COLORS.muted : gap >= 0 ? COLORS.positive : COLORS.negative }}>{gap === null ? "–" : `${gap >= 0 ? "+" : ""}${fmtI(gap)}`}</td>
                    </tr>
                  );
                })}
                {!past.length && <tr><td colSpan={8} style={{ ...cell, color: COLORS.muted }}>No past years yet — the plan starts in {psY}. You can change "Plan start year" in Family & Inflation.</td></tr>}
              </tbody>
            </table>
          </Card>
        );
      })()}

      {tab === "tips" && (
        <>
          {[["warn", "Needs attention", COLORS.negative], ["good", "Going well", COLORS.positive], ["info", "Good to know", COLORS.info]].map(([k, title, col]) => insights[k].length > 0 && (
            <Card key={k}>
              <b style={{ fontSize: 13, color: col }}>{title}</b>
              {insights[k].map((i, n) => <div key={n} style={{ marginTop: 8, fontSize: 12 }}><b>{i.t}</b><div style={{ color: COLORS.muted }}>{i.d}</div></div>)}
            </Card>
          ))}
        </>
      )}

      {tab === "ledger" && (
        <Card style={{ overflowX: "auto", padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr>
              <th style={head}>Year</th>{[family.fName, family.mName, family.k1Name, family.k2Name].map((n, i) => <th key={i} style={head}>{n} age</th>)}
              <th style={head}>Start balance</th><th style={head}>Added / (removed)</th>{tierKeys.map((k) => <th key={k} style={head}>{k}</th>)}<th style={head}>Planned outlay</th><th style={head}>Actual outlay</th><th style={head}>Income</th><th style={head}>End balance</th>
            </tr></thead>
            <tbody>
              {calc.rows.map((r) => (
                <tr key={r.f}>
                  <td style={cell}>{r.year}</td><td style={cell}><b>{r.f}</b></td><td style={cell}>{r.m}</td><td style={cell}>{r.k1}</td><td style={cell}>{r.k2}</td>
                  <td style={cell}>{fmtI(r.start)}</td><td style={cell}>{r.added ? fmtI(r.added) : "–"}</td>{tierKeys.map((k) => <td key={k} style={cell}>{fmtI(r.out[k] || 0)}</td>)}
                  <td style={{ ...cell, color: COLORS.muted }}>{fmtI(r.total)}</td>
                  <td style={{ ...cell, color: COLORS.negative }}>{fmtI(r.totalActual)}</td>
                  <td style={{ ...cell, color: COLORS.positive }}>{r.inc ? fmtI(r.inc) : "–"}</td>
                  <td style={{ ...cell, fontWeight: 700, color: r.end < 0 ? COLORS.negative : COLORS.positive }}>{fmtI(r.end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
