-- T061 — Retire `member_location_affinities` table + 3 SECURITY DEFINER functions.
--
-- Ships:
--   1. Drop the three SECURITY DEFINER scalar functions installed by T049
--      (member_is_local_to_location, count_likes_for_location, count_followers_for_location).
--   2. Drop public.member_location_affinities.
--   3. Rewrite public.member_events.event_kind CHECK to remove the two dead
--      kinds (member.location_affinity_added/removed). Postgres CHECK
--      constraints are not partially droppable — drop-and-recreate is the
--      only path.
--
-- Spec anchors:
--   planning/adrs/ADR-0021-member-geography-substrate-split.md (Ratified 2026-05-23)
--   planning/adrs/ADR-0016-affinity-row-privacy.md (fully superseded by ADR-21)
--   planning/rebuild-plan.md b1 rule 7
--   planning/bundles/b1x-substrate-sprint.md § B1
--
-- Independence note: nothing in web/src/ references this table; the only
-- consumers were evals (members-affinities.spec.ts and floor.spec.ts). The
-- accompanying T061 follow-up deletes/patches those eval files (not in
-- this migration). The planned action handlers (`member.location_affinity.*`
-- per 011_member_location_affinities.sql:78-82) were never written.
--
-- This migration runs after T062's 018 and T063's 019 — both of those
-- rewrite the same member_events CHECK to *add* new kinds; this migration
-- rewrites once more to *drop* the dead ones. The final CHECK is the union
-- of (002's original ∪ T062's additions ∪ T063's additions) minus the two
-- location_affinity kinds.

------------------------------------------------------------
-- 1. Drop SECURITY DEFINER functions (must drop first because the table
--    they reference is about to go away; CASCADE on the table drop would
--    also work but explicit ordering keeps the migration self-documenting).
------------------------------------------------------------

drop function if exists public.member_is_local_to_location(uuid, uuid);
drop function if exists public.count_likes_for_location(uuid);
drop function if exists public.count_followers_for_location(uuid);

------------------------------------------------------------
-- 2. Drop the table.
------------------------------------------------------------

drop table if exists public.member_location_affinities;

------------------------------------------------------------
-- 3. Rewrite member_events.event_kind CHECK.
--    Postgres CHECK constraint name from 002_members.sql is auto-generated
--    as `member_events_event_kind_check`. We drop it and re-add with the
--    trimmed list. The final list is:
--      002 original (18 kinds) ∪ T062 additions (4) ∪ T063 additions (3) - 2 dropped
------------------------------------------------------------

alter table public.member_events
  drop constraint if exists member_events_event_kind_check;

alter table public.member_events
  add constraint member_events_event_kind_check
  check (event_kind in (
    -- 002 original (minus the two retired affinity kinds)
    'member.created',
    'member.profile_updated',
    'member.home_location_set',
    'member.privacy_changed',
    'member.maker_mode_changed',
    'member.followed',
    'member.unfollowed',
    'member.interest_added',
    'member.interest_removed',
    'member.delegation_granted',
    'member.delegation_revoked',
    'member.deleted',
    'member.restored',
    'member.export_requested',
    'member.purge_executed',
    'member.handle_changed',
    -- T062 additions (018_member_place_interests.sql)
    'member.place_interest_added',
    'member.place_interest_removed',
    'member.place_interest_promoted',
    'member.place_interest_demoted',
    -- T063 additions (019_member_saved_searches.sql)
    'member.saved_search.created',
    'member.saved_search.updated',
    'member.saved_search.removed'
  ));

comment on constraint member_events_event_kind_check on public.member_events is
  'Rewritten by T061 (021): drops member.location_affinity_added/removed (retired with member_location_affinities); union of original + T062 place_interest_* + T063 saved_search.*.';
