import { handleSheet } from "@/lib/sheet/handler";
import { loadSheetData } from "@/lib/sheet/load";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Called by the Google Sheet's Apps Script, not a browser: it authenticates with the shared
// secret (see src/proxy.ts, which lets /api/sheet through for that reason).
export async function GET(request: Request) {
  return handleSheet(request, {
    secret: process.env.INGEST_SHARED_SECRET,
    load: () => loadSheetData(createAdminClient()),
  });
}
