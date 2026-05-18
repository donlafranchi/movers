-- ─────────────────────────────────────────────────────────────────────────
-- T052 — Eval helpers (00): introspection RPCs
-- Source: development/tickets/T052-phase-0-eval-helpers.md
-- ADR:    planning/adrs/ADR-0018-eval-helpers.md (Decision 1)
-- Consumed by: web/evals/phase-0/floor.spec.ts (T041 + T042 floor checks)
--
-- PRODUCTION-SAFETY REMINDER
-- This file lives in supabase/test-helpers/, NOT supabase/migrations/. It is
-- applied only by `npm run eval:bootstrap` against a localhost Postgres. If
-- you find yourself reaching for `013_eval_helpers.sql` in migrations/, stop
-- and re-read ADR-18. The introspection surfaces below (pg_extension shape,
-- pg_attribute typing, partitioning state) have no business in a prod schema
-- and would themselves trip the CI conformance check.
--
-- All functions:
--   - language plpgsql
--   - security definer (callable by service_role only)
--   - revoke execute from public; grant execute to service_role
--   - comment on function referencing this ticket + the consumer spec
-- ─────────────────────────────────────────────────────────────────────────

-- Helper 1 — list installed extensions the spec cares about.
-- The Phase 0 floor needs pgvector + postgis. Other extensions are ignored
-- to keep the surface tight and the spec deterministic.
create or replace function public.eval_pg_extensions()
returns table (extname text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
    select pg_extension.extname::text
    from pg_extension
    where pg_extension.extname in ('vector', 'postgis')
    order by pg_extension.extname;
end;
$$;

revoke execute on function public.eval_pg_extensions() from public;
grant execute on function public.eval_pg_extensions() to service_role;

comment on function public.eval_pg_extensions() is
  'T052 eval helper — returns rows for the Phase 0 extensions (vector, postgis) actually present in pg_extension. Consumed by web/evals/phase-0/floor.spec.ts (T041 assertion).';

-- Helper 2 — column shape for a public-schema table.
-- We read from pg_attribute + format_type(atttypid, atttypmod) rather than
-- information_schema.columns. The Playwright spec asserts
--   expect(embedding?.data_type).toMatch(/vector/)
-- and information_schema.columns reports 'USER-DEFINED' for vector(n).
-- format_type returns 'vector(1536)' literally, which matches the spec's
-- regex. Same data, more honest typing.
create or replace function public.eval_table_shape(p_table text)
returns table (column_name text, data_type text, is_nullable text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
    select
      a.attname::text                                  as column_name,
      format_type(a.atttypid, a.atttypmod)::text       as data_type,
      case when a.attnotnull then 'NO' else 'YES' end  as is_nullable
    from pg_attribute a
    join pg_class c       on c.oid = a.attrelid
    join pg_namespace n   on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = p_table
      and a.attnum > 0
      and not a.attisdropped
    order by a.attnum;
end;
$$;

revoke execute on function public.eval_table_shape(text) from public;
grant execute on function public.eval_table_shape(text) to service_role;

comment on function public.eval_table_shape(text) is
  'T052 eval helper — column_name / data_type / is_nullable for a public-schema table. Uses pg_attribute + format_type so vector(n) reports as "vector(N)" rather than information_schema''s "USER-DEFINED". Consumed by web/evals/phase-0/floor.spec.ts (T041 + T042 table-shape assertions).';

-- Helper 3 — boolean: is the table a partition parent?
-- relkind = 'p' means RANGE/LIST/HASH partitioned table.
create or replace function public.eval_is_partitioned(p_table text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result boolean;
begin
  select coalesce(
    (select c.relkind = 'p'
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = p_table),
    false
  ) into result;
  return result;
end;
$$;

revoke execute on function public.eval_is_partitioned(text) from public;
grant execute on function public.eval_is_partitioned(text) to service_role;

comment on function public.eval_is_partitioned(text) is
  'T052 eval helper — true iff the named public-schema table has relkind = ''p'' (a partition parent). Consumed by web/evals/phase-0/floor.spec.ts (T042 member_events partitioning assertion).';
