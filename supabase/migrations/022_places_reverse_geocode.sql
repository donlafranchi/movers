-- T059 — Reverse-geocode SECURITY DEFINER function.
--
-- Ships:
--   1. public.place_for_coords(lat, lon) — returns (place_id, kind) or zero rows
--
-- Spec anchors:
--   product/systems/places.md § Data model implications → Reverse-geocoder contract
--   planning/adrs/ADR-0020-locality-scoped-urls.md § Anchoring rules
--   planning/bundles/b1x-substrate-sprint.md § A2
--
-- Resolution rule: walk public.places.geography with ST_Covers (geography-
-- aware containment); return the row with the smallest covering polygon
-- (neighborhood beats city beats county beats state). ST_Covers handles
-- boundary points correctly (ST_Contains excludes the boundary, which
-- would surface near-edge points as ambiguous).
--
-- SECURITY DEFINER because the polygon library is curated server-side and
-- the result has no privacy concern (places are public-read). Stable
-- (deterministic for a given coordinate + place data) so query planner can
-- cache.
--
-- The function returns ZERO rows when no polygon covers the point. The
-- caller (web/src/lib/places/reverse-geocode.ts) decides whether to fall
-- back to Mapbox. b1 seeded rows have no geometry — the polygon library is
-- a T2 deliverable per places.md — so this function will return nothing
-- until polygons are loaded. The contract still holds: callers cope with
-- empty result.

create or replace function public.place_for_coords(
  p_lat double precision,
  p_lon double precision
)
returns table(place_id uuid, kind text)
language sql
security definer
stable
set search_path = public, pg_catalog
as $$
  select id, kind
  from public.places
  where geography is not null
    and deleted_at is null
    and ST_Covers(
      geography,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
    )
  order by ST_Area(geography::geometry) asc
  limit 1;
$$;

comment on function public.place_for_coords(double precision, double precision) is
  'Reverse-geocode a coordinate to its most-specific containing place. Returns zero rows when no polygon covers the point — caller falls back to external geocoder per places.md. SECURITY DEFINER because places are public-read curated infrastructure.';

-- Public-callable. RLS doesn't apply to SECURITY DEFINER functions, but we
-- still grant execute to anon + authenticated so PostgREST exposes it.
grant execute on function public.place_for_coords(double precision, double precision) to anon, authenticated, service_role;
