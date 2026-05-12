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
--      surfaces. Privacy-gated visibility: a row (A, B) is publicly
--      readable only when A.show_following = true AND B.show_followers
--      = true. Members always see their own follows regardless of
--      privacy (member_follows_self_read).

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

-- "Who follows X" surface — Loop 8.
create index idx_follows_followed_active
  on public.member_follows (followed_member_id)
  where unfollowed_at is null;

-- "Who does X follow" surface.
create index idx_follows_follower_active
  on public.member_follows (follower_member_id)
  where unfollowed_at is null;

alter table public.member_follows enable row level security;

-- A Member always sees their own follow relationships in both directions.
-- Bypasses the privacy-gating below.
create policy member_follows_self_read on public.member_follows
  for select
  using (
    follower_member_id = auth.uid()
    or followed_member_id = auth.uid()
  );

-- Public visibility requires BOTH endpoints to opt in via member_privacy:
--   follower.show_following = true (the follower has agreed to show what they follow)
--   followed.show_followers = true (the followed Member has agreed to show their followers)
-- Per Postgres RLS multi-policy semantics, this OR's with member_follows_self_read —
-- a row is visible if either policy returns true.
create policy member_follows_public_read on public.member_follows
  for select
  using (
    exists (
      select 1 from public.member_privacy mp_follower
      where mp_follower.member_id = follower_member_id
        and mp_follower.show_following = true
    )
    and exists (
      select 1 from public.member_privacy mp_followed
      where mp_followed.member_id = followed_member_id
        and mp_followed.show_followers = true
    )
  );

-- No INSERT / UPDATE / DELETE policy — action-layer-only writes per ADR-7.
-- The action handlers `member.follow` / `member.unfollow` (T2) own writes;
-- unfollow sets unfollowed_at rather than deleting (soft-unfollow keeps
-- "you previously followed X" surfaces working).

comment on table public.member_follows is
  'Loop 8 substrate. Soft-unfollow via unfollowed_at. Visibility gated by member_privacy.show_following + show_followers on both endpoints; self-rows always visible to the Member.';
