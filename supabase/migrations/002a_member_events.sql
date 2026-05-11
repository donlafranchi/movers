-- T042 — Member event log (Phase 0)
-- Source: notes/migration-to-primitives.md § Phase 0; product/systems/member.md
-- Decisions encoded: ADR-6 (audit fields), ADR-10 (event log invariants).
--
-- Monthly partitioned by created_at per ADR-10. Composite PK (id, created_at)
-- is required by the partition-key inclusion rule.
--
-- The action layer (T043+) writes every row. No direct insert path is
-- exposed to clients; RLS has read policy only. The system-Member bootstrap
-- row in 002b_system_member.sql is the one documented exception that
-- predates T043 (per T042 Notes and ADR-7 deviation log).

create table public.member_events (
  id                 uuid          not null default gen_random_uuid(),
  member_id          uuid          not null references public.members(id) on delete cascade,
  event_kind         text          not null
                                   check (event_kind in (
                                     'member.created',
                                     'member.profile_updated',
                                     'member.home_location_set',
                                     'member.privacy_changed',
                                     'member.maker_mode_changed',
                                     'member.followed',
                                     'member.unfollowed',
                                     'member.location_affinity_added',
                                     'member.location_affinity_removed',
                                     'member.interest_added',
                                     'member.interest_removed',
                                     'member.delegation_granted',
                                     'member.delegation_revoked',
                                     'member.deleted',
                                     'member.restored',
                                     'member.export_requested',
                                     'member.purge_executed',
                                     'member.handle_changed'
                                   )),
  payload            jsonb         not null default '{}'::jsonb,
  acting_member_id   uuid          not null references public.members(id) on delete restrict,
  via_delegation_id  uuid,         -- FK added in Phase 1 when member_delegations lands
  created_at         timestamptz   not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create index idx_member_events_member
  on public.member_events (member_id, created_at desc);

create index idx_member_events_acting
  on public.member_events (acting_member_id, created_at desc);

alter table public.member_events enable row level security;

-- Members read events about them or by them. No INSERT / UPDATE / DELETE
-- policy — writes only via the action layer (service role).
create policy member_events_owner_read on public.member_events
  for select
  using (member_id = auth.uid() or acting_member_id = auth.uid());

-- Partition rotation function. Creates monthly partitions ahead of time so
-- inserts never miss a target. Idempotent (uses create table if not exists).
create or replace function public.ensure_member_events_partition(target_month date)
returns void
language plpgsql
as $$
declare
  partition_name text;
  range_start    date;
  range_end      date;
begin
  range_start    := date_trunc('month', target_month)::date;
  range_end      := (range_start + interval '1 month')::date;
  partition_name := format('member_events_y%sm%s',
                           to_char(range_start, 'YYYY'),
                           to_char(range_start, 'MM'));

  execute format(
    'create table if not exists public.%I partition of public.member_events
       for values from (%L) to (%L)',
    partition_name, range_start, range_end
  );
end;
$$;

-- Rolls a window of three months: current + next + month-after-next.
-- Call this once at install and schedule monthly via pg_cron (or manual).
create or replace function public.rotate_member_events_partitions()
returns void
language plpgsql
as $$
declare
  base date := date_trunc('month', now())::date;
begin
  perform public.ensure_member_events_partition(base);
  perform public.ensure_member_events_partition((base + interval '1 month')::date);
  perform public.ensure_member_events_partition((base + interval '2 months')::date);
end;
$$;

-- Create the initial three-month window (covers current + 2 future months).
select public.rotate_member_events_partitions();

-- To schedule monthly rotation, enable pg_cron and run (once):
--
--   create extension if not exists pg_cron;
--   select cron.schedule(
--     'member-events-partition-rotation',
--     '0 0 1 * *',                                  -- 1st of every month at 00:00
--     'select public.rotate_member_events_partitions();'
--   );
--
-- Deferred to a later phase — three months of runway is enough for Phase 0+1
-- development. Schedule wiring is a separate ticket.

comment on table public.member_events is
  'Append-only event log per ADR-10. Monthly partitioned. Audit fields (acting_member_id, via_delegation_id) per ADR-6. Writes only via the action layer.';
