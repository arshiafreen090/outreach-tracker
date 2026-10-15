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

/** A row of the jobs table (migration 0006 added most of these columns). */
export interface JobRow {
  id: string;
  title: string;
  company_name: string | null;
  company_id: string | null;
  url: string | null;
  source: string;
  posted_at: string | null;
  found_at: string;
  status: "new" | "seen" | "applied" | "dismissed";
  location: string | null;
  work_mode: string | null;
  saved_search: string | null;
  role_family: "data_analytics" | "product_analytics" | "data_science" | "ml" | "ai" | "swe" | "other";
  is_internship: boolean;
  seen_in: string[];
}

/** A company job board you follow. */
export interface JobSourceRow {
  id: string;
  kind: "greenhouse" | "lever" | "ashby";
  slug: string;
  label: string | null;
  enabled: boolean;
  last_pulled_at: string | null;
  last_status: string | null;
  last_job_count: number | null;
  last_new_count: number | null;
}
