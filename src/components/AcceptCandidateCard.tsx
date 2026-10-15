"use client";

import { useId } from "react";
import type { ActionResult, FormState } from "@/lib/action-types";
import type { AcceptCandidate, CompanyRow } from "@/lib/db-types";
import { agoLabel, daysSince } from "@/lib/time";
import { safeHttpUrl } from "@/lib/urls";
import { useFormAction } from "@/lib/use-form-action";
import { ActionButton } from "./ActionButton";
import { Avatar } from "./Avatar";
import { CompanyField } from "./CompanyField";

export interface PendingOption {
  id: string;
  label: string;
}

/**
 * Someone accepted a request that matches none of the ones you logged (different profile URL or
 * name, or a connection you made without the app). You decide what they are.
 */
export function AcceptCandidateCard({
  candidate,
  pending,
  companies,
  showPhotos,
  link,
  create,
  dismiss,
}: {
  candidate: AcceptCandidate;
  /** Requests still waiting for an accept, to link this person to. */
  pending: readonly PendingOption[];
  companies: readonly CompanyRow[];
  showPhotos: boolean;
  link: (prev: FormState, formData: FormData) => Promise<FormState>;
  create: (prev: FormState, formData: FormData) => Promise<FormState>;
  dismiss: () => Promise<ActionResult>;
}) {
  const uid = useId();
  const linkForm = useFormAction(link);
  const createForm = useFormAction(create);
  const profileHref = safeHttpUrl(candidate.profile_url);

  return (
    <article className="card" aria-label={candidate.full_name}>
      <div className="person">
        <Avatar name={candidate.full_name} photoUrl={candidate.photo_url} showPhotos={showPhotos} />
        <div className="person-main">
          <h2 className="person-name">{candidate.full_name}</h2>
          <div className="person-sub">{candidate.headline ?? "No headline in the email"}</div>
          <div className="chips">
            <span className="chip">Accepted {agoLabel(daysSince(candidate.accepted_at))}</span>
            {candidate.company_hint && <span className="chip accent">Maybe at {candidate.company_hint}</span>}
          </div>
        </div>
      </div>

      <p className="muted small">
        None of your logged requests matches this person. Link it to one you sent, add them as a new person, or dismiss it.
      </p>

      <div className="actions">
        {profileHref && (
          <a className="btn" href={profileHref} target="_blank" rel="noopener noreferrer">
            Open profile ↗
          </a>
        )}
        <ActionButton action={dismiss} className="btn ghost">
          Dismiss
        </ActionButton>
      </div>

      <details className="more">
        <summary>Link to a request I logged</summary>
        {pending.length === 0 ? (
          <p className="muted small">You have no pending requests to link to.</p>
        ) : (
          <form onSubmit={linkForm.onSubmit} className="grid-form">
            <div className="field">
              <label htmlFor={`${uid}-person`}>Which request is this?</label>
              <select id={`${uid}-person`} name="person_id" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {pending.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <button type="submit" className="btn small" disabled={linkForm.pending}>
                {linkForm.pending ? "Linking…" : "Link"}
              </button>
              {linkForm.state.error && <span className="banner error" role="alert">{linkForm.state.error}</span>}
            </div>
          </form>
        )}
      </details>

      <details className="more">
        <summary>Add as a new person</summary>
        <form onSubmit={createForm.onSubmit} className="grid-form two">
          <CompanyField companies={companies} defaultValue={candidate.company_hint ?? ""} />
          <div className="span-2 row">
            <button type="submit" className="btn small primary" disabled={createForm.pending}>
              {createForm.pending ? "Adding…" : "Add to Accepted"}
            </button>
            {createForm.state.error && <span className="banner error" role="alert">{createForm.state.error}</span>}
          </div>
          <p className="muted small span-2">The company was guessed from their headline. Check it: it picks the template and fills in the message.</p>
        </form>
      </details>
    </article>
  );
}
