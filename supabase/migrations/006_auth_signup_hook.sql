-- T044 — Supabase Auth post-signup hook → member.create
-- Source: notes/migration-to-primitives.md § Phase 0 — AI-native floor
-- Decisions encoded: rebuild-plan exit criterion (Member row + member.created
-- event auto-created when a new auth.users row appears).
--
-- Mechanism: AFTER INSERT trigger on auth.users → handle_new_auth_user()
-- function → pg_net.http_post fire-and-forget to /api/internal/auth-signup
-- → that Next.js route invokes the member.create action handler.
--
-- Configuration via Supabase Vault (NOT custom GUCs — Supabase restricts
-- which GUC prefixes the postgres role can set; ALTER DATABASE on
-- `app.*` is permission-denied). Vault is the documented Supabase pattern
-- for trigger-readable secrets.
--
-- After this migration applies, the user populates Vault once (Studio's SQL
-- Editor or psql — see the leading comment in the function below for the
-- exact statements). The trigger function reads via
-- vault.decrypted_secrets at fire time.
--
-- pg_net is async by default; the trigger returns immediately. Failures
-- (route unreachable, signature mismatch, handler error) are visible in
-- net._http_response. A nightly reconciliation job (Phase 1+) sweeps
-- auth.users for rows without a corresponding members row and replays
-- member.create. Not a Phase 0 deliverable.

create extension if not exists pg_net;
create extension if not exists pgcrypto;
-- vault is pre-installed on Supabase; this is defensive.
create extension if not exists supabase_vault;

------------------------------------------------------------
-- Trigger function — reads URL + secret from Vault.
------------------------------------------------------------
-- ONE-TIME SETUP after `supabase db reset` (run in Studio SQL Editor):
--
--   select vault.create_secret(
--     'http://host.docker.internal:3000/api/internal/auth-signup',
--     'auth_signup_hook_url',
--     'URL the post-signup hook POSTs to (Phase 0 — T044)'
--   );
--
--   select vault.create_secret(
--     'local-dev-secret-must-be-at-least-16-chars-long',
--     'auth_signup_hook_secret',
--     'HMAC-SHA256 signing key for the auth-signup hook (Phase 0 — T044)'
--   );
--
-- For production: rotate the secret quarterly per ADR-9. The URL value can
-- be updated via:
--
--   update vault.secrets set secret = '<new value>' where name = 'auth_signup_hook_url';
--
-- Match AUTH_SIGNUP_HOOK_SECRET in web/.env.local to the Vault secret's value.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net, vault
as $$
declare
  payload         jsonb;
  payload_str     text;
  signature       text;
  signup_url      text;
  secret          text;
  request_id      bigint;
begin
  -- Skip system-internal auth.users rows (defensive). The system Member
  -- already exists; we do not double-bootstrap via the hook.
  if new.id = '00000000-0000-0000-0000-000000000001'::uuid then
    return new;
  end if;

  -- Read configuration from Vault.
  select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'auth_signup_hook_secret'
    limit 1;

  select decrypted_secret into signup_url
    from vault.decrypted_secrets
    where name = 'auth_signup_hook_url'
    limit 1;

  if secret is null or secret = '' or signup_url is null or signup_url = '' then
    raise warning
      'auth-signup hook not configured (vault secrets auth_signup_hook_url / auth_signup_hook_secret missing). Member row for auth user % will NOT be auto-created. Populate vault.secrets and replay via reconciliation.',
      new.id;
    return new;
  end if;

  -- Build the payload that the route expects.
  payload := jsonb_build_object(
    'authUserId',       new.id,
    'email',            new.email,
    'handleSuggestion', coalesce(new.raw_user_meta_data ->> 'handle_suggestion', null)
  );
  -- Canonical JSON string for signing. The route signs the body bytes it
  -- receives, so we must use the same representation as what is sent.
  payload_str := payload::text;

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
  'T044 — Fires on auth.users insert. Reads URL + HMAC secret from vault.decrypted_secrets (names auth_signup_hook_url / auth_signup_hook_secret). HMAC-SHA256-signs the payload and POSTs to the URL via pg_net (async). The route invokes member.create with the new auth user id; idempotent on retry via members.id unique constraint (409 on duplicate). Failures visible in net._http_response.';

-- COMMENT ON TRIGGER on auth.users would require ownership of auth.users,
-- which the postgres role does not have (auth.users is owned by
-- supabase_auth_admin). The function comment above carries the
-- documentation; the trigger itself is self-describing via its name and
-- create-trigger DDL.
