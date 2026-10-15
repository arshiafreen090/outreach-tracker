/**
 * Re-processes stored emails with the current parsers.
 *   npm run reparse            emails that failed or were ignored
 *   npm run reparse -- --all   every email that still has its raw body
 * Safe to repeat: matching an accepted person is idempotent. Use it after a parser improves
 * (or after you send a sample of a template that had no parser).
 */
import { createClient } from "@supabase/supabase-js";
import { rowToProcessInput } from "../src/lib/ingest/handler";
import { processEmail } from "../src/lib/ingest/linkedin/process";
import { createIngestStore } from "../src/lib/ingest/store";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (see .env.local).");
  process.exit(1);
}
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const store = createIngestStore(db);

const all = process.argv.includes("--all");
let query = db.from("email_ingest_log").select("id, from_address, subject, raw_body, parse_result, received_at").not("raw_body", "is", null).order("received_at");
if (!all) query = query.in("parse_status", ["failed", "ignored"]);
const { data, error } = await query;
if (error) {
  console.error(error.message);
  process.exit(1);
}

const tally: Record<string, number> = {};
for (const row of data ?? []) {
  const processed = processEmail(rowToProcessInput(row));
  const outcome = await store.finish(row.id, processed, new Date(row.received_at ?? Date.now()));
  const details = [...outcome.accepts, ...outcome.jobs.map((j) => `job ${j}`)];
  const label = `${processed.kind}/${processed.parse_status}${details.length ? ` [${[...new Set(details)].join(", ")}]` : ""}`;
  tally[label] = (tally[label] ?? 0) + 1;
}
console.log(`Re-processed ${data?.length ?? 0} email(s).`);
for (const [label, n] of Object.entries(tally)) console.log(`  ${String(n).padStart(4)}  ${label}`);
