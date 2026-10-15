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
const TARGET_KEY = "in/smoke-test-link-target";
const CAND_KEYS = { link: "in/smoke-test-cand-link", create: "in/smoke-test-cand-create", dismiss: "in/smoke-test-cand-dismiss" };

let failed = 0;
function step(ok: boolean, name: string, detail = "") {
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failed++;
}

async function cleanup() {
  await admin.from("people").delete().in("profile_url_key", [KEY, TARGET_KEY, ...Object.values(CAND_KEYS)]); // cascades events and messages
  await admin.from("accept_candidates").delete().in("profile_url_key", Object.values(CAND_KEYS));
  await admin.from("companies").delete().eq("name", COMPANY);
}

async function overview(id: string) {
  const { data, error } = await owner.from("people_overview").select("*").eq("id", id).single();
  if (error) throw new Error(`people_overview: ${error.message}`);
  return data as { status: string; company_id: string | null; requested_at: string | null; accepted_at: string | null; last_messaged_at: string | null; last_replied_at: string | null; messages_sent_count: number; follow_ups_count: number };
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

  // Replies and follow-ups, as the signed-in owner (needs migration 0005)
  const gone = "00000000-0000-0000-0000-000000000000";
  const available = await owner.rpc("set_person_status", { p_person_id: gone, p_status: "new" });
  if (!String(available.error?.message).includes("person_not_found")) {
    step(false, "Follow-ups", `migration 0005 is not applied (${available.error?.message ?? "unexpected"})`);
  } else {
    const messagedAt = (await overview(id)).last_messaged_at;
    const followed = await owner.rpc("mark_followed_up", { p_person_id: id });
    o = await overview(id);
    step(!followed.error && o.follow_ups_count === 1 && o.messages_sent_count === 2 && Boolean(o.last_messaged_at && messagedAt && o.last_messaged_at >= messagedAt), "mark_followed_up restarts the clock and counts one follow-up", followed.error?.message);

    const replied = await owner.rpc("mark_replied", { p_person_id: id });
    o = await overview(id);
    step(!replied.error && o.status === "replied" && Boolean(o.last_replied_at), "mark_replied moves them to Replied", replied.error?.message);

    const late = await owner.rpc("mark_followed_up", { p_person_id: id });
    step(Boolean(late.error?.message.includes("not_awaiting_reply")), "You can't follow up someone who already replied", late.error?.message ?? "it succeeded");

    const interview = await owner.rpc("set_person_status", { p_person_id: id, p_status: "interview" });
    const again = await owner.rpc("mark_replied", { p_person_id: id });
    o = await overview(id);
    step(!interview.error && !again.error && o.status === "interview", "set_person_status works, and a later reply never pulls them back", interview.error?.message ?? again.error?.message);
  }

  // Unknown accepts: the three buttons on that page, as the signed-in owner (needs migration 0004)
  const probe = await admin.from("accept_candidates").select("id").limit(1);
  if (probe.error) {
    step(false, "Unknown accepts", `migration 0004 is not applied (${probe.error.message})`);
  } else {
    const candidate = async (key: string, name: string) => {
      const r = await admin.rpc("apply_accept", {
        p_ingest_id: null, p_full_name: name, p_headline: "Tester @Smoke", p_company_hint: "Smoke Test Co",
        p_profile_url: `https://www.linkedin.com/${key}/`, p_profile_url_key: key, p_photo_url: null, p_accepted_at: new Date().toISOString(),
      });
      const row = await admin.from("accept_candidates").select("id").eq("profile_url_key", key).single();
      return { result: r.data as string, id: row.data?.id as string };
    };

    const target = await owner.rpc("log_request", {
      p_full_name: "Smoke Link Target", p_profile_url: `https://www.linkedin.com/${TARGET_KEY}/`, p_profile_url_key: TARGET_KEY,
      p_role: null, p_company_name: null, p_company_category: "other_relevant", p_requested_at: new Date().toISOString(),
    });
    const a = await candidate(CAND_KEYS.link, "Smoke Candidate Link");
    step(a.result === "unmatched", "A stranger's accept is held as unmatched", a.result);
    const linked = await owner.rpc("link_accept", { p_candidate_id: a.id, p_person_id: target.data as string });
    const targetAfter = await owner.from("people_overview").select("status, accepted_at").eq("id", target.data as string).single();
    step(!linked.error && targetAfter.data?.status === "accepted", "Owner can link it to a request (link_accept)", linked.error?.message);
    const again = await owner.rpc("link_accept", { p_candidate_id: a.id, p_person_id: target.data as string });
    step(Boolean(again.error?.message.includes("candidate_not_unmatched")), "Resolving it twice is refused", again.error?.message ?? "it succeeded");

    const b = await candidate(CAND_KEYS.create, "Smoke Candidate Create");
    const created = await owner.rpc("create_person_from_accept", { p_candidate_id: b.id, p_company_name: COMPANY, p_company_category: "small_startup" });
    const createdRow = await owner.from("people_overview").select("status, role, company_id, profile_url_key").eq("id", created.data as string).single();
    step(!created.error && createdRow.data?.status === "accepted" && createdRow.data?.role === "Tester @Smoke" && Boolean(createdRow.data?.company_id) && createdRow.data?.profile_url_key === CAND_KEYS.create, "Owner can add it as a new Accepted person (create_person_from_accept)", created.error?.message);

    const c = await candidate(CAND_KEYS.dismiss, "Smoke Candidate Dismiss");
    const dismissed = await owner.rpc("dismiss_accept", { p_candidate_id: c.id });
    const dismissedRow = await owner.from("accept_candidates").select("status").eq("id", c.id).single();
    step(!dismissed.error && dismissedRow.data?.status === "dismissed", "Owner can dismiss it (dismiss_accept)", dismissed.error?.message);

    const blocked = await owner.rpc("apply_accept", {
      p_ingest_id: null, p_full_name: "x", p_headline: null, p_company_hint: null, p_profile_url: "https://x", p_profile_url_key: "in/smoke-forbidden",
      p_photo_url: null, p_accepted_at: new Date().toISOString(),
    });
    step(Boolean(blocked.error), "A signed-in user cannot call apply_accept (ingest route only)", blocked.error?.message ?? "it succeeded");
  }

  await owner.auth.signOut();
} catch (e) {
  step(false, "Smoke test aborted", (e as Error).message);
} finally {
  await cleanup();
  const left = await admin.from("people").select("id", { count: "exact" }).eq("profile_url_key", KEY);
  const leftCompany = await admin.from("companies").select("id", { count: "exact" }).eq("name", COMPANY);
  const leftCandidates = await admin.from("accept_candidates").select("id").in("profile_url_key", Object.values(CAND_KEYS));
  step((left.data ?? []).length === 0 && (leftCompany.data ?? []).length === 0 && (leftCandidates.data ?? []).length === 0, "Test rows removed");
}

console.log(`\n${failed === 0 ? "Smoke test passed." : `${failed} step(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
