-- Phase 4: replies, follow-ups and a manual status for every person.
--
-- "Follow-up due" is DERIVED, not stored: someone you messaged with no reply for N days (the
-- follow_up_days setting) is flagged by the app and the Sheet at read time, so it is always
-- current and needs no scheduler. Setting the status to 'follow_up_due' by hand is also allowed.

-- ---------------------------------------------------------------- mark_replied
-- They answered. Records a 'replied' event and moves the person to 'replied', except that
-- someone already at referral / interview / offer keeps that (further along) status.
create function mark_replied(
  p_person_id   uuid,
  p_note        text default null,
  p_occurred_at timestamptz default now()
) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.people where id = p_person_id for update;
  if not found then
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;

  insert into public.outreach_events (person_id, type, occurred_at, source, note)
  values (p_person_id, 'replied', p_occurred_at, 'manual', nullif(btrim(p_note), ''));

  update public.people
     set status = 'replied'
   where id = p_person_id and status not in ('referral', 'interview', 'offer');
end $$;

-- ---------------------------------------------------------------- mark_followed_up
-- You sent a follow-up. Records another 'messaged' event (note starts with "follow-up") so the
-- no-reply clock restarts from now. Only for people still waiting on a reply.
create function mark_followed_up(
  p_person_id uuid,
  p_note      text default null
) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.people where id = p_person_id and status in ('messaged', 'follow_up_due') for update;
  if not found then
    if exists (select 1 from public.people where id = p_person_id) then
      raise exception 'not_awaiting_reply' using errcode = 'P0001';
    end if;
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;

  insert into public.outreach_events (person_id, type, source, note)
  values (p_person_id, 'messaged', 'manual', 'follow-up' || coalesce(': ' || nullif(btrim(p_note), ''), ''));

  update public.people set status = 'messaged' where id = p_person_id;
end $$;

-- ---------------------------------------------------------------- set_person_status
create function set_person_status(
  p_person_id uuid,
  p_status    public.person_status
) returns void
language plpgsql set search_path = '' as $$
begin
  update public.people set status = p_status where id = p_person_id;
  if not found then
    raise exception 'person_not_found' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------- people_overview: follow-up count
create or replace view people_overview with (security_invoker = true) as
select p.*,
       (select min(e.occurred_at) from outreach_events e where e.person_id = p.id and e.type = 'requested') as requested_at,
       (select min(e.occurred_at) from outreach_events e where e.person_id = p.id and e.type = 'accepted')  as accepted_at,
       (select max(e.occurred_at) from outreach_events e where e.person_id = p.id and e.type = 'messaged')  as last_messaged_at,
       (select max(e.occurred_at) from outreach_events e where e.person_id = p.id and e.type = 'replied')   as last_replied_at,
       (select count(*) from messages_sent m where m.person_id = p.id)                                     as messages_sent_count,
       (select count(*) from outreach_events e where e.person_id = p.id and e.type = 'messaged' and e.note like 'follow-up%') as follow_ups_count
  from people p;

-- ---------------------------------------------------------------- privileges
revoke execute on function
  mark_replied(uuid, text, timestamptz),
  mark_followed_up(uuid, text),
  set_person_status(uuid, public.person_status)
from public, anon;

grant execute on function
  mark_replied(uuid, text, timestamptz),
  mark_followed_up(uuid, text),
  set_person_status(uuid, public.person_status)
to authenticated;
