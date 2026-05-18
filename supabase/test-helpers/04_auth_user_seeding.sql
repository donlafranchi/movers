-- ─────────────────────────────────────────────────────────────────────────
-- Phase 0 eval helpers (04): auth.users seeding for ADR-15 compliance
-- Source: notes/migration-to-primitives.md § Phase 0 — AI-native floor
-- ADR:    planning/adrs/ADR-15 (members.id ∈ auth.users invariant)
-- Consumed by: web/evals/phase-0/floor.spec.ts (T042 + T043 + RLS smoke)
--
-- PRODUCTION-SAFETY REMINDER
-- This file lives in supabase/test-helpers/, NOT supabase/migrations/. The
-- helpers below write directly to auth.users — a schema the postgres role
-- does NOT own, and which production code paths reach only via
-- supabase_auth_admin (the auth signup flow). It is allowlisted only
-- because the test-helpers/ folder is unreachable by `supabase db push`,
-- and the bootstrap-eval-helpers.ts script refuses to run against any host
-- outside the localhost allowlist.
--
-- WHY THIS FILE EXISTS
-- T047 (009_members_phase1.sql) added the constraint trigger
-- `members_assert_id_in_auth_users` that rejects any public.members insert
-- whose id is not present in auth.users (system-Member exempted). This
-- encodes ADR-15: the only legitimate path to a public.members row is via
-- an auth.users insert + the signup hook firing member.create.
--
-- The Phase 0 spec at web/evals/phase-0/floor.spec.ts and the seed helper
-- in 03_handle_collisions.sql were both authored before T047 landed; they
-- mint random UUIDs and insert into public.members directly. After T047 the
-- constraint trigger rejects those inserts with SQLSTATE 23503. The fix is
-- to land a real auth.users row first, satisfying the trigger.
--
-- WHY NOT JUST CALL admin.auth.admin.createUser(...) FROM THE SPEC
-- For the per-test probes that's the cleanest path and the spec uses it.
-- But two scenarios need a Postgres-side seeding helper:
--   1. The 99-collision bulk seed (eval_seed_handle_collision_range) needs
--      99 auth.users rows; calling createUser 99 times is slow, pollutes
--      the auth signup-hook path, and re-fires the pg_net hook for each.
--   2. The T043 member.create handler tests must run with a fresh members
--      row insert — but admin.auth.admin.createUser fires the signup hook
--      which in turn calls member.create. By the time the spec invokes
--      invokeMemberCreate, the hook has likely already created the row and
--      the test's call hits ConflictError instead of exercising the
--      handler. A side-channel auth.users insert that does NOT fire the
--      signup hook is what the test needs.
--
-- HOW THE HOOK BYPASS WORKS
-- The migration in 006_auth_signup_hook.sql installs handle_new_auth_user()
-- (AFTER INSERT trigger on auth.users). This file replaces that function
-- with a version that honors a session-local GUC: when
-- current_setting('eval.skip_signup_hook', true) = 'on', the function
-- returns immediately without queueing the pg_net call. The override is
-- behavior-preserving for every code path that doesn't set the GUC —
-- production paths never set it.
--
-- The eval_seed_auth_user_only helper does
--   perform set_config('eval.skip_signup_hook', 'on', true);
-- before inserting into auth.users. The `true` arg makes it transaction-
-- local; the next statement boundary clears it.
--
-- ARCHITECTURE NOTE
-- One helper is sufficient. Earlier drafts considered a paired
-- "auth_and_member" helper for the bulk case, but the bulk seed already
-- writes the members rows directly inside a single INSERT … SELECT — all
-- we need is the auth.users predicate to be true at the constraint
-- trigger's deferred-check time. The helper exposes the auth.users insert;
-- the bulk seed's loop wraps it.
-- ─────────────────────────────────────────────────────────────────────────

