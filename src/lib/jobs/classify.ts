/** The role families you asked the feed to cover, plus "other" for everything else. */
export const ROLE_FAMILIES = ["data_analytics", "product_analytics", "data_science", "ml", "ai", "swe"] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number] | "other";

export const FAMILY_LABELS: Record<RoleFamily, string> = {
  data_analytics: "Data analytics",
  product_analytics: "Product analytics",
  data_science: "Data science",
  ml: "Machine learning",
  ai: "AI",
  swe: "Software engineering",
  other: "Other",
};

export const isRoleFamily = (v: unknown): v is RoleFamily =>
  v === "other" || (typeof v === "string" && (ROLE_FAMILIES as readonly string[]).includes(v));

// Not an analyst role in the data sense.
const NOT_DATA_ANALYST = /\b(financial|finance|accounting|accountant|audit|tax|legal|compliance|credit|investment|equity|treasury|payroll|recruit(?:er|ing|ment)?|hr)\b/;
const SWE_CONTEXT = /\b(backend|back-end|frontend|front-end|full[ -]?stack|web|mobile|ios|android|platform|devops|sre|cloud|data|application|api|react|node|java|python|golang)\b/;

/**
 * Which family a job title belongs to. First match wins, most specific first, so "Principal AI
 * Data Analyst" is AI and "AI/ML Engineer" is ML. It judges the TITLE only (it is a filter, not a
 * verdict: the title is always shown), and titles it can't place are "other".
 */
export function classifyRole(title: string): RoleFamily {
  const t = title.toLowerCase().replace(/[_]/g, " ");

  if (/\bproduct (?:data )?analy(?:st|tics|sts)\b|\bgrowth analy(?:st|tics|sts)\b/.test(t)) return "product_analytics";
  if (/\b(?:data|decision) scien(?:ce|tist|tists)\b/.test(t)) return "data_science";
  if (/\bmachine learning\b|\bml\b|\bmlops\b|\bdeep learning\b|\bcomputer vision\b|\bnlp\b|\bapplied scien|\bresearch scien/.test(t)) return "ml";
  if (/\bai\b|\bartificial intelligence\b|\bllm\b|\bgen(?:erative)? ?ai\b|\bgenai\b/.test(t)) return "ai";
  if (/\banaly(?:st|sts|tics)\b/.test(t) && !NOT_DATA_ANALYST.test(t)) return "data_analytics";
  if (/\b(?:sde|swe)\b|\bsoftware\b/.test(t)) return "swe";
  if (/\b(?:engineer|engineers|developer|developers|programmer)\b/.test(t) && SWE_CONTEXT.test(t)) return "swe";
  return "other";
}

/** "Intern", "Internship", "Trainee", "Apprentice", or an ATS that labels the employment type as intern. */
export function isInternship(title: string, employmentType?: string | null): boolean {
  return /\bintern(?:ship)?s?\b|\btrainee\b|\bapprentice\b/i.test(title) || /intern/i.test(employmentType ?? "");
}

const COMPANY_SUFFIX = /\b(?:pvt|private|ltd|limited|inc|llc|corp|corporation|co)\b/g;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’‘`]/g, "") // Dexter's -> dexters, not "dexter s"
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The same opening often shows up twice (a LinkedIn alert and the company's own board). Same
 * company + title + city means the same job. Returns null when there isn't enough to compare.
 */
export function softKey(company: string | null, title: string, location: string | null): string | null {
  const c = norm(company ?? "").replace(COMPANY_SUFFIX, "").replace(/\s+/g, " ").trim();
  const t = norm(title);
  if (!c || !t) return null;
  const city = norm((location ?? "").split(",")[0] ?? "");
  return `${c}|${t}|${city}`;
}
