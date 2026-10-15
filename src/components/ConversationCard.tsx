"use client";

import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-types";
import { CATEGORY_LABELS } from "@/lib/categories";
import type { CompanyRow, LastMessage, PersonRow, PersonStatus } from "@/lib/db-types";
import { daysWaiting, isFollowUpDue } from "@/lib/followups";
import { PERSON_STATUSES, STATUS_LABELS } from "@/lib/status";
import { formatDate, formatDateTime } from "@/lib/time";
import { safeHttpUrl } from "@/lib/urls";
import { ActionButton } from "./ActionButton";
import { Avatar } from "./Avatar";

/** Someone you have messaged: where it stands, what to do next, and a status you can set by hand. */
export function ConversationCard({
  person,
  company,
  lastMessage,
  templateName,
  followUpDays,
  showPhotos,
  now,
  markReplied,
  markFollowedUp,
  setStatus,
}: {
  person: PersonRow;
  company: CompanyRow | null;
  lastMessage: LastMessage | null;
  templateName: string | null;
  followUpDays: number;
  showPhotos: boolean;
  now?: Date;
  markReplied: () => Promise<ActionResult>;
  markFollowedUp: () => Promise<ActionResult>;
  setStatus: (status: PersonStatus) => Promise<ActionResult>;
}) {
  const uid = useId();
  const [next, setNext] = useState<PersonStatus>(person.status);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const due = isFollowUpDue(person, followUpDays, now);
  const waiting = person.status === "messaged" || person.status === "follow_up_due";
  const days = daysWaiting(person, now);
  const companyName = company?.name ?? person.company_name_raw ?? "";
  const profileHref = safeHttpUrl(person.profile_url);

  return (
    <article className="card" aria-label={person.full_name}>
      <div className="person">
        <Avatar name={person.full_name} photoUrl={person.photo_url} showPhotos={showPhotos} />
        <div className="person-main">
          <h2 className="person-name">{person.full_name}</h2>
          <div className="person-sub">{[person.role, companyName].filter(Boolean).join(" · ") || "No role or company"}</div>
          <div className="chips">
            <span className="chip accent">{STATUS_LABELS[person.status]}</span>
            {due && <span className="chip warn">{days === null ? "Follow-up due" : `Follow-up due · ${days} ${days === 1 ? "day" : "days"} of silence`}</span>}
            {!due && waiting && days !== null && <span className="chip">Waiting {days} {days === 1 ? "day" : "days"}</span>}
            {company && <span className="chip">{CATEGORY_LABELS[company.category]}</span>}
            {lastMessage && (
              <span className="chip">
                Messaged {formatDateTime(lastMessage.sent_at)} · {templateName ?? "Template"} v{lastMessage.template_version}
              </span>
            )}
            {person.follow_ups_count > 0 && (
              <span className="chip">
                {person.follow_ups_count} follow-up{person.follow_ups_count === 1 ? "" : "s"}
              </span>
            )}
            {person.last_replied_at && <span className="chip ok">Replied {formatDate(person.last_replied_at)}</span>}
          </div>
        </div>
      </div>

      {lastMessage && (
        <details className="more">
          <summary>View the message as sent</summary>
          <pre className="sent">{lastMessage.final_text}</pre>
        </details>
      )}

      <div className="actions">
        {waiting && (
          <>
            <ActionButton action={markReplied} className="btn primary">
              They replied
            </ActionButton>
            <ActionButton action={markFollowedUp} className="btn">
              I followed up
            </ActionButton>
          </>
        )}
        {profileHref && (
          <a className="btn" href={profileHref} target="_blank" rel="noopener noreferrer">
            Open profile ↗
          </a>
        )}
      </div>

      <div className="row">
        <label htmlFor={`${uid}-status`} className="label">
          Status
        </label>
        <select id={`${uid}-status`} value={next} onChange={(e) => setNext(e.target.value as PersonStatus)} style={{ width: "auto", minWidth: 160 }}>
          {PERSON_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn small"
          disabled={pending || next === person.status}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await setStatus(next);
              if (!result.ok) setError(result.error);
            })
          }
        >
          {pending ? "Saving…" : "Set status"}
        </button>
      </div>
      {error && <p className="banner error" role="alert">{error}</p>}
    </article>
  );
}
