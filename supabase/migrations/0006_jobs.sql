-- Phase 5: the jobs feed.
--
-- Jobs arrive from two places: LinkedIn job-alert emails (saved at ingest) and the public job-board
-- APIs of companies you follow (job_sources, pulled daily). upsert_job is the one door in: it
-- de-duplicates by (source, id), and also by company + title + city so the same opening seen on two
-- sources is stored once, with both sources recorded in seen_in.

alter table jobs
  add column location      text,
  add column work_mode     text,                  -- Hybrid / On-site / Remote as the source labels it
  add column saved_search  text,                  -- the LinkedIn alert that produced it
  add column role_family   text not null default 'other'
    check (role_family in ('data_analytics', 'product_analytics', 'data_science', 'ml', 'ai', 'swe', 'other')),
  add column is_internship boolean not null default false,
  add column soft_key      text,                  -- normalised company|title|city, for cross-source de-duplication
  add column seen_in       text[] not null default '{}';

-- 'dismissed' = "not interested", so irrelevant jobs stop cluttering the feed.
alter table jobs drop constraint jobs_status_check;
alter table jobs add constraint jobs_status_check check (status in ('new', 'seen', 'applied', 'dismissed'));
alter table jobs add constraint jobs_url_http_check check (url is null or url ~* '^https?://');

create index jobs_soft_key_idx on jobs (soft_key) where soft_key is not null;
create index jobs_family_idx   on jobs (role_family, found_at desc);

-- ---------------------------------------------------------------- job_sources
-- A company's public job board. Only fixed, known API hosts are ever called (no arbitrary URLs).
create table job_sources (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('greenhouse', 'lever', 'ashby')),
  slug           text not null check (slug ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  label          text,                             -- the company name shown on its jobs
  company_id     uuid references companies (id) on delete set null,
  enabled        boolean not null default true,
  last_pulled_at timestamptz,
  last_status    text,                             -- 'ok' or why the last pull failed
  last_job_count int,                              -- jobs the board listed
  last_new_count int,                              -- relevant jobs that were new to you
  created_at     timestamptz not null default now(),
  unique (kind, slug)
);

alter table job_sources enable row level security;
create policy job_sources_owner_all on job_sources
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on job_sources from anon;

-- ---------------------------------------------------------------- upsert_job
-- Returns 'inserted' | 'duplicate' | 'duplicate_soft'. Never changes a job you already triaged:
-- seen, applied and dismissed stay as they are when the job shows up again.
create function upsert_job(
  p_source        text,
  p_external_id   text,
  p_title         text,
  p_company       text,
  p_location      text,
  p_work_mode     text,
  p_url           text,
  p_saved_search  text,
  p_role_family   text,
  p_is_internship boolean,
  p_soft_key      text,
  p_posted_at     timestamptz,
  p_found_at      timestamptz,
  p_ingest_id     uuid
) returns text
language plpgsql set search_path = '' as $$
declare
  v_key      text := p_source || ':' || p_external_id;
  v_existing uuid;
  v_company  uuid;
begin
  if btrim(coalesce(p_source, '')) = '' or btrim(coalesce(p_external_id, '')) = '' or btrim(coalesce(p_title, '')) = '' then
    raise exception 'invalid_job' using errcode = '22023';
  end if;

  perform 1 from public.jobs where dedupe_key = v_key;
  if found then
    return 'duplicate';
  end if;

  if p_soft_key is not null then
    select j.id into v_existing from public.jobs j where j.soft_key = p_soft_key order by j.found_at limit 1;
    if found then
      update public.jobs
         set seen_in = case when p_source = any (seen_in) then seen_in else array_append(seen_in, p_source) end
       where id = v_existing;
      return 'duplicate_soft';
    end if;
  end if;

  select c.id into v_company
    from public.companies c
   where p_company is not null and lower(btrim(c.name)) = lower(btrim(p_company))
   limit 1;

  insert into public.jobs
    (title, company_name, company_id, url, source, posted_at, found_at, dedupe_key, ingest_id,
     location, work_mode, saved_search, role_family, is_internship, soft_key, seen_in)
  values
    (btrim(p_title), nullif(btrim(p_company), ''), v_company, p_url, p_source, p_posted_at, coalesce(p_found_at, now()), v_key, p_ingest_id,
     nullif(btrim(p_location), ''), nullif(btrim(p_work_mode), ''), nullif(btrim(p_saved_search), ''),
     coalesce(p_role_family, 'other'), coalesce(p_is_internship, false), p_soft_key, array[p_source]);
  return 'inserted';
end $$;

revoke execute on function
  upsert_job(text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid)
from public, anon, authenticated;
grant execute on function
  upsert_job(text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid)
to service_role;
