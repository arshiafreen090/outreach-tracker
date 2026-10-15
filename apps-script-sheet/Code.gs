/**
 * @OnlyCurrentDoc
 *
 * Outreach Tracker: Google Sheet mirror.
 *
 * Create this from INSIDE the Sheet (Extensions > Apps Script), so it is bound to that one Sheet.
 * Every 15 minutes it asks your dashboard (/api/sheet) for three tabs and rewrites them:
 * "Accepted connections", "Messaged" and "Pending requests".
 *
 * It can only touch this Sheet (the manifest asks for spreadsheets.currentonly). It cannot read
 * Gmail, Drive or anything else, and it never contacts LinkedIn. It only talks to your own
 * dashboard URL. The tabs are a read-only mirror: they are overwritten on every sync, so do your
 * own notes and charts in a different tab.
 *
 * Setup (details in README.md, "Phase 4: Google Sheet mirror"):
 *   1. Project Settings > Script Properties, add:
 *        INGEST_BASE_URL  e.g. https://your-app.vercel.app   (no trailing slash)
 *        INGEST_SECRET    the INGEST_SHARED_SECRET from your .env.local
 *   2. Run syncSheet() once and accept the permission prompt.
 *   3. Run installTrigger() once.
 */

const SYNC_EVERY_MINUTES = 15; // Apps Script only allows 1, 5, 10, 15 or 30

/** Adds an "Outreach Tracker" menu to the Sheet. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Outreach Tracker').addItem('Sync now', 'syncSheet').addToUi();
}

function syncSheet() {
  const cfg = config_();
  const res = UrlFetchApp.fetch(cfg.baseUrl + '/api/sheet', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + cfg.secret },
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('GET /api/sheet failed with HTTP ' + code + ': ' + res.getContentText().slice(0, 300));

  const body = JSON.parse(res.getContentText());
  if (!body.ok || !Array.isArray(body.tabs)) throw new Error('Unexpected response from /api/sheet.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  body.tabs.forEach((tab) => writeTab_(ss, tab));
  console.log('Synced ' + body.tabs.map((t) => t.name + ' (' + t.rows.length + ')').join(', ') + ' at ' + body.generatedAt);
}

/** Run once by hand: replaces any old trigger with one that runs syncSheet on a timer. */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncSheet')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncSheet').timeBased().everyMinutes(SYNC_EVERY_MINUTES).create();
  console.log('Trigger installed: syncSheet every ' + SYNC_EVERY_MINUTES + ' minutes.');
}

// ---------------------------------------------------------------- helpers

function writeTab_(ss, tab) {
  const width = tab.headers.length;
  const values = [tab.headers].concat(tab.rows);
  values.forEach((row, i) => {
    if (row.length !== width) throw new Error('Tab "' + tab.name + '", row ' + (i + 1) + ' has ' + row.length + ' cells, expected ' + width + '.');
  });

  const sheet = ss.getSheetByName(tab.name) || ss.insertSheet(tab.name);
  sheet.clearContents();
  const range = sheet.getRange(1, 1, values.length, width);
  // Plain-text format first: whatever a person typed in LinkedIn can never turn into a formula.
  range.setNumberFormat('@');
  range.setValues(values);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  sheet.getRange(1, 1).setNote('Mirror of your Outreach Tracker. This tab is rewritten on every sync, so edits here are lost.');
  sheet.autoResizeColumns(1, width);
}

function config_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = (props.getProperty('INGEST_BASE_URL') || '').trim().replace(/\/+$/, '');
  const secret = (props.getProperty('INGEST_SECRET') || '').trim();
  if (!/^https:\/\//.test(baseUrl)) throw new Error('Set the INGEST_BASE_URL script property to your https:// dashboard URL.');
  if (secret.length < 32) throw new Error('Set the INGEST_SECRET script property (at least 32 characters).');
  return { baseUrl: baseUrl, secret: secret };
}
