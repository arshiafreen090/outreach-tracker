export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export type KeyKind = "publishable" | "secret" | "legacy-anon" | "legacy-service-role" | "unknown";

/** The `role` claim of a legacy (JWT-style) Supabase key, or null if it isn't one. */
function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

export function classifyKey(value: string): KeyKind {
  const v = value.trim();
  if (v.startsWith("sb_publishable_")) return "publishable";
  if (v.startsWith("sb_secret_")) return "secret";
  const role = jwtRole(v);
  if (role === "anon") return "legacy-anon";
  if (role === "service_role") return "legacy-service-role";
  return "unknown";
}

const ok = (name: string, detail?: string): Check => ({ name, status: "ok", detail });
const warn = (name: string, detail: string): Check => ({ name, status: "warn", detail });
const fail = (name: string, detail: string): Check => ({ name, status: "fail", detail });

/**
 * Turns "which tables/views failed to load" into one verdict.
 * `problems` maps object name -> error text; `total` is how many objects were probed.
 */
export function judgeSchema(problems: ReadonlyMap<string, string>, total: number, tableCount: number): Check {
  const name = "Schema";
  if (problems.size === 0) return ok(name, `${tableCount} tables and ${total - tableCount} views present`);
  if (problems.size === total) {
    return fail(name, "NONE of the tables or views exist in this project, so the SQL has not been applied here. Run 'npm run sql:copy', paste it into THIS project's SQL Editor and press Run");
  }
  // Tables that belong to a later migration: if only those are missing, say which file to run.
  const LATER: Record<string, string> = { app_owner: "0003 (owner gate)", accept_candidates: "0004 (accepts)", job_sources: "0006 (jobs feed)" };
  const missing = [...problems.keys()];
  if (missing.every((n) => n in LATER)) {
    const files = missing.map((n) => LATER[n]).join(" and ");
    return fail(name, `migration${missing.length > 1 ? "s" : ""} ${files} ${missing.length > 1 ? "haven't" : "hasn't"} been applied. Paste ${missing.length > 1 ? "those files from supabase/migrations/ in order" : "it"} into the SQL Editor (npm run sql:copy:latest copies only the newest)`);
  }
  const list = [...problems].map(([n, e]) => `${n} (${e})`).join("; ");
  return fail(name, `missing or unreadable: ${list}. If the SQL ran with an error, nothing from it is kept: fix the error and run all of it again`);
}

/**
 * Static checks of .env.local. The most important one: a secret (RLS-bypassing) key in
 * the NEXT_PUBLIC_ variable would be shipped to every browser.
 */
export function checkEnv(env: Record<string, string | undefined>): Check[] {
  const checks: Check[] = [];
  const get = (k: string) => (env[k] ?? "").trim();

  const url = get("NEXT_PUBLIC_SUPABASE_URL");
  if (!url) checks.push(fail("NEXT_PUBLIC_SUPABASE_URL", "not set"));
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    checks.push(fail("NEXT_PUBLIC_SUPABASE_URL", "should look like https://<project-ref>.supabase.co with nothing after it"));
  } else checks.push(ok("NEXT_PUBLIC_SUPABASE_URL", url.replace(/\/$/, "")));

  const pub = get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!pub) checks.push(fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "not set"));
  else {
    const kind = classifyKey(pub);
    if (kind === "publishable") checks.push(ok("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable key"));
    else if (kind === "legacy-anon") checks.push(warn("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "legacy anon key: works, but Supabase is deprecating legacy keys"));
    else if (kind === "secret" || kind === "legacy-service-role") {
      checks.push(fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "this is a SECRET key. NEXT_PUBLIC_ values are sent to every browser. Put the publishable key here and the secret key in SUPABASE_SECRET_KEY"));
    } else checks.push(fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "doesn't look like a Supabase key (expected sb_publishable_...)"));
  }

  const secret = get("SUPABASE_SECRET_KEY");
  if (!secret) checks.push(fail("SUPABASE_SECRET_KEY", "not set"));
  else {
    const kind = classifyKey(secret);
    if (kind === "secret") checks.push(ok("SUPABASE_SECRET_KEY", "secret key"));
    else if (kind === "legacy-service-role") checks.push(warn("SUPABASE_SECRET_KEY", "legacy service_role key: works, but Supabase is deprecating legacy keys"));
    else if (kind === "publishable" || kind === "legacy-anon") {
      checks.push(fail("SUPABASE_SECRET_KEY", "this is the publishable/anon key. Use the secret key (sb_secret_...)"));
    } else checks.push(fail("SUPABASE_SECRET_KEY", "doesn't look like a Supabase key (expected sb_secret_...)"));
  }

  const email = get("ALLOWED_EMAIL");
  if (!email) checks.push(fail("ALLOWED_EMAIL", "not set: nobody could sign in"));
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) checks.push(fail("ALLOWED_EMAIL", "doesn't look like an email address"));
  else checks.push(ok("ALLOWED_EMAIL", email));

  const ingest = get("INGEST_SHARED_SECRET");
  if (!ingest) checks.push(warn("INGEST_SHARED_SECRET", "empty (only needed from Phase 3)"));
  else if (ingest.length < 32) checks.push(warn("INGEST_SHARED_SECRET", "shorter than 32 characters"));
  else checks.push(ok("INGEST_SHARED_SECRET", "set"));

  return checks;
}
