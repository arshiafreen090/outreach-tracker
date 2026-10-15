import { redirect } from "next/navigation";
import { isAllowedEmail } from "./auth-rules";
import { createClient } from "./supabase/server";

/**
 * The signed-in user's Supabase client, or null unless the verified JWT's email
 * is the single ALLOWED_EMAIL. getClaims() validates the token signature, unlike
 * getSession(), which only reads the cookie.
 */
export async function getAuthedClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email;
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL)) return null;
  return { supabase, email: email as string };
}

/** For pages and layouts: bounce to /login when not allowed. */
export async function requireAuthed() {
  const authed = await getAuthedClient();
  if (!authed) redirect("/login");
  return authed;
}
