import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompanies, loadSettings } from "../data";
import type { PersonRow } from "../db-types";
import type { SheetData, SheetMessage } from "./build";

/** Reads everything the Sheet mirror shows. Uses the secret-key client, so call it only after authenticating. */
export async function loadSheetData(db: SupabaseClient): Promise<SheetData> {
  const [people, messages, templates, companies, settings] = await Promise.all([
    db.from("people_overview").select("*"),
    db.from("messages_sent").select("person_id, template_id, template_version, sent_at"),
    db.from("templates").select("id, name"),
    loadCompanies(db),
    loadSettings(db),
  ]);
  for (const r of [people, messages, templates]) if (r.error) throw new Error(r.error.message);
  return {
    people: (people.data ?? []) as PersonRow[],
    messages: (messages.data ?? []) as SheetMessage[],
    templates: (templates.data ?? []) as { id: string; name: string }[],
    companies,
    settings,
  };
}
