import type { JobPosting } from "../ingest/linkedin/jobs";
import { safeHttpUrl } from "../urls";
import { classifyRole, isInternship, softKey } from "./classify";

/** What upsert_job returns. 'duplicate_soft' = the same opening was already stored from another source. */
export type JobOutcome = "inserted" | "duplicate" | "duplicate_soft";

/** A job from any source, before it is classified and stored. */
export interface NewJob {
  /** e.g. "linkedin-alert", "greenhouse:acme". With externalId it identifies the job. */
  source: string;
  externalId: string;
  title: string;
  company: string | null;
  location: string | null;
  workMode: string | null;
  url: string | null;
  /** The LinkedIn saved search that produced it. */
  savedSearch: string | null;
  /** The source's own label, e.g. Ashby's "Intern". */
  employmentType?: string | null;
  postedAt?: string | null;
}

export const LINKEDIN_ALERT_SOURCE = "linkedin-alert";

export function fromLinkedIn(job: JobPosting): NewJob {
  return {
    source: LINKEDIN_ALERT_SOURCE,
    externalId: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    workMode: job.workMode,
    url: job.url,
    savedSearch: job.alertTitle,
  };
}

const MAX_TITLE = 300;
const MAX_FIELD = 200;
const clip = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);

/**
 * The named arguments for the `upsert_job` database function. Classification, the internship
 * flag and the de-duplication key are computed here (in tested TypeScript), and the link is
 * kept only if it is a plain http(s) URL.
 */
export function upsertArgs(job: NewJob, foundAt: Date, ingestId: string | null): Record<string, unknown> {
  const title = job.title.trim().slice(0, MAX_TITLE);
  const company = clip(job.company, MAX_FIELD);
  const location = clip(job.location, MAX_FIELD);
  return {
    p_source: job.source,
    p_external_id: job.externalId,
    p_title: title,
    p_company: company,
    p_location: location,
    p_work_mode: clip(job.workMode, 50),
    p_url: safeHttpUrl(job.url),
    p_saved_search: clip(job.savedSearch, MAX_FIELD),
    p_role_family: classifyRole(title),
    p_is_internship: isInternship(title, job.employmentType),
    p_soft_key: softKey(company, title, location),
    p_posted_at: job.postedAt ?? null,
    p_found_at: foundAt.toISOString(),
    p_ingest_id: ingestId,
  };
}
