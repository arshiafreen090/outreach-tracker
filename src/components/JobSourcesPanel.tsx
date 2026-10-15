"use client";

import { useState } from "react";
import type { ActionResult, FormState } from "@/lib/action-types";
import type { JobSourceRow } from "@/lib/db-types";
import { KIND_LABELS, SOURCE_KINDS } from "@/lib/jobs/sources";
import { formatDateTime } from "@/lib/time";
import { useFormAction } from "@/lib/use-form-action";
import { ActionButton } from "./ActionButton";

/** Company job boards you follow. They are pulled once a day, or whenever you press Pull now. */
export function JobSourcesPanel({
  sources,
  add,
  pull,
  pullAll,
  setEnabled,
  remove,
}: {
  sources: readonly JobSourceRow[];
  add: (prev: FormState, formData: FormData) => Promise<FormState>;
  pull: (id: string) => Promise<ActionResult>;
  pullAll: () => Promise<ActionResult>;
  setEnabled: (id: string, enabled: boolean) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
}) {
  const { state, onSubmit, pending } = useFormAction(add);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="stack">
      <form key={state.nonce ?? 0} onSubmit={onSubmit} className="card grid-form two">
        <div className="field">
          <label htmlFor="kind">Job board system</label>
          <select id="kind" name="kind" defaultValue="greenhouse">
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="slug">Board name or careers-page address</label>
          <input id="slug" name="slug" type="text" required autoComplete="off" placeholder="acme  or  boards.greenhouse.io/acme" maxLength={200} />
        </div>
        <div className="field span-2">
          <label htmlFor="company">Company name (shown on its jobs)</label>
          <input id="company" name="company" type="text" autoComplete="off" maxLength={200} />
        </div>
        <p className="muted small span-2">
          Open the company&apos;s careers page. If its address looks like boards.greenhouse.io/<b>name</b>, jobs.lever.co/<b>name</b> or jobs.ashbyhq.com/<b>name</b>, that last part is the board name. Only jobs in your role families are kept.
        </p>
        <div className="span-2 row">
          <button type="submit" className="btn primary" disabled={pending}>
            {pending ? "Adding and checking…" : "Add and check it"}
          </button>
          {state.error && <span className="banner error" role="alert">{state.error}</span>}
          {state.ok && <span className="banner ok" role="status">{state.message}</span>}
        </div>
      </form>

      {sources.length === 0 ? (
        <p className="empty">No company boards yet. Add one above and its matching jobs will appear in the feed.</p>
      ) : (
        <>
          <div className="row between">
            <h2>{sources.length} board{sources.length === 1 ? "" : "s"}</h2>
            <ActionButton action={pullAll} className="btn small">
              Pull all now
            </ActionButton>
          </div>
          {sources.map((s) => (
            <article key={s.id} className="card" aria-label={`${KIND_LABELS[s.kind]} ${s.slug}`}>
              <div className="person-main">
                <h2 className="person-name">{s.label || s.slug}</h2>
                <div className="chips">
                  <span className="chip accent">{KIND_LABELS[s.kind]}: {s.slug}</span>
                  {!s.enabled && <span className="chip warn">Paused</span>}
                  {s.last_pulled_at ? (
                    s.last_status === "ok" ? (
                      <span className="chip ok">
                        Pulled {formatDateTime(s.last_pulled_at)} · {s.last_job_count ?? 0} listed, {s.last_new_count ?? 0} new
                      </span>
                    ) : (
                      <span className="chip warn">Last pull failed: {s.last_status}</span>
                    )
                  ) : (
                    <span className="chip">Not pulled yet</span>
                  )}
                </div>
              </div>
              <div className="actions">
                <ActionButton action={() => pull(s.id)} className="btn">
                  Pull now
                </ActionButton>
                <ActionButton action={() => setEnabled(s.id, !s.enabled)} className="btn">
                  {s.enabled ? "Pause" : "Resume"}
                </ActionButton>
                {confirming === s.id ? (
                  <>
                    <ActionButton action={() => remove(s.id)} className="btn danger">
                      Yes, remove it
                    </ActionButton>
                    <button type="button" className="btn" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn ghost" onClick={() => setConfirming(s.id)}>
                    Remove
                  </button>
                )}
              </div>
              {confirming === s.id && <p className="muted small">Jobs already found stay in your feed.</p>}
            </article>
          ))}
        </>
      )}
    </div>
  );
}
