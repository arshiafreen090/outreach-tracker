import { handleIngest } from "@/lib/ingest/handler";
import { createIngestStore } from "@/lib/ingest/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Called by the Gmail Apps Script, not by a browser: it authenticates with the shared
// secret (see src/proxy.ts, which lets /api/ingest through for that reason).
export async function POST(request: Request) {
  return handleIngest(request, {
    secret: process.env.INGEST_SHARED_SECRET,
    getStore: () => createIngestStore(createAdminClient()),
  });
}
