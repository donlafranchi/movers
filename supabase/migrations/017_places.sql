-- T058 — Places primitive + launch-locality seed.
--
-- Ships:
--   1. public.places                  (self-referential hierarchy; platform-curated)
--   2. ancestor_state_id column + trigger (denormalized state ancestor)
--   3. State-scoped UNIQUE for city slugs (one Sacramento per state, not per county)
--   4. public.place_events            (monthly partitioned per ADR-10)
--   5. Seed rows: CA (state) → 5 counties (Sacramento, Yolo, Placer,
--      El Dorado, Sutter) → Sacramento (city, under Sacramento County) +
--      West Sacramento (city, under Yolo County) → 5 neighborhoods under
--      Sacramento city = 13 rows total.
--
-- Spec anchors:
--   product/systems/places.md
--   planning/adrs/ADR-0020-locality-scoped-urls.md
--   planning/adrs/ADR-0022-url-slug-naming-refinements.md (Accepted 2026-05-25)
--   planning/adrs/ADR-0007-action-layer.md
--   planning/adrs/ADR-0010-events-from-day-one.md
--   planning/adrs/ADR-0019-clean-slate-rebuild.md (b1.x sprint context)
--
-- ADR-0022 amendments encoded here:
--   * `kind` enum: msa → county. Counties tile the country completely
--     (FIPS-coded admin-level-2); MSAs leave ~1,200 rural counties without
--     a tier to anchor to. Region kind retained for colloquial groupings
--     ("the Bay Area").
--   * State slugs use 2-letter USPS codes (`ca`, not `california`).
--     Display name unchanged ("California"). Per PM, 2026-05-25.
--   * West Sacramento is an incorporated city in Yolo County — not a
--     Sacramento neighborhood. ADR-0022 § Consequences calls out the prior
--     misclassification; this seed encodes the corrected chain.
--   * Counties exist as data substrate but are skipped in URLs when a
--     city of the same name exists (resolver enforces; see
--     src/lib/places/resolve-path.ts). City slug uniqueness therefore
--     promotes from parent-scoped (one per county) to state-scoped (one
--     per state) — otherwise URL `/p/ca/sacramento` would be ambiguous if
--     two counties had cities with that slug.
--
-- Encodes ratified absolutes:
--   * "Places are platform-curated, not user-created." — ADR-20 Intent.
--     Enforced by absence of INSERT/UPDATE/DELETE policies; service-role-
--     only writes via the admin action handler.
--   * "URLs are locality-scoped wherever a place is the most stable
--     anchor." — ADR-20 Intent. Enforced by `parent_id` chain + the
--     uniqueness constraints below.
--   * Parent-scoped slug uniqueness — places.md Intent. Composite UNIQUE
--     (parent_id, slug) + partial UNIQUE for the NULL-parent root.
--   * State-scoped city uniqueness — ADR-0022 § Consequences. Partial
--     UNIQUE (ancestor_state_id, slug) WHERE kind='city'.
--
-- Naming note: places.md § Data model implications calls the soft-delete
-- column `deleted_at` (not `removed_at` used by member tables). Mirrored
-- here verbatim.

------------------------------------------------------------
-- 1. public.places (hierarchy)
------------------------------------------------------------

create table public.places (
  id                 uuid          not null default gen_random_uuid() primary key,
  parent_id          uuid                   references public.places(id) on delete restrict,
  -- Denormalized pointer to the state-kind ancestor (NULL for state/region/country
  -- rows themselves). Populated by trigger places_set_ancestor_state_id
  -- on insert/update of parent_id or kind. Powers the state-scoped city
  -- uniqueness constraint and the county-skipping URL resolver.
  ancestor_state_id  uuid                   references public.places(id) on delete restrict,
  slug               text          not null
                                   check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  display_name       text          not null
                                   check (char_length(display_name) between 1 and 120),
  kind               text          not null
                                   check (kind in ('region','state','county','city','neighborhood')),
  geography          geography(MultiPolygon, 4326),
  iso_country_code   text                   check (iso_country_code is null or char_length(iso_country_code) = 2),
  metadata           jsonb         not null default '{}'::jsonb,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),
  deleted_at         timestamptz,
  -- Cities must have an ancestor state — the URL resolver assumes it and
  -- the state-scoped UNIQUE below depends on it being non-null.
  constraint places_city_must_have_state_ancestor
    check (kind <> 'city' or ancestor_state_id is not null)
);

-- Parent-scoped slug uniqueness — load-bearing for hierarchy walks and
-- for the "two Oak Parks under different parents" case (ADR-20).
create unique index uniq_places_parent_slug
  on public.places (parent_id, slug)
  where deleted_at is null;

