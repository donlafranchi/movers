-- T048 — Member interests + member follows (Phase 1 Member surface continuation)
-- Source: notes/migration-to-primitives.md § Phase 1 (rebuild plan labels:
--         007b_member_interests.sql + 007c_member_follows.sql, consolidated
--         to 010_* per the renumbering established in T047 DEVIATIONS);
--         product/systems/member.md lines 230 (interests) + 243 (follows);
--         development/tickets/T048-member-interests-and-follows.md.
--
-- Two tables in one migration:
--   1. public.member_interests — controlled-vocabulary tag list per Member.
--      Public-by-default visibility (powers Item relevance + Group
--      suggestion). Vocabulary validation lives in the action handler
--      (member.interests.add), not in the schema — lets vocabulary evolve
--      without migrations.
--   2. public.member_follows — Loop 8 substrate. Soft-unfollow via
--      unfollowed_at; partial indexes cover the two follower-direction
--      surfaces. Public-by-default visibility per the 2026-05-11 product
--      decision (recorded in DEVIATIONS): follow graph is community-fabric,
--      not sensitive data — the privacy work that ADR-9 targets lands on
--      member_location_affinities (T049) where `lives`/`works` affinity
--      rows are owner-only and cross-Member computation goes through
--      SECURITY DEFINER functions per member.md lines 295-298. The
--      member_privacy.show_following / show_followers columns from T047
--      remain as reserved substrate; the action layer / b2 surface
--      composer may wire them in later if real-Member feedback warrants
--      a per-Member opt-out, but the schema does not enforce them at b1.

------------------------------------------------------------
-- 1. public.member_interests
------------------------------------------------------------

create table public.member_interests (
  member_id   uuid          not null references public.members(id) on delete cascade,
  tag         text          not null
                            check (char_length(tag) between 1 and 60
                                   and tag ~ '^[a-z0-9-]+$'),
  created_at  timestamptz   not null default now(),
  primary key (member_id, tag)
);

-- Inverse lookup: "which Members declare interest in `live-music`?"
-- Powers the Group-suggestion query at onboarding and the locality-first
-- index relevance scoring.
create index idx_member_interests_tag
  on public.member_interests (tag);

alter table public.member_interests enable row level security;

create policy member_interests_public_read on public.member_interests
  for select
  using (true);

-- No INSERT / UPDATE / DELETE policy — action-layer-only writes per ADR-7.
-- The action handler `member.interests.add` (T2) validates against the
-- controlled vocabulary before insert.

comment on table public.member_interests is
  'Public-by-default tag list per Member. Powers Item relevance + Group suggestion + locality-first index scoring. Vocabulary validation lives in the action handler, not the schema.';

------------------------------------------------------------
-- 2. public.member_follows
------------------------------------------------------------

create table public.member_follows (
  follower_member_id  uuid          not null references public.members(id) on delete cascade,
  followed_member_id  uuid          not null references public.members(id) on delete cascade,
  created_at          timestamptz   not null default now(),
  unfollowed_at       timestamptz,
  primary key (follower_member_id, followed_member_id),
  check (follower_member_id <> followed_member_id)
);

-- "Who follows X" surface — Loop 8. The PK leads with follower_member_id,
-- so it doesn't help reverse lookups. This is the load-bearing new index.
create index idx_follows_followed_active
  on public.member_follows (followed_member_id)
  where unfollowed_at is null;

-- "Who does X follow" surface. The PK (follower_member_id, followed_member_id)
-- can leading-column scan by follower_member_id, but only against the full
-- table. This partial index keeps active-follows scans lean and cache-friendly
-- by skipping soft-unfollowed rows entirely.
create index idx_follows_follower_active
  on public.member_follows (follower_member_id)
  where unfollowed_at is null;

alter table public.member_follows enable row level security;

-- Public-by-default visibility. Per the 2026-05-11 product decision (see
-- migration header + DEVIATIONS): follow graph is community-fabric, and
-- the cross-Member privacy work ADR-9 targets lives on
-- member_location_affinities (T049). If a future b2 surface composer wants
-- per-Member opt-out, it wires member_privacy.show_following /
-- show_followers via the action layer; the schema does not gate at b1.
create policy member_follows_public_read on public.member_follows
  for select
  using (true);

-- No INSERT / UPDATE / DELETE policy — action-layer-only writes per ADR-7.
-- The action handlers `member.follow` / `member.unfollow` (T2) own writes;
-- unfollow sets unfollowed_at rather than deleting (soft-unfollow keeps
-- "you previously followed X" surfaces working).

comment on table public.member_follows is
  'Loop 8 substrate. Soft-unfollow via unfollowed_at. Public-by-default visibility per the 2026-05-11 product decision — follow graph is community-fabric. Location-affinity privacy (lives/works) lives on member_location_affinities (T049) where ADR-9 opt-out posture applies.';
