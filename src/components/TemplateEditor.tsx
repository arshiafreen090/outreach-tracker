"use client";

import { useState } from "react";
import type { FormState } from "@/lib/action-types";
import { CATEGORY_LABELS } from "@/lib/categories";
import type { TemplateRow } from "@/lib/db-types";
import { findUnknownPlaceholders } from "@/lib/templates/engine";
import { formatDateTime } from "@/lib/time";
import { useFormAction } from "@/lib/use-form-action";

export interface VersionInfo {
  version: number;
  note: string | null;
  created_at: string;
  body: string;
}

/** Edit = save a new version. Old versions stay forever and messages record which one they used. */
export function TemplateEditor({
  template,
  versions,
  action,
}: {
  template: TemplateRow;
  versions: readonly VersionInfo[];
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const { state, onSubmit, pending } = useFormAction(action);
  const [body, setBody] = useState(template.body);
  const unknown = findUnknownPlaceholders(body);
  const changed = body.replace(/\r\n/g, "\n") !== template.body;

  return (
    <article className="card" aria-label={template.name}>
      <div className="row between">
        <h2>{template.name}</h2>
        <div className="chips">
          <span className="chip">v{template.version}</span>
          {template.default_category && <span className="chip accent">Default: {CATEGORY_LABELS[template.default_category]}</span>}
        </div>
      </div>
      {template.description && <p className="muted small">{template.description}</p>}
      {template.warning && <p className="banner warn" role="note">{template.warning}</p>}

      <form onSubmit={onSubmit} className="stack">
        <input type="hidden" name="template_id" value={template.template_id} />
        <div className="field">
          <label htmlFor={`body-${template.key}`}>Text (placeholders: {"{{first_name}}"}, {"{{Company}}"}, {"{{COMPANY_UPPER}}"})</label>
          <textarea
            id={`body-${template.key}`}
            name="body"
            className="message"
            rows={Math.min(28, body.split("\n").length + 1)}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {unknown.length > 0 && (
          <p className="banner error" role="alert">Unknown placeholder: {unknown.join(", ")}. It would be sent as-is.</p>
        )}
        <div className="field">
          <label htmlFor={`note-${template.key}`}>What changed (optional)</label>
          <input id={`note-${template.key}`} name="note" type="text" maxLength={200} />
        </div>
        <div className="row">
          <button type="submit" className="btn primary" disabled={pending || !changed || unknown.length > 0}>
            {pending ? "Saving…" : "Save as new version"}
          </button>
          {changed && <button type="button" className="btn ghost" onClick={() => setBody(template.body)}>Discard changes</button>}
          {state.error && <span className="banner error" role="alert">{state.error}</span>}
          {state.ok && <span className="banner ok" role="status">{state.message}</span>}
        </div>
      </form>

      <details className="more">
        <summary>Version history ({versions.length})</summary>
        <div className="stack">
          {versions.map((v) => (
            <details key={v.version} className="more">
              <summary>
                v{v.version} · {formatDateTime(v.created_at)}
                {v.note ? ` · ${v.note}` : ""}
              </summary>
              <pre className="sent">{v.body}</pre>
            </details>
          ))}
        </div>
      </details>
    </article>
  );
}