-- NULL-parent root uniqueness — Postgres treats NULLs as distinct under a
-- composite UNIQUE, so without this partial index two NULL-parent rows
-- could share a slug. Required for URL-namespace stability at the root.
create unique index uniq_places_root_slug
  on public.places (slug)
  where parent_id is null and deleted_at is null;

-- State-scoped city slug uniqueness (ADR-0022 amendment). One Sacramento
-- per California — not one Sacramento per California-county. The county is
-- skipped in URLs when a city of the same name exists, so collisions at
-- the city-slug-per-state level would surface as URL ambiguity.
create unique index uniq_places_city_per_state
  on public.places (ancestor_state_id, slug)
  where kind = 'city' and deleted_at is null;

-- Hierarchy walks — route resolver scans children of a known parent by
-- slug. Index excludes soft-deleted rows.
create index idx_places_parent_kind
  on public.places (parent_id, kind)
  where deleted_at is null;

-- Resolver lookup of cities scoped to a state (skipping the county tier).
create index idx_places_state_city
  on public.places (ancestor_state_id, slug)
  where kind = 'city' and deleted_at is null;

-- Polygon containment — reverse-geocoder (T059) does ST_Covers lookups.
create index idx_places_geography
  on public.places using gist (geography)
  where geography is not null and deleted_at is null;

create trigger places_set_updated_at
  before update on public.places
  for each row execute function public.update_updated_at_column();

------------------------------------------------------------
-- 1a. Trigger to populate ancestor_state_id from the parent chain.
--
-- Walks parent_id up to 5 hops (the kind enum has at most 5 levels:
-- region/state/county/city/neighborhood). Sets NEW.ancestor_state_id to
-- the id of the nearest state-kind ancestor, or NULL if none exists
-- (which is the correct value for state/region/country rows themselves).
------------------------------------------------------------

create or replace function public.places_set_ancestor_state_id()
returns trigger
language plpgsql
as $$
declare
  cur_id     uuid := NEW.parent_id;
  cur_kind   text;
  cur_parent uuid;
begin
  -- A state row has no state ancestor.
  if NEW.kind = 'state' then
    NEW.ancestor_state_id := NULL;
    return NEW;
  end if;

  for i in 1..5 loop
    if cur_id is null then
      NEW.ancestor_state_id := NULL;
      return NEW;
    end if;
    select kind, parent_id into cur_kind, cur_parent
      from public.places where id = cur_id;
    if not found then
      NEW.ancestor_state_id := NULL;
      return NEW;
    end if;
    if cur_kind = 'state' then
      NEW.ancestor_state_id := cur_id;
      return NEW;
    end if;
    cur_id := cur_parent;
  end loop;

  -- Walk exhausted without finding a state. NULL is the honest answer;
  -- the city-must-have-state CHECK will reject city rows in this state.
  NEW.ancestor_state_id := NULL;
  return NEW;
end;
$$;

create trigger places_set_ancestor_state_id
  before insert or update of parent_id, kind on public.places
  for each row execute function public.places_set_ancestor_state_id();

alter table public.places enable row level security;

-- Public-read. Anon + auth see all non-deleted places.
create policy places_select_all
  on public.places
  for select
  using (deleted_at is null);

