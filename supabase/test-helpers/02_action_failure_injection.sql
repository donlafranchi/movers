-- ─────────────────────────────────────────────────────────────────────────
-- T052 — Eval helpers (02): action-layer failure-injection probe
-- Source: development/tickets/T052-phase-0-eval-helpers.md
-- ADR:    planning/adrs/ADR-0018-eval-helpers.md (Decision 2 — Path A chosen)
-- Consumed by: web/evals/phase-0/floor.spec.ts (T043 same-transaction assertion)
--
-- PRODUCTION-SAFETY REMINDER
-- This file lives in supabase/test-helpers/, NOT supabase/migrations/. The
-- helper writes directly to public.members — the canonical action-layer
-- conformance violation. It is allowlisted only because the test-helpers/
-- folder is unreachable by `supabase db push`.
--
-- DESIGN NOTE — why SQL-side (Path A) and not Node-side (Path B).
-- The Playwright spec's eval-writer firewall (floor.spec.ts line 16) forbids
-- importing from web/src/. The spec therefore cannot invoke the Node action
-- handler directly in-process. Two options:
--   - Path A (chosen): reproduce ADR-7's same-transaction invariant in SQL
--     via a subtransaction that forces a NOT NULL violation on the event-log
--     insert and verifies the members row rolled back too. The handler's
--     own commit-path coverage stays in Vitest.
--   - Path B (rejected): add a ?fail_mode=event_log query param to the
--     auth-signup route, gated to NODE_ENV !== 'production'. More production
--     surface code for marginal additional coverage.
-- Full rationale: ADR-0018 § Decision 2.
--
-- The invariant under test is *substrate-shape*: members row + event-log
-- row write same-transaction; both roll back if either fails. The plpgsql
-- BEGIN..EXCEPTION block IS a subtransaction in Postgres — when the event
-- insert raises not_null_violation, the savepoint rolls back the members
-- insert too, so the function returns membersRowRemaining = false.
--
-- A complication worth naming: 009_members_phase1.sql installs a
-- constraint trigger `members_assert_id_in_auth_users` that fires
-- DEFERRABLE INITIALLY DEFERRED. With a savepoint rollback inside this
-- function, the queued constraint check on the rolled-back row is removed
-- before the outer transaction commits, so the deferred trigger does not
-- fire on a nonexistent row. If the savepoint had committed, the deferred
-- trigger would reject p_id at outer commit unless p_id existed in
-- auth.users. Path A is structurally safe against that case.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.eval_member_create_with_failure_injection(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  -- BEGIN..EXCEPTION in plpgsql opens an implicit savepoint. The savepoint
  -- rolls back when an exception fires inside it, removing any rows
  -- inserted in this block from the surrounding transaction's view.
  begin
    insert into public.members (id, handle, display_name)
    values (
      p_id,
      'fail-probe-' || substr(p_id::text, 1, 8),
      'Fail Probe'
    );

    -- Force the event-log insert to raise. acting_member_id is NOT NULL
    -- per 002_members.sql; passing NULL triggers not_null_violation,
    -- which the EXCEPTION clause below catches. The subtransaction
    -- rolls back, taking the members insert with it.
    insert into public.member_events (
      id, member_id, event_kind, payload, acting_member_id, via_delegation_id
    )
    values (
      gen_random_uuid(), p_id, 'member.created', '{}'::jsonb, NULL, NULL
    );
  exception
    when not_null_violation then
      -- Expected. ADR-7's same-transaction invariant requires that the
      -- members row is gone after this savepoint rollback.
      null;
    when foreign_key_violation then
      -- Defense-in-depth: today NOT NULL is evaluated before FK checks, so
      -- the not_null_violation above always fires first. If a future
      -- Postgres release reorders or if the schema changes (e.g.,
      -- acting_member_id loses NOT NULL but keeps the FK), the FK check
      -- would raise instead. Either way, the substrate's same-transaction
      -- invariant is the property under test — both rollbacks satisfy it.
      null;
  end;

  result := jsonb_build_object(
    'rolledBack',          true,
    'membersRowRemaining', exists(select 1 from public.members where id = p_id)
  );
  return result;
end;
$$;

revoke execute on function public.eval_member_create_with_failure_injection(uuid) from public;
grant execute on function public.eval_member_create_with_failure_injection(uuid) to service_role;

comment on function public.eval_member_create_with_failure_injection(uuid) is
  'T052 eval helper (Path A per ADR-18). Verifies ADR-7''s same-transaction invariant at the substrate level: a NOT NULL violation in the event-log insert rolls back the members insert in the same subtransaction. Returns { rolledBack: true, membersRowRemaining: false } on a healthy substrate. Consumed by web/evals/phase-0/floor.spec.ts (T043 rollback assertion).';
