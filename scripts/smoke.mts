/**
 * End-to-end smoke test of the live database as the signed-in owner.
 *   npm run smoke
 * Uses the secret key to have Supabase issue a one-time session for ALLOWED_EMAIL (no password,
 * no email sent), then runs the real flow through the same API the dashboard uses: log a request,
 * duplicate guard, mark accepted, mark sent, duplicate-send guard. It writes one clearly labelled
 * fake person and company and removes them again (also at the start, in case an earlier run died).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const email = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
if (!url || !publishable || !secret || !email) {
  console.error("Missing Supabase env values. Run `npm run setup:env` first.");
  process.exit(1);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, options);
const owner = createClient(url, publishable, options);

const KEY = "in/smoke-test-do-not-keep";
const COMPANY = "Smoke Test Co";
const MESSAGE = "smoke test message with trailing spaces   ";

let failed = 0;
function step(ok: boolean, name: string, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failed++;
}

async function cleanup() {
  await admin.from("people").delete().eq("profile_url_key", KEY); // cascades events and messages
  await admin.from("companies").delete().eq("name", COMPANY);
}

async function overview(id: string) {
  const { data, error } = await owner.from("people_overview").select("*").eq("id", id).single();
  if (error) throw new Error(`people_overview: ${error.message}`);
  return data as { status: string; company_id: string | null; requested_at: string | null; accepted_at: string | null; last_messaged_at: string | null; messages_sent_count: number };
}

try {
  await cleanup();

  // A real session for the owner, issued by Supabase's admin API.
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) throw new Error(`Could not issue a session: ${link.error?.message ?? "no token"}`);
  const session = await owner.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  step(!session.error && Boolean(session.data.session), "Owner session issued", session.error?.message);
  if (session.error) throw new Error("No session; cannot continue.");

  // RLS with a real token
  const tpl = await owner.from("templates_current").select("template_id, key, version, body").eq("key", "template_2").maybeSingle();
  step(Boolean(tpl.data) && !tpl.error, "Owner can read templates (RLS + owner gate with a real JWT)", tpl.error?.message);
  const hidden = await owner.from("app_owner").select("*");
  step(Boolean(hidden.error), "Owner cannot read app_owner directly", hidden.error?.message ?? "it returned rows");
  if (!tpl.data) throw new Error("Template 2 is not readable; cannot continue.");

  // log_request
  const args = {
    p_full_name: "Smoke Test (safe to delete)",
    p_profile_url: `https://www.linkedin.com/${KEY}/`,
    p_profile_url_key: KEY,
    p_role: "Tester",
    p_company_name: COMPANY,
    p_company_category: "quick_commerce",
    p_requested_at: new Date().toISOString(),
  };
  const logged = await owner.rpc("log_request", args);
  step(!logged.error && typeof logged.data === "string", "log_request", logged.error?.message);
  const id = logged.data as string;
  const dup = await owner.rpc("log_request", args);
  step(dup.error?.code === "23505", "log_request rejects the same profile twice", dup.error?.message ?? "it succeeded");

  let o = await overview(id);
  step(o.status === "requested" && Boolean(o.requested_at) && Boolean(o.company_id), "Person is 'requested' with a date and company");

  // mark_accepted
  const accepted = await owner.rpc("mark_accepted", { p_person_id: id });
  o = await overview(id);
  step(!accepted.error && o.status === "accepted" && Boolean(o.accepted_at), "mark_accepted", accepted.error?.message);

  // mark_message_sent + duplicate guard
  const send = (allow: boolean) =>
    owner.rpc("mark_message_sent", {
      p_person_id: id,
      p_template_id: tpl.data!.template_id,
      p_template_version: tpl.data!.version,
      p_final_text: MESSAGE,
      p_allow_duplicate: allow,
    });
  const first = await send(false);
  o = await overview(id);
  step(!first.error && o.status === "messaged" && o.messages_sent_count === 1 && Boolean(o.last_messaged_at), "mark_message_sent", first.error?.message);
  const second = await send(false);
  step(Boolean(second.error?.message.includes("already_messaged")), "Second send is blocked (already_messaged)", second.error?.message ?? "it succeeded");
  const forced = await send(true);
  o = await overview(id);
  step(!forced.error && o.messages_sent_count === 2, "Second send goes through once explicitly allowed", forced.error?.message);

  const stored = await owner.from("messages_sent").select("final_text, template_version").eq("person_id", id);
  step(
    (stored.data ?? []).length === 2 && (stored.data ?? []).every((m) => m.final_text === MESSAGE && m.template_version === tpl.data!.version),
    "Stored message text is exactly what was sent, with its template version",
    stored.error?.message,
  );

  await owner.auth.signOut();
} catch (e) {
  step(false, "Smoke test aborted", (e as Error).message);
} finally {
  await cleanup();
  const left = await admin.from("people").select("id", { count: "exact" }).eq("profile_url_key", KEY);
  const leftCompany = await admin.from("companies").select("id", { count: "exact" }).eq("name", COMPANY);
  step((left.data ?? []).length === 0 && (leftCompany.data ?? []).length === 0, "Test rows removed");
}

console.log(`\n${failed === 0 ? "Smoke test passed." : `${failed} step(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