-- No INSERT / UPDATE / DELETE policy.
-- Platform-curated per ADR-20 Intent. Writes only via the action layer
-- using the service-role connection (admin handler not yet written;
-- deferred to b2 admin curation surface per places.md § T2). T051 CI
-- enforcement catches any bypass attempt that imports the service role
-- outside src/actions/_lib/**.

comment on table public.places is
  'Platform-curated geographic hierarchy. Anchors locality-scoped URLs (ADR-20). Writes via action layer / service role only — no public INSERT/UPDATE/DELETE policy by design.';

------------------------------------------------------------
-- 2. public.place_events (partitioned monthly per ADR-10)
------------------------------------------------------------

create table public.place_events (
  id                 uuid          not null default gen_random_uuid(),
  place_id           uuid          not null references public.places(id) on delete cascade,
  event_kind         text          not null
                                   check (event_kind in (
                                     'place.created',
                                     'place.updated',
                                     'place.superseded',
                                     'place.merged'
                                   )),
  payload            jsonb         not null default '{}'::jsonb,
  acting_member_id   uuid                   references public.members(id) on delete restrict,
  via_delegation_id  uuid                   references public.member_delegations(id) on delete set null,
  created_at         timestamptz   not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create index idx_place_events_place
  on public.place_events (place_id, created_at desc);

create index idx_place_events_acting
  on public.place_events (acting_member_id, created_at desc)
  where acting_member_id is not null;

alter table public.place_events enable row level security;

-- Public-read on events. Place curation history is itself public infrastructure;
-- there is no peer-to-peer privacy concern with seeing that "Oak Park was
-- created on 2026-05-25 by admin." No acting-Member-specific RLS required.
create policy place_events_select_all
  on public.place_events
  for select
  using (true);

-- Partition rotation — mirrors item_events / member_events / group_events.
create or replace function public.ensure_place_events_partition(target_month date)
returns void
language plpgsql
as $$
declare
  partition_name text;
  range_start    date;
  range_end      date;
begin
  range_start    := date_trunc('month', target_month)::date;
  range_end      := (range_start + interval '1 month')::date;
  partition_name := format('place_events_y%sm%s',
                           to_char(range_start, 'YYYY'),
                           to_char(range_start, 'MM'));

  execute format(
    'create table if not exists public.%I partition of public.place_events
       for values from (%L) to (%L)',
    partition_name, range_start, range_end
  );
end;
$$;

create or replace function public.rotate_place_events_partitions()
returns void
language plpgsql
as $$
declare
  base date := date_trunc('month', now())::date;
begin
  perform public.ensure_place_events_partition(base);
  perform public.ensure_place_events_partition((base + interval '1 month')::date);
  perform public.ensure_place_events_partition((base + interval '2 months')::date);
end;
$$;

select public.rotate_place_events_partitions();

comment on table public.place_events is
  'Append-only place curation log per ADR-10. Monthly partitioned. Public-read; writes via action layer only.';

------------------------------------------------------------
-- 3. Launch-locality seed (Sacramento metro: 1 state + 5 counties +
--    2 cities + 5 neighborhoods = 13 rows)
--
-- These are the b1 launch markets per places.md § T1. B2/F028 cannot
-- insert a Member primary_home against an empty places table.
-- All seed rows: no geometry (T2 deliverable per places.md);
-- iso_country_code 'US' on California; metadata empty.
--
-- State slug is the 2-letter USPS code per ADR-0022 (display name still
-- "California"). Counties carry their natural slug. Sacramento County
-- and Sacramento (city) share the slug 'sacramento' — admitted by
-- parent-scoped UNIQUE because parent_id differs (state vs county). The
-- city is reachable from URL `/p/ca/sacramento`; the county is skipped
-- in URL form when a city of the same name exists. West Sacramento is
-- a Yolo County city per ADR-0022 (fixing the prior misclassification
-- as a Sacramento neighborhood).
------------------------------------------------------------

insert into public.places (parent_id, slug, display_name, kind, iso_country_code)
values (null, 'ca', 'California', 'state', 'US');

-- 5 counties under California: Sacramento + 4 neighbors (Yolo, Placer,
-- El Dorado, Sutter) cover the b1 launch metro.
with ca as (
  select id from public.places where slug = 'ca' and parent_id is null and deleted_at is null
)
insert into public.places (parent_id, slug, display_name, kind)
select ca.id, c.slug, c.display_name, 'county'
from ca, (values
  ('sacramento', 'Sacramento'),
  ('yolo',       'Yolo'),
  ('placer',     'Placer'),
  ('el-dorado',  'El Dorado'),
  ('sutter',     'Sutter')
) as c(slug, display_name);

-- Sacramento (the city) under Sacramento County. The shared slug
-- 'sacramento' is admitted because parent_id differs (county row id ≠
-- state row id).
with sac_county as (
  select p.id from public.places p
  join public.places parent on parent.id = p.parent_id
  where p.slug = 'sacramento' and p.kind = 'county'
    and parent.slug = 'ca'
    and p.deleted_at is null
)
insert into public.places (parent_id, slug, display_name, kind)
select sac_county.id, 'sacramento', 'Sacramento', 'city' from sac_county;

-- West Sacramento (city) under Yolo County. Separately incorporated city;
-- NOT a Sacramento neighborhood. ADR-0022 § Consequences identifies the
-- prior seed misclassification.
with yolo_county as (
  select p.id from public.places p
  join public.places parent on parent.id = p.parent_id
  where p.slug = 'yolo' and p.kind = 'county'
    and parent.slug = 'ca'
    and p.deleted_at is null
)
insert into public.places (parent_id, slug, display_name, kind)
select yolo_county.id, 'west-sacramento', 'West Sacramento', 'city' from yolo_county;

-- 5 neighborhoods under the city of Sacramento (west-sacramento removed;
-- it's now a Yolo County city above).
with sac_city as (
  select p.id from public.places p
  join public.places county on county.id = p.parent_id
  where p.slug = 'sacramento' and p.kind = 'city'
    and county.slug = 'sacramento' and county.kind = 'county'
    and p.deleted_at is null
)
insert into public.places (parent_id, slug, display_name, kind)
select sac_city.id, n.slug, n.display_name, 'neighborhood'
from sac_city, (values
  ('oak-park',        'Oak Park'),
  ('curtis-park',     'Curtis Park'),
  ('east-sacramento', 'East Sacramento'),
  ('midtown',         'Midtown'),
  ('land-park',       'Land Park')
) as n(slug, display_name);
