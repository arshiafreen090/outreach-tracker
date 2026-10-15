import type { CompanyCategory } from "./categories";

export type PersonStatus =
  | "new" | "requested" | "accepted" | "messaged" | "replied"
  | "follow_up_due" | "referral" | "interview" | "offer" | "dead";

/** A row of the people_overview view. */
export interface PersonRow {
  id: string;
  full_name: string;
  first_name: string | null;
  role: string | null;
  company_id: string | null;
  company_name_raw: string | null;
  profile_url: string | null;
  profile_url_key: string | null;
  photo_url: string | null;
  status: PersonStatus;
  notes: string | null;
  requested_at: string | null;
  accepted_at: string | null;
  last_messaged_at: string | null;
  last_replied_at: string | null;
  messages_sent_count: number;
  /** Follow-ups you logged after the first message (migration 0005). */
  follow_ups_count: number;
}

export interface CompanyRow {
  id: string;
  name: string;
  category: CompanyCategory;
  website: string | null;
  linkedin_url: string | null;
  blurb: string | null;
  notes: string | null;
}

/** A row of the templates_current view (latest version of each template). */
export interface TemplateRow {
  template_id: string;
  key: string;
  name: string;
  description: string | null;
  warning: string | null;
  default_category: CompanyCategory | null;
  is_archived: boolean;
  version: number;
  body: string;
}

export interface LastMessage {
  person_id: string;
  template_id: string;
  template_version: number;
  final_text: string;
  sent_at: string;
}

/** An accepted person seen in an email. 'unmatched' ones wait for you on the Unknown accepts page. */
export interface AcceptCandidate {
  id: string;
  full_name: string;
  headline: string | null;
  company_hint: string | null;
  profile_url: string | null;
  profile_url_key: string;
  photo_url: string | null;
  accepted_at: string;
  status: "unmatched" | "linked" | "dismissed";
  match_method: "url" | "name" | "manual" | null;
  person_id: string | null;
}
