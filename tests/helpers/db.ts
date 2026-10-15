import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/** Mimics what Supabase provides before our migrations run. */
export const SUPABASE_PRELUDE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  -- a role that holds privileges but has NO RLS policy: proves RLS is really enforced
  create role outsider nologin;
  grant usage on schema public to anon, authenticated, outsider, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, outsider, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, outsider, service_role;

  -- Supabase's auth.jwt(): the claims of the verified token for the current request
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant usage on schema auth to anon, authenticated, outsider;
`;

/** The one allowed user in tests. makeDb() registers it in app_owner. */
export const OWNER_EMAIL = "owner@example.com";

// Vitest runs from the repo root. (import.meta.url + fileURLToPath breaks under jsdom's URL.)
const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

export function readRepoFile(relativeToRepo: string): string {
  return readFileSync(path.join(repoRoot, relativeToRepo), "utf8");
}

/** A fresh in-memory Postgres with the Supabase prelude and every migration applied in order. */
export async function makeDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_PRELUDE);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  await db.query("insert into app_owner (email) values ($1)", [OWNER_EMAIL]);
  return db;
}

/** Runs fn as `role`, as if the request carried a verified JWT for `email` (null = no email claim). */
export async function asUser<T>(db: PGlite, role: string, email: string | null, fn: () => Promise<T>): Promise<T> {
  const claims = email === null ? "" : JSON.stringify({ email });
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  try {
    return await asRole(db, role, fn);
  } finally {
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

export async function asRole<T>(db: PGlite, role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

export const scalar = async <T>(db: PGlite, sql: string, params: unknown[] = []) =>
  (await db.query<{ v: T }>(sql, params)).rows[0]!.v;
