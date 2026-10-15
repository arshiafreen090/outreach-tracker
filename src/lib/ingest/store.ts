import type { SupabaseClient } from "@supabase/supabase-js";
import { fromLinkedIn, upsertArgs, type JobOutcome } from "../jobs/save";
import type { AcceptOutcome, IngestStore } from "./handler";
import type { Processed } from "./linkedin/process";

/** Raw bodies of emails that were parsed (or deliberately ignored) are dropped after this long. */
export const RAW_BODY_RETENTION_DAYS = 30;

export function createIngestStore(db: SupabaseClient): IngestStore {
  const markFailed = async (id: string, message: string) => {
    await db.from("email_ingest_log").update({ parse_status: "failed", parse_error: message.slice(0, 500) }).eq("id", id);
  };

  return {
    async insert(rows) {
      // ON CONFLICT DO NOTHING on gmail_message_id; the returned rows are only the new ones.
      const { data, error } = await db
        .from("email_ingest_log")
        .upsert(rows, { onConflict: "gmail_message_id", ignoreDuplicates: true })
        .select("id, gmail_message_id");
      if (error) throw new Error(error.message);
      return data ?? [];
    },

    async finish(id, processed: Processed, receivedAt) {
      try {
        // Apply first, record second: if matching fails, the row stays 'failed' and a re-parse retries it.
        const outcomes: AcceptOutcome[] = [];
        const jobOutcomes: JobOutcome[] = [];
        for (const a of processed.accepters) {
          const { data, error } = await db.rpc("apply_accept", {
            p_ingest_id: id,
            p_full_name: a.name,
            p_headline: a.headline,
            p_company_hint: a.companyHint,
            p_profile_url: a.profileUrl,
            p_profile_url_key: a.profileKey,
            p_photo_url: a.photoUrl,
            p_accepted_at: receivedAt.toISOString(),
          });
          if (error) throw new Error(error.message);
          outcomes.push(data as AcceptOutcome);
        }

        for (const job of processed.jobs) {
          const { data, error } = await db.rpc("upsert_job", upsertArgs(fromLinkedIn(job), receivedAt, id));
          if (error) throw new Error(error.message);
          jobOutcomes.push(data as JobOutcome);
        }

        const current = await db.from("email_ingest_log").select("parse_result").eq("id", id).single();
        if (current.error) throw new Error(current.error.message);
        const { error } = await db
          .from("email_ingest_log")
          .update({
            kind: processed.kind,
            parse_status: processed.parse_status,
            parse_error: processed.parse_error,
            parse_result: { ...(current.data.parse_result as Record<string, unknown>), ...processed.result, outcomes, job_outcomes: jobOutcomes },
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return { accepts: outcomes, jobs: jobOutcomes };
      } catch (e) {
        console.error("ingest: could not apply an email");
        await markFailed(id, `Could not apply: ${(e as Error).message}`).catch(() => {});
        return { accepts: [], jobs: [] };
      }
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
