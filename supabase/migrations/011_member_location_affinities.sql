-- T049 — Member location affinities (Phase 1 Member surface continuation)
-- Source: notes/migration-to-primitives.md § Phase 1 (rebuild plan label
--         007i_member_location_affinities.sql; renumbered to 011_* per the
--         Phase 1 consolidation established by T047 / T048);
--         product/systems/member.md lines 261-306;
--         planning/DECISIONS.md ADR-16 (privacy posture);
--         development/tickets/T049-member-location-affinities.md.
--
-- Multi-Location belonging. A Member can hold zero or many affinities of
-- six kinds against a Location: lives / works / plays / visits / follows /
-- liked. The composite PK (member_id, location_id, affinity_kind) permits
-- multiple kinds against the same Location. Soft-remove via removed_at
-- mirrors member_follows.unfollowed_at.
--
-- Privacy posture (ADR-16, 2026-05-11):
--   Layer 1 — RLS owner-only. Single policy keyed by auth.uid(). All six
--     affinity_kind values are equally sensitive at the row level; no
--     peer-Member SELECT under any condition.
--   Layer 2 — Three SECURITY DEFINER scalar functions return narrowly-
--     scoped booleans / counts. Closed catalog, public-callable, used by
--     the locally-owned derivation (groups.md) and Location-page rollups.
--   Layer 3 — service_role bypasses RLS for the recommendation engine and
--     embedding pipeline. Outputs to users are anonymized aggregates only.
--
-- Action-layer-only writes (ADR-7). No INSERT / UPDATE / DELETE policies.
-- T051's CI enforcement is the project-wide invariant that catches
-- bypass attempts.

------------------------------------------------------------
-- 1. public.member_location_affinities
------------------------------------------------------------

create table public.member_location_affinities (
  member_id     uuid          not null references public.members(id)   on delete cascade,
  location_id   uuid          not null references public.locations(id) on delete cascade,
  affinity_kind text          not null
                              check (affinity_kind in ('lives','works','plays','visits','follows','liked')),
  created_at    timestamptz   not null default now(),
  removed_at    timestamptz,
  primary key (member_id, location_id, affinity_kind)
);

-- "Places I live / work / play / visit / follow / liked" — the Member's
-- own profile surfaces. Leading column is member_id so the Member-scoped
-- scan stays cheap; affinity_kind as a secondary lets the surface partition
-- the rows by kind without a separate index per kind.
create index idx_affinity_member_active
  on public.member_location_affinities (member_id, affinity_kind)
  where removed_at is null;

-- Concerts-in-the-Park substrate — Location-followers feed (Loop 4). The
-- partial predicate fixes affinity_kind so the fan-out scan stays narrow.
create index idx_affinity_location_followers
  on public.member_location_affinities (location_id)
  where affinity_kind = 'follows' and removed_at is null;

-- Locally-owned-and-operated derivation (groups.md). Any of `lives` /
-- `works` is sufficient for a Member to qualify as a local owner of a
-- Group anchored to this Location. Accessed exclusively through
-- public.member_is_local_to_location() per ADR-16.
create index idx_affinity_location_locals
  on public.member_location_affinities (location_id, affinity_kind)
  where affinity_kind in ('lives','works') and removed_at is null;

alter table public.member_location_affinities enable row level security;

-- ADR-16 Layer 1: owner-only row access. Single policy across all six
-- affinity kinds — `lives`/`works` are obviously sensitive, but
-- `liked`/`follows` narrow geography for a patient observer too, so they
-- get the same treatment at this layer. Cross-Member computation goes
-- through the SECURITY DEFINER catalog below.
create policy member_location_affinities_owner_read
  on public.member_location_affinities
  for select
  using (member_id = auth.uid());

-- No INSERT / UPDATE / DELETE policy — action-layer-only writes per
-- ADR-7. Handlers (`member.location_affinity.add` / `.remove` /
-- `member.locality.set`) own writes and emit member.location_affinity_*
-- events in the same transaction. T051 CI enforcement catches bypass.

comment on table public.member_location_affinities is
  'Multi-Location belonging substrate. Six affinity_kinds (lives/works/plays/visits/follows/liked). Soft-remove via removed_at. ADR-16 privacy posture: owner-only RLS; cross-Member access only through SECURITY DEFINER scalar functions (member_is_local_to_location, count_likes_for_location, count_followers_for_location); backend pipelines via service_role with anonymized outputs. Action-layer-only writes per ADR-7.';

------------------------------------------------------------
-- 2. SECURITY DEFINER access catalog (ADR-16 Layer 2)
------------------------------------------------------------

-- Locally-owned derivation. True when the Member has an active `lives` or
-- `works` affinity at the Location. Used by groups.md's locally-owned-
-- and-operated badge. Public-callable; reads private rows internally,
-- returns a boolean only.
create or replace function public.member_is_local_to_location(
  p_member_id   uuid,
  p_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.member_location_affinities
    where member_id = p_member_id
      and location_id = p_location_id
      and affinity_kind in ('lives','works')
      and removed_at is null
  );
$$;

grant execute on function public.member_is_local_to_location(uuid, uuid)
  to authenticated, anon;

-- Aggregate rollup — "N Members liked this place." Counts active `liked`
-- rows. Returns 0 when no rows match.
create or replace function public.count_likes_for_location(
  p_location_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.member_location_affinities
  where location_id = p_location_id
    and affinity_kind = 'liked'
    and removed_at is null;
$$;

grant execute on function public.count_likes_for_location(uuid)
  to authenticated, anon;

-- Aggregate rollup — "N Members follow this place." Powers Location-page
-- rollups and (via service_role) the notification-fanout pattern.
create or replace function public.count_followers_for_location(
  p_location_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.member_location_affinities
  where location_id = p_location_id
    and affinity_kind = 'follows'
    and removed_at is null;
$$;

grant execute on function public.count_followers_for_location(uuid)
  to authenticated, anon;