------------------------------------------------------------
-- 1. Hook override: honor eval.skip_signup_hook session GUC.
------------------------------------------------------------
-- The original function lives in 006_auth_signup_hook.sql. The body below
-- is byte-identical to that migration's function EXCEPT for the new early
-- return that respects the GUC. Production paths never set the GUC; only
-- this folder's helpers do, and only inside their own transaction.

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
  -- ─── EVAL-ONLY BYPASS (test-helpers override) ───
  -- Honor the session-local GUC set by eval_seed_auth_user_only. Production
  -- paths never set this GUC; the GUC has no platform-side meaning.
  -- current_setting(name, true) returns '' (empty) when the GUC is unset,
  -- so the comparison is safe in normal use.
  if current_setting('eval.skip_signup_hook', true) = 'on' then
    return new;
  end if;

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

  payload := jsonb_build_object(
    'authUserId',       new.id,
    'email',            new.email,
    'handleSuggestion', coalesce(new.raw_user_meta_data ->> 'handle_suggestion', null)
  );
  payload_str := payload::text;

  signature := encode(
    extensions.hmac(payload_str::bytea, secret::bytea, 'sha256'),
    'hex'
  );

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

comment on function public.handle_new_auth_user() is
  'T044 — Fires on auth.users insert. EVAL OVERRIDE (test-helpers/04_auth_user_seeding.sql): respects session-local GUC eval.skip_signup_hook=on for test-side seeding. Behavior-preserving for every production path that does not set the GUC.';

------------------------------------------------------------
-- 2. eval_seed_auth_user_only — minimal auth.users insert.
------------------------------------------------------------
-- Inserts a minimum-viable auth.users row to satisfy
-- members_assert_id_in_auth_users at deferred-check time. Sets
-- eval.skip_signup_hook=on transaction-locally so the trigger function
-- short-circuits.
--
-- Column choices below — only fields with NOT NULL or load-bearing
-- defaults that the trigger cascade touches are populated:
--   - id, email: identity for the trigger function and any downstream
--     spec that queries auth.users by email.
--   - aud='authenticated', role='authenticated': standard Supabase auth
--     defaults; some auth.users views and trigger functions reference
--     them.
--   - encrypted_password: dummy bytea-of-text. Real signups carry an
--     argon2id hash; the seeded rows are never logged in as.
--   - email_confirmed_at, instance_id: defaults that real signups have;
--     populating defensively to keep downstream auth view queries quiet.
--
-- Idempotent via `on conflict (id) do nothing`. A re-seed of the same id
-- is a no-op.

create or replace function public.eval_seed_auth_user_only(
  p_id uuid,
  p_email text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  effective_email text;
begin
  -- ALWAYS synthesize a UUID-prefixed unique email for the auth.users row.
  -- p_email used to flow through to auth.users.email, but auth.users has a
  -- UNIQUE constraint on email and our ON CONFLICT clause only catches id
  -- conflicts. When the same p_email was reused across test runs (e.g.
  -- 'maya@example.test' across reruns of the maya-collision spec) and a
  -- prior run left an orphan row, the second seed silently raised a UNIQUE
  -- violation on email — leaving auth.users empty for the new id and the
  -- deferred members_assert_id_in_auth_users trigger then rejecting the
  -- handler's commit. The handler reads its email from the request payload,
  -- not from auth.users, so the stored email has no observational value to
  -- the spec. Synthesizing it from the id makes the helper idempotent
  -- against repeated runs with the same p_email argument. p_email is
  -- retained as a parameter for API compatibility but ignored for the
  -- auth.users.email slot.
  effective_email := 'eval-' || substr(p_id::text, 1, 8) || '@eval-test.local';

  -- Transaction-local GUC: cleared at next statement boundary outside this
  -- function. The hook function's early-return clause reads it.
  perform set_config('eval.skip_signup_hook', 'on', true);

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    p_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    effective_email,
    'eval-placeholder',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do nothing;
end;
$$;

revoke execute on function public.eval_seed_auth_user_only(uuid, text) from public;
grant execute on function public.eval_seed_auth_user_only(uuid, text) to service_role;

comment on function public.eval_seed_auth_user_only(uuid, text) is
  'Phase 0 eval helper — inserts a minimum-viable auth.users row so that public.members inserts satisfy the members_assert_id_in_auth_users constraint trigger (T047, ADR-15). Sets eval.skip_signup_hook=on transaction-locally to bypass the pg_net call in handle_new_auth_user(). Idempotent. Consumed by web/evals/phase-0/floor.spec.ts and by public.eval_seed_handle_collision_range.';
