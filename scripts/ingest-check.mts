/**
 * End-to-end check of the Gmail forwarder's endpoint, as the Apps Script would call it.
 *   npm run ingest:check                              (against http://localhost:3000, `npm run dev` running)
 *   npm run ingest:check -- https://your-app.vercel.app   (after deploying)
 * Posts one synthetic email, posts it again, confirms it is stored once in your database, then
 * deletes it. It never touches Gmail or LinkedIn.
 */
import { createClient } from "@supabase/supabase-js";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = process.env.INGEST_SHARED_SECRET;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!secret || !url || !key) {
  console.error("INGEST_SHARED_SECRET, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const id = `ingestcheck${Date.now()}`;
const marker = `ingest-check-marker-${Date.now()}`;

const raw = Buffer.from(
  [
    'From: "Ingest Check" <ingest-check@example.com>',
    "To: me@example.com",
    "Subject: Synthetic ingest check (safe to delete)",
    "Date: Fri, 16 Oct 2026 10:00:00 +0000",
    "Message-ID: <ingest-check@example.com>",
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    `<p>${marker}</p>`,
    "",
  ].join("\r\n"),
  "utf8",
).toString("base64url");

const stamp = Date.now();
const KNOWN_KEY = `in/ingest-check-known-${stamp}`;
const UNKNOWN_KEY = `in/ingest-check-unknown-${stamp}`;
const ACCEPT_KNOWN_ID = `ingestcheckaccept${stamp}a`;
const ACCEPT_UNKNOWN_ID = `ingestcheckaccept${stamp}b`;

/** A minimal "accepted your invitation" email shaped like LinkedIn's, with Gmail-style verification headers. */
function acceptEmail(key: string, name: string): string {
  const slug = key.replace(/^in\//, "");
  return Buffer.from(
    [
      `From: "${name} via LinkedIn" <invitations@linkedin.com>`,
      "To: me@example.com",
      `Subject: ${name} accepted your invitation`,
      "Date: Fri, 16 Oct 2026 10:00:00 +0000",
      `Message-ID: <${slug}@example.com>`,
      "Authentication-Results: mx.google.com; dkim=pass header.i=@linkedin.com header.s=x; spf=pass; dmarc=pass header.from=linkedin.com",
      "X-LinkedIn-Class: INVITE-ACCEPT",
      "X-LinkedIn-Template: email_accept_invite_single_01",
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      `<a href="https://in.linkedin.com/comm/in/${slug}?trk=x"><img alt="${name}’s Profile Picture" src="https://media.licdn.com/dms/image/v2/ZZZ/profile-displayphoto-scale_400_400/B/0/1?e=1&v=beta&t=tok"></a>`,
      `<a href="https://in.linkedin.com/comm/in/${slug}?trk=x"> ${name} </a>`,
      "<table><tr><td> Tester @CheckCo | QA </td></tr></table>",
      '<a href="https://www.linkedin.com/comm/messaging/compose/X">Message</a>',
      "",
    ].join("\r\n"),
    "utf8",
  ).toString("base64url");
}

let failed = 0;
const step =(ok: boolean, name: string, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failed++;
};

const post = (path: string, body: unknown, token: string | null) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    redirect: "manual",
  });

const payload = { emails: [{ id, internal_date: String(Date.now()), raw }] };

try {
  const noAuth = await post("/api/ingest", payload, null);
  step(noAuth.status === 401, "Request without the secret is refused", `HTTP ${noAuth.status}`);
  const wrong = await post("/api/ingest", payload, "x".repeat(40));
  step(wrong.status === 401, "Request with a wrong secret is refused", `HTTP ${wrong.status}`);

  const first = await post("/api/ingest", payload, secret);
  const firstBody = (await first.json().catch(() => ({}))) as { inserted?: number; duplicates?: number };
  step(first.status === 200 && firstBody.inserted === 1, "Valid email is accepted and stored", `HTTP ${first.status} ${JSON.stringify(firstBody)}`);

  const again = await post("/api/ingest", payload, secret);
  const againBody = (await again.json().catch(() => ({}))) as { inserted?: number; duplicates?: number };
  step(again.status === 200 && againBody.inserted === 0 && againBody.duplicates === 1, "Sending it again stores nothing new", JSON.stringify(againBody));

  const { data, error } = await db.from("email_ingest_log").select("*").eq("gmail_message_id", id);
  const row = data?.[0];
  step(
    !error && data?.length === 1 && row?.from_address === "ingest-check@example.com" && String(row?.raw_body).includes(marker) && row?.parse_status === "ignored" && row?.kind === "other",
    "Exactly one row in email_ingest_log, with sender and raw body, ignored as non-LinkedIn mail",
    error?.message,
  );

  const ping = await post("/api/ingest/ping", {}, secret);
  step(ping.status === 200, "Keepalive ping works", `HTTP ${ping.status}`);

  // ---- the accept flow, as LinkedIn's emails would drive it (fake people, removed afterwards)
  const probe = await db.from("accept_candidates").select("id").limit(1);
  if (probe.error) {
    step(false, "Accept flow", `migration 0004 is not applied (${probe.error.message}). Run: npm run sql:copy:latest`);
  } else {
    const logged = await db.rpc("log_request", {
      p_full_name: "Ingest Check Person",
      p_profile_url: `https://www.linkedin.com/${KNOWN_KEY}/`,
      p_profile_url_key: KNOWN_KEY,
      p_role: null,
      p_company_name: null,
      p_company_category: "other_relevant",
      p_requested_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    step(!logged.error, "Fake request logged for the accept test", logged.error?.message);
    const personId = logged.data as string;

    const matched = await post("/api/ingest", { emails: [{ id: ACCEPT_KNOWN_ID, internal_date: String(Date.now()), raw: acceptEmail(KNOWN_KEY, "Ingest Check Person") }] }, secret);
    const matchedBody = (await matched.json().catch(() => ({}))) as { accepts?: Record<string, number> };
    step(matched.status === 200 && matchedBody.accepts?.linked_url === 1, "An accept for a request you logged is matched by profile URL", JSON.stringify(matchedBody.accepts));

    const me = await db.from("people_overview").select("status, photo_url, role, accepted_at").eq("id", personId).single();
    step(
      me.data?.status === "accepted" && String(me.data?.photo_url).includes("profile-displayphoto") && me.data?.role === "Tester @CheckCo | QA" && Boolean(me.data?.accepted_at),
      "The person is now Accepted, with the email's photo and headline",
      me.error?.message ?? JSON.stringify(me.data),
    );
    const ev = await db.from("outreach_events").select("type, source").eq("person_id", personId).eq("type", "accepted");
    step(ev.data?.length === 1 && ev.data[0]?.source === "email", "Exactly one 'accepted' event, sourced from the email");

    const logRow = await db.from("email_ingest_log").select("kind, parse_status").eq("gmail_message_id", ACCEPT_KNOWN_ID).single();
    step(logRow.data?.kind === "accept" && logRow.data?.parse_status === "parsed", "The stored email is classified and marked parsed", JSON.stringify(logRow.data));

    const unknown = await post("/api/ingest", { emails: [{ id: ACCEPT_UNKNOWN_ID, internal_date: String(Date.now()), raw: acceptEmail(UNKNOWN_KEY, "Nobody Known") }] }, secret);
    const unknownBody = (await unknown.json().catch(() => ({}))) as { accepts?: Record<string, number> };
    step(unknown.status === 200 && unknownBody.accepts?.unmatched === 1, "An accept for someone you never logged becomes an unknown accept", JSON.stringify(unknownBody.accepts));
    const cand = await db.from("accept_candidates").select("status, company_hint").eq("profile_url_key", UNKNOWN_KEY).single();
    step(cand.data?.status === "unmatched" && cand.data?.company_hint === "CheckCo", "It waits as 'unmatched', with the company guess", JSON.stringify(cand.data));
  }
} catch (e) {
  step(false, "Check aborted", (e as Error).message);
} finally {
  await db.from("email_ingest_log").delete().in("gmail_message_id", [id, ACCEPT_KNOWN_ID, ACCEPT_UNKNOWN_ID]);
  await db.from("accept_candidates").delete().in("profile_url_key", [KNOWN_KEY, UNKNOWN_KEY]);
  await db.from("people").delete().eq("profile_url_key", KNOWN_KEY);
  const left = await db.from("email_ingest_log").select("id").in("gmail_message_id", [id, ACCEPT_KNOWN_ID, ACCEPT_UNKNOWN_ID]);
  const leftPeople = await db.from("people").select("id").eq("profile_url_key", KNOWN_KEY);
  step((left.data ?? []).length === 0 && (leftPeople.data ?? []).length === 0, "Test rows removed");
}

console.log(`\n${failed === 0 ? "Ingest endpoint works." : `${failed} step(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
