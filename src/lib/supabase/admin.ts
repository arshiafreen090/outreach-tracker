import { createClient } from "@supabase/supabase-js";

/**
 * A client with the secret key: it bypasses RLS, so it is for trusted server code only
 * (the shared-secret ingest routes). Never import this from a component.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
