-- T103 — Contract test for public.resolve_home_metro(point geography).
-- Run against a migrated DB:  psql "$DATABASE_URL" -f supabase/tests/resolve_home_metro.sql
-- Self-contained: relies on the seeded Sacramento CSA (472), adds a small
-- overlapping hand-tuned metro to exercise the smallest-by-area tiebreak,
-- asserts the four contract cases, ROLLBACKs.
-- A failed assert raises and aborts; clean completion prints 'T103 OK'.

begin;

-- A tiny hand-tuned metro fully inside the Sacramento CSA, to force the
-- smallest-by-area tiebreak (the only path that creates overlapping polygons —
-- Census CSAs are non-overlapping by definition).
insert into public.metro_polygons (name, slug, csa_code, geography, centroid, metadata)
values (
  'T103 Inner Test Metro', 't103-inner', 'T103X',
  ST_GeomFromText('POLYGON((-121.6 38.5, -121.4 38.5, -121.4 38.7, -121.6 38.7, -121.6 38.5))', 4326)::geography,
  ST_GeomFromText('POINT(-121.5 38.6)', 4326)::geography,
  '{}'::jsonb
);

do $$
declare
  sac_id  uuid;
  inner_id uuid;
  got     uuid;
begin
  select id into sac_id   from public.metro_polygons where csa_code = '472';
  select id into inner_id from public.metro_polygons where csa_code = 'T103X';
  assert sac_id is not null, 'Sacramento CSA (472) must be seeded by migration 031';

  -- Case 1: point inside Sacramento CSA (but outside the inner test metro) →
  -- returns the Sacramento metro id. West Sacramento ~ (-121.53, 38.58) is in
  -- the big box; pick a point clearly outside the inner box.
  select public.resolve_home_metro(ST_GeomFromText('POINT(-121.3 39.2)', 4326)::geography) into got;
  assert got = sac_id, 'point inside Sacramento CSA should resolve to metro 472';

  -- Case 2: point outside all seeded CSAs (NYC) → null metro.
  select public.resolve_home_metro(ST_GeomFromText('POINT(-74.0 40.7)', 4326)::geography) into got;
  assert got is null, 'NYC point should resolve to null (outside all CSAs)';

  -- Case 3: null input → null.
  select public.resolve_home_metro(null) into got;
  assert got is null, 'null input should resolve to null';

  -- Case 4: smallest-by-area tiebreak / overlap — a point inside BOTH the
  -- Sacramento CSA and the inner test metro resolves to the smaller (inner).
  select public.resolve_home_metro(ST_GeomFromText('POINT(-121.5 38.6)', 4326)::geography) into got;
  assert got = inner_id, 'overlapping point should resolve to the smallest metro by area';

  raise notice 'T103 OK';
end $$;

rollback;
