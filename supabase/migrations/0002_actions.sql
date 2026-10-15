-- Phase 2: atomic actions the dashboard calls via supabase.rpc().
-- supabase-js has no transactions, so every multi-row change lives in one function.
-- All functions are SECURITY INVOKER (the default): RLS applies to the caller, and
-- only the `authenticated` role may execute them.

-- ---------------------------------------------------------------- upsert_company
-- Finds a company by case-insensitive name, or creates it. Never changes the
-- category of an existing company. Returns null for a blank name.
create function upsert_company(
  p_name     text,
  p_category public.company_category default 'other_relevant'
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_name is null or btrim(p_name) = '' then
    return null;
  end if;

  select c.id into v_id
    from public.companies c
   where lower(btrim(c.name)) = lower(btrim(p_name));

  if v_id is null then
    insert into public.companies (name, category)
    values (btrim(p_name), p_category)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- log_request
-- Quick-log of a connection request you sent: person + company + 'requested' event.
-- A duplicate profile_url_key raises unique_violation (23505); the app reports it.
create function log_request(
  p_full_name        text,
  p_profile_url      text,
  p_profile_url_key  text,
  p_role             text default null,
  p_company_name     text default null,
  p_company_category public.company_category default 'other_relevant',
  p_requested_at     timestamptz default now()
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_company uuid;
  v_person  uuid;
begin
  v_company := public.upsert_company(p_company_name, p_company_category);

  insert into public.people
    (full_name, role, company_id, company_name_raw, profile_url, profile_url_key, status)
  values
    (btrim(p_full_name), nullif(btrim(p_role), ''), v_company, nullif(btrim(p_company_name), ''),
     nullif(btrim(p_profile_url), ''), p_profile_url_key, 'requested')
  returning id into v_person;

  insert into public.outreach_events (person_id, type, occurred_at, source)
  values (v_person, 'requested', p_requested_at, 'manual');

  return v_person;
end $$;

-- ---------------------------------------------------------------- mark_accepted
-- Idempotent: the 'accepted' event is only written once; status only moves forward
-- from new/requested, so a late call never downgrades someone already messaged.
create function mark_accepted(
  p_person_id   uuid,
  p_occurred_at timestamptz default now()
) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.people where id = p_person_id for update;
  if not found then
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.outreach_events e
     where e.person_id = p_person_id and e.type = 'accepted'
  ) then
    insert into public.outreach_events (person_id, type, occurred_at, source)
    values (p_person_id, 'accepted', p_occurred_at, 'manual');
  end if;

  update public.people
     set status = 'accepted'
   where id = p_person_id and status in ('new', 'requested');
end $$;

-- ---------------------------------------------------------------- mark_message_sent
-- Records exactly what was sent (final_text), with the template version used.
-- Duplicate-send prevention: if the person already has a message and
-- p_allow_duplicate is false, raises 'already_messaged' so the UI can ask first.
-- The row lock makes a double click safe.
create function mark_message_sent(
  p_person_id        uuid,
  p_template_id      uuid,
  p_template_version int,
  p_final_text       text,
  p_allow_duplicate  boolean default false
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_final_text is null or btrim(p_final_text) = '' then
    raise exception 'empty_message' using errcode = 'P0001';
  end if;

  perform 1 from public.people where id = p_person_id for update;
  if not found then
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;

  if not p_allow_duplicate
     and exists (select 1 from public.messages_sent m where m.person_id = p_person_id) then
    raise exception 'already_messaged' using errcode = 'P0001';
  end if;

  insert into public.messages_sent (person_id, template_id, template_version, final_text)
  values (p_person_id, p_template_id, p_template_version, p_final_text)
  returning id into v_id;

  insert into public.outreach_events (person_id, type, source)
  values (p_person_id, 'messaged', 'manual');

  update public.people
     set status = 'messaged'
   where id = p_person_id and status in ('new', 'requested', 'accepted', 'follow_up_due');

  return v_id;
end $$;

-- ---------------------------------------------------------------- set_person_company
create function set_person_company(
  p_person_id        uuid,
  p_company_name     text,
  p_company_category public.company_category default 'other_relevant'
) returns void
language plpgsql set search_path = '' as $$
declare
  v_company uuid;
begin
  v_company := public.upsert_company(p_company_name, p_company_category);
  update public.people
     set company_id = v_company,
         company_name_raw = nullif(btrim(p_company_name), '')
   where id = p_person_id;
  if not found then
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------- privileges
-- Functions are executable by PUBLIC by default; lock them to `authenticated`.
revoke execute on function
  upsert_company(text, public.company_category),
  log_request(text, text, text, text, text, public.company_category, timestamptz),
  mark_accepted(uuid, timestamptz),
  mark_message_sent(uuid, uuid, int, text, boolean),
  set_person_company(uuid, text, public.company_category)
from public, anon;

grant execute on function
  upsert_company(text, public.company_category),
  log_request(text, text, text, text, text, public.company_category, timestamptz),
  mark_accepted(uuid, timestamptz),
  mark_message_sent(uuid, uuid, int, text, boolean),
  set_person_company(uuid, text, public.company_category)
to authenticated;
