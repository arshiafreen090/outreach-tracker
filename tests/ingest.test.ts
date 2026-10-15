import { describe, expect, it, vi } from "vitest";
import { MIN_SECRET_LENGTH, verifyBearer } from "@/lib/ingest/auth";
import type { Processed } from "@/lib/ingest/linkedin/process";
import { handleIngest, handlePing, MAX_STORED_BODY_CHARS, rowToProcessInput, toRow, type IngestRow, type IngestStore } from "@/lib/ingest/handler";
import { processEmail } from "@/lib/ingest/linkedin/process";
import { parseRawEmail } from "@/lib/ingest/mime";
import { LIMITS, parseIngestPayload } from "@/lib/ingest/payload";

const SECRET = "s".repeat(MIN_SECRET_LENGTH + 8);
const NOW = new Date("2026-10-16T12:00:00Z");

/** Builds a Gmail-API-style `raw` value: a CRLF RFC 2822 message, base64url encoded. */
function rawEmail(opts: { subject?: string; from?: string; html?: string; text?: string; extraHeaders?: string[] } = {}): string {
  const lines = [
    `From: ${opts.from ?? '"Priya Sharma via LinkedIn" <Invitations@LinkedIn.com>'}`,
    "To: me@example.com",
    `Subject: ${opts.subject ?? "Priya Sharma accepted your invitation"}`,
    "Date: Fri, 16 Oct 2026 10:00:00 +0000",
    "Message-ID: <abc123@example.com>",
    "Authentication-Results: mx.google.com; dkim=pass header.i=@linkedin.com; spf=pass; dmarc=pass",
    ...(opts.extraHeaders ?? []),
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="b1"',
    "",
    "--b1",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    opts.text ?? "Hello =E2=9C=93 Priya accepted",
    "--b1",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    opts.html ?? '<p>Hello <a href=3D"https://www.linkedin.com/in/priya-sharma/">Priya</a></p>',
    "--b1--",
    "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

const item = (id = "18f3a9c2d4e5b601", extra: Record<string, unknown> = {}) => ({ id, internal_date: String(NOW.getTime() - 1000), raw: rawEmail(), ...extra });

function request(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }, rawBody?: string) {
  return new Request("http://localhost/api/ingest", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: rawBody ?? JSON.stringify(body) });
}

function fakeStore(overrides: Partial<IngestStore> = {}) {
  const rows: IngestRow[] = [];
  const finished: { id: string; processed: Processed }[] = [];
  const store: IngestStore = {
    insert: vi.fn(async (r: IngestRow[]) => {
      rows.push(...r);
      return r.map((x, i) => ({ id: `row-${i}`, gmail_message_id: x.gmail_message_id }));
    }),
    finish: vi.fn(async (id: string, processed: Processed) => {
      finished.push({ id, processed });
      return processed.accepters.map(() => "unmatched" as const);
    }),
    ping: vi.fn(async () => ({ pruned: 2 })),
    ...overrides,
  };
  return { store, rows, finished };
}
const deps = (store: IngestStore, secret: string | undefined = SECRET) => ({ secret, getStore: () => store, now: () => NOW });

