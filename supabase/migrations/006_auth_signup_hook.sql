-- T044 — Supabase Auth post-signup hook → member.create
-- Source: notes/migration-to-primitives.md § Phase 0 — AI-native floor
-- Decisions encoded: rebuild-plan exit criterion (Member row + member.created
-- event auto-created when a new auth.users row appears).
--
-- Mechanism: AFTER INSERT trigger on auth.users → handle_new_auth_user()
-- function → pg_net.http_post fire-and-forget to /api/internal/auth-signup
-- → that Next.js route invokes the member.create action handler.
--
-- pg_net is async by default; the trigger returns immediately. Failures
-- (route unreachable, signature mismatch, handler error) are visible in
-- pg_net's response table (net._http_response). A nightly reconciliation
-- job (Phase 1+) sweeps auth.users for rows without a corresponding members
-- row and replays member.create. Not a Phase 0 deliverable.
--
-- Per T044 Notes: chose Postgres-trigger-via-pg_net over Edge Function
-- because it keeps the floor entirely in the DB and avoids the supabase-CLI
-- ↔ Edge-Function deploy coupling. Cost: ~50–100ms of signup latency.

create extension if not exists pg_net;
create extension if not exists pgcrypto;

-- Configuration GUCs. Set these on the DB so the trigger function can read
-- them. For local Supabase, run:
--
--   alter database postgres set app.auth_signup_hook_url
--     = 'http://host.docker.internal:3000/api/internal/auth-signup';
--   alter database postgres set app.auth_signup_hook_secret
--     = '<a secret you also set in web/.env.local as AUTH_SIGNUP_HOOK_SECRET>';
--
-- For production, alter the linked DB with the deployed URL + a rotated
-- secret. Rotate quarterly per ADR-9.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  payload         jsonb;
  payload_str     text;
  signature       text;
  signup_url      text;
  secret          text;
  request_id      bigint;
begin
  -- Skip system-internal auth.users rows (none expected at Phase 0, but
  -- defensive). The system Member already exists; we do not want to
  -- double-bootstrap it via the hook.
  if new.id = '00000000-0000-0000-0000-000000000001'::uuid then
    return new;
  end if;

  -- Build the payload that the route expects.
  payload := jsonb_build_object(
    'authUserId',       new.id,
    'email',            new.email,
    'handleSuggestion', coalesce(new.raw_user_meta_data ->> 'handle_suggestion', null)
  );
  -- Canonical JSON string for signing. Postgres jsonb::text gives a stable
  -- representation; the route signs the body bytes it receives, so we must
  -- use the same representation as what is sent.
  payload_str := payload::text;

  -- Read config from GUCs. `missing_ok := true` returns null instead of
  -- raising when unset; the trigger then no-ops with a warning.
  secret := current_setting('app.auth_signup_hook_secret', true);
  signup_url := current_setting('app.auth_signup_hook_url', true);

  if secret is null or secret = '' or signup_url is null or signup_url = '' then
    raise warning
      'auth-signup hook not configured (app.auth_signup_hook_url / app.auth_signup_hook_secret missing). Member row for auth user % will NOT be auto-created. Set the GUCs and replay via reconciliation.',
      new.id;
    return new;
  end if;

  -- HMAC-SHA256 the payload bytes with the secret. extensions.hmac is from
  -- pgcrypto; output is bytea, encode to hex.
  signature := encode(
    extensions.hmac(payload_str::bytea, secret::bytea, 'sha256'),
    'hex'
  );

  -- Fire-and-forget POST. net.http_post returns a request id we don't
  -- await. Failures surface in net._http_response asynchronously.
  select net.http_post(
    url     := signup_url,
    body    := payload,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-signature',  signature
    )
  ) into request_id;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

comment on function public.handle_new_auth_user is
  'T044 — Fires on auth.users insert. HMAC-signs a payload with app.auth_signup_hook_secret and POSTs to app.auth_signup_hook_url. Async via pg_net. The route invokes member.create with the new auth user id; idempotent on retry via members.id unique constraint (409 on duplicate). Failures visible in net._http_response.';

comment on trigger on_auth_user_created on auth.users is
  'T044 — Bridges Supabase Auth signup to the rebuild action layer. Phase 0 exit criterion: new auth user → members row + member.created event with acting_member_id = new id.';
