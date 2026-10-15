import { verifyBearer } from "./auth";
import { processEmail, type Processed } from "./linkedin/process";
import { parseRawEmail, type ParsedEmail } from "./mime";
import { LIMITS, parseIngestPayload, type IncomingEmail, type Rejected } from "./payload";

/** A row of email_ingest_log as first stored: raw, not yet interpreted. */
export interface IngestRow {
  gmail_message_id: string;
  received_at: string;
  from_address: string | null;
  subject: string | null;
  kind: "other";
  parse_status: "failed";
  parse_error: string;
  raw_body: string | null;
  parse_result: Record<string, unknown>;
}

/** How each accepted person in an email was handled (see apply_accept in migration 0004). */
export type AcceptOutcome = "linked_url" | "linked_name" | "unmatched" | "duplicate";

export interface IngestStore {
  /** Inserts rows, silently skipping message ids already stored. Returns only the rows that were new. */
  insert(rows: IngestRow[]): Promise<{ id: string; gmail_message_id: string }[]>;
  /**
   * Records what an email turned out to be and applies it: accepted people are matched to your
   * requests. Never throws: a failure is written onto the stored row so the raw email is kept
   * and can be re-processed later.
   */
  finish(id: string, processed: Processed, receivedAt: Date): Promise<AcceptOutcome[]>;
  /** Cheap database read (keeps the free project awake) plus pruning of old raw bodies. */
  ping(): Promise<{ pruned: number }>;
}

export interface IngestDeps {
  secret: string | undefined;
  /** Created lazily so unauthenticated requests never touch the database. */
  getStore: () => IngestStore;
  now?: () => Date;
}

/** Longest body kept per email. The rest is dropped and `truncated` is recorded. */
export const MAX_STORED_BODY_CHARS = 400_000;

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const unauthorized = () => json(401, { ok: false, error: "Unauthorized." });

export function toRow(email: IncomingEmail, parsed: ParsedEmail): IngestRow {
  const body = parsed.html ?? parsed.text;
  return {
    gmail_message_id: email.id,
    received_at: new Date(email.internalDateMs).toISOString(),
    from_address: parsed.fromAddress,
    subject: parsed.subject ? parsed.subject.slice(0, 998) : null,
    kind: "other",
    parse_status: "failed",
    parse_error: "Not parsed yet: no parser has looked at this email",
    raw_body: body ? body.slice(0, MAX_STORED_BODY_CHARS) : null,
    parse_result: {
      source: "gmail-api",
      body_kind: parsed.html ? "html" : parsed.text ? "text" : "none",
      truncated: body ? body.length > MAX_STORED_BODY_CHARS : false,
      from_name: parsed.fromName,
      message_id: parsed.messageId,
      authentication_results: parsed.authenticationResults,
      linkedin_class: parsed.linkedinClass,
      linkedin_template: parsed.linkedinTemplate,
    },
  };
}

/** What the processor needs, rebuilt from a stored row (also used by `npm run reparse`). */
export function rowToProcessInput(row: {
  from_address: string | null;
  subject: string | null;
  raw_body: string | null;
  parse_result: Record<string, unknown> | null;
}) {
  const r = row.parse_result ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const kind = str(r.body_kind);
  return {
    fromAddress: row.from_address,
    subject: row.subject,
    html: kind === "html" ? row.raw_body : null,
    text: kind === "text" ? row.raw_body : null,
    authenticationResults: str(r.authentication_results),
    linkedinClass: str(r.linkedin_class),
    linkedinTemplate: str(r.linkedin_template),
  };
}

export async function handleIngest(request: Request, deps: IngestDeps): Promise<Response> {
  if (!verifyBearer(request.headers.get("authorization"), deps.secret)) return unauthorized();

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LIMITS.maxBodyChars) return json(413, { ok: false, error: "Request too large." });
  const text = await request.text();
  if (text.length > LIMITS.maxBodyChars) return json(413, { ok: false, error: "Request too large." });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, error: "Body is not valid JSON." });
  }

  const payload = parseIngestPayload(body, deps.now?.());
  if (!payload.ok) return json(400, { ok: false, error: payload.error });

  const rejected: Rejected[] = [...payload.rejected];
  const rows: IngestRow[] = [];
  const received = new Map<string, Date>();
  for (const email of payload.emails) {
    try {
      rows.push(toRow(email, await parseRawEmail(email.raw)));
      received.set(email.id, new Date(email.internalDateMs));
    } catch {
      rejected.push({ id: email.id, reason: "unreadable message" });
    }
  }

  try {
    const store = rows.length > 0 ? deps.getStore() : null;
    const fresh = store ? await store.insert(rows) : [];

    // Only emails stored for the first time are processed; repeats were handled the first time.
    const byMessage = new Map(rows.map((r) => [r.gmail_message_id, r]));
    const accepts: Record<AcceptOutcome, number> = { linked_url: 0, linked_name: 0, unmatched: 0, duplicate: 0 };
    let jobsSeen = 0;
    for (const { id, gmail_message_id } of fresh) {
      const row = byMessage.get(gmail_message_id);
      if (!row || !store) continue;
      try {
        const processed = processEmail(rowToProcessInput(row));
        jobsSeen += processed.jobs.length;
        for (const outcome of await store.finish(id, processed, received.get(gmail_message_id) ?? new Date())) accepts[outcome]++;
      } catch {
        // The raw email is already stored; `npm run reparse` can process it again.
        console.error("ingest: processing failed for one email");
      }
    }

    return json(200, {
      ok: true,
      received: payload.emails.length + payload.rejected.length,
      inserted: fresh.length,
      duplicates: rows.length - fresh.length,
      rejected,
      accepts,
      jobsSeen,
    });
  } catch {
    // Details stay in the server log; the caller (and anyone probing) gets nothing useful.
    console.error("ingest: database write failed");
    return json(500, { ok: false, error: "Could not store the emails." });
  }
}

export async function handlePing(request: Request, deps: IngestDeps): Promise<Response> {
  if (!verifyBearer(request.headers.get("authorization"), deps.secret)) return unauthorized();
  try {
    const { pruned } = await deps.getStore().ping();
    return json(200, { ok: true, pruned });
  } catch {
    console.error("ingest: ping failed");
    return json(500, { ok: false, error: "Ping failed." });
  }
}
