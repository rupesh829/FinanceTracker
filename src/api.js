// ---------------------------------------------------------------------------
// PASTE YOUR APPS SCRIPT WEB APP URL HERE after deploying (see README.md).
// It looks like: https://script.google.com/macros/s/AKfycb.../exec
// ---------------------------------------------------------------------------
export const API_URL = "https://script.google.com/macros/s/AKfycbyYVYuC2fvaWZYckshcWx9EuyamypO94w_ypBZsqStQ7n-RqMpAG-veQMdvTyDH9GcU/exec";

// Reads every row of a sheet tab, returned as an array of plain objects
// keyed by header row. Empty/missing sheet returns [].
export async function getTable(sheet) {
  if (API_URL.includes("PASTE_YOUR")) {
    console.warn("API_URL not configured yet — see README.md");
    return [];
  }
  const res = await fetch(`${API_URL}?sheet=${encodeURIComponent(sheet)}`);
  if (!res.ok) throw new Error(`Failed to load sheet "${sheet}"`);
  const data = await res.json();
  return data.rows || [];
}

// Overwrites a sheet tab's contents entirely with the given array of row
// objects (same "replace whole table" model as the previous in-page storage,
// just backed by Sheets now — simplest way to avoid partial-write conflicts
// for a single-user tool).
export async function setTable(sheet, rows) {
  if (API_URL.includes("PASTE_YOUR")) {
    console.warn("API_URL not configured yet — see README.md");
    return { status: "skipped" };
  }
  // Content-Type is deliberately "text/plain" rather than "application/json":
  // Apps Script web apps don't implement CORS preflight (OPTIONS) handling,
  // so a JSON content-type triggers a preflight that fails. text/plain is a
  // "simple request" and skips preflight entirely; Apps Script still parses
  // the body as JSON fine on its end.
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ sheet, rows }),
  });
  if (!res.ok) throw new Error(`Failed to save sheet "${sheet}"`);
  return res.json();
}
