import { parseAccepters, type Accepter } from "./accept";
import { classifyLinkedIn, type EmailKind } from "./classify";
import { parseJobAlert, type JobPosting } from "./jobs";

export interface ProcessInput {
  fromAddress: string | null;
  subject: string | null;
  html: string | null;
  text: string | null;
  authenticationResults: string | null;
  linkedinClass: string | null;
  linkedinTemplate: string | null;
}

export type ParseStatus = "parsed" | "partial" | "failed" | "ignored";

export interface Processed {
  kind: EmailKind;
  parse_status: ParseStatus;
  parse_error: string | null;
  /** Merged into email_ingest_log.parse_result. */
  result: Record<string, unknown>;
  /** To be matched against your requests (accept emails). */
  accepters: Accepter[];
  /** Listed in the email (job alerts). Saved to the jobs table in Phase 5. */
  jobs: JobPosting[];
}

/**
 * Looks at one stored email and decides what it is and what it says. Pure: no database, no
 * network. Unknown LinkedIn templates are kept (status "ignored") with their template name
 * recorded, so a parser can be added later and the stored email re-processed.
 */
export function processEmail(input: ProcessInput): Processed {
  const cls = classifyLinkedIn(input);
  const linkedin = { class: input.linkedinClass, template: input.linkedinTemplate, trusted: cls.trusted };
  const base = { kind: cls.kind, accepters: [] as Accepter[], jobs: [] as JobPosting[] };

  if (!cls.trusted) {
    return { ...base, kind: "other", parse_status: "ignored", parse_error: cls.untrustedReason, result: { linkedin } };
  }

  const body = input.html ?? "";

  if (cls.kind === "accept") {
    const accepters = body ? parseAccepters(body) : [];
    if (accepters.length === 0) {
      return {
        ...base,
        parse_status: "failed",
        parse_error: `Accept email (${input.linkedinTemplate ?? "unknown template"}) but no accepted person could be read from it`,
        result: { linkedin },
      };
    }
    return { ...base, accepters, parse_status: "parsed", parse_error: null, result: { linkedin, accepters } };
  }

  if (cls.kind === "job_alert") {
    const jobs = body ? parseJobAlert(body) : [];
    if (jobs.length === 0) {
      return {
        ...base,
        parse_status: "failed",
        parse_error: `Job alert (${input.linkedinTemplate ?? "unknown template"}) but no jobs could be read from it`,
        result: { linkedin },
      };
    }
    return { ...base, jobs, parse_status: "parsed", parse_error: null, result: { linkedin, jobs } };
  }

  if (cls.kind === "message") {
    return {
      ...base,
      parse_status: "failed",
      parse_error: `Message email (${input.linkedinTemplate ?? "unknown template"}): no parser yet, send a sample`,
      result: { linkedin },
    };
  }

  return { ...base, parse_status: "ignored", parse_error: null, result: { linkedin } };
}
