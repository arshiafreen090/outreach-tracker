import type { SupabaseClient } from "@supabase/supabase-js";
import type { PullStore, SourceRow } from "./pull";
import type { JobOutcome } from "./save";

/** The secret-key client's view of job sources and jobs. Call it only from authenticated server code. */
export function createPullStore(db: SupabaseClient, only?: { sourceId: string }): PullStore {
  return {
    async listSources() {
      let q = db.from("job_sources").select("id, kind, slug, label").eq("enabled", true);
      if (only) q = q.eq("id", only.sourceId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as SourceRow[];
    },
    async upsertJob(args) {
      const { data, error } = await db.rpc("upsert_job", args);
      if (error) throw new Error(error.message);
      return data as JobOutcome;
    },
    async recordPull(id, result, at) {
      const { error } = await db
        .from("job_sources")
        .update({ last_pulled_at: at.toISOString(), last_status: result.status, last_job_count: result.listed, last_new_count: result.added })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
