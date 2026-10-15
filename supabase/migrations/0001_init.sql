-- Outreach tracker: initial schema (single user, Supabase free tier).
-- Run in Supabase Dashboard -> SQL Editor, or `supabase db push`.
--
-- Access model: RLS is ON for every table. The only policy grants the
-- `authenticated` role full access; public sign-ups are disabled in Supabase
-- Auth, so the one user you create is the only authenticated user. `anon`
-- gets nothing. The server-side secret key (ingest API route, seed script)
-- bypasses RLS by design.

-- ---------------------------------------------------------------- enums
create type company_category as enum (
  'quick_commerce', 'food_delivery', 'other_relevant', 'small_startup'
);

create type person_status as enum (
  'new', 'requested', 'accepted', 'messaged', 'replied',
  'follow_up_due', 'referral', 'interview', 'offer', 'dead'
);

create type outreach_event_type as enum (
  'requested', 'accepted', 'messaged', 'replied'
);

-- ---------------------------------------------------------------- helpers
create function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- companies
create table companies (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (btrim(name) <> ''),
  category     company_category not null,
  website      text,
  linkedin_url text,
  blurb        text,
  blurb_source text check (blurb_source in ('auto', 'manual')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index companies_name_unique on companies (lower(btrim(name)));
create trigger companies_updated_at before update on companies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- people
create table people (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null check (btrim(full_name) <> ''),
  first_name       text,   -- optional override; the engine derives it from full_name when null
  role             text,   -- headline / job title as seen in the email or typed
  company_id       uuid references companies (id) on delete set null,
  company_name_raw text,   -- company text as received; kept when no companies row matches yet
  profile_url      text,
  profile_url_key  text,   -- normalised by the app for matching accept emails to requests
  photo_url        text,   -- URL only; never downloaded server-side
  status           person_status not null default 'new',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index people_profile_url_key_unique on people (profile_url_key)
  where profile_url_key is not null;
create index people_status_idx    on people (status);
create index people_company_idx   on people (company_id);
create index people_full_name_idx on people (lower(btrim(full_name)));
create trigger people_updated_at before update on people
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- email_ingest_log
-- One row per Gmail message the Apps Script has seen. Raw body is kept so the
-- parser can be debugged against real emails. gmail_message_id makes retries idempotent.
create table email_ingest_log (
  id               uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  received_at      timestamptz,
  from_address     text,
  subject          text,
  kind             text not null default 'other'
                     check (kind in ('accept', 'message', 'job_alert', 'other')),
  parse_status     text not null default 'failed'
                     check (parse_status in ('parsed', 'partial', 'failed', 'ignored')),
  parse_result     jsonb,
  parse_error      text,
  raw_body         text,
  person_id        uuid references people (id) on delete set null,  -- null on an accept = "link it manually"
  created_at       timestamptz not null default now()
);
create index email_ingest_log_received_idx on email_ingest_log (received_at desc);

-- ---------------------------------------------------------------- outreach_events
create table outreach_events (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references people (id) on delete cascade,
  type        outreach_event_type not null,
  occurred_at timestamptz not null default now(),
  source      text not null default 'manual' check (source in ('manual', 'email', 'import')),
  ingest_id   uuid references email_ingest_log (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index outreach_events_person_idx on outreach_events (person_id, type, occurred_at desc);

-- ---------------------------------------------------------------- templates
-- A template row is identity + metadata. The text lives in template_versions.
create table templates (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique check (key ~ '^[a-z0-9_]+$'),
  name             text not null,
  description      text,
  warning          text,                       -- shown in the UI when this template is selected
  default_category company_category unique,    -- at most one default template per category
  is_archived      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger templates_updated_at before update on templates
  for each row execute function set_updated_at();

create table template_versions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates (id) on delete restrict,
  version     int  not null check (version >= 1),
  body        text not null,
  note        text,
  created_at  timestamptz not null default now(),
  unique (template_id, version)
);

-- Omit `version` on insert and the next number is assigned automatically.
create function template_versions_assign_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.version is null then
    select coalesce(max(v.version), 0) + 1 into new.version
      from public.template_versions v
     where v.template_id = new.template_id;
  end if;
  return new;
end $$;
create trigger template_versions_assign_version before insert on template_versions
  for each row execute function template_versions_assign_version();

-- Every version is kept forever: editing a template means inserting a new version.
create function template_versions_block_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'template_versions rows are immutable: insert a new version instead';
end $$;
create trigger template_versions_immutable before update or delete on template_versions
  for each row execute function template_versions_block_changes();

create view templates_current with (security_invoker = true) as
select t.id          as template_id,
       t.key, t.name, t.description, t.warning, t.default_category, t.is_archived,
       v.id          as version_id,
       v.version,
       v.body,
       v.created_at  as version_created_at
  from templates t
  join lateral (
    select * from template_versions tv
     where tv.template_id = t.id
     order by tv.version desc
     limit 1
  ) v on true;

-- ---------------------------------------------------------------- messages_sent
create table messages_sent (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references people (id) on delete cascade,
  template_id      uuid not null,
  template_version int  not null,
  final_text       text not null,   -- exactly what was copied, after any manual edits
  sent_at          timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  foreign key (template_id, template_version)
    references template_versions (template_id, version)
);
create index messages_sent_person_idx on messages_sent (person_id, sent_at desc);

-- ---------------------------------------------------------------- jobs
create table jobs (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  company_name text,
  company_id   uuid references companies (id) on delete set null,
  url          text,
  source       text not null,       -- e.g. 'internshala-email', 'naukri-email', 'rss:<name>'
  posted_at    timestamptz,
  found_at     timestamptz not null default now(),
  dedupe_key   text not null unique, -- built by the app from normalised url, or title + company
  status       text not null default 'new' check (status in ('new', 'seen', 'applied')),
  ingest_id    uuid references email_ingest_log (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index jobs_status_found_idx on jobs (status, found_at desc);

-- ---------------------------------------------------------------- settings
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
create trigger settings_updated_at before update on settings
  for each row execute function set_updated_at();

insert into settings (key, value) values
  ('follow_up_days',     '5'),    -- messaged, no reply after N days -> follow-up due
  ('pending_nudge_days', '7'),    -- request still pending after N days -> nudge
  ('show_photos',        'true')  -- off = initials avatars, nothing loaded from LinkedIn's CDN
on conflict (key) do nothing;

-- ---------------------------------------------------------------- derived view
create view people_overview with (security_invoker = true) as
select p.*,
       (select min(e.occurred_at) from outreach_events e where e.person_id = p.id and e.type = 'requested') as requested_at,
       (select min(e.occurred_at) from outreach_events e where e.person_id = p.id and e.type = 'accepted')  as accepted_at,
       (select max(e.occurred_at) from outreach_events e where e.person_id = p.id and e.type = 'messaged')  as last_messaged_at,
       (select max(e.occurred_at) from outreach_events e where e.person_id = p.id and e.type = 'replied')   as last_replied_at,
       (select count(*) from messages_sent m where m.person_id = p.id)                                     as messages_sent_count
  from people p;

-- ---------------------------------------------------------------- security
do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'people', 'email_ingest_log', 'outreach_events', 'templates',
    'template_versions', 'messages_sent', 'jobs', 'settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t
    );
  end loop;
end $$;

revoke all on all tables in schema public from anon;
