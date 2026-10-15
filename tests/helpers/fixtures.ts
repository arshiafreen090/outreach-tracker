import type { CompanyRow, LastMessage, PersonRow, TemplateRow } from "@/lib/db-types";
import { parseSeed } from "@/lib/templates/seed-parser";
import { readRepoFile } from "./db";

/** The four real templates from seed.md, shaped like rows of templates_current. */
export function templateRows(): TemplateRow[] {
  return parseSeed(readRepoFile("templates/seed.md")).map((t, i) => ({
    template_id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    key: t.key,
    name: t.name,
    description: t.description,
    warning: t.warning,
    default_category: t.defaultCategory,
    is_archived: false,
    version: 1,
    body: t.body,
  }));
}

export function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    name: "Zepto",
    category: "quick_commerce",
    website: null,
    linkedin_url: null,
    blurb: null,
    notes: null,
    ...overrides,
  };
}

export function person(overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    full_name: "Priya Sharma",
    first_name: null,
    role: "Data Analyst",
    company_id: "00000000-0000-4000-8000-0000000000c1",
    company_name_raw: "Zepto",
    profile_url: "https://www.linkedin.com/in/priya-sharma/",
    profile_url_key: "in/priya-sharma",
    photo_url: null,
    status: "accepted",
    notes: null,
    requested_at: "2026-10-01T10:00:00Z",
    accepted_at: "2026-10-14T10:00:00Z",
    last_messaged_at: null,
    last_replied_at: null,
    messages_sent_count: 0,
    ...overrides,
  };
}

export function lastMessage(overrides: Partial<LastMessage> = {}): LastMessage {
  return {
    person_id: "00000000-0000-4000-8000-0000000000a1",
    template_id: "00000000-0000-4000-8000-000000000002",
    template_version: 1,
    final_text: "earlier message",
    sent_at: "2026-10-10T10:00:00Z",
    ...overrides,
  };
}
