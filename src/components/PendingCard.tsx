import type { ReactNode } from "react";
import type { ActionResult } from "@/lib/action-types";
import { CATEGORY_LABELS } from "@/lib/categories";
import type { CompanyRow, PersonRow } from "@/lib/db-types";
import { agoLabel, daysSince, formatDate } from "@/lib/time";
import { safeHttpUrl } from "@/lib/urls";
import { ActionButton } from "./ActionButton";
import { Avatar } from "./Avatar";

export function PendingCard({
  person,
  company,
  showPhotos,
  nudgeDays,
  now,
  markAccepted,
  editSlot,
}: {
  person: PersonRow;
  company: CompanyRow | null;
  showPhotos: boolean;
  nudgeDays: number;
  now?: Date;
  markAccepted: () => Promise<ActionResult>;
  editSlot?: ReactNode;
}) {
  const waiting = person.requested_at ? daysSince(person.requested_at, now) : null;
  const nudge = waiting !== null && waiting >= nudgeDays;
  const companyName = company?.name ?? person.company_name_raw ?? "";
  const profileHref = safeHttpUrl(person.profile_url);

  return (
    <article className="card" aria-label={person.full_name}>
      <div className="person">
        <Avatar name={person.full_name} photoUrl={person.photo_url} showPhotos={showPhotos} />
        <div className="person-main">
          <h2 className="person-name">{person.full_name}</h2>
          <div className="person-sub">{[person.role, companyName].filter(Boolean).join(" · ") || "No role or company yet"}</div>
          <div className="chips">
            {company && <span className="chip accent">{CATEGORY_LABELS[company.category]}</span>}
            {person.requested_at && (
              <span className="chip">
                Sent {formatDate(person.requested_at)} · {agoLabel(waiting ?? 0)}
              </span>
            )}
            {nudge && <span className="chip warn">Nudge: pending {waiting} days</span>}
          </div>
        </div>
      </div>

      {company?.blurb && <p className="blurb">{company.blurb}</p>}

      <div className="actions">
        <ActionButton action={markAccepted} className="btn primary">
          Mark accepted
        </ActionButton>
        {profileHref && (
          <a className="btn" href={profileHref} target="_blank" rel="noopener noreferrer">
            Open profile ↗
          </a>
        )}
      </div>

      {editSlot}
    </article>
  );
}
