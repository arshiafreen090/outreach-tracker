import Link from "next/link";
import { JobCard } from "@/components/JobCard";
import { requireAuthed } from "@/lib/auth";
import { JOBS_PAGE_SIZE, loadJobs } from "@/lib/data";
import { FAMILY_LABELS, ROLE_FAMILIES } from "@/lib/jobs/classify";
import { filtersToQuery, JOB_STATUS_LABELS, JOB_STATUSES, parseJobFilters, type JobFilters } from "@/lib/jobs/filters";
import { setJobStatus } from "../../actions";

export const metadata = { title: "Jobs · Outreach Tracker" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase } = await requireAuthed();
  const filters = parseJobFilters(await searchParams);
  const { jobs, total } = await loadJobs(supabase, filters);
  const withStatus = (status: JobFilters["status"]): JobFilters => ({ ...filters, status });

  return (
    <>
      <div className="page-head">
        <h1>Jobs</h1>
        <Link href="/jobs/sources">Company job boards →</Link>
      </div>

      <nav className="nav" aria-label="Job status" style={{ padding: 0 }}>
        {([...JOB_STATUSES, "all"] as const).map((s) => (
          <Link key={s} href={`/jobs${filtersToQuery(withStatus(s))}`} aria-current={filters.status === s ? "page" : undefined}>
            {s === "all" ? "All" : JOB_STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>

      <form method="get" className="card grid-form two">
        <input type="hidden" name="status" value={filters.status} />
        <div className="field">
          <label htmlFor="q">Search title or company</label>
          <input id="q" name="q" type="text" defaultValue={filters.q} maxLength={60} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="family">Role</label>
          <select id="family" name="family" defaultValue={filters.family}>
            <option value="all">All roles</option>
            {[...ROLE_FAMILIES, "other" as const].map((f) => (
              <option key={f} value={f}>
                {FAMILY_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <label className="checkbox">
          <input type="checkbox" name="internships" value="1" defaultChecked={filters.internshipsOnly} />
          <span>Internships only</span>
        </label>
        <div className="row">
          <button type="submit" className="btn primary">
            Filter
          </button>
          <Link className="btn ghost" href="/jobs">
            Reset
          </Link>
        </div>
      </form>

      <p className="muted small">
        {total === 0 ? "No jobs match." : `Showing ${jobs.length}${total > jobs.length ? ` of ${total}` : ""}, newest first.`}
        {total > JOBS_PAGE_SIZE ? " Narrow the filters to see the rest." : ""}
      </p>

      {jobs.length === 0 ? (
        <p className="empty">
          Nothing here yet. LinkedIn job-alert emails arrive through the Gmail forwarder, and the company boards you follow are pulled once a day.
        </p>
      ) : (
        jobs.map((job) => <JobCard key={job.id} job={job} setStatus={setJobStatus.bind(null, job.id)} />)
      )}
    </>
  );
}
