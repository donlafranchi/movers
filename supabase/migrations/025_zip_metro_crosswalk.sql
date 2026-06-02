-- T075 — zip_metro_crosswalk + proximity function + Location→MSA join path
-- Source: development/tickets/T075-member-business-jurisdictions-substrate.md
-- Spec:   product/systems/business-jurisdiction.md § Proximity computation /
--         § T1 (MVP Tier b1)
--
-- Ships:
--   1. public.zip_metro_crosswalk          (HUD-USPS ZIP→CBSA mapping; RLS public-read)
--   2. Sacramento CBSA-40900 seed           (inlined — mirrors seeds/zip_metro_crosswalk_sacramento.sql)
--   3. places.msa_code                      (added — column absent before T075)
--   4. locations.place_id                   (added — join path absent before T075)
--   5. public.zip_is_proximal_to_location() (SECURITY DEFINER; same-MSA test)
--
-- DEVIATION (see development/DEVIATIONS.md):
--   * The ticket assumed places.msa_code and locations.place_id already existed
--     (per T060/T066). Neither did. Both are added here, nullable, and flagged to
--     SPEC-PATCHES against location.md. The proximity function is null-safe-false,
--     so existing rows (locations with null place_id) never earn the badge until a
--     later ticket populates the join.
--   * The ticket said "no RLS on zip_metro_crosswalk." web/CLAUDE.md Rule 3 +
--     tests/rls-coverage.test.ts require RLS on EVERY public table. RLS is enabled
--     here with a public-read SELECT policy — this honors "public read" while
--     satisfying the hard CI rule. Seed/refresh writes run as table owner (service
--     role) and bypass RLS by design.
--   * Seed is inlined rather than `\i`/`\ir`-included: the Supabase migration
--     runner applies files via a Postgres driver, not psql, so backslash includes
--     would fail on `supabase db push`. The standalone seeds/ file is kept for
--     manual reload + future national expansion; this block mirrors it.

------------------------------------------------------------
-- 1. public.zip_metro_crosswalk
------------------------------------------------------------

create table public.zip_metro_crosswalk (
  zip          text          primary key check (zip ~ '^[0-9]{5}$'),
  msa_code     text          not null,                                    -- HUD CBSA code (e.g. 40900)
  msa_name     text          not null,
  state        text          not null check (state ~ '^[A-Z]{2}$'),
  source       text          not null default 'HUD-USPS-2026Q1',          -- provenance for refresh tracking
  refreshed_at timestamptz   not null default now()
);

comment on table public.zip_metro_crosswalk is
  'USPS/HUD ZIP-to-CBSA crosswalk, refreshed quarterly. Read by public.zip_is_proximal_to_location() to test a self-attested business ZIP against the anchor Location''s MSA. Seeded for CBSA 40900 (Sacramento) at b1; national seed lands later. Public read; writes run as table owner via migration/refresh job. Spec: business-jurisdiction.md § Proximity computation.';

-- RLS: public read (the crosswalk is reference data, intentionally world-readable
-- behind the SECURITY DEFINER function and for direct lookups). No client write
-- policy — seed + quarterly refresh run as table owner and bypass RLS.
alter table public.zip_metro_crosswalk enable row level security;

create policy zmc_select_public on public.zip_metro_crosswalk
  for select
  using (true);

------------------------------------------------------------
-- 2. Sacramento (CBSA 40900) seed — inlined. Mirrors
--    seeds/zip_metro_crosswalk_sacramento.sql. Counties: Sacramento, Placer,
--    El Dorado, Yolo. (Sutter County is Yuba City CBSA 49700, not seeded.)
------------------------------------------------------------

