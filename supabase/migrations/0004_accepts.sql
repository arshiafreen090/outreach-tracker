-- Phase 3: matching "accepted your invitation" emails to the requests you logged.
--
--   apply_accept          called by the ingest route (secret key) for each person in an accept email
--   accept_candidates     one row per accepted person seen in an email: linked to a request,
--                         or 'unmatched' = "unknown accept, link it manually" in the dashboard
--   link_accept / create_person_from_accept / dismiss_accept   the owner's three ways to resolve one
--
-- Matching order: (1) the profile URL key, (2) the full name, but only when exactly one
-- request is still 'requested' under that name. Anything else stays unmatched for a human.

create table accept_candidates (
  id               uuid primary key default gen_random_uuid(),
  ingest_id        uuid references email_ingest_log (id) on delete set null,
  full_name        text not null check (btrim(full_name) <> ''),
  headline         text,
  company_hint     text,                       -- a guess from the headline, only ever a suggestion
  profile_url      text,
  profile_url_key  text not null unique,       -- one row per person, whichever email mentions them first
  photo_url        text,                       -- signed, expiring LinkedIn CDN URL; never downloaded
  accepted_at      timestamptz not null,
  status           text not null default 'unmatched' check (status in ('unmatched', 'linked', 'dismissed')),
  match_method     text check (match_method in ('url', 'name', 'manual')),
  person_id        uuid references people (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index accept_candidates_status_idx on accept_candidates (status, accepted_at desc);

alter table accept_candidates enable row level security;
create policy accept_candidates_owner_all on accept_candidates
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
revoke all on accept_candidates from anon;

-- ---------------------------------------------------------------- record_accepted
-- The shared effect of "this person accepted": one 'accepted' event, status moves forward
-- (never back), and the person picks up the photo, headline and profile URL if they lack them.
create function record_accepted(
  p_person_id       uuid,
  p_accepted_at     timestamptz,
  p_ingest_id       uuid,
  p_photo_url       text,
  p_headline        text,
  p_profile_url     text,
  p_profile_url_key text
) returns void
language plpgsql set search_path = '' as $$
declare
  v_key_free boolean;
begin
  if not exists (
    select 1 from public.outreach_events e where e.person_id = p_person_id and e.type = 'accepted'
  ) then
    insert into public.outreach_events (person_id, type, occurred_at, source, ingest_id)
    values (p_person_id, 'accepted', p_accepted_at, 'email', p_ingest_id);
  end if;

  v_key_free := p_profile_url_key is not null
    and not exists (select 1 from public.people p where p.profile_url_key = p_profile_url_key);

  update public.people
     set status          = case when status in ('new', 'requested') then 'accepted'::public.person_status else status end,
         photo_url       = coalesce(p_photo_url, photo_url),
         role            = coalesce(role, p_headline),
         profile_url     = case when profile_url_key is null and v_key_free then coalesce(profile_url, p_profile_url) else profile_url end,
         profile_url_key = case when profile_url_key is null and v_key_free then p_profile_url_key else profile_url_key end
   where id = p_person_id;
end $$;

-- ---------------------------------------------------------------- apply_accept
-- Returns 'linked_url' | 'linked_name' | 'unmatched' | 'duplicate'. Safe to call again for the
-- same person (a later email, or a re-parse): the second call is a no-op ('duplicate').
create function apply_accept(
  p_ingest_id       uuid,
  p_full_name       text,
  p_headline        text,
  p_company_hint    text,
  p_profile_url     text,
  p_profile_url_key text,
  p_photo_url       text,
  p_accepted_at     timestamptz
) returns text
language plpgsql set search_path = '' as $$
declare
  v_person uuid;
  v_method text;
  v_ids    uuid[];
begin
  if exists (select 1 from public.accept_candidates c where c.profile_url_key = p_profile_url_key) then
    return 'duplicate';
  end if;

  select p.id into v_person from public.people p where p.profile_url_key = p_profile_url_key;
  if found then
    v_method := 'url';
  else
    select array_agg(p.id) into v_ids
      from public.people p
     where p.status = 'requested'
       and lower(btrim(p.full_name)) = lower(btrim(p_full_name));
    if coalesce(cardinality(v_ids), 0) = 1 then
      v_person := v_ids[1];
      v_method := 'name';
    end if;
  end if;

  if v_person is not null then
    perform public.record_accepted(v_person, p_accepted_at, p_ingest_id, p_photo_url, p_headline, p_profile_url, p_profile_url_key);
    insert into public.accept_candidates
      (ingest_id, full_name, headline, company_hint, profile_url, profile_url_key, photo_url, accepted_at, status, match_method, person_id)
    values
      (p_ingest_id, btrim(p_full_name), p_headline, p_company_hint, p_profile_url, p_profile_url_key, p_photo_url, p_accepted_at, 'linked', v_method, v_person);
    return 'linked_' || v_method;
  end if;

  insert into public.accept_candidates
    (ingest_id, full_name, headline, company_hint, profile_url, profile_url_key, photo_url, accepted_at)
  values
    (p_ingest_id, btrim(p_full_name), p_headline, p_company_hint, p_profile_url, p_profile_url_key, p_photo_url, p_accepted_at);
  return 'unmatched';
end $$;

-- ---------------------------------------------------------------- the owner's three actions
create function link_accept(p_candidate_id uuid, p_person_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  c public.accept_candidates;
begin
  select * into c from public.accept_candidates where id = p_candidate_id for update;
  if not found then raise exception 'candidate_not_found' using errcode = 'P0002'; end if;
  if c.status <> 'unmatched' then raise exception 'candidate_not_unmatched' using errcode = 'P0001'; end if;
  perform 1 from public.people where id = p_person_id for update;
  if not found then raise exception 'person_not_found' using errcode = 'P0002'; end if;

  perform public.record_accepted(p_person_id, c.accepted_at, c.ingest_id, c.photo_url, c.headline, c.profile_url, c.profile_url_key);
  update public.accept_candidates set status = 'linked', match_method = 'manual', person_id = p_person_id where id = p_candidate_id;
end $$;

create function create_person_from_accept(
  p_candidate_id     uuid,
  p_company_name     text default null,
  p_company_category public.company_category default 'other_relevant'
) returns uuid
language plpgsql set search_path = '' as $$
declare
  c         public.accept_candidates;
  v_person  uuid;
  v_company uuid;
begin
  select * into c from public.accept_candidates where id = p_candidate_id for update;
  if not found then raise exception 'candidate_not_found' using errcode = 'P0002'; end if;
  if c.status <> 'unmatched' then raise exception 'candidate_not_unmatched' using errcode = 'P0001'; end if;

  -- You may have logged this person since the email arrived: link to them instead of duplicating.
  select p.id into v_person from public.people p where p.profile_url_key = c.profile_url_key;
  if found then
    perform public.record_accepted(v_person, c.accepted_at, c.ingest_id, c.photo_url, c.headline, c.profile_url, c.profile_url_key);
  else
    v_company := public.upsert_company(p_company_name, p_company_category);
    insert into public.people
      (full_name, role, company_id, company_name_raw, profile_url, profile_url_key, photo_url, status)
    values
      (c.full_name, c.headline, v_company, nullif(btrim(p_company_name), ''), c.profile_url, c.profile_url_key, c.photo_url, 'accepted')
    returning id into v_person;
    insert into public.outreach_events (person_id, type, occurred_at, source, ingest_id)
    values (v_person, 'accepted', c.accepted_at, 'email', c.ingest_id);
  end if;

  update public.accept_candidates set status = 'linked', match_method = 'manual', person_id = v_person where id = p_candidate_id;
  return v_person;
end $$;

create function dismiss_accept(p_candidate_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update public.accept_candidates set status = 'dismissed' where id = p_candidate_id and status = 'unmatched';
  if not found then raise exception 'candidate_not_unmatched' using errcode = 'P0001'; end if;
end $$;

-- ---------------------------------------------------------------- privileges
-- apply_accept is for the ingest route only (secret key). The rest are the owner's, behind RLS.
revoke execute on function
  apply_accept(uuid, text, text, text, text, text, text, timestamptz),
  record_accepted(uuid, timestamptz, uuid, text, text, text, text),
  link_accept(uuid, uuid),
  create_person_from_accept(uuid, text, public.company_category),
  dismiss_accept(uuid)
from public, anon, authenticated;

grant execute on function apply_accept(uuid, text, text, text, text, text, text, timestamptz) to service_role;
grant execute on function
  record_accepted(uuid, timestamptz, uuid, text, text, text, text),
  link_accept(uuid, uuid),
  create_person_from_accept(uuid, text, public.company_category),
  dismiss_accept(uuid)
to authenticated, service_role;
