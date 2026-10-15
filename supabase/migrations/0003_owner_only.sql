-- Phase 2 hardening: RLS no longer trusts "any signed-in user".
--
-- 0001 let the `authenticated` role do anything, which is only safe while public
-- sign-ups are switched off. Now every policy also requires the caller's verified
-- JWT email to be the one row in app_owner, so a stranger who manages to sign up
-- still sees and changes nothing. Turning sign-ups off remains good hygiene.
--
-- app_owner is filled by `npm run seed:templates` from ALLOWED_EMAIL (it can also be
-- set by hand: insert into app_owner (email) values ('you@example.com');).
-- Until it has a row, nobody can use the dashboard.

create table app_owner (
  email text primary key check (email <> '' and email = lower(btrim(email)))
);
alter table app_owner enable row level security;   -- deliberately no policies
revoke all on app_owner from anon, authenticated;  -- only the secret key / SQL Editor can touch it

-- SECURITY DEFINER so it can read app_owner on the caller's behalf; the caller can
-- learn only a yes/no. auth.jwt() is the signature-verified token of the request.
create function is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.app_owner o
     where o.email = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

revoke execute on function is_owner() from public, anon;
grant execute on function is_owner() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies', 'people', 'email_ingest_log', 'outreach_events', 'templates',
    'template_versions', 'messages_sent', 'jobs', 'settings'
  ] loop
    execute format('drop policy %I on public.%I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())',
      t || '_owner_all', t
    );
  end loop;
end $$;
