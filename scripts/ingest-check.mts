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

let failed = 0;
const step = (ok: boolean, name: string, detail = "") => {
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
    !error && data?.length === 1 && row?.from_address === "ingest-check@example.com" && String(row?.raw_body).includes(marker) && row?.parse_status === "failed",
    "Exactly one row in email_ingest_log, with sender and raw body",
    error?.message,
  );

  const ping = await post("/api/ingest/ping", {}, secret);
  step(ping.status === 200, "Keepalive ping works", `HTTP ${ping.status}`);
} catch (e) {
  step(false, "Check aborted", (e as Error).message);
} finally {
  await db.from("email_ingest_log").delete().eq("gmail_message_id", id);
  const left = await db.from("email_ingest_log").select("id").eq("gmail_message_id", id);
  step((left.data ?? []).length === 0, "Test row removed");
}

console.log(`\n${failed === 0 ? "Ingest endpoint works." : `${failed} step(s) failed.`}`);
process.exit(failed === 0 ? 0 : 1);
