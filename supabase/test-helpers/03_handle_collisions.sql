-- ─────────────────────────────────────────────────────────────────────────
-- T052 — Eval helpers (03): handle-collision saturation + cleanup
-- Source: development/tickets/T052-phase-0-eval-helpers.md
-- ADR:    planning/adrs/ADR-0018-eval-helpers.md (Decision 1)
-- Consumed by: web/evals/phase-0/floor.spec.ts (T043 99-collision assertion)
--
-- PRODUCTION-SAFETY REMINDER
-- This file lives in supabase/test-helpers/, NOT supabase/migrations/. The
-- seed helper writes directly to public.members — the canonical action-layer
-- conformance violation. It is allowlisted only because the test-helpers/
-- folder is unreachable by `supabase db push`. Running the seed against
-- production would create 99 garbage rows + FK contamination on
-- member_events; the localhost guard in bootstrap-eval-helpers.ts is the
-- load-bearing prevention.
--
-- The action layer's collision-suffix rule: when 'maya' is taken, the next
-- caller gets 'maya-2', then 'maya-3', ..., up to a fixed cap. T043's spec
-- needs to saturate the cap (99) so the next `member.create` call with a
-- 'maya' base must return 409 ConflictError. These two helpers seed and
-- clear that range.
-- ─────────────────────────────────────────────────────────────────────────

-- Seed p_count rows with handles { p_base, p_base-2, p_base-3, ..., p_base-p_count }.
-- One row per handle. The first handle is the bare base (no suffix) per the
-- action layer's collision-suffix rule. `on conflict do nothing` makes the
-- helper safe to re-run; the test owns the cleanup lifecycle via
-- eval_clear_handle_collision_range below.
--
-- Implementation note: this is a single INSERT ... SELECT against
-- generate_series so all rows land in one statement. Handle index 1 is the
-- bare base; indexes 2..p_count append the '-N' suffix.
create or replace function public.eval_seed_handle_collision_range(p_base text, p_count int)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_count < 1 then
    return;
  end if;

  -- Precondition: p_base must satisfy the members.handle CHECK after suffix
  -- expansion. The bare base must be >=4 chars; the suffixed forms must be
  -- <=30 chars. on conflict do nothing only catches unique violations, NOT
  -- check_violations — so a too-short or too-long base would raise a hard
  -- error mid-INSERT and leave the helper in a confusing state. Fail loud
  -- up front instead.
  if char_length(p_base) < 4 then
    raise exception
      'eval_seed_handle_collision_range: p_base "%" is too short (members.handle CHECK requires >=4 chars).',
      p_base
      using errcode = '22023';
  end if;
  if char_length(p_base) + 1 + char_length(p_count::text) > 30 then
    raise exception
      'eval_seed_handle_collision_range: p_base "%" + "-%" suffix would exceed handle length 30.',
      p_base, p_count
      using errcode = '22023';
  end if;

  insert into public.members (id, handle, display_name)
  select
    gen_random_uuid(),
    case when n = 1 then p_base else p_base || '-' || n::text end,
    'Collision Seed ' || n::text
  from generate_series(1, p_count) as g(n)
  on conflict (handle) do nothing;
end;
$$;

revoke execute on function public.eval_seed_handle_collision_range(text, int) from public;
grant execute on function public.eval_seed_handle_collision_range(text, int) to service_role;

comment on function public.eval_seed_handle_collision_range(text, int) is
  'T052 eval helper — seeds p_count members with handles {p_base, p_base-2, ..., p_base-p_count} in one INSERT. Idempotent via on conflict do nothing. Consumed by web/evals/phase-0/floor.spec.ts (T043 — saturates the 99-collision window so the next member.create returns 409).';

-- Clear all members whose handle is p_base OR matches p_base-<digits>.
-- Uses LIKE rather than regex with concatenation: parameterized-safe and
-- the action-layer-conformance check (T051 Rule 4) does not flag LIKE
-- patterns. member_events deletes first because member_events.member_id
-- and member_events.acting_member_id both reference public.members(id)
-- (the latter is ON DELETE RESTRICT, so the order matters).
--
-- Match scope: the LIKE filter (`p_base || '-%'`) is broader than the seed
-- function's strict numeric suffixes — it would also catch e.g. `maya-x`.
-- That's deliberate: callers should pass a base they own end-to-end (the
-- spec uses 'maya'), and a stricter regex would either require a constant
-- pattern (annotation noise) or runtime concatenation (T051 Rule 4 flag).
-- The seed/clear pair is the contract; document and accept the wider clear.
create or replace function public.eval_clear_handle_collision_range(p_base text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Delete event-log rows first to satisfy the FK constraint on
  -- member_events.member_id and the ON DELETE RESTRICT on
  -- member_events.acting_member_id.
  delete from public.member_events
  where member_id in (
    select id from public.members
    where handle = p_base or handle like p_base || '-%'
  )
     or acting_member_id in (
    select id from public.members
    where handle = p_base or handle like p_base || '-%'
  );

  delete from public.members
  where handle = p_base or handle like p_base || '-%';
end;
$$;

revoke execute on function public.eval_clear_handle_collision_range(text) from public;
grant execute on function public.eval_clear_handle_collision_range(text) to service_role;

comment on function public.eval_clear_handle_collision_range(text) is
  'T052 eval helper — cleanup pair for eval_seed_handle_collision_range. Deletes member_events rows referencing the seeded members before deleting the members rows themselves (FK ordering). Uses LIKE with a parameterized base (no regex concatenation — keeps T051 Rule 4 quiet). Consumed by web/evals/phase-0/floor.spec.ts (T043 cleanup after the 99-collision saturation).';
