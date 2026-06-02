-- T075 — Contract test for public.zip_is_proximal_to_location(zip, location_id).
-- Run against a migrated DB:  psql "$DATABASE_URL" -f supabase/tests/zip_is_proximal_to_location.sql
-- Self-contained: builds fixtures, asserts the five contract cases, ROLLBACKs.
-- A failed assert raises and aborts; clean completion prints 'T075 OK'.

begin;

-- Fixtures -----------------------------------------------------------------
insert into public.members (id, handle, display_name)
values ('00000000-0000-0000-0000-0000000000a1', 't075owner', 'T075 Owner');

-- In-MSA place (CBSA 40900) and a different-MSA place (CBSA 41860, SF).
insert into public.places (id, slug, display_name, kind, msa_code)
values
  ('00000000-0000-0000-0000-0000000000b1', 't075-in-msa',   'T075 In MSA',   'county', '40900'),
  ('00000000-0000-0000-0000-0000000000b2', 't075-diff-msa', 'T075 Diff MSA', 'county', '41860'),
  ('00000000-0000-0000-0000-0000000000b3', 't075-null-msa', 'T075 Null MSA', 'county', null);

-- A crosswalk ZIP in the different MSA (the seeded 95818 is already 40900).
insert into public.zip_metro_crosswalk (zip, msa_code, msa_name, state)
values ('94110', '41860', 'San Francisco-Oakland-Berkeley, CA', 'CA')
on conflict (zip) do nothing;

-- Locations: one resolving to the in-MSA place, one to the null-msa place,
-- one with no place_id at all.
insert into public.locations (id, member_id, kind, label, slug, geography, place_id)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
   'permanent', 'In-MSA venue', 't075-loc-in-msa',
   ST_SetSRID(ST_MakePoint(-121.49, 38.58), 4326)::geography, '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1',
   'permanent', 'Null-MSA venue', 't075-loc-null-msa',
   ST_SetSRID(ST_MakePoint(-121.49, 38.58), 4326)::geography, '00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1',
   'permanent', 'No-place venue', 't075-loc-no-place',
   ST_SetSRID(ST_MakePoint(-121.49, 38.58), 4326)::geography, null);

-- Assertions ---------------------------------------------------------------
do $$
begin
  -- Case 1: same MSA -> true. 95818 (40900) against the in-MSA Location.
  assert public.zip_is_proximal_to_location('95818', '00000000-0000-0000-0000-0000000000c1') = true,
    'same-MSA ZIP should be proximal';

  -- Case 2: different MSA -> false. 94110 (41860) against the in-MSA Location.
  assert public.zip_is_proximal_to_location('94110', '00000000-0000-0000-0000-0000000000c1') = false,
    'cross-MSA ZIP should not be proximal';

  -- Case 3: unknown ZIP -> false. 00000 is not in the crosswalk.
  assert public.zip_is_proximal_to_location('00000', '00000000-0000-0000-0000-0000000000c1') = false,
    'unknown ZIP should not be proximal';

  -- Case 4: Location with null place_id -> false (no place / no MSA to match).
  assert public.zip_is_proximal_to_location('95818', '00000000-0000-0000-0000-0000000000c3') = false,
    'Location with null place_id should not be proximal';

  -- Case 5: Place with null msa_code -> false.
  assert public.zip_is_proximal_to_location('95818', '00000000-0000-0000-0000-0000000000c2') = false,
    'Place with null msa_code should not be proximal';

  raise notice 'T075 OK';
end $$;

rollback;
