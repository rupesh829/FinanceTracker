/**
 * Finance Tracker — Apps Script backend
 *
 * Deploy this bound to your Google Sheet (Extensions > Apps Script).
 * It exposes two endpoints on the same web app URL:
 *   GET  ?sheet=SheetName        -> { rows: [ {col: val, ...}, ... ] }
 *   POST { sheet, rows: [...] }  -> overwrites the entire sheet tab with the given rows
 *
 * Each "table" (Investments, Income, Debts, DebtPayments, Salary) is its own
 * tab in the spreadsheet. Tabs are created automatically on first write if
 * they don't exist yet — you don't need to pre-create them, just deploy this
 * script against a spreadsheet (any spreadsheet; a blank one is fine).
 */

function doGet(e) {
  const sheetName = e.parameter.sheet;
  if (!sheetName) return jsonResponse({ error: "Missing 'sheet' parameter" });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return jsonResponse({ rows: [] });

  const data = sheet.getDataRange().getValues();
  if (data.length === 0) return jsonResponse({ rows: [] });

  const headers = data[0];
  const rows = data.slice(1)
    .filter((row) => row.some((cell) => cell !== "" && cell !== null))
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        // Dates come back from Sheets as Date objects for date-typed cells;
        // normalize to YYYY-MM-DD strings so the front end's string
        // comparisons/sorts work the same as freshly-typed dates.
        const val = row[i];
        obj[h] = val instanceof Date ? Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd") : val;
      });
      return obj;
    });

  return jsonResponse({ rows });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: "Invalid JSON body" });
  }

  const sheetName = body.sheet;
  const rows = body.rows || [];
  if (!sheetName) return jsonResponse({ error: "Missing 'sheet' in body" });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  sheet.clearContents();

  if (rows.length === 0) return jsonResponse({ status: "ok", count: 0 });

  // Union of all keys across rows, so no data is silently dropped if some
  // rows have different fields than others.
  const headerSet = {};
  rows.forEach((r) => Object.keys(r).forEach((k) => { headerSet[k] = true; }));
  const headers = Object.keys(headerSet);

  const values = [headers, ...rows.map((r) => headers.map((h) => (r[h] !== undefined && r[h] !== null) ? r[h] : ""))];
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);

  return jsonResponse({ status: "ok", count: rows.length });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
