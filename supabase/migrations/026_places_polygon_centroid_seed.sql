-- T076 — Sacramento-region Places: polygon backfill + centroid + new cities.
--
-- Ships:
--   1. public.places.centroid geography(Point,4326) column + GiST index
--      (idx_places_centroid; KNN-capable for nearest-neighbour tiebreaks).
--   2. Three new incorporated cities — Davis (Yolo Co.), Roseville (Placer
--      Co.), Folsom (Sacramento Co.) — with polygons.
--   3. Polygon backfill for the T058-seeded rows that shipped geometry-less:
--      California, Sacramento/Yolo/Placer counties, Sacramento + West
--      Sacramento cities, and the five Sacramento neighbourhoods.
--   4. Derived centroid for every touched row (ST_PointOnSurface fallback
--      when ST_Centroid escapes a concave shape — noted in metadata).
--   5. One place_events row per touched place (place.created for the three
--      new cities, place.updated for the eleven backfills), all carrying a
--      single correlation_id so the batch is unwindable.
--
-- NO metro / region row (D3, Ratified 2026-06-02 — PLATFORM-PATTERNS §
-- metro-polygon overlay). Colloquial metros (the Sacramento MSA/CSA) live in
-- the future `metro_polygons` discovery overlay, NOT the place tree. Every
-- city's authoritative parent walk terminates through a COUNTY, never a
-- metro/region row: Oak Park → Sacramento → Sacramento County → California.
-- The four-county+ CSA metro geometry belongs to the S-metro ticket.
--
-- Placer County note: T058 (017_places.sql) already seeded Placer as a
-- `kind='county'` row with slug 'placer'. This migration therefore BACKFILLS
-- Placer's polygon (place.updated) rather than inserting a duplicate; the
-- existing row already anchors Roseville under a county per the schema's
-- `kind='city' ⇒ ancestor_state_id NOT NULL` invariant. See DEVIATIONS.md.
--
-- Polygon source-of-truth (resolves places.md § Open questions — *Polygon
-- source-of-truth and licensing* for the launch market):
--   * Counties/state  — U.S. Census TIGER/Line 2023, tl_2023_us_county /
--     tl_2023_us_state    https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/
--                         https://www2.census.gov/geo/tiger/TIGER2023/STATE/
--   * Incorporated cities — U.S. Census TIGER/Line 2023 Places (California),
--     tl_2023_06_place    https://www2.census.gov/geo/tiger/TIGER2023/PLACE/
--   * Neighbourhoods — City of Sacramento Open Data, "Neighborhoods" layer,
--     https://data.cityofsacramento.org/ (public-domain civic boundaries)
--   Retrieval date for the authoritative replay: pending S-metro full-res
--   backfill. (Census TIGER + Census Places are public domain; City of
--   Sacramento Open Data is published under an open licence.)
--
-- DEVIATION (flagged in DEVIATIONS.md + SPEC-PATCHES.md): the polygons below
-- are simplified axis-aligned bounding approximations of the cited sources,
-- NOT the full-resolution TIGER 2023 boundary geometry. They give the
-- reverse-geocoder correct *coverage* and correct *smallest-covering-polygon
-- ordering* for the launch market (verified in tests/places-polygon-seed and
-- tests/places-reverse-geocode), which is all b1 substrate requires. The
-- authoritative full-resolution replay from the URLs above is deferred to the
-- S-metro ticket, which owns the polygon-library backfill. Provenance +
-- approximation are recorded in each row's place_events payload
-- (seed_method='approx_bbox').
--
-- Encodes ratified absolutes:
--   product/systems/places.md — platform-curated (no INSERT/UPDATE/DELETE
--     policy; writes via this service-role migration), parent_id is the
--     single source of hierarchy.
--   PLATFORM-PATTERNS — county tier (ADR-0022); metro-polygon overlay D3.

------------------------------------------------------------
-- 1. Schema — derived centroid column + KNN-capable GiST index.
--
-- Polygon stays source-of-truth; centroid is derived at seed/update time so
-- nearest-neighbour tiebreaks (places.md § Reverse-geocoder) avoid
-- ST_Centroid(geography) on every query and the index can serve KNN (<->).
------------------------------------------------------------

alter table public.places
  add column if not exists centroid geography(Point, 4326);

create index if not exists idx_places_centroid
  on public.places using gist (centroid)
  where centroid is not null and deleted_at is null;

comment on column public.places.centroid is
  'Derived point-on-surface of geography, set at seed/update time (T076). Polygon stays source-of-truth. GiST index serves KNN distance tiebreaks per places.md § Reverse-geocoder. ST_PointOnSurface substituted for ST_Centroid when the centroid escapes a concave MultiPolygon — see metadata.centroid_method.';

------------------------------------------------------------
-- 2. Staging — (slug, kind, parent, geometry) for every touched row.
--
-- match_slug + match_kind uniquely identify each row (the only slug
-- collision is 'sacramento', disambiguated county-vs-city by match_kind).
-- parent_slug + parent_kind resolve the FK for the three NEW cities.
------------------------------------------------------------

create temporary table _t076_seed (
  match_slug   text    not null,
  match_kind   text    not null,
  parent_slug  text,
  parent_kind  text,
  is_new       boolean not null,
  display_name text    not null,
  wkt          text    not null
) on commit drop;

insert into _t076_seed
  (match_slug, match_kind, parent_slug, parent_kind, is_new, display_name, wkt)
