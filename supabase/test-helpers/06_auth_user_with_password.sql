-- F036 eval support — seed an auth.users row with a real (bcrypt-hashed)
-- password so the UI sign-in flow at /auth/login works against it.
--
-- WHY THIS EXISTS
--
-- The existing eval_seed_auth_user_only (04_auth_user_seeding.sql) stamps
-- the literal string 'eval-placeholder' into auth.users.encrypted_password.
-- That's fine for substrate evals that only need the row to satisfy the
-- members_assert_id_in_auth_users constraint trigger, but it's NOT a valid
-- argon2id/bcrypt hash — GoTrue's password verifier rejects every attempt,
-- so the UI sign-in flow that F036 drives times out.
--
-- WHY NOT auth.admin.createUser FROM JS
--
-- In local dev the auth admin endpoints (createUser / listUsers) return
-- "Database error finding users" / "Database error creating new user".
-- Likely the project's on_auth_user_created trigger (which POSTs to a
-- Next.js route via pg_net) interferes with admin-side inserts when the
-- dev server isn't reachable or the eval.skip_signup_hook GUC isn't set
-- in GoTrue's transaction context. This helper sidesteps GoTrue entirely.
--
-- WHAT IT DOES
--   1. Sets eval.skip_signup_hook=on transaction-locally so the project's
--      auth-signup hook trigger early-returns.
--   2. Inserts auth.users with encrypted_password = crypt(p_password, gen_salt('bf')).
--      GoTrue accepts bcrypt hashes for password verification.
--   3. Idempotent on (id) — re-seed of the same id is a no-op (does NOT
--      update the password hash on re-seed; if you need to rotate, delete
--      the auth.users row first).
--
-- Service-role only. Hard-coded password parameters → not for production.

create or replace function public.eval_seed_auth_user_with_password(
  p_id uuid,
  p_email text,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog, extensions
as $$
declare
  existing_id uuid;
begin
  -- Idempotency: if a row with this email already exists, return its id
  -- and skip the insert path. The PostgREST client can't query auth.users
  -- directly (auth schema is not REST-exposed), so this RPC is the only
  -- supported lookup-or-create path for eval seeds.
  select id into existing_id from auth.users where email = p_email limit 1;
  if existing_id is not null then
    return existing_id;
  end if;

  -- Bypass the auth-signup trigger's pg_net call — see handle_new_auth_user().
  perform set_config('eval.skip_signup_hook', 'on', true);

  -- Wrap the insert + race-handling. Three parallel Playwright workers
  -- can all pass the SELECT-first check and then race the insert; without
  -- the catch, two of them die on the partial-unique users_email_partial_key.
  begin
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
      p_email,
      crypt(p_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );
  exception
    when unique_violation then
      -- Another worker won the race. Return the id that lost the race? No —
      -- return the id that won. Re-select by email and return that.
      select id into existing_id from auth.users where email = p_email limit 1;
      return existing_id;
  end;

  -- Some auth.users variants in newer Supabase versions require a row in
  -- auth.identities for the password flow to find the user. Seed defensively;
  -- skip silently if the table doesn't exist on this version.
  begin
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      p_id,
      p_id::text,
      jsonb_build_object('sub', p_id::text, 'email', p_email),
      'email',
      now(),
      now(),
      now()
    )
    on conflict do nothing;
  exception when undefined_table then
    null;
  end;

  return p_id;
end;
$$;

revoke execute on function public.eval_seed_auth_user_with_password(uuid, text, text) from public;
grant execute on function public.eval_seed_auth_user_with_password(uuid, text, text) to service_role;

comment on function public.eval_seed_auth_user_with_password(uuid, text, text) is
  'F036 eval helper — seeds auth.users with a bcrypt-hashed password so the UI sign-in flow at /auth/login works. Bypasses GoTrue admin endpoints (which fail in local dev) by inserting directly. Sets eval.skip_signup_hook=on to neuter the project signup trigger. Also seeds auth.identities (where present) so the password flow can resolve the user. Service-role only.';
