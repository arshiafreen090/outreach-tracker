import { handlePull } from "@/lib/jobs/handler";
import { pullAll } from "@/lib/jobs/pull";
import { createPullStore } from "@/lib/jobs/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Boards are fetched a few at a time with a 10 second limit each; Vercel's Hobby limit is 300 s.
export const maxDuration = 300;

// Called once a day by the Gmail forwarder's Apps Script (shared secret), not by a browser.
export async function POST(request: Request) {
  return handlePull(request, {
    secret: process.env.INGEST_SHARED_SECRET,
    pull: () => pullAll(createPullStore(createAdminClient())),
  });
}
