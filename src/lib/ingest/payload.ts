/** Limits sized for Vercel's 4.5 MB request cap and the free-tier database. */
export const LIMITS = {
  /** Most emails in one request. */
  maxEmails: 20,
  /** Longest base64url string accepted per email (about 1.5 MB of raw message). */
  maxRawChars: 2_000_000,
  /** Whole request body, in characters. Vercel rejects bodies over 4.5 MB itself. */
  maxBodyChars: 4_000_000,
} as const;

export interface IncomingEmail {
  /** Gmail message id. Makes ingestion idempotent. */
  id: string;
  /** Gmail's internalDate: epoch milliseconds. */
  internalDateMs: number;
  /** The entire RFC 2822 message, base64url encoded (Gmail API `raw`). */
  raw: string;
}

export interface Rejected {
  id: string;
  reason: string;
}

export type PayloadResult =
  | { ok: true; emails: IncomingEmail[]; rejected: Rejected[] }
  | { ok: false; error: string };

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const YEAR_2000_MS = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;

/**
 * Validates the JSON the Apps Script sends:
 *   { "emails": [ { "id": "...", "internal_date": "1760000000000", "raw": "<base64url>" } ] }
 * A malformed request is rejected as a whole. A single oversized email is reported in
 * `rejected` instead, so one huge message can never block the rest of the sync.
 */
export function parseIngestPayload(json: unknown, now: Date = new Date()): PayloadResult {
  if (typeof json !== "object" || json === null || !Array.isArray((json as { emails?: unknown }).emails)) {
    return { ok: false, error: "Expected an object with an `emails` array." };
  }
  const list = (json as { emails: unknown[] }).emails;
  if (list.length === 0) return { ok: false, error: "`emails` is empty." };
  if (list.length > LIMITS.maxEmails) return { ok: false, error: `At most ${LIMITS.maxEmails} emails per request.` };

  const emails: IncomingEmail[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();

  for (const [index, item] of list.entries()) {
    const where = `emails[${index}]`;
    if (typeof item !== "object" || item === null) return { ok: false, error: `${where} must be an object.` };
    const { id, internal_date, raw } = item as Record<string, unknown>;

    if (typeof id !== "string" || !ID.test(id)) return { ok: false, error: `${where}.id is not a valid message id.` };
    if (seen.has(id)) continue; // same message twice in one batch: keep the first
    seen.add(id);

    const ms = typeof internal_date === "number" ? internal_date : typeof internal_date === "string" && /^\d{10,16}$/.test(internal_date) ? Number(internal_date) : NaN;
    if (!Number.isFinite(ms) || ms < YEAR_2000_MS || ms > now.getTime() + DAY_MS) {
      return { ok: false, error: `${where}.internal_date must be epoch milliseconds.` };
    }

    if (typeof raw !== "string" || raw.length === 0 || !BASE64URL.test(raw)) {
      return { ok: false, error: `${where}.raw must be a base64url string.` };
    }
    if (raw.length > LIMITS.maxRawChars) {
      rejected.push({ id, reason: "too large" });
      continue;
    }
    emails.push({ id, internalDateMs: ms, raw });
  }
  return { ok: true, emails, rejected };
}
