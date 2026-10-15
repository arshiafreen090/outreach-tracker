import { isRoleFamily, type RoleFamily } from "./classify";

export const JOB_STATUSES = ["new", "seen", "applied", "dismissed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: "New",
  seen: "Seen",
  applied: "Applied",
  dismissed: "Not interested",
};

export const isJobStatus = (v: unknown): v is JobStatus => typeof v === "string" && (JOB_STATUSES as readonly string[]).includes(v);

export interface JobFilters {
  status: JobStatus | "all";
  family: RoleFamily | "all";
  internshipsOnly: boolean;
  /** Already sanitised: safe to put in a PostgREST filter. */
  q: string;
}

export const MAX_SEARCH = 60;

/**
 * The search text goes into a PostgREST `or=(title.ilike.%…%,…)` filter, where commas, parentheses,
 * dots, percent signs and asterisks have meaning. Keep only characters that are plain text.
 */
export function safeSearch(raw: string | undefined | null): string {
  return (raw ?? "")
    .replace(/[^\p{L}\p{N} \-+#&']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH)
    .trim();
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Reads the URL's query string. Anything unrecognised falls back to the default instead of failing. */
export function parseJobFilters(params: Params): JobFilters {
  const status = first(params.status);
  const family = first(params.family);
  const internships = first(params.internships);
  return {
    status: status === "all" ? "all" : isJobStatus(status) ? status : "new",
    family: family && family !== "all" && isRoleFamily(family) ? family : "all",
    internshipsOnly: internships === "1" || internships === "on",
    q: safeSearch(first(params.q)),
  };
}

/** The query string for a filter set, omitting defaults so URLs stay short. */
export function filtersToQuery(f: JobFilters): string {
  const p = new URLSearchParams();
  if (f.status !== "new") p.set("status", f.status);
  if (f.family !== "all") p.set("family", f.family);
  if (f.internshipsOnly) p.set("internships", "1");
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** "linkedin-alert" -> "LinkedIn alert"; "greenhouse:acme" -> "Greenhouse (acme)". */
export function sourceLabel(source: string): string {
  if (source === "linkedin-alert") return "LinkedIn alert";
  const [kind, ...rest] = source.split(":");
  const name = kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : source;
  return rest.length ? `${name} (${rest.join(":")})` : name;
}