describe("verifyBearer", () => {
  it("accepts only the exact secret", () => {
    expect(verifyBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(verifyBearer(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(verifyBearer(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
    expect(verifyBearer(SECRET, SECRET)).toBe(false); // no scheme
    expect(verifyBearer(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(verifyBearer("Bearer ", SECRET)).toBe(false);
    expect(verifyBearer(null, SECRET)).toBe(false);
  });
  it("fails closed when the server secret is missing or weak", () => {
    expect(verifyBearer("Bearer abc", undefined)).toBe(false);
    expect(verifyBearer("Bearer ", "")).toBe(false);
    expect(verifyBearer("Bearer short", "short")).toBe(false);
  });
});

describe("parseIngestPayload", () => {
  it("accepts a valid batch, with the date as a string or a number", () => {
    const r = parseIngestPayload({ emails: [item("aaaaaa111111"), { ...item("bbbbbb222222"), internal_date: NOW.getTime() - 5 }] }, NOW);
    expect(r.ok && r.emails.map((e) => e.id)).toEqual(["aaaaaa111111", "bbbbbb222222"]);
  });
  it("keeps the first copy of a message id repeated in one batch", () => {
    const r = parseIngestPayload({ emails: [item("aaaaaa111111"), item("aaaaaa111111")] }, NOW);
    expect(r.ok && r.emails).toHaveLength(1);
  });
  it.each([
    ["not an object", "x"],
    ["no emails key", {}],
    ["emails not an array", { emails: "x" }],
    ["empty list", { emails: [] }],
    ["too many", { emails: Array.from({ length: LIMITS.maxEmails + 1 }, (_, i) => item(`id${String(i).padStart(8, "0")}`)) }],
    ["item not an object", { emails: ["x"] }],
    ["bad id", { emails: [item("bad id!")] }],
    ["short id", { emails: [item("abc")] }],
    ["date in seconds", { emails: [item("aaaaaa111111", { internal_date: "1760000000" })] }],
    ["date in the future", { emails: [item("aaaaaa111111", { internal_date: String(NOW.getTime() + 3 * 86_400_000) })] }],
    ["date before 2000", { emails: [item("aaaaaa111111", { internal_date: "100000000000" })] }],
    ["raw missing", { emails: [item("aaaaaa111111", { raw: undefined })] }],
    ["raw not base64url", { emails: [item("aaaaaa111111", { raw: "not base64!" })] }],
    ["raw is a number", { emails: [item("aaaaaa111111", { raw: 5 })] }],
  ])("rejects the whole request: %s", (_label, body) => {
    expect(parseIngestPayload(body, NOW).ok).toBe(false);
  });
  it("reports a single oversized email as rejected instead of failing the batch", () => {
    const r = parseIngestPayload({ emails: [item("aaaaaa111111"), item("bigone111111", { raw: "A".repeat(LIMITS.maxRawChars + 1) })] }, NOW);
    expect(r.ok && r.emails.map((e) => e.id)).toEqual(["aaaaaa111111"]);
    expect(r.ok && r.rejected).toEqual([{ id: "bigone111111", reason: "too large" }]);
  });
});

describe("parseRawEmail", () => {
  it("extracts sender, subject, both bodies and the auth verdict, decoding quoted-printable", async () => {
    const m = await parseRawEmail(rawEmail());
    expect(m.fromAddress).toBe("invitations@linkedin.com"); // lower-cased
    expect(m.fromName).toBe("Priya Sharma via LinkedIn");
    expect(m.subject).toBe("Priya Sharma accepted your invitation");
    expect(m.html).toContain('<a href="https://www.linkedin.com/in/priya-sharma/">Priya</a>');
    expect(m.text).toContain("Hello ✓ Priya accepted");
    expect(m.messageId).toContain("abc123@example.com");
    expect(m.authenticationResults).toContain("dkim=pass");
    expect(m.authenticationResults).toBe(m.authenticationResults?.toLowerCase());
  });
  it("decodes encoded-word subjects", async () => {
    const m = await parseRawEmail(rawEmail({ subject: "=?UTF-8?B?w4luw6lhIGFjY2VwdGVk?=" }));
    expect(m.subject).toBe("Énéa accepted");
  });
  it("copes with a message that has no sender or auth header", async () => {
    const bare = Buffer.from("Subject: hi\r\n\r\njust text", "utf8").toString("base64url");
    const m = await parseRawEmail(bare);
    expect(m.fromAddress).toBeNull();
    expect(m.authenticationResults).toBeNull();
    expect(m.text).toContain("just text");
    expect(m.html).toBeNull();
  });
});

describe("handleIngest", () => {
  it("rejects missing or wrong credentials without touching the store", async () => {
    const { store } = fakeStore();
    const getStore = vi.fn(() => store);
    const attempts: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }, { authorization: SECRET }];
    for (const headers of attempts) {
      const res = await handleIngest(request({ emails: [item()] }, headers), { secret: SECRET, getStore });
      expect(res.status).toBe(401);
    }
    expect(getStore).not.toHaveBeenCalled();
  });

  it("is closed entirely when the server has no secret configured", async () => {
    const { store } = fakeStore();
    const res = await handleIngest(request({ emails: [item()] }, { authorization: "Bearer anything" }), deps(store, undefined));
    expect(res.status).toBe(401);
  });

  it("stores emails raw, as not-yet-parsed rows with the right fields", async () => {
    const { store, rows } = fakeStore();
    const res = await handleIngest(request({ emails: [item("18f3a9c2d4e5b601")] }), deps(store));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, received: 1, inserted: 1, duplicates: 0, rejected: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      gmail_message_id: "18f3a9c2d4e5b601",
      from_address: "invitations@linkedin.com",
      subject: "Priya Sharma accepted your invitation",
      kind: "other",
      parse_status: "failed",
    });
    expect(rows[0]!.received_at).toBe(new Date(NOW.getTime() - 1000).toISOString());
    expect(rows[0]!.raw_body).toContain("linkedin.com/in/priya-sharma");
    expect(rows[0]!.parse_result).toMatchObject({ source: "gmail-api", body_kind: "html", truncated: false, from_name: "Priya Sharma via LinkedIn" });
  });

  it("reports duplicates the store skipped", async () => {
    const { store } = fakeStore({ insert: vi.fn(async () => [{ id: "r1", gmail_message_id: "aaaaaa111111" }]) });
    const res = await handleIngest(request({ emails: [item("aaaaaa111111"), item("bbbbbb222222")] }), deps(store));
    expect(await res.json()).toMatchObject({ received: 2, inserted: 1, duplicates: 1 });
  });

  it("truncates huge bodies and says so", async () => {
    const { store, rows } = fakeStore();
    const html = "<p>" + "x".repeat(MAX_STORED_BODY_CHARS + 500) + "</p>";
    await handleIngest(request({ emails: [{ id: "aaaaaa111111", internal_date: String(NOW.getTime()), raw: rawEmail({ html }) }] }), deps(store));
    expect(rows[0]!.raw_body!.length).toBe(MAX_STORED_BODY_CHARS);
    expect(rows[0]!.parse_result.truncated).toBe(true);
  });

  it("returns unreadable and oversized emails as rejected while storing the rest", async () => {
    const { store, rows } = fakeStore();
    const res = await handleIngest(
      request({ emails: [item("good00000001"), item("huge00000001", { raw: "A".repeat(LIMITS.maxRawChars + 1) })] }),
      deps(store),
    );
    expect(await res.json()).toMatchObject({ inserted: 1, rejected: [{ id: "huge00000001", reason: "too large" }] });
    expect(rows.map((r) => r.gmail_message_id)).toEqual(["good00000001"]);
  });

  it.each([
    ["not JSON", undefined, "{nope"],
    ["wrong shape", { emails: [] }, undefined],
    ["invalid id", { emails: [item("no good")] }, undefined],
  ])("answers 400 for %s", async (_l, body, raw) => {
    const { store } = fakeStore();
    const res = await handleIngest(request(body, undefined, raw), deps(store));
    expect(res.status).toBe(400);
    expect(store.insert).not.toHaveBeenCalled();
  });

  it("answers 413 for oversized requests, by header and by actual size", async () => {
    const { store } = fakeStore();
    const byHeader = await handleIngest(request({ emails: [item()] }, { authorization: `Bearer ${SECRET}`, "content-length": String(LIMITS.maxBodyChars + 1) }), deps(store));
    expect(byHeader.status).toBe(413);
    const bySize = await handleIngest(request(null, undefined, "x".repeat(LIMITS.maxBodyChars + 1)), deps(store));
    expect(bySize.status).toBe(413);
  });

  it("hides database errors from the caller", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = fakeStore({ insert: vi.fn(async () => { throw new Error('relation "email_ingest_log" secret detail'); }) });
    const res = await handleIngest(request({ emails: [item()] }), deps(store));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/relation|secret detail/);
    spy.mockRestore();
  });

  it("never caches responses", async () => {
    const { store } = fakeStore();
    const res = await handleIngest(request({ emails: [item()] }), deps(store));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("handlePing", () => {
  const ping = (headers?: Record<string, string>) => new Request("http://localhost/api/ingest/ping", { method: "POST", headers });

  it("requires the secret", async () => {
    const { store } = fakeStore();
    expect((await handlePing(ping(), deps(store))).status).toBe(401);
    expect(store.ping).not.toHaveBeenCalled();
  });
  it("pings and reports what was pruned", async () => {
    const { store } = fakeStore();
    const res = await handlePing(ping({ authorization: `Bearer ${SECRET}` }), deps(store));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pruned: 2 });
  });
  it("answers 500 without details when the database is unreachable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = fakeStore({ ping: vi.fn(async () => { throw new Error("connection refused 10.0.0.1"); }) });
    const res = await handlePing(ping({ authorization: `Bearer ${SECRET}` }), deps(store));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/10\.0\.0\.1/);
    spy.mockRestore();
  });
});

describe("handleIngest: processing what was stored", () => {
  const acceptHeaders = ["X-LinkedIn-Class: INVITE-ACCEPT", "X-LinkedIn-Template: email_accept_invite_single_01"];
  const accept = (id: string, opts: Parameters<typeof rawEmail>[0] = {}) => ({
    id,
    internal_date: String(NOW.getTime() - 1000),
    raw: rawEmail({ extraHeaders: acceptHeaders, ...opts }),
  });

  it("stores LinkedIn's own labels so a stored email can be re-processed later", async () => {
    const { store, rows } = fakeStore();
    await handleIngest(request({ emails: [accept("aaaaaa111111")] }), deps(store));
    expect(rows[0]!.parse_result).toMatchObject({ linkedin_class: "INVITE-ACCEPT", linkedin_template: "email_accept_invite_single_01" });
  });

  it("processes new emails and passes the accepted people on to be matched", async () => {
    const { store, finished } = fakeStore();
    const res = await handleIngest(request({ emails: [accept("aaaaaa111111")] }), deps(store));
    expect(finished).toHaveLength(1);
    expect(finished[0]!.processed).toMatchObject({ kind: "accept", parse_status: "parsed" });
    expect(finished[0]!.processed.accepters.map((a) => a.profileKey)).toEqual(["in/priya-sharma"]);
    expect(await res.json()).toMatchObject({ inserted: 1, accepts: { unmatched: 1, linked_url: 0, linked_name: 0, duplicate: 0 } });
  });

  it("does not process emails that were already stored", async () => {
    const { store, finished } = fakeStore({ insert: vi.fn(async () => []) });
    const res = await handleIngest(request({ emails: [accept("aaaaaa111111")] }), deps(store));
    expect(finished).toHaveLength(0);
    expect(await res.json()).toMatchObject({ inserted: 0, duplicates: 1 });
  });

  it("stores a forged 'LinkedIn' email but never lets it create an accept", async () => {
    const { store, finished } = fakeStore();
    await handleIngest(request({ emails: [accept("aaaaaa111111", { from: '"LinkedIn" <invitations@linkedin.com.evil.com>' })] }), deps(store));
    expect(finished[0]!.processed).toMatchObject({ kind: "other", parse_status: "ignored", accepters: [] });
  });

  it("still answers 200 if processing blows up, because the raw email is already safe", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, rows } = fakeStore({ finish: vi.fn(async () => { throw new Error("boom"); }) });
    const res = await handleIngest(request({ emails: [accept("aaaaaa111111")] }), deps(store));
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(1);
    spy.mockRestore();
  });

  it("rowToProcessInput rebuilds exactly what processing saw (so reparse agrees with ingest)", async () => {
    const { rows } = fakeStore();
    const { store } = fakeStore();
    await handleIngest(request({ emails: [accept("aaaaaa111111")] }), deps(store));
    const direct = await parseRawEmail(accept("aaaaaa111111").raw);
    const row = toRow({ id: "aaaaaa111111", internalDateMs: NOW.getTime(), raw: "" }, direct);
    rows.push(row);
    const viaRow = processEmail(rowToProcessInput(row));
    const viaMail = processEmail({ ...direct, html: direct.html });
    expect(viaRow).toEqual(viaMail);
  });
});
