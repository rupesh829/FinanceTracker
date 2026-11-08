import React, { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { getTable, setTable } from "../api.js";
import { COLORS, sansFont, btnStyleGhost, todayStr } from "../styles.js";

// Add any new Sheet tab here so it is included in backups.
export const ALL_TABS = [
  "Investments", "Income", "AssetClasses", "Debts", "DebtPayments", "Salary", "Transfers",
  "RecurringExpenses", "Expenses", "RecurringIncoming", "IncomingTransfers",
  "RetirementConfig", "RetirementExpenses", "RetirementItems", "RetirementAssets", "RetirementActuals","Settings",
];

export default function Backup() {
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);

  const exportAll = async () => {
    try {
      setMsg("Exporting…");
      const data = {};
      for (const t of ALL_TABS) data[t] = await getTable(t);
      const blob = new Blob([JSON.stringify({ app: "finance-tracker", exportedAt: new Date().toISOString(), tables: data }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `finance-backup-${todayStr()}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
      setMsg(`✓ Exported ${ALL_TABS.length} tabs`);
    } catch (e) { setMsg("⚠ Export failed: " + e.message); }
  };

  const importAll = async (file) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const tables = json.tables;
      if (!tables || json.app !== "finance-tracker") throw new Error("Not a finance-tracker backup file");
      const names = Object.keys(tables).filter((t) => ALL_TABS.includes(t));
      if (!window.confirm(`Restore ${names.length} tabs from the backup dated ${json.exportedAt?.slice(0, 10)}? This OVERWRITES the current data in those tabs. Export a fresh backup first if unsure.`)) return;
      for (const t of names) { setMsg(`Restoring ${t}…`); await setTable(t, tables[t]); }
      setMsg("✓ Restored. Reloading…");
      setTimeout(() => window.location.reload(), 800);
    } catch (e) { setMsg("⚠ Import failed: " + e.message); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: sansFont, fontSize: 11, color: COLORS.muted }}>
      {msg && <span>{msg}</span>}
      <button onClick={exportAll} style={btnStyleGhost}><Download size={13} /> Backup</button>
      <button onClick={() => fileRef.current?.click()} style={btnStyleGhost}><Upload size={13} /> Restore</button>
      <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => importAll(e.target.files?.[0])} />
    </div>
  );
}
