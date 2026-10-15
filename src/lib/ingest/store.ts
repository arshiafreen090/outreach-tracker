import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestStore } from "./handler";

/** Raw bodies of emails that were parsed (or deliberately ignored) are dropped after this long. */
export const RAW_BODY_RETENTION_DAYS = 30;

export function createIngestStore(db: SupabaseClient): IngestStore {
  return {
    async insert(rows) {
      // ON CONFLICT DO NOTHING on gmail_message_id; the returned rows are only the new ones.
      const { data, error } = await db
        .from("email_ingest_log")
        .upsert(rows, { onConflict: "gmail_message_id", ignoreDuplicates: true })
        .select("gmail_message_id");
      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    },

    async ping() {
      const probe = await db.from("settings").select("key").limit(1);
      if (probe.error) throw new Error(probe.error.message);

      const cutoff = new Date(Date.now() - RAW_BODY_RETENTION_DAYS * 86_400_000).toISOString();
      const pruned = await db
        .from("email_ingest_log")
        .update({ raw_body: null })
        .in("parse_status", ["parsed", "ignored"])
        .not("raw_body", "is", null)
        .lt("created_at", cutoff)
        .select("id");
      if (pruned.error) throw new Error(pruned.error.message);
      return { pruned: pruned.data?.length ?? 0 };
    },
  };
}
