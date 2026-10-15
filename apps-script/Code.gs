/**
 * Outreach Tracker: Gmail forwarder.
 *
 * Every 10 minutes it looks for recent LinkedIn emails in THIS Gmail account and sends each
 * one, untouched, to your dashboard's /api/ingest endpoint, which stores and parses it.
 *
 * Read-only by construction: appsscript.json limits Gmail access to the gmail.readonly scope,
 * so this script cannot send, label, archive or delete anything. It never contacts LinkedIn.
 * It only talks to Gmail and to your own dashboard URL.
 *
 * Setup (details in README.md, "Phase 3: Gmail forwarder"):
 *   1. Project Settings > Script Properties, add:
 *        INGEST_BASE_URL  e.g. https://your-app.vercel.app   (no trailing slash)
 *        INGEST_SECRET    the INGEST_SHARED_SECRET from your .env.local
 *   2. Run testConnection() once and accept the permission prompt.
 *   3. Run installTrigger() once.
 */

// Which emails to forward. Widen this later (for job alerts) by adding senders, e.g.
// 'from:(linkedin.com OR internshala.com)'. The server treats every email as untrusted data.
const QUERY = 'from:linkedin.com';
const FIRST_RUN_LOOKBACK_DAYS = 30;
const OVERLAP_MS = 60 * 60 * 1000;          // re-check the last hour each run; the server ignores duplicates
const MAX_MESSAGES_PER_RUN = 200;           // keeps a big first backfill inside the 6 minute limit
const BATCH_MAX_EMAILS = 5;
const BATCH_MAX_CHARS = 2500000;            // stay well under Vercel's 4.5 MB request body limit
const SKIP_RAW_OVER_CHARS = 1900000;        // the server rejects anything bigger anyway
const PING_EVERY_MS = 20 * 60 * 60 * 1000;  // keepalive roughly daily
const PULL_JOBS_EVERY_MS = 20 * 60 * 60 * 1000; // company job boards, roughly daily

function syncEmails() {
  const cfg = config_();
  const props = PropertiesService.getScriptProperties();
  const startedAt = Date.now();

  const lastSync = Number(props.getProperty('LAST_SYNC_MS')) || startedAt - FIRST_RUN_LOOKBACK_DAYS * 86400000;
  const days = Math.ceil((startedAt - (lastSync - OVERLAP_MS)) / 86400000) + 1;
  const ids = listMessageIds_(QUERY + ' newer_than:' + days + 'd').reverse(); // oldest first

  const todo = ids.slice(0, MAX_MESSAGES_PER_RUN);
  const capped = ids.length > todo.length;

  let batch = [];
  let batchChars = 0;
  let newestMs = 0;
  let sent = 0, inserted = 0, duplicates = 0, rejected = 0;

  const flush = () => {
    if (batch.length === 0) return;
    const result = post_(cfg, '/api/ingest', { emails: batch });
    sent += batch.length;
    inserted += result.inserted;
    duplicates += result.duplicates;
    rejected += result.rejected.length;
    result.rejected.forEach((r) => console.warn('Server rejected ' + r.id + ': ' + r.reason));
    batch = [];
    batchChars = 0;
  };

  for (const id of todo) {
    const msg = Gmail.Users.Messages.get('me', id, { format: 'raw' });
    const ms = Number(msg.internalDate);
    newestMs = Math.max(newestMs, ms);
    if (ms < lastSync - OVERLAP_MS) continue; // older than the overlap window
    if (msg.raw.length > SKIP_RAW_OVER_CHARS) {
      console.warn('Skipping ' + id + ': message is too large (' + msg.raw.length + ' chars)');
      continue;
    }
    if (batch.length >= BATCH_MAX_EMAILS || batchChars + msg.raw.length > BATCH_MAX_CHARS) flush();
    batch.push({ id: msg.id, internal_date: String(msg.internalDate), raw: msg.raw });
    batchChars += msg.raw.length;
  }
  flush();

  // Only now, after every request succeeded, move the cursor. A failure above throws before
  // this line, so the next run simply tries the same window again.
  props.setProperty('LAST_SYNC_MS', String(capped ? newestMs : startedAt));

  console.log('Looked at ' + todo.length + ' of ' + ids.length + ' messages; sent ' + sent +
    ' (new ' + inserted + ', already stored ' + duplicates + ', rejected ' + rejected + ')' +
    (capped ? '. More remain; the next run continues.' : '.'));

  pingIfDue_(cfg, props, startedAt);
  pullJobsIfDue_(cfg, props, startedAt);
}

/** Run once by hand: checks the Script Properties, the endpoint and the secret. Sends no email data. */
function testConnection() {
  const cfg = config_();
  const result = post_(cfg, '/api/ingest/ping', {});
  console.log('Connected to ' + cfg.baseUrl + '. Server says: ' + JSON.stringify(result));
  const count = Gmail.Users.Messages.list('me', { q: QUERY + ' newer_than:7d', maxResults: 5 });
  console.log('Gmail access works. Recent matching messages (up to 5): ' + (count.messages ? count.messages.length : 0));
}

/** Run once by hand: replaces any old trigger with one that runs syncEmails every 10 minutes. */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'syncEmails')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncEmails').timeBased().everyMinutes(10).create();
  console.log('Trigger installed: syncEmails every 10 minutes.');
}

/** Debugging: forget the cursor so the next run re-reads the last 30 days (the server skips duplicates). */
function resetCursor() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_SYNC_MS');
  console.log('Cursor reset.');
}

// ---------------------------------------------------------------- helpers

function config_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = (props.getProperty('INGEST_BASE_URL') || '').trim().replace(/\/+$/, '');
  const secret = (props.getProperty('INGEST_SECRET') || '').trim();
  if (!/^https:\/\//.test(baseUrl)) throw new Error('Set the INGEST_BASE_URL script property to your https:// dashboard URL.');
  if (secret.length < 32) throw new Error('Set the INGEST_SECRET script property (at least 32 characters).');
  return { baseUrl: baseUrl, secret: secret };
}

function listMessageIds_(query) {
  const ids = [];
  let pageToken;
  do {
    const page = Gmail.Users.Messages.list('me', { q: query, maxResults: 100, pageToken: pageToken });
    (page.messages || []).forEach((m) => ids.push(m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < 1000);
  return ids;
}

function post_(cfg, path, body) {
  const res = UrlFetchApp.fetch(cfg.baseUrl + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.secret },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('POST ' + path + ' failed with HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

function pingIfDue_(cfg, props, now) {
  const last = Number(props.getProperty('LAST_PING_MS')) || 0;
  if (now - last < PING_EVERY_MS) return;
  post_(cfg, '/api/ingest/ping', {});
  props.setProperty('LAST_PING_MS', String(now));
}

/** Once a day, asks the dashboard to check the company job boards you follow (Jobs > Company job boards). */
function pullJobsIfDue_(cfg, props, now) {
  const last = Number(props.getProperty('LAST_JOBS_PULL_MS')) || 0;
  if (now - last < PULL_JOBS_EVERY_MS) return;
  const result = post_(cfg, '/api/jobs/pull', {});
  props.setProperty('LAST_JOBS_PULL_MS', String(now));
  console.log('Job boards: ' + result.sources + ' checked, ' + result.added + ' new job(s), ' + result.failed + ' failed.');
}
