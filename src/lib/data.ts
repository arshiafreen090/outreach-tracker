import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSettings, type AppSettings } from "./settings";
import type { AcceptCandidate, CompanyRow, LastMessage, PersonRow, PersonStatus, TemplateRow } from "./db-types";

function check<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Could not load ${what}: ${result.error.message}`);
  return (result.data ?? ([] as unknown)) as T;
}

export async function loadSettings(db: SupabaseClient): Promise<AppSettings> {
  return parseSettings(check(await db.from("settings").select("key, value"), "settings") as { key: string; value: unknown }[]);
}

/** Latest version of every template. Archived ones are included; callers filter. */
export async function loadTemplates(db: SupabaseClient): Promise<TemplateRow[]> {
  return check<TemplateRow[]>(await db.from("templates_current").select("*").order("key"), "templates");
}

export async function loadCompanies(db: SupabaseClient): Promise<CompanyRow[]> {
  return check<CompanyRow[]>(await db.from("companies").select("*").order("name"), "companies");
}

export async function loadPeopleByStatus(db: SupabaseClient, statuses: PersonStatus[]): Promise<PersonRow[]> {
  return check<PersonRow[]>(await db.from("people_overview").select("*").in("status", statuses), "people");
}

/** Everyone who has been sent at least one message, newest first. */
export async function loadMessagedPeople(db: SupabaseClient): Promise<PersonRow[]> {
  return check<PersonRow[]>(
    await db.from("people_overview").select("*").gt("messages_sent_count", 0).order("last_messaged_at", { ascending: false }),
    "messaged people",
  );
}

/** profile_url_key -> full name, for the "already logged" hint in the log form. */
export async function loadKnownProfiles(db: SupabaseClient): Promise<Record<string, string>> {
  const rows = check<{ full_name: string; profile_url_key: string }[]>(
    await db.from("people").select("full_name, profile_url_key").not("profile_url_key", "is", null),
    "profiles",
  );
  return Object.fromEntries(rows.map((r) => [r.profile_url_key, r.full_name]));
}

/** Accepted people from emails that match none of your requests. */
export async function loadUnmatchedAccepts(db: SupabaseClient): Promise<AcceptCandidate[]> {
  const { data, error } = await db.from("accept_candidates").select("*").eq("status", "unmatched").order("accepted_at", { ascending: false });
  if (error) {
    const hint = error.code === "PGRST205" ? " Run migration 0004 (npm run sql:copy:latest) in the Supabase SQL Editor." : "";
    throw new Error(`Could not load unknown accepts: ${error.message}.${hint}`);
  }
  return (data ?? []) as AcceptCandidate[];
}

export async function loadCounts(db: SupabaseClient): Promise<{ accepted: number; pending: number; unmatched: number }> {
  const count = async (status: PersonStatus) => {
    const { count: n, error } = await db.from("people").select("id", { count: "exact", head: true }).eq("status", status);
    if (error) throw new Error(`Could not load counts: ${error.message}`);
    return n ?? 0;
  };
  const [accepted, pending] = await Promise.all([count("accepted"), count("requested")]);
  // Tolerant on purpose: before migration 0004 exists this must not take the whole dashboard down.
  const unknown = await db.from("accept_candidates").select("id", { count: "exact" }).eq("status", "unmatched").limit(1);
  return { accepted, pending, unmatched: unknown.error ? 0 : (unknown.count ?? 0) };
}

/** Most recent message per person (for the duplicate-send banner and the Messaged list). */
export async function loadLastMessages(db: SupabaseClient, personIds: string[]): Promise<Map<string, LastMessage>> {
  const map = new Map<string, LastMessage>();
  if (personIds.length === 0) return map;
  const rows = check<LastMessage[]>(
    await db
      .from("messages_sent")
      .select("person_id, template_id, template_version, final_text, sent_at")
      .in("person_id", personIds)
      .order("sent_at", { ascending: false }),
    "messages",
  );
  for (const row of rows) if (!map.has(row.person_id)) map.set(row.person_id, row);
  return map;
}

export function companyById(companies: readonly CompanyRow[]): Map<string, CompanyRow> {
  return new Map(companies.map((c) => [c.id, c]));
}
