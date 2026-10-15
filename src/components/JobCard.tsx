"use client";

import type { ActionResult } from "@/lib/action-types";
import type { JobRow } from "@/lib/db-types";
import { FAMILY_LABELS } from "@/lib/jobs/classify";
import { JOB_STATUS_LABELS, JOB_STATUSES, sourceLabel, type JobStatus } from "@/lib/jobs/filters";
import { formatDate } from "@/lib/time";
import { safeHttpUrl } from "@/lib/urls";
import { ActionButton } from "./ActionButton";

const BUTTONS: Record<JobStatus, string> = {
  new: "Back to new",
  seen: "Mark seen",
  applied: "Applied",
  dismissed: "Not interested",
};

/** One opening in the feed. You open it on its own site, then say what you did with it. */
export function JobCard({ job, setStatus }: { job: JobRow; setStatus: (status: JobStatus) => Promise<ActionResult> }) {
  const href = safeHttpUrl(job.url);
  const where = [job.location, job.work_mode].filter(Boolean).join(" · ");

  return (
    <article className="card" aria-label={job.title}>
      <div className="person-main">
        <h2 className="person-name">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {job.title} ↗
            </a>
          ) : (
            job.title
          )}
        </h2>
        <div className="person-sub">{[job.company_name, where].filter(Boolean).join(" · ") || "No company listed"}</div>
        <div className="chips">
          <span className="chip accent">{FAMILY_LABELS[job.role_family]}</span>
          {job.is_internship && <span className="chip ok">Internship</span>}
          {job.company_id && <span className="chip warn">A company you track</span>}
          {job.status !== "new" && <span className="chip">{JOB_STATUS_LABELS[job.status]}</span>}
          <span className="chip">Found {formatDate(job.found_at)}</span>
          {job.saved_search && <span className="chip">Alert: {job.saved_search}</span>}
          {(job.seen_in.length > 0 ? job.seen_in : [job.source]).map((s) => (
            <span key={s} className="chip">
              {sourceLabel(s)}
            </span>
          ))}
        </div>
      </div>

      <div className="actions">
        {JOB_STATUSES.filter((s) => s !== job.status).map((s) => (
          <ActionButton key={s} action={() => setStatus(s)} className={s === "applied" ? "btn primary" : "btn"}>
            {BUTTONS[s]}
          </ActionButton>
        ))}
      </div>
    </article>
  );
}
