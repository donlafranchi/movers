-- T063 — Member saved searches.
--
-- Ships:
--   1. public.member_saved_searches            (id PK, soft-delete, owner-only RLS)
--   2. public.member_events event_kind CHECK   (extended with 3 new kinds; T061 rewrites again)
--
-- Spec anchors:
--   product/systems/member.md § Saved searches
--   planning/adrs/ADR-0021-member-geography-substrate-split.md (Ratified 2026-05-23)
--   planning/adrs/ADR-0007-action-layer.md
--   planning/adrs/ADR-0010-events-from-day-one.md
--   planning/bundles/b1x-substrate-sprint.md § B3
--
-- Encodes ratified absolutes:
--   * `member_saved_searches` is owner-only at the row level.
--       — ADR-21 (recheck CLEAN 2026-05-23). Enforced by single owner-read
--         RLS policy + absence of INSERT/UPDATE/DELETE policies.
--   * Saved searches must carry at least one filter (place / location / interest_tags).
--       — member.md § Saved searches Intent. A no-filter search would fan
--         out to every Item; CHECK rejects it at schema level.
--
-- b1 ships substrate only. No surface (composer, fan-out worker) is built
-- here. The b2 worker reads this substrate via service-role and emits the
-- per-Member digest.

create table public.member_saved_searches (
  id              uuid          not null default gen_random_uuid() primary key,
  member_id       uuid          not null references public.members(id) on delete cascade,
  label           text          not null
                                check (char_length(label) between 1 and 80),
  place_id        uuid                   references public.places(id)    on delete restrict,
  location_id     uuid                   references public.locations(id) on delete restrict,
  interest_tags   text[]        not null default '{}',
  item_kinds      text[]        not null default '{}',
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  removed_at      timestamptz,
  constraint at_least_one_filter check (
    place_id is not null
    or location_id is not null
    or array_length(interest_tags, 1) is not null
  )
);

-- Member-scoped read (own saved searches).
create index idx_member_saved_searches_member_active
  on public.member_saved_searches (member_id)
  where removed_at is null;

-- Place / location lookups for the future b2 fan-out worker (service-role).
create index idx_member_saved_searches_place_active
  on public.member_saved_searches (place_id)
  where place_id is not null and removed_at is null;

create index idx_member_saved_searches_location_active
  on public.member_saved_searches (location_id)
  where location_id is not null and removed_at is null;

create trigger member_saved_searches_set_updated_at
  before update on public.member_saved_searches
  for each row execute function public.update_updated_at_column();

alter table public.member_saved_searches enable row level security;

-- Owner-only row read.
create policy member_saved_searches_owner_read
  on public.member_saved_searches
  for select
  using (member_id = auth.uid());

-- No INSERT / UPDATE / DELETE policy — action-layer-only writes per ADR-7.

comment on table public.member_saved_searches is
  'Member-defined saved searches. Owner-only at row level per ADR-21. Writes via action layer only. b2 fan-out worker reads via service role.';

------------------------------------------------------------
-- Extend member_events.event_kind CHECK (T061 rewrites again to drop retired kinds).
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
    'member.location_affinity_added',   -- dropped by T061 (021)
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
    'member.place_interest_demoted',
    -- T063 additions
    'member.saved_search.created',
    'member.saved_search.updated',
    'member.saved_search.removed'
  ));
