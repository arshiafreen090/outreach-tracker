"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult, MarkSentInput } from "@/lib/action-types";
import { CATEGORY_LABELS } from "@/lib/categories";
import { copyText } from "@/lib/clipboard";
import type { CompanyRow, LastMessage, PersonRow, TemplateRow } from "@/lib/db-types";
import { findUnresolvedPlaceholders, firstNameFromFullName, renderTemplate } from "@/lib/templates/engine";
import { defaultTemplateFor } from "@/lib/templates/select";
import { agoLabel, daysSince, formatDateTime } from "@/lib/time";
import { safeHttpUrl } from "@/lib/urls";
import { Avatar } from "./Avatar";

export interface AcceptedCardProps {
  person: PersonRow;
  company: CompanyRow | null;
  /** Non-archived templates, latest version of each. */
  templates: readonly TemplateRow[];
  /** Most recent message already sent to this person, if any (drives the duplicate-send warning). */
  lastMessage: LastMessage | null;
  showPhotos: boolean;
  onMarkSent: (input: MarkSentInput) => Promise<ActionResult>;
  /** The edit-details form, supplied by the page so this card stays easy to test. */
  editSlot?: ReactNode;
}

export function AcceptedCard({ person, company, templates, lastMessage, showPhotos, onMarkSent, editSlot }: AcceptedCardProps) {
  const uid = useId();
  const defaultTemplate = defaultTemplateFor(company?.category ?? null, templates);
  const [templateKey, setTemplateKey] = useState(defaultTemplate?.key ?? "");
  const template = templates.find((t) => t.key === templateKey) ?? defaultTemplate;

  const firstName = person.first_name?.trim() || firstNameFromFullName(person.full_name);
  const companyName = company?.name ?? person.company_name_raw ?? "";
  const rendered = useMemo(
    () => (template ? renderTemplate(template.body, { firstName, company: companyName }) : ""),
    [template, firstName, companyName],
  );

  // `edited` holds the user's textarea text; null means "show the template as rendered".
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? rendered;
  const isEdited = edited !== null && edited !== rendered;
  const unresolved = findUnresolvedPlaceholders(text);

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [serverSaysDuplicate, setServerSaysDuplicate] = useState(false);
  const [sent, setSent] = useState(false);

  const alreadyMessaged = person.messages_sent_count > 0 || serverSaysDuplicate;
  const profileHref = safeHttpUrl(person.profile_url);

  if (!template) {
    return (
      <article className="card" aria-label={person.full_name}>
        <p className="banner warn">No templates found. Run <code>npm run seed:templates</code>.</p>
      </article>
    );
  }

  const isDefault = template.key === defaultTemplate?.key;
  const previous = lastMessage ? templates.find((t) => t.template_id === lastMessage.template_id) : undefined;
  const messagedAt = lastMessage?.sent_at ?? person.last_messaged_at;
  const charCount = [...text].length;

  async function copy() {
    const ok = await copyText(text);
    setCopied(ok);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    if (!ok) setError("Couldn't copy automatically. Select the text and copy it manually.");
  }

  function submit(allowDuplicate: boolean) {
    startTransition(async () => {
      setError(null);
      const result = await onMarkSent({
        personId: person.id,
        templateId: template!.template_id,
        templateVersion: template!.version,
        finalText: text,
        allowDuplicate,
      });
      if (result.ok) {
        setSent(true);
        setConfirming(false);
      } else if (result.code === "already_messaged") {
        setServerSaysDuplicate(true);
        setConfirming(true);
      } else {
        setError(result.error);
      }
    });
  }

  function onMarkSentClick() {
    if (alreadyMessaged && !confirming) {
      setConfirming(true);
      return;
    }
    submit(alreadyMessaged);
  }

  return (
    <article className="card" aria-label={person.full_name}>
      <div className="person">
        <Avatar name={person.full_name} photoUrl={person.photo_url} showPhotos={showPhotos} />
        <div className="person-main">
          <h2 className="person-name">{person.full_name}</h2>
          <div className="person-sub">
            {[person.role, companyName].filter(Boolean).join(" · ") || "No role or company yet"}
          </div>
          <div className="chips">
            {company && <span className="chip accent">{CATEGORY_LABELS[company.category]}</span>}
            {person.accepted_at && <span className="chip">Accepted {agoLabel(daysSince(person.accepted_at))}</span>}
          </div>
        </div>
      </div>

      {company?.blurb && <p className="blurb">{company.blurb}</p>}

      <div className="field">
        <label htmlFor={`${uid}-template`}>Template</label>
        <select
          id={`${uid}-template`}
          value={template.key}
          onChange={(e) => {
            setTemplateKey(e.target.value);
            setEdited(null);
            setConfirming(false);
          }}
        >
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
              {t.key === defaultTemplate?.key ? " (auto)" : ""} · v{t.version}
            </option>
          ))}
        </select>
        <span className="small muted">
          {!company
            ? "No company set, so the general template is selected. Add the company under Edit details."
            : isDefault
              ? `Auto-selected for ${CATEGORY_LABELS[company.category]}.`
              : `Manual override. Auto would be ${defaultTemplate?.name}.`}
          {isEdited ? " Switching template discards your edits." : ""}
        </span>
      </div>

      {template.warning && (
        <p className="banner warn" role="note">
          <strong>Check before sending:</strong> {template.warning}
        </p>
      )}

      {alreadyMessaged && (
        <p className="banner warn" role="alert">
          <strong>Already messaged</strong>
          {messagedAt ? ` on ${formatDateTime(messagedAt)}` : ""}
          {previous && lastMessage ? ` with ${previous.name} v${lastMessage.template_version}` : ""}. Marking this as sent again needs a confirmation.
        </p>
      )}

      <div className="field">
        <label htmlFor={`${uid}-message`}>Message</label>
        <textarea
          id={`${uid}-message`}
          className="message"
          value={text}
          rows={Math.min(24, Math.max(10, text.split("\n").length + 1))}
          onChange={(e) => setEdited(e.target.value)}
        />
      </div>

      <div className="row between">
        <span className="counter" aria-live="polite">
          {charCount} characters{isEdited ? " · edited" : ""}
        </span>
        <button type="button" className="btn ghost small" onClick={() => setEdited(null)} disabled={!isEdited}>
          Reset to template
        </button>
      </div>

      {unresolved.length > 0 && (
        <p className="banner warn" role="alert">
          Still contains {[...new Set(unresolved)].join(", ")}. Set the company under Edit details, or edit the text.
        </p>
      )}
      {error && <p className="banner error" role="alert">{error}</p>}
      {sent && <p className="banner ok" role="status">Marked as sent. It now lives under Messaged.</p>}

      <div className="actions">
        <button type="button" className="btn" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
        {profileHref && (
          <a className="btn" href={profileHref} target="_blank" rel="noopener noreferrer">
            Open profile ↗
          </a>
        )}
        {confirming ? (
          <>
            <button type="button" className="btn primary" onClick={() => submit(true)} disabled={pending}>
              {pending ? "Saving…" : "Yes, mark as sent again"}
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn primary" onClick={onMarkSentClick} disabled={pending || sent}>
            {pending ? "Saving…" : "Mark as sent"}
          </button>
        )}
      </div>

      {editSlot}
    </article>
  );
}
