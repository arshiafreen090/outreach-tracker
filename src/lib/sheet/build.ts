import { CATEGORY_LABELS } from "../categories";
import type { CompanyRow, PersonRow } from "../db-types";
import { isFollowUpDue } from "../followups";
import type { AppSettings } from "../settings";
import { STATUS_LABELS } from "../status";
import { daysSince, formatSheetDateTime } from "../time";

export interface SheetTab {
  name: string;
  headers: string[];
  /** Every row has exactly `headers.length` cells, all text. */
  rows: string[][];
}

export interface SheetMessage {
  person_id: string;
  template_id: string;
  template_version: number;
  sent_at: string;
}

export interface SheetData {
  people: PersonRow[];
  companies: CompanyRow[];
  messages: SheetMessage[];
  templates: { id: string; name: string }[];
  settings: AppSettings;
}

/**
 * Text that came from an email (names, headlines) ends up in spreadsheet cells. A cell that starts
 * with = + - or @ is a formula to Google Sheets, and a formula can read other cells or call out to
 * the internet. A leading apostrophe makes it plain text. (The Apps Script also writes every cell
 * with a plain-text format; this is the second lock.)
 */
export function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const when = (iso: string | null) => (iso ? formatSheetDateTime(iso) : "");

const MESSAGED_HEADERS = ["Sent on", "Name", "Role", "Company", "Template", "Status now", "Replied on", "Follow-up due", "Days since message", "Follow-ups sent", "Profile"];

/** The three tabs mirrored to the Google Sheet. Pure: same data in, same cells out. */
export function buildSheetTabs(data: SheetData, now: Date = new Date()): SheetTab[] {
  const companies = new Map(data.companies.map((c) => [c.id, c]));
  const templates = new Map(data.templates.map((t) => [t.id, t.name]));
  const people = new Map(data.people.map((p) => [p.id, p]));
  const companyOf = (p: PersonRow) => (p.company_id ? companies.get(p.company_id) : undefined);
  const companyName = (p: PersonRow) => companyOf(p)?.name ?? p.company_name_raw ?? "";
  const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

  const accepted = data.people
    .filter((p) => p.accepted_at)
    .sort((a, b) => time(b.accepted_at) - time(a.accepted_at))
    .map((p) => {
      const category = companyOf(p)?.category;
      return [
        cell(p.full_name),
        cell(p.role),
        cell(companyName(p)),
        cell(category ? CATEGORY_LABELS[category] : ""),
        when(p.accepted_at),
        STATUS_LABELS[p.status],
        p.messages_sent_count > 0 ? "Yes" : "No",
        cell(p.profile_url),
      ];
    });

  // The "due" flag belongs to the person's latest message only, so older rows don't all shout.
  const latestMessage = new Map<string, number>();
  for (const m of data.messages) latestMessage.set(m.person_id, Math.max(latestMessage.get(m.person_id) ?? 0, time(m.sent_at)));

  const messaged = data.messages
    .filter((m) => people.has(m.person_id))
    .sort((a, b) => time(b.sent_at) - time(a.sent_at))
    .map((m) => {
      const p = people.get(m.person_id)!;
      const isLatest = time(m.sent_at) === latestMessage.get(m.person_id);
      return [
        when(m.sent_at),
        cell(p.full_name),
        cell(p.role),
        cell(companyName(p)),
        cell(`${templates.get(m.template_id) ?? "Template"} v${m.template_version}`),
        STATUS_LABELS[p.status],
        when(p.last_replied_at),
        isLatest && isFollowUpDue(p, data.settings.followUpDays, now) ? "Yes" : "",
        String(daysSince(m.sent_at, now)),
        String(p.follow_ups_count ?? 0),
        cell(p.profile_url),
      ];
    });

  const pending = data.people
    .filter((p) => p.status === "requested")
    .sort((a, b) => time(a.requested_at) - time(b.requested_at))
    .map((p) => {
      const days = p.requested_at ? daysSince(p.requested_at, now) : null;
      return [
        cell(p.full_name),
        cell(p.role),
        cell(companyName(p)),
        when(p.requested_at),
        days === null ? "" : String(days),
        days !== null && days >= data.settings.pendingNudgeDays ? "Yes" : "",
        cell(p.profile_url),
      ];
    });

  return [
    { name: "Accepted connections", headers: ["Name", "Headline / role", "Company", "Category", "Accepted on", "Status", "Messaged?", "Profile"], rows: accepted },
    { name: "Messaged", headers: MESSAGED_HEADERS, rows: messaged },
    { name: "Pending requests", headers: ["Name", "Role", "Company", "Requested on", "Days pending", "Nudge", "Profile"], rows: pending },
  ];
}