values
  ('ca','state',null,null,false,'California','MULTIPOLYGON(((-124.45 32.5, -114.1 32.5, -114.1 42.05, -124.45 42.05, -124.45 32.5)))'),
  ('sacramento','county','ca','state',false,'Sacramento','MULTIPOLYGON(((-121.86 38.02, -121.03 38.02, -121.03 38.74, -121.86 38.74, -121.86 38.02)))'),
  ('yolo','county','ca','state',false,'Yolo','MULTIPOLYGON(((-122.1 38.31, -121.5 38.31, -121.5 38.93, -122.1 38.93, -122.1 38.31)))'),
  ('placer','county','ca','state',false,'Placer','MULTIPOLYGON(((-121.48 38.71, -120 38.71, -120 39.32, -121.48 39.32, -121.48 38.71)))'),
  ('sacramento','city','sacramento','county',false,'Sacramento','MULTIPOLYGON(((-121.56 38.44, -121.36 38.44, -121.36 38.68, -121.56 38.68, -121.56 38.44)))'),
  ('west-sacramento','city','yolo','county',false,'West Sacramento','MULTIPOLYGON(((-121.56 38.555, -121.515 38.555, -121.515 38.61, -121.56 38.61, -121.56 38.555)))'),
  ('davis','city','yolo','county',true,'Davis','MULTIPOLYGON(((-121.785 38.52, -121.695 38.52, -121.695 38.575, -121.785 38.575, -121.785 38.52)))'),
  ('roseville','city','placer','county',true,'Roseville','MULTIPOLYGON(((-121.345 38.715, -121.235 38.715, -121.235 38.8, -121.345 38.8, -121.345 38.715)))'),
  ('folsom','city','sacramento','county',true,'Folsom','MULTIPOLYGON(((-121.22 38.63, -121.105 38.63, -121.105 38.71, -121.22 38.71, -121.22 38.63)))'),
  ('land-park','neighborhood','sacramento','city',false,'Land Park','MULTIPOLYGON(((-121.512 38.53, -121.492 38.53, -121.492 38.552, -121.512 38.552, -121.512 38.53)))'),
  ('curtis-park','neighborhood','sacramento','city',false,'Curtis Park','MULTIPOLYGON(((-121.49 38.535, -121.476 38.535, -121.476 38.558, -121.49 38.558, -121.49 38.535)))'),
  ('oak-park','neighborhood','sacramento','city',false,'Oak Park','MULTIPOLYGON(((-121.474 38.535, -121.455 38.535, -121.455 38.558, -121.474 38.558, -121.474 38.535)))'),
  ('midtown','neighborhood','sacramento','city',false,'Midtown','MULTIPOLYGON(((-121.495 38.562, -121.47 38.562, -121.47 38.585, -121.495 38.585, -121.495 38.562)))'),
  ('east-sacramento','neighborhood','sacramento','city',false,'East Sacramento','MULTIPOLYGON(((-121.46 38.56, -121.435 38.56, -121.435 38.585, -121.46 38.585, -121.46 38.56)))');

------------------------------------------------------------
-- 3. INSERT the three new cities (geometry inline).
--
-- Parent resolved by (slug, kind) so 'sacramento' county is picked for
-- Folsom, never the like-named city. The ancestor_state_id trigger fills
-- the denormalized state pointer; the city-must-have-state CHECK passes.
------------------------------------------------------------

insert into public.places (parent_id, slug, display_name, kind, geography)
select par.id, s.match_slug, s.display_name, s.match_kind,
       ST_GeomFromText(s.wkt, 4326)::geography
from _t076_seed s
join public.places par
  on par.slug = s.parent_slug
 and par.kind = s.parent_kind
 and par.deleted_at is null
where s.is_new;

------------------------------------------------------------
-- 4. BACKFILL polygons for the eleven existing rows.
------------------------------------------------------------

update public.places p
set geography = ST_GeomFromText(s.wkt, 4326)::geography
from _t076_seed s
where not s.is_new
  and p.slug = s.match_slug
  and p.kind = s.match_kind
  and p.deleted_at is null;

------------------------------------------------------------
-- 5. Derive centroid for every touched row.
--
-- ST_Centroid can fall outside a concave MultiPolygon (rare for civic
-- boundaries, common for island geometries). Where ST_Contains rejects the
-- centroid, fall back to ST_PointOnSurface and record the substitution in
-- metadata.centroid_method.
------------------------------------------------------------

update public.places p
set centroid = case
      when ST_Contains(p.geography::geometry, ST_Centroid(p.geography::geometry))
        then ST_Centroid(p.geography::geometry)::geography
      else ST_PointOnSurface(p.geography::geometry)::geography
    end,
    metadata = case
      when ST_Contains(p.geography::geometry, ST_Centroid(p.geography::geometry))
        then p.metadata
      else jsonb_set(p.metadata, '{centroid_method}', '"point_on_surface"'::jsonb)
    end
from _t076_seed s
where p.slug = s.match_slug
  and p.kind = s.match_kind
  and p.deleted_at is null
  and p.geography is not null;

------------------------------------------------------------
-- 6. place_events — one row per touched place, single correlation_id.
--
-- acting_member_id = the system Member (002_members.sql). place.created for
-- the three new cities; place.updated for the eleven polygon backfills. The
-- shared correlation_id lets the whole seed batch be unwound together.
------------------------------------------------------------

select public.rotate_place_events_partitions();

insert into public.place_events (place_id, event_kind, payload, acting_member_id)
select p.id,
       case when s.is_new then 'place.created' else 'place.updated' end,
       jsonb_build_object(
         'correlation_id', 'b7600000-0000-4000-8000-000000000076',
         'source',         'T076_polygon_centroid_seed',
         'seed_method',    'approx_bbox',
         'polygon_source', case s.match_kind
                             when 'neighborhood' then 'city_of_sacramento_open_data'
                             else 'census_tiger_2023'
                           end
       ),
       '00000000-0000-0000-0000-000000000001'
from _t076_seed s
join public.places p
  on p.slug = s.match_slug
 and p.kind = s.match_kind
 and p.deleted_at is null;
