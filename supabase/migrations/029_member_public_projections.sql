-- T092 — Public Member-page projections (F032 read surface).
--
-- The public Member page at /m/[handle] needs two reads that the base-table
-- RLS does NOT grant to an anonymous (or non-co-member) viewer:
--
--   1. member_has_standing_presence — the badge derivation view (014_groups.sql)
--      was created without a GRANT, so anon/authenticated PostgREST roles can't
--      read it. The page needs it for every viewer. Grant select.
--
--   2. group_memberships — RLS is owner/co-member only (memberships_select_self
--      + memberships_select_co_member). A public page that lists a Member's
--      *listed* group memberships therefore needs a privacy-preserving
--      projection. This regular view runs with the owner's privileges (RLS on
--      the base tables is bypassed for the view body), and its WHERE clause is
--      the gate: only ACTIVE explicit memberships in non-dissolved, LISTED
--      Groups, projecting only public-safe columns (slug/name/kind). Unlisted
--      and private Groups never appear; place-interests are never touched.
--
-- Privacy posture (member.md § Follows/visibility): the follow graph and listed
-- Group memberships are community-fabric. The b1 visibility gate for "listed
-- membership" is groups.discoverability = 'listed' — members.stakeholder_visibility
-- and per-membership visibility remain reserved substrate with no surface yet.

------------------------------------------------------------
-- 1. Grant the standing-presence view to the PostgREST roles.
------------------------------------------------------------

grant select on public.member_has_standing_presence to anon, authenticated;

------------------------------------------------------------
-- 2. public.member_public_group_memberships (view)
------------------------------------------------------------

create or replace view public.member_public_group_memberships as
  select gm.member_id,
         g.id   as group_id,
         g.slug,
         g.name,
         g.kind
    from public.group_memberships gm
    join public.groups g on g.id = gm.group_id
   where gm.left_at is null
     and gm.source = 'explicit'
     and g.dissolved_at is null
     and g.discoverability = 'listed';

comment on view public.member_public_group_memberships is
  'Public, privacy-preserving projection of a Member''s listed Group memberships for the /m/[handle] page (F032). Regular view → runs with owner privileges so it bypasses group_memberships RLS (owner/co-member only); the WHERE clause is the gate: active explicit memberships in non-dissolved, listed Groups only. Unlisted/private Groups never surface. Anon-readable via the grant below.';

grant select on public.member_public_group_memberships to anon, authenticated;
