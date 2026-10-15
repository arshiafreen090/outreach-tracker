/**
 * Read-only health check of your live Supabase setup.
 *   npm run doctor
 * Verifies .env.local, the schema, the seeded templates, your one auth user, and that
 * the publishable key (what browsers get) can read and write nothing. Writes nothing.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { checkEnv, type Check } from "../src/lib/doctor-checks";
import { parseSeed } from "../src/lib/templates/seed-parser";

const TABLES = ["companies", "people", "email_ingest_log", "outreach_events", "templates", "template_versions", "messages_sent", "jobs", "settings"];
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

// 1. Auth service reachable; are public sign-ups off?
try {
  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishable } });
  if (!res.ok) fail("Auth service", `HTTP ${res.status}. Check the URL and publishable key`);
  else {
    const settings = (await res.json()) as { disable_signup?: unknown };
    ok("Auth service", "reachable");
    if (settings.disable_signup === true) ok("Public sign-ups", "disabled");
    else if (settings.disable_signup === false) fail("Public sign-ups", "ENABLED. Turn off 'Allow new users to sign up' in Authentication settings");
    else warn("Public sign-ups", "couldn't read the setting; check 'Allow new users to sign up' is off by hand");
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
if (problems.size === TABLES.length + 2) {
  fail("Schema", "NONE of the tables or views exist in this project, so the SQL has not been applied here. Run 'npm run sql:copy', paste it into THIS project's SQL Editor and press Run");
} else if (problems.size > 0) {
  fail("Schema", `missing or unreadable: ${[...problems].map(([n, e]) => `${n} (${e})`).join("; ")}. If the SQL ran with an error, nothing from it is kept: fix the error and run all of it again`);
} else {
  ok("Schema", `${TABLES.length} tables and 2 views present`);
}

// upsert_company with a blank name returns null and writes nothing
const fn = await admin.rpc("upsert_company", { p_name: "" });
if (fn.error) fail("Functions (migration 0002)", `${fn.error.message}. Did the second migration run?`);
else ok("Functions (migration 0002)", "callable");

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
