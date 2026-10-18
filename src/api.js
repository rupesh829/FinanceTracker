// ---------------------------------------------------------------------------
// PASTE YOUR APPS SCRIPT WEB APP URL HERE after deploying (see README.md).
// It looks like: https://script.google.com/macros/s/AKfycb.../exec
// ---------------------------------------------------------------------------
export const API_URL = "https://script.google.com/macros/s/AKfycbyYVYuC2fvaWZYckshcWx9EuyamypO94w_ypBZsqStQ7n-RqMpAG-veQMdvTyDH9GcU/exec";

// All ids (row ids and foreign-key references like investmentId/debtId) are
// generated as Date.now().toString() — long numeric-looking strings. Google
// Sheets' default "Automatic" cell format auto-detects these as numbers when
// they're written via setValues, so they come back from getDataRange() as JS
// numbers, not strings. That silently breaks strict (===) comparisons
// anywhere a string from elsewhere (e.g. a <select> element's value, which
// the DOM always reports as a string) is compared against one of these
// fields — the "All" option happened to still match, which is why filters
// looked like they worked until a specific id was picked. Fixed once, here,
// by normalizing every id-like field to a string right after fetch, so nothing
// downstream has to think about it.
const ID_FIELDS = ["id", "investmentId", "debtId", "recurringId", "refinancedFromId", "parentExpenseId"];
function normalizeIds(rows) {
  return rows.map((r) => {
    const out = { ...r };
    ID_FIELDS.forEach((f) => {
      if (out[f] !== undefined && out[f] !== null && out[f] !== "") out[f] = String(out[f]);
    });
    return out;
  });
}

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
  return normalizeIds(data.rows || []);
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