insert into public.zip_metro_crosswalk (zip, msa_code, msa_name, state, source)
values
  -- Sacramento County
  ('95608','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95610','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95621','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95624','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95626','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95628','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95630','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95632','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95638','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95641','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95655','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95660','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95662','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95670','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95673','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95683','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95690','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95693','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95742','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95757','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95758','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95811','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95814','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95815','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95816','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95817','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95818','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95819','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95820','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95821','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95822','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95823','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95824','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95825','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95826','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95827','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95828','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95829','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95831','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95832','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95833','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95834','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95835','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95838','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95841','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95842','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95843','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95864','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  -- Placer County
  ('95602','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95603','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95650','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95658','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95661','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95663','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95677','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95678','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95746','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95747','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95765','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  -- El Dorado County
  ('95613','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95614','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95619','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95623','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95633','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95634','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95635','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95651','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95664','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95667','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95672','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95682','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95684','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95709','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95762','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  -- Yolo County
  ('95605','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95606','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95607','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95612','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95616','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95618','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95627','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95637','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95645','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95653','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95691','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95694','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95695','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95697','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95698','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1'),
  ('95776','40900','Sacramento-Roseville-Folsom, CA','CA','HUD-USPS-2026Q1')
on conflict (zip) do update
  set msa_code = excluded.msa_code,
      msa_name = excluded.msa_name,
      state = excluded.state,
      source = excluded.source,
      refreshed_at = now();

------------------------------------------------------------
-- 3. places.msa_code — Location→MSA derivation target.
--    Column was absent (T060/T066 did not add it). Nullable; populated for the
--    seeded in-MSA Sacramento Places below.
------------------------------------------------------------

alter table public.places
  add column if not exists msa_code text;

comment on column public.places.msa_code is
  'HUD CBSA code for the Place''s metro. Added by T075 (the spec assumed it existed). Populated for the seeded Sacramento in-MSA Places; null elsewhere until a national backfill. Read by public.zip_is_proximal_to_location() via locations.place_id.';

-- Populate msa_code = 40900 for the subtree of the four CBSA-40900 counties
-- (Sacramento city + neighborhoods inherit from the county). California (state)
-- and Sutter (Yuba City CBSA) stay null.
with recursive in_msa as (
  select id
    from public.places
   where kind = 'county'
     and slug in ('sacramento', 'placer', 'el-dorado', 'yolo')
     and deleted_at is null
  union all
  select p.id
    from public.places p
    join in_msa on p.parent_id = in_msa.id
   where p.deleted_at is null
)
update public.places
   set msa_code = '40900'
 where id in (select id from in_msa);

------------------------------------------------------------
-- 4. locations.place_id — the anchor-Location → Place join the function needs.
--    Column was absent (locations carried geography only). Nullable; no
--    population path at b1, so the function returns false for all current
--    Locations (null-safe-false: a missing-data row never earns the badge).
------------------------------------------------------------

alter table public.locations
  add column if not exists place_id uuid references public.places(id) on delete set null;

create index if not exists idx_locations_place_id
  on public.locations (place_id)
  where deleted_at is null and place_id is not null;

comment on column public.locations.place_id is
  'Curated Place this Location resolves to (variable-depth place path). Added by T075 (the spec assumed it existed). Nullable; population lands in a later ticket. Read by public.zip_is_proximal_to_location() to derive the anchor Location''s MSA.';

------------------------------------------------------------
-- 5. public.zip_is_proximal_to_location(zip, location_id) -> boolean
--    Same-MSA = true. Null-safe-false on any gap in the join chain (unknown
--    ZIP, Location with null place_id, Place with null msa_code). Per
--    business-jurisdiction.md § Open questions #1 — rural cross-MSA tie-break
--    parked at b1; null-safe false is the conservative default.
--
--    SECURITY DEFINER so anon/authenticated can call it without direct read
--    grants on the crosswalk; STABLE because it only reads. Parameters are
--    name-qualified to disambiguate from the column `zip`.
------------------------------------------------------------

create or replace function public.zip_is_proximal_to_location(zip text, location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (
      select zc.msa_code
        from public.zip_metro_crosswalk zc
       where zc.zip = zip_is_proximal_to_location.zip
    )
    =
    (
      select pl.msa_code
        from public.locations loc
        join public.places pl on pl.id = loc.place_id
       where loc.id = zip_is_proximal_to_location.location_id
    ),
    false
  );
$$;

comment on function public.zip_is_proximal_to_location(text, uuid) is
  'Returns true when the input ZIP''s MSA matches the anchor Location''s MSA (locations.place_id -> places.msa_code). Null-safe false on any join-chain gap. SECURITY DEFINER. Spec: business-jurisdiction.md § Proximity computation.';

grant execute on function public.zip_is_proximal_to_location(text, uuid) to authenticated, anon;
