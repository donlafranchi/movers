-- T046 — Locations RLS fix-forward
-- Source: development/tickets/T046-locations-rls-fixes.md;
--         T045 M2 code-review record;
--         product/systems/location.md lines 136 + 165
--
-- Three corrective items the T045 code review surfaced:
--   1. Add locations_owner_read RLS policy — completes the matrix for private
--      Locations (location.md line 165: "Private Locations readable only by
--      member_id = auth.uid()"). T045 shipped public-read + owner-update;
--      this adds the missing owner-read.
--   2. Swap idx_locations_geog from full to partial (where deleted_at is null)
--      — matches location.md line 136. Soft-deleted rows no longer participate
--      in proximity queries.
--   3. Extend sync_area_centroid()'s search_path to (public, extensions) —
--      defensive against Supabase's relocation of PostGIS to the extensions
--      schema in newer Postgres distributions. Function body unchanged.
--
-- No data preservation concerns — rebuild phase, no live data.

------------------------------------------------------------
-- 1. locations_owner_read RLS policy
------------------------------------------------------------

create policy locations_owner_read on public.locations
  for select
  using (member_id = auth.uid() and deleted_at is null);

------------------------------------------------------------
-- 2. Partial GIST index swap
------------------------------------------------------------

drop index if exists public.idx_locations_geog;

create index idx_locations_geog
  on public.locations using gist (geography)
  where deleted_at is null;

------------------------------------------------------------
-- 3. sync_area_centroid() with extended search_path
------------------------------------------------------------

create or replace function public.sync_area_centroid()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.locations
  set geography = ST_Centroid(new.polygon)::geography(Point, 4326)
  where id = new.location_id;
  return new;
end;
$$;
