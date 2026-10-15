/**
 * Read-only health check of your live Supabase setup.
 *   npm run doctor
 * Verifies .env.local, the schema, the seeded templates, your one auth user, and that
 * the publishable key (what browsers get) can read and write nothing. Writes nothing.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { checkEnv, judgeSchema, type Check } from "../src/lib/doctor-checks";
import { parseSeed } from "../src/lib/templates/seed-parser";

const TABLES = ["companies", "people", "email_ingest_log", "outreach_events", "templates", "template_versions", "messages_sent", "jobs", "settings", "app_owner"];
const SETTING_KEYS = ["follow_up_days", "pending_nudge_days", "show_photos"];

const results: Check[] = [...checkEnv(process.env)];
const add = (c: Check) => results.push(c);
const ok = (name: string, detail?: string) => add({ name, status: "ok", detail });
const warn = (name: string, detail: string) => add({ name, status: "warn", detail });
const fail = (name: string, detail: string) => add({ name, status: "fail", detail });

function print() {
  const mark = { ok: "OK  ", warn: "WARN", fail: "FAIL" } as const;
  for (const r of results) console.log(`${mark[r.status]}  ${r.name}${r.detail ? ` - ${r.detail}` : ""}`);
  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  console.log(`\n${fails === 0 ? "All required checks passed" : `${fails} check(s) failed`}${warns ? `, ${warns} warning(s)` : ""}.`);
  process.exit(fails === 0 ? 0 : 1);
}

const envFailed = results.some((r) => r.status === "fail" && /SUPABASE/.test(r.name));
if (envFailed) {
  print();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/$/, "");
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.trim();
const secret = process.env.SUPABASE_SECRET_KEY!.trim();
const allowedEmail = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, clientOptions);
const anon = createClient(url, publishable, clientOptions);

// 1. Auth service reachable. (Whether public sign-ups are off is judged below, together with the owner gate.)
let signups: "off" | "on" | "unknown" = "unknown";
try {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishable } });
  if (!res.ok) fail("Auth service", `HTTP ${res.status}. Check the URL and publishable key`);
  else {
    const settings = (await res.json()) as { disable_signup?: unknown };
    ok("Auth service", "reachable");
    signups = settings.disable_signup === true ? "off" : settings.disable_signup === false ? "on" : "unknown";
  }
} catch (e) {
  fail("Auth service", `unreachable: ${(e as Error).message}`);
}

// 2. Schema. Real GET requests, not HEAD: supabase-js reports a 404 on a HEAD request as success.
const problems = new Map<string, string>();
for (const name of [...TABLES, "people_overview", "templates_current"]) {
  const { error } = await admin.from(name).select("*").limit(1);
  if (error) problems.set(name, `${error.code ?? "error"}: ${error.message}`);
}
add(judgeSchema(problems, TABLES.length + 2, TABLES.length));

// upsert_company with a blank name returns null and writes nothing
const fn = await admin.rpc("upsert_company", { p_name: "" });
if (fn.error) fail("Functions (migration 0002)", `${fn.error.message}. Did the second migration run?`);
else ok("Functions (migration 0002)", "callable");

// The database itself only lets ALLOWED_EMAIL in (RLS checks the signed token's email against app_owner)
let ownerGateOk = false;
{
  const { data, error } = await admin.from("app_owner").select("email");
  if (error) fail("Owner gate (migration 0003)", `${error.code ?? "error"}: ${error.message}`);
  else if (!data || data.length === 0) fail("Owner gate", "app_owner is empty, so nobody can use the dashboard. Run 'npm run seed:templates' (it registers ALLOWED_EMAIL)");
  else if (data.length !== 1 || data[0]?.email !== allowedEmail) fail("Owner gate", `app_owner has ${data.length} row(s) and doesn't match ALLOWED_EMAIL. Run 'npm run seed:templates'`);
  else {
    ok("Owner gate", "the database accepts only ALLOWED_EMAIL");
    ownerGateOk = true;
  }
}

if (signups === "off") ok("Public sign-ups", "disabled");
else if (signups === "on") {
  if (ownerGateOk) warn("Public sign-ups", "still ENABLED. Not a data risk now (the owner gate rejects strangers), but switch off 'Allow new users to sign up' to stop stray accounts");
  else fail("Public sign-ups", "ENABLED and the owner gate isn't in place. Turn off 'Allow new users to sign up'");
} else warn("Public sign-ups", "couldn't read the setting; check 'Allow new users to sign up' by hand");

// 3. Settings rows
{
  const { data, error } = await admin.from("settings").select("key");
  const keys = new Set((data ?? []).map((r: { key: string }) => r.key));
  const absent = SETTING_KEYS.filter((k) => !keys.has(k));
  if (error) fail("Settings rows", `${error.code ?? "error"}: ${error.message}`);
  else if (absent.length) fail("Settings rows", `missing: ${absent.join(", ")}`);
  else ok("Settings rows", "defaults present");
}

// 4. Templates seeded and byte-identical to templates/seed.md
{
  const seed = parseSeed(readFileSync(new URL("../templates/seed.md", import.meta.url), "utf8"));
  const problems: string[] = [];
  for (const t of seed) {
    const { data: row, error: rowError } = await admin.from("templates").select("id").eq("key", t.key).maybeSingle();
    if (rowError) {
      problems.push(`${t.key}: ${rowError.message}`);
      continue;
    }
    if (!row) {
      problems.push(`${t.key} not seeded`);
      continue;
    }
    const { data: v1, error: v1Error } = await admin.from("template_versions").select("body").eq("template_id", row.id).eq("version", 1).maybeSingle();
    if (v1Error) problems.push(`${t.key}: ${v1Error.message}`);
    else if (!v1) problems.push(`${t.key} has no version 1`);
    else if (v1.body !== t.body) problems.push(`${t.key} v1 differs from seed.md`);
  }
  if (problems.length) fail("Templates", `${problems.join("; ")}. After the schema exists, run 'npm run seed:templates'`);
  else ok("Templates", `${seed.length} seeded, version 1 matches seed.md byte-for-byte`);
}

// 5. The one auth user exists and can actually sign in
{
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 100 });
  if (error) fail("Auth user", error.message);
  else {
    const users = data.users;
    const me = users.find((u) => (u.email ?? "").toLowerCase() === allowedEmail);
    if (!me) fail("Auth user", `no user with email ${allowedEmail}. Create it in Authentication > Users`);
    else if (!me.email_confirmed_at) fail("Auth user", "exists but its email is not confirmed, so sign-in would fail. Confirm it (or recreate it with 'Auto Confirm User')");
    else ok("Auth user", `${allowedEmail} exists and is confirmed`);
    if (users.length > 1) warn("Other auth users", `${users.length - 1} other user(s) exist. They would be rejected by the allowlist, but delete them if you don't know them`);
  }
}

// 5b. Gmail forwarder activity (informational: a warning until the Apps Script is installed)
{
  // A real GET with a count: supabase-js reports a 404 on HEAD requests as success.
  const { data, error, count } = await admin.from("email_ingest_log").select("created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(1);
  if (error) fail("Gmail ingest", `${error.code ?? "error"}: ${error.message}`);
  else if (!count) warn("Gmail ingest", "no emails received yet. Set up the Apps Script (README, Phase 3: Gmail forwarder)");
  else ok("Gmail ingest", `${count} email(s) stored; the latest reached the server at ${data?.[0]?.created_at}`);
}

// 6. What a browser (publishable key, no login) can do: nothing
{
  const leaks: string[] = [];
  for (const table of ["people", "companies", "messages_sent", "email_ingest_log", "templates_current", "people_overview"]) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    if (!error && data && data.length > 0) leaks.push(table);
  }
  const write = await anon.rpc("log_request", { p_full_name: "doctor probe", p_profile_url: null, p_profile_url_key: null });
  if (!write.error) leaks.push("log_request (WRITE succeeded; delete the 'doctor probe' person)");
  if (leaks.length) fail("Anonymous access", `exposed: ${leaks.join(", ")}`);
  else ok("Anonymous access", "publishable key can read and write nothing");
}

print();
