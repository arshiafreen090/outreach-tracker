import { walk } from "./dom";

export interface JobPosting {
  /** LinkedIn's numeric job id. Stable, so it is the de-duplication key. */
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  /** "Hybrid", "On-site", "Remote" as LinkedIn labels it. */
  workMode: string | null;
  /** https://www.linkedin.com/jobs/view/<id>/ (opened by you, never fetched by this app). */
  url: string;
  /** The saved search that produced it, e.g. "Data Analyst". */
  alertTitle: string | null;
  /** Other lines on the card: "5 school alumni", "Actively recruiting", "Easy Apply". */
  badges: string[];
}

const JOB_ID = /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d{5,})/i;
const SEARCH = /linkedin\.com\/(?:comm\/)?jobs\/search-results/i;
const SEE_ALL = /^see all jobs$/i;

const innermost = (anchors: string[], re: RegExp): RegExpExecArray | null => {
  for (let i = anchors.length - 1; i >= 0; i--) {
    const m = re.exec(anchors[i]!);
    if (m) return m;
  }
  return null;
};

/** "Airbnb · Bengaluru (Hybrid)" -> company, location, work mode. */
export function splitCompanyLine(line: string): { company: string; location: string | null; workMode: string | null } {
  const [company, ...rest] = line.split(/\s*[·•]\s*/);
  const tail = rest.join(" · ").trim();
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(tail);
  return {
    company: (company ?? "").trim(),
    location: (m ? m[1] : tail) || null,
    workMode: m ? m[2]!.trim() : null,
  };
}

/** The jobs listed in a LinkedIn job-alert email, de-duplicated by job id. */
export function parseJobAlert(html: string): JobPosting[] {
  const events = walk(html);

  const groups = new Map<string, { texts: string[]; alert: string | null }>();
  let alert: string | null = null;
  let search: string[] = [];
  const finishSearch = () => {
    const title = search.join(" ").replace(/^your job alert for\s+/i, "").trim();
    if (title && !SEE_ALL.test(title)) alert = title;
    search = [];
  };

  for (const e of events) {
    if (e.type !== "text") {
      if (e.type === "anchor" && search.length > 0) finishSearch();
      continue;
    }
    const job = innermost(e.anchors, JOB_ID);
    if (job) {
      if (search.length > 0) finishSearch();
      const id = job[1]!;
      const group = groups.get(id) ?? { texts: [], alert };
      group.texts.push(e.text);
      groups.set(id, group);
    } else if (innermost(e.anchors, SEARCH)) {
      search.push(e.text);
    } else if (search.length > 0) {
      finishSearch();
    }
  }
  if (search.length > 0) finishSearch();

  const jobs: JobPosting[] = [];
  for (const [id, { texts, alert: alertTitle }] of groups) {
    const title = texts[0];
    if (!title) continue;
    const line = texts.find((t, i) => i > 0 && /[·•]/.test(t));
    const parsed = line ? splitCompanyLine(line) : null;
    jobs.push({
      id,
      title,
      company: parsed?.company || null,
      location: parsed?.location ?? null,
      workMode: parsed?.workMode ?? null,
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      alertTitle,
      badges: texts.filter((t, i) => i > 0 && t !== line && t !== title),
    });
  }
  return jobs;
}
