-- T090 — email_is_registered RPC (F030 email-first signup).
--
-- Powers the single "enter email" signup page's returning-user detection:
-- a registered email routes to "enter password" (sign in); an unknown email
-- routes to "set a password" (sign up). `members` has no email column (the
-- T044 signup hook mirrors auth.users → members by id, not email), so the
-- lookup must read auth.users — hence SECURITY DEFINER, same pattern as the
-- 002/006/009 auth-reading functions.
--
-- Enumeration note: exposing existence to anon is inherent to the requested
-- email-first UX (the two-phase prompt reveals existence either way). Scope is
-- limited to a boolean; no other auth.users data is returned. See DEVIATIONS.

create or replace function public.email_is_registered(p_email text)
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(trim(p_email))
  );
$$;

revoke all on function public.email_is_registered(text) from public;
grant execute on function public.email_is_registered(text) to anon, authenticated;

comment on function public.email_is_registered(text) is
  'F030 email-first signup: true when an auth.users row matches the email (case-insensitive). Boolean-only by design; returning-user UX is inherently enumerable.';
