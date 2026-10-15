"use client";

import { useState } from "react";
import type { FormState } from "@/lib/action-types";
import type { CompanyRow } from "@/lib/db-types";
import { todayInDisplayZone } from "@/lib/time";
import { parseProfileUrl } from "@/lib/urls";
import { useFormAction } from "@/lib/use-form-action";
import { CompanyField } from "./CompanyField";

/** Five-second logging of a connection request you just sent. The URL is what accept emails get matched on. */
export function LogRequestForm({
  action,
  companies,
  knownProfiles,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  companies: readonly CompanyRow[];
  /** profile_url_key -> name, for an instant "already logged" hint. The server enforces it too. */
  knownProfiles: Record<string, string>;
}) {
  const { state, onSubmit, pending } = useFormAction(action);

  // Re-keying clears every field after a successful log, ready for the next one.
  return (
    <div className="stack">
      {state.ok && <p className="banner ok" role="status">{state.message} Add another below.</p>}
      <Fields key={state.nonce ?? 0} onSubmit={onSubmit} pending={pending} error={state.error} companies={companies} knownProfiles={knownProfiles} />
    </div>
  );
}

function Fields({
  onSubmit,
  pending,
  error,
  companies,
  knownProfiles,
}: {
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  pending: boolean;
  error?: string;
  companies: readonly CompanyRow[];
  knownProfiles: Record<string, string>;
}) {
  const [url, setUrl] = useState("");
  const parsed = url.trim() ? parseProfileUrl(url) : null;
  const existing = parsed ? knownProfiles[parsed.key] : undefined;

  return (
    <form onSubmit={onSubmit} className="card grid-form two">
      <div className="field span-2">
        <label htmlFor="profile_url">LinkedIn profile URL</label>
        <input
          id="profile_url"
          name="profile_url"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://www.linkedin.com/in/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          autoFocus
        />
        {existing ? (
          <span className="small" style={{ color: "var(--danger)" }}>Already logged: {existing}.</span>
        ) : parsed ? (
          <span className="small muted">Recognised: {parsed.key}</span>
        ) : url.trim() ? (
          <span className="small" style={{ color: "var(--danger)" }}>Needs to look like linkedin.com/in/…</span>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="full_name">Name</label>
        <input id="full_name" name="full_name" type="text" required maxLength={200} autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="role">Role (optional)</label>
        <input id="role" name="role" type="text" maxLength={200} autoComplete="off" />
      </div>

      <CompanyField companies={companies} />

      <div className="field">
        <label htmlFor="sent_on">Sent on (blank = now)</label>
        <input id="sent_on" name="sent_on" type="date" max={todayInDisplayZone()} />
      </div>

      <div className="span-2 row">
        <button type="submit" className="btn primary" disabled={pending || Boolean(existing)}>
          {pending ? "Logging…" : "Log request"}
        </button>
        {error && <span className="banner error" role="alert">{error}</span>}
      </div>
    </form>
  );
}
