-- T062 — Member ↔ Place interest scope.
--
-- Ships:
--   1. public.member_place_interests          (composite PK; one active primary_home per Member)
--   2. public.member_events event_kind CHECK  (extended with 4 new kinds; T061 rewrites again)
--
-- Spec anchors:
--   product/systems/member.md § Place-interest scope
--   planning/adrs/ADR-0021-member-geography-substrate-split.md (Ratified 2026-05-23)
--   planning/adrs/ADR-0007-action-layer.md
--   planning/adrs/ADR-0010-events-from-day-one.md
--   planning/bundles/b1x-substrate-sprint.md § B2
--
-- Encodes ratified absolutes:
--   * `member_place_interests` is owner-only at the row level.
--       — ADR-21 (recheck CLEAN 2026-05-23). Enforced by single owner-read
--         RLS policy + absence of INSERT/UPDATE/DELETE policies.
--   * At most one active `primary_home` per Member.
--       — ADR-21 + member.md § Place-interest scope Intent. Enforced by
--         the partial unique index uniq_primary_home_active.

------------------------------------------------------------
-- 1. public.member_place_interests
------------------------------------------------------------

create table public.member_place_interests (
  member_id    uuid          not null references public.members(id) on delete cascade,
  place_id     uuid          not null references public.places(id)  on delete restrict,
  scope_kind   text          not null
                             check (scope_kind in ('primary_home', 'secondary')),
  created_at   timestamptz   not null default now(),
  removed_at   timestamptz,
  metadata     jsonb         not null default '{}'::jsonb,
  primary key (member_id, place_id, scope_kind)
);

-- At most one active primary_home per Member. Partial unique index because
-- the constraint applies only to non-removed rows of the primary_home kind;
-- secondaries and removed rows are unaffected. Load-bearing — encodes the
-- ADR-21 absolute at the DB level so a buggy handler can't double-write.
create unique index uniq_primary_home_active
  on public.member_place_interests (member_id)
  where scope_kind = 'primary_home' and removed_at is null;

-- Member-scoped reads (rendering /you/locality, awareness-feed scope).
create index idx_member_place_interests_member_active
  on public.member_place_interests (member_id, scope_kind)
  where removed_at is null;

alter table public.member_place_interests enable row level security;

-- Owner-only row read. Encodes the ADR-21 absolute.
create policy member_place_interests_owner_read
  on public.member_place_interests
  for select
  using (member_id = auth.uid());

-- No INSERT / UPDATE / DELETE policy.
-- Action-layer-only writes per ADR-7. T051 CI enforcement catches bypass.

comment on table public.member_place_interests is
  'Member''s place-interest scope (primary_home + ≤5 secondaries). Owner-only at row level per ADR-21. Writes via action layer only. Supersedes member_location_affinities (retired in 021).';

------------------------------------------------------------
-- 2. Extend member_events.event_kind CHECK with the 4 new kinds.
--
-- T061 (021) rewrites this CHECK one final time to drop the two retired
-- location_affinity kinds. This migration extends the active set so events
-- emitted between 018-applied and 021-applied (a brief window during fresh
-- DB reset) are still accepted.
------------------------------------------------------------

alter table public.member_events
  drop constraint if exists member_events_event_kind_check;

alter table public.member_events
  add constraint member_events_event_kind_check
  check (event_kind in (
    'member.created',
    'member.profile_updated',
    'member.home_location_set',
    'member.privacy_changed',
    'member.maker_mode_changed',
    'member.followed',
    'member.unfollowed',
    'member.location_affinity_added',   -- dropped by T061 (021); included here for migration-order safety
    'member.location_affinity_removed', -- dropped by T061 (021)
    'member.interest_added',
    'member.interest_removed',
    'member.delegation_granted',
    'member.delegation_revoked',
    'member.deleted',
    'member.restored',
    'member.export_requested',
    'member.purge_executed',
    'member.handle_changed',
    -- T062 additions
    'member.place_interest_added',
    'member.place_interest_removed',
    'member.place_interest_promoted',
    'member.place_interest_demoted'
  ));
