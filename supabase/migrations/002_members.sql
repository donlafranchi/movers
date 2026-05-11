-- T042 — Members + member_events + system Member (Phase 0 floor)
-- Source: notes/migration-to-primitives.md § Phase 0; product/systems/member.md § Data model implications
--
-- This migration is the minimal Members floor needed for Phase 0 work.
-- Phase 1's 007_* series augments with: member_privacy, member_interests,
-- member_follows, member_handle_history, member_threads + messages +
-- participants, member_self_records, member_delegations,
-- member_location_affinities, and the FK constraints to auth.users /
-- locations / groups that depend on tables Phase 1 creates.
--
-- Three sections in one file (Supabase CLI rejects alpha-suffixed numbering
-- like 002a/002b — must consolidate):
--   1. public.members table + indexes + RLS
--   2. public.member_events table (partitioned monthly) + rotation functions
--   3. System Member row + bootstrap event
--
-- DEVIATIONS from member.md (recorded in DEVIATIONS.md):
--   - `id` has NO FK to auth.users at Phase 0 — the system Member has no
--     auth.users counterpart. Phase 1 augmentation adds the FK.
--   - `home_location_id`, `primary_group_id`, `embedding_id` have NO FK yet.
--   - `member_privacy` not created here — Phase 1.
--   - `login_disabled` column added (not in member.md) — system-Member gate.
--
-- ADR-7 EXCEPTION: the system Member + bootstrap event are inserted via raw
-- INSERT because the action layer (T043) does not exist yet. This is the one
-- documented exception. CI conformance check (T043) whitelists this file.

------------------------------------------------------------
-- 1. public.members
------------------------------------------------------------

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.members (
  id                     uuid          primary key default gen_random_uuid(),
  handle                 text          unique not null
                                       check (char_length(handle) between 4 and 30
                                              and handle ~ '^[a-z0-9-]+$'),
  display_name           text          not null
                                       check (char_length(display_name) between 1 and 60),
  bio                    text          check (bio is null or char_length(bio) <= 500),
  avatar_url             text,
  pronouns               text          check (pronouns is null or char_length(pronouns) <= 30),
  home_location_id       uuid,                                              -- FK added in Phase 1
  primary_group_id       uuid,                                              -- FK added in Phase 1
  stakeholder_visibility text          not null default 'private'
                                       check (stakeholder_visibility in ('private','community_only','public')),
  maker_mode_enabled     boolean       not null default false,
  embedding_id           uuid,                                              -- populated by T3 embedding pipeline
  login_disabled         boolean       not null default false,
  deleted_at             timestamptz,
  created_at             timestamptz   not null default now(),
  updated_at             timestamptz   not null default now()
);

create index idx_members_home_location
  on public.members (home_location_id)
  where home_location_id is not null;

create index idx_members_primary_group
  on public.members (primary_group_id)
  where primary_group_id is not null;

create index idx_members_active
  on public.members (deleted_at)
  where deleted_at is null;

create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.update_updated_at_column();

alter table public.members enable row level security;

create policy members_public_read on public.members
  for select
  using (deleted_at is null and login_disabled = false);

create policy members_owner_update on public.members
  for update
  using (id = auth.uid());

comment on table public.members is
  'Phase 0 floor: minimal members table for the action layer + auth signup hook to write to. Phase 1''s 007_* series augments with privacy, interests, follows, threads, affinities, delegations, self-records.';

comment on column public.members.id is
  'Phase 0: plain uuid (gen_random_uuid). Phase 1 adds FK to auth.users(id) with an exception for the system Member.';

comment on column public.members.login_disabled is
  'When true, the row cannot be logged in as. Reserved for the system Member (handle=''system''). Filtered out by members_public_read.';

------------------------------------------------------------
-- 2. public.member_events (partitioned monthly per ADR-10)
------------------------------------------------------------

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

create policy member_events_owner_read on public.member_events
  for select
  using (member_id = auth.uid() or acting_member_id = auth.uid());

-- Partition rotation. Idempotent.
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

select public.rotate_member_events_partitions();

-- Schedule monthly rotation later via pg_cron:
--   create extension if not exists pg_cron;
--   select cron.schedule(
--     'member-events-partition-rotation',
--     '0 0 1 * *',
--     'select public.rotate_member_events_partitions();'
--   );

comment on table public.member_events is
  'Append-only event log per ADR-10. Monthly partitioned. Audit fields (acting_member_id, via_delegation_id) per ADR-6. Writes only via the action layer; bootstrap row in this migration is the documented exception.';

------------------------------------------------------------
-- 3. System Member row + self-bootstrap event
------------------------------------------------------------

-- The system Member is used as acting_member_id for platform-emitted events
-- that have no human actor (dormancy jobs, partition rotations, etc.).
-- The bootstrap event self-references acting_member_id = member_id, which
-- is the ONE documented ADR-6 exception. All future member.created events
-- have acting_member_id = the new human member's id.
--
-- The id constant is mirrored in web/src/lib/system-member.ts.

insert into public.members (id, handle, display_name, login_disabled, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000001',
  'system',
  'System',
  true,
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.member_events (member_id, event_kind, payload, acting_member_id, created_at)
values (
  '00000000-0000-0000-0000-000000000001',
  'member.created',
  jsonb_build_object('source', 'bootstrap', 'handle', 'system'),
  '00000000-0000-0000-0000-000000000001',
  now()
)
on conflict do nothing;

comment on column public.members.handle is
  E'4-30 chars, lowercase alnum + hyphen, unique. The handle ''system'' is reserved by 002_members.sql; the unique constraint blocks human attempts to claim it.';
