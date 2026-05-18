-- ─────────────────────────────────────────────────────────────────────────
-- T052 — Eval helpers (01): action-layer conformance result probe
-- Source: development/tickets/T052-phase-0-eval-helpers.md
-- ADR:    planning/adrs/ADR-0018-eval-helpers.md (Decision 1)
-- Consumed by: web/evals/phase-0/floor.spec.ts (T043 conformance assertion)
--
-- PRODUCTION-SAFETY REMINDER
-- This file lives in supabase/test-helpers/, NOT supabase/migrations/. The
-- eval_artifacts table is a Postgres-side cache for Node-side check results;
-- it has no business in a production schema.
--
-- The action-layer-conformance check (T043 + T051) runs in Node. To expose
-- its result to the Playwright spec without the spec running Node code, the
-- bootstrap script:
--   1. Applies this file (creates eval_artifacts + the helper function).
--   2. Runs `npm run check:action-layer -- --json` (Node).
--   3. Inserts the parsed JSON into public.eval_artifacts with
--      key = 'conformance_check'.
-- The spec then calls `eval_conformance_check_result()` to fetch the
-- captured result. Decoupled in this shape so the spec stays Postgres-side.
-- ─────────────────────────────────────────────────────────────────────────

-- Artifact store — small KV table for build-time Node results that the
-- spec needs to assert against from Postgres. Idempotent shape.
create table if not exists public.eval_artifacts (
  key        text primary key,
  value      jsonb       not null,
  created_at timestamptz not null default now()
);

comment on table public.eval_artifacts is
  'T052 eval-only artifact store. Populated by web/scripts/bootstrap-eval-helpers.ts after applying test-helpers/. Read by SECURITY DEFINER helpers in this folder. Never written to from production code paths; the table is excluded from supabase/migrations/ so it is unreachable by supabase db push.';

-- The bootstrap script runs `npm run check:action-layer -- --json` and
-- upserts the parsed `{ ok, violations }` object under this key.
create or replace function public.eval_conformance_check_result()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  select value into result
  from public.eval_artifacts
  where key = 'conformance_check';

  if result is null then
    raise exception
      'eval:bootstrap not run — call `npm run eval:bootstrap` before running phase-0 spec. '
      'The bootstrap script populates public.eval_artifacts with the action-layer-conformance result.'
      using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke execute on function public.eval_conformance_check_result() from public;
grant execute on function public.eval_conformance_check_result() to service_role;

comment on function public.eval_conformance_check_result() is
  'T052 eval helper — returns the parsed { ok, violations } JSON captured by `npm run eval:bootstrap` from `npm run check:action-layer -- --json`. Raises a clear P0002 if the bootstrap step has not been run. Consumed by web/evals/phase-0/floor.spec.ts (T043 conformance assertion).';
