import type { NewJob } from "./save";

/**
 * Companies' public job boards. Each of these ATS vendors documents a public, read-only,
 * credential-free listing API (verified in the vendors' own docs):
 *   Greenhouse  GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs
 *   Lever       GET https://api.lever.co/v0/postings/{site}?mode=json
 *   Ashby       GET https://api.ashbyhq.com/posting-api/job-board/{name}
 * Only these fixed hosts are ever called; the only thing you supply is the board's short name.
 */
export const SOURCE_KINDS = ["greenhouse", "lever", "ashby"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const KIND_LABELS: Record<SourceKind, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" };

export const isSourceKind = (v: unknown): v is SourceKind => typeof v === "string" && (SOURCE_KINDS as readonly string[]).includes(v);

/** Same rule as the job_sources.slug database constraint. */
export const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function sourceUrl(kind: SourceKind, slug: string): string {
  if (!SLUG.test(slug)) throw new Error("Invalid board name.");
  const s = encodeURIComponent(slug);
  switch (kind) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`;
    case "lever":
      return `https://api.lever.co/v0/postings/${s}?mode=json`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${s}`;
  }
}

/**
 * You can paste either the board's short name or its careers-page address
 * (boards.greenhouse.io/acme, jobs.lever.co/acme, jobs.ashbyhq.com/acme): the first part of the
 * path is the name. The result is still checked against SLUG before anything is called.
 */
export function boardNameFromInput(input: string): string {
  const t = input.trim();
  if (!/[/:]/.test(t)) return t;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    return url.pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    return t;
  }
}

/** The `source` stored on each job, e.g. "greenhouse:acme". */
export const sourceName = (kind: SourceKind, slug: string) => `${kind}:${slug.toLowerCase()}`;

// ---------------------------------------------------------------- mapping

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

const WORK_MODE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", "on-site": "On-site", onsite: "On-site" };
const workMode = (v: unknown): string | null => WORK_MODE[String(v ?? "").toLowerCase()] ?? null;

function jobsArray(json: unknown, kind: SourceKind): unknown[] {
  const list = kind === "lever" ? json : obj(json)?.jobs;
  if (!Array.isArray(list)) throw new Error("Unexpected response from the job board.");
  return list;
}

/** Maps one board's JSON to jobs. Entries missing a title, id or link are skipped, never guessed at. */
export function mapJobs(kind: SourceKind, json: unknown, company: string | null): Omit<NewJob, "source">[] {
  const out: Omit<NewJob, "source">[] = [];
  for (const raw of jobsArray(json, kind)) {
    const j = obj(raw);
    if (!j) continue;

    if (kind === "greenhouse") {
      const id = typeof j.id === "number" || typeof j.id === "string" ? String(j.id) : null;
      const title = str(j.title);
      const url = str(j.absolute_url);
      if (!id || !title || !url) continue;
      out.push({ externalId: id, title, company, location: str(obj(j.location)?.name), workMode: null, url, savedSearch: null });
    } else if (kind === "lever") {
      const id = str(j.id);
      const title = str(j.text);
      const url = str(j.hostedUrl);
      if (!id || !title || !url) continue;
      const categories = obj(j.categories);
      out.push({
        externalId: id,
        title,
        company,
        location: str(categories?.location),
        workMode: workMode(j.workplaceType),
        url,
        savedSearch: null,
        employmentType: str(categories?.commitment),
      });
    } else {
      if (j.isListed === false) continue; // reachable only by direct link: not an open listing
      const title = str(j.title);
      const url = str(j.jobUrl);
      if (!title || !url) continue; // Ashby documents no job id, so its page URL is the identity
      out.push({
        externalId: url,
        title,
        company,
        location: str(j.location),
        workMode: workMode(j.workplaceType) ?? (j.isRemote === true ? "Remote" : null),
        url,
        savedSearch: null,
        employmentType: str(j.employmentType),
        postedAt: str(j.publishedAt),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- fetching

export const MAX_RESPONSE_BYTES = 5_000_000;

export interface FetchDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Downloads one board's listing. No redirects (a redirect could point somewhere internal), a
 * timeout, and a size cap. Throws a short, user-presentable message on any failure.
 */
export async function fetchSource(kind: SourceKind, slug: string, deps: FetchDeps = {}): Promise<unknown> {
  const doFetch = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(sourceUrl(kind, slug), {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
  } catch (e) {
    const name = (e as Error).name;
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "Timed out." : "Could not reach the job board.");
  }
  if (res.status === 404) throw new Error("No such board. Check the name.");
  if (!res.ok) throw new Error(`The job board answered HTTP ${res.status}.`);
  if (Number(res.headers.get("content-length") ?? "0") > MAX_RESPONSE_BYTES) throw new Error("The job board response was too large.");
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("The job board response was too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The job board did not return JSON.");
  }
}
