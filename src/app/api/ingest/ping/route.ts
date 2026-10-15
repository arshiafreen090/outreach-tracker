import { handlePing } from "@/lib/ingest/handler";
import { createIngestStore } from "@/lib/ingest/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Daily keepalive from the Apps Script: a cheap database read so the free Supabase
// project never idles, plus pruning of old raw email bodies.
export async function POST(request: Request) {
  return handlePing(request, {
    secret: process.env.INGEST_SHARED_SECRET,
    getStore: () => createIngestStore(createAdminClient()),
  });
}
