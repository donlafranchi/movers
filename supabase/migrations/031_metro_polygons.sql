-- T103 — Metro-polygon discovery overlay + members.home_metro_id.
--
-- Ships the S-metro substrate (STAGE-LEDGER S-metro). Encodes the ratified
-- metro-polygon overlay decisions (PLATFORM-PATTERNS § metro-polygon overlay,
-- all Ratified 2026-06-02):
--   D1 — overlay construct: read-only, never in URLs, never a messaging
--        target, not editable by Members. metro_polygons is adjacent to the
--        place tree, NOT a places row.
--   D2 — CSA grain: Census-sourced (Combined Statistical Area), hand-tunable
--        where Census disagrees with how residents think about their metro.
--   D3 — colloquial metros belong to this overlay, NOT region tree rows. This
--        migration creates NO places row (verified in migrations-t103 test).
--   D4 — isochrone deferred to T2; radius + metro polygon ship now.
--
-- CSA vs MSA grain: T075's zip_metro_crosswalk uses CBSA/MSA codes (40900 —
-- four counties) for jurisdiction proximity. metro_polygons uses CSA grain
-- (472 — six counties) for discovery feed widening. Different purposes,
-- different grain — the two substrates coexist without conflict.
--
-- Polygon source-of-truth: U.S. Census TIGER/Line 2023 Combined Statistical
-- Areas, tl_2023_us_csa  (https://www2.census.gov/geo/tiger/TIGER2023/CSA/),
-- CSA code 472 = "Sacramento-Roseville, CA" (Sacramento, Placer, El Dorado,
-- Yolo, Sutter, Yuba counties). Retrieval date for the authoritative replay:
-- pending S-metro full-res backfill.
--
-- DEVIATION (flagged in DEVIATIONS.md + SPEC-PATCHES.md): the seeded polygon
-- is a simplified axis-aligned bounding approximation of the cited CSA source,
-- NOT the full-resolution TIGER 2023 boundary geometry — same approach and
-- precedent as T076 (seed_method='approx_bbox'). It gives ST_Contains correct
-- *coverage* for the launch market (downtown Sacramento resolves to this
-- metro; out-of-region points do not), which is all the b1 substrate requires.
-- The authoritative full-resolution replay is deferred. Provenance +
-- approximation recorded in metadata.
--
-- DEVIATION (flagged): the ticket names a `member.locality.set` action handler
-- writing `members.home_location_id`; that handler does not exist and
-- home_location_id is never populated. Locality is set via
-- member.place_interest.add (scope primary_home) → member_place_interests →
-- places.centroid. The backfill (§5) and the handler wiring (place-interest-
-- add/remove) therefore derive home_metro_id from the primary_home Place's
-- centroid, not from locations.geography. Same observable intent
-- (home-metro resolved at locality-save), real data path. See SPEC-PATCHES.md.

------------------------------------------------------------
-- 1. Table — metro_polygons discovery overlay (D1/D2).
------------------------------------------------------------

create table public.metro_polygons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                          -- CSA name, e.g. 'Sacramento-Roseville, CA'
  slug       text unique not null,                   -- stable key for logging/admin/idempotency
  csa_code   text unique not null,                   -- Census CSA FIPS code (D2)
  geography  geography(Polygon, 4326) not null,      -- CSA boundary polygon
  centroid   geography(Point, 4326) not null,        -- derived (ST_Centroid / ST_PointOnSurface fallback)
  source     text not null default 'Census-CSA-2023',
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.metro_polygons is
  'Metro-polygon discovery overlay (T103). CSA-grain (D2) boundaries adjacent to the place tree, NOT places rows (D1/D3). Platform-curated — writes are migration/service-role only. Read by the community-awareness feed (discovery.md) and the metro-scope opt-in (member.md) via ST_Contains. Never appears in URLs, never a messaging target (D1).';

-- GiST index — ST_Contains against the polygon is the hot path (feed
-- generation + resolve_home_metro both hit this).
create index idx_metro_polygons_geography
  on public.metro_polygons using gist (geography);

------------------------------------------------------------
-- 2. members.home_metro_id — derived FK to the overlay.
------------------------------------------------------------

alter table public.members
  add column home_metro_id uuid references public.metro_polygons(id) on delete set null;

comment on column public.members.home_metro_id is
  'Derived metro for the Member (T103). Resolved from the primary_home Place centroid via resolve_home_metro at locality-save (member.place_interest.add). Null when the Member has no primary_home or it falls outside any seeded CSA (rural fallback — F031 reads the null to offer radius scope instead of metro scope).';

create index idx_members_home_metro
  on public.members (home_metro_id)
  where deleted_at is null and home_metro_id is not null;

------------------------------------------------------------
-- 3. RLS — public read, no client writes (D1, platform-curated).
------------------------------------------------------------

alter table public.metro_polygons enable row level security;

-- Every user (anon + authenticated) reads the overlay for feed generation and
-- the metro-scope filter. Platform-curated means no client INSERT/UPDATE/
-- DELETE policy — writes are migration / service-role only.
create policy metro_select_public
  on public.metro_polygons
  for select
  using (true);

------------------------------------------------------------
-- 4. resolve_home_metro(point) — the containment resolver.
--
-- SECURITY INVOKER (no elevated privileges needed — metro_polygons is
-- publicly readable; unlike T075's zip_is_proximal_to_location which joins
-- through RLS-gated tables and needed DEFINER). Returns the containing
-- metro id, null if none. Deterministic smallest-by-area tiebreak guards
-- against future hand-tuned (D2) overlaps; with Census CSAs (non-overlapping)
-- it never fires.
------------------------------------------------------------

create or replace function public.resolve_home_metro(point geography)
returns uuid
language sql
stable
security invoker
as $$
  select id
  from public.metro_polygons
  where point is not null
    and ST_Contains(geography::geometry, point::geometry)
  order by ST_Area(geography) asc
  limit 1;
$$;

grant execute on function public.resolve_home_metro(geography) to authenticated, anon;

------------------------------------------------------------
-- 5. Seed — Sacramento-Roseville CSA (code 472) + centroid + backfill.
--
-- Polygon is the approx-bbox of the six-county CSA (see header DEVIATION).
-- Centroid derived in-transaction: ST_Centroid when it lands inside the
-- polygon, else ST_PointOnSurface (T076 precedent), method recorded in
-- metadata.centroid_method.
------------------------------------------------------------

with seed as (
  select
    'Sacramento-Roseville, CA'::text as name,
    'sacramento-roseville-ca'::text  as slug,
    '472'::text                      as csa_code,
    -- Six-county bounding approximation: Yolo (west) → El Dorado/Tahoe (east),
    -- southern El Dorado/Sacramento (south) → northern Yuba/Sutter (north).
    ST_GeomFromText(
      'POLYGON((-122.5 38.0, -119.85 38.0, -119.85 39.65, -122.5 39.65, -122.5 38.0))',
      4326
    )::geography as geography
)
insert into public.metro_polygons (name, slug, csa_code, geography, centroid, metadata)
select
  s.name, s.slug, s.csa_code, s.geography,
  case
    when ST_Contains(s.geography::geometry, ST_Centroid(s.geography::geometry))
      then ST_Centroid(s.geography::geometry)::geography
    else ST_PointOnSurface(s.geography::geometry)::geography
  end,
  jsonb_build_object(
    'seed_method', 'approx_bbox',
    'census_vintage', 'TIGER-2023',
    'counties', jsonb_build_array('Sacramento','Placer','El Dorado','Yolo','Sutter','Yuba'),
    'centroid_method',
      case
        when ST_Contains(s.geography::geometry, ST_Centroid(s.geography::geometry))
          then 'centroid'
        else 'point_on_surface'
      end
  )
from seed s
on conflict (csa_code) do nothing;

-- Backfill existing Members: derive home_metro_id from their active
-- primary_home Place's centroid. (No home_location_id path — see header
-- DEVIATION.) Runs in the same transaction as the seed so the Sacramento row
-- is available. Members with no primary_home, or whose primary_home falls
-- outside every seeded CSA, keep home_metro_id = null (rural fallback).
update public.members m
set home_metro_id = public.resolve_home_metro(p.centroid)
from public.member_place_interests mpi
join public.places p
  on p.id = mpi.place_id and p.deleted_at is null
where mpi.member_id = m.id
  and mpi.scope_kind = 'primary_home'
  and mpi.removed_at is null
  and m.deleted_at is null
  and p.centroid is not null;
