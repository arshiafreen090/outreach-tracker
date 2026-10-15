"use client";

import type { FormState } from "@/lib/action-types";
import type { AppSettings } from "@/lib/settings";
import { useFormAction } from "@/lib/use-form-action";

export function SettingsForm({
  settings,
  action,
}: {
  settings: AppSettings;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const { state, onSubmit, pending } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="card grid-form">
      <div className="field">
        <label htmlFor="follow_up_days">Follow-up after (days)</label>
        <input id="follow_up_days" name="follow_up_days" type="number" min={1} max={365} step={1} defaultValue={settings.followUpDays} required />
        <span className="small muted">Messaged with no reply for this long means a follow-up is due.</span>
      </div>
      <div className="field">
        <label htmlFor="pending_nudge_days">Pending nudge after (days)</label>
        <input id="pending_nudge_days" name="pending_nudge_days" type="number" min={1} max={365} step={1} defaultValue={settings.pendingNudgeDays} required />
        <span className="small muted">A connection request still pending this long gets a nudge badge.</span>
      </div>
      <label className="checkbox">
        <input type="checkbox" name="show_photos" defaultChecked={settings.showPhotos} />
        <span>
          Show profile photos
          <span className="small muted" style={{ display: "block" }}>
            Photos load straight from LinkedIn&apos;s image servers in your browser, without a referrer. Turn off to show initials only and make no requests to LinkedIn&apos;s domains.
          </span>
        </span>
      </label>
      <div className="row">
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state.error && <span className="banner error" role="alert">{state.error}</span>}
        {state.ok && <span className="banner ok" role="status">{state.message}</span>}
      </div>
    </form>
  );
}
