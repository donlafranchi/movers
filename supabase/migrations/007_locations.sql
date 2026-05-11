-- T045 — Locations spine + 3 children + location_events (Phase 1 floor)
-- Source: notes/migration-to-primitives.md § Phase 1 (Location surface);
--         product/systems/location.md § Spine + child data model;
--         development/tickets/T045-locations-schema.md
--
-- Numbering note: the rebuild plan calls this 008_*. Renumbered to 007 here
-- because locations is the most-independent Phase 1 schema and must land
-- before any 007_* member augmentation that FKs into it. Recorded in
-- DEVIATIONS.md.
--
-- Three logical sections in one file:
--   1. public.locations spine + indexes + updated_at trigger + RLS
--   2. public.location_permanent / location_recurring_temporary /
--      location_areas children + the centroid-sync trigger on areas
--   3. public.location_events (partitioned monthly per ADR-10) + rotation
--
-- Forward-looking columns reserved at b1: parent_location_id (T2 sub-venue
-- surface — no FK to self yet), embedding_id (T3), federation_origin (T13).
-- Their FKs / pipelines land at their respective tier tickets.

------------------------------------------------------------
-- 1. public.locations spine
------------------------------------------------------------

create table public.locations (
  id                   uuid          primary key default gen_random_uuid(),
  member_id            uuid          not null references public.members(id) on delete restrict,
  kind                 text          not null
                                     check (kind in ('permanent','recurring_temporary','area')),
  label                text          not null
                                     check (char_length(label) between 1 and 120),
  slug                 text          unique not null
                                     check (slug ~ '^[a-z0-9-]+$'
                                            and char_length(slug) between 3 and 80),
  description          text          check (description is null or char_length(description) <= 2000),
  geography            geography(Point, 4326) not null,
  parent_location_id   uuid,                                                  -- T2 sub-venue (no FK to self yet)
  brand_label          text,
  discoverability      text          not null default 'listed'
                                     check (discoverability in ('listed','unlisted','private')),
  ambient_extras       jsonb         not null default '{}'::jsonb,
  embedding_id         uuid,                                                  -- T3 embedding pipeline
  federation_origin    text,                                                  -- Loop 13 / federation
  deleted_at           timestamptz,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now()
);

create index idx_locations_geog
  on public.locations using gist (geography);

create index idx_locations_member
  on public.locations (member_id)
  where deleted_at is null;

create index idx_locations_listed
  on public.locations (kind, discoverability)
  where deleted_at is null and discoverability = 'listed';

create index idx_locations_active
  on public.locations (deleted_at)
  where deleted_at is null;

-- Reuses the function defined in 002_members.sql.
create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.update_updated_at_column();

alter table public.locations enable row level security;

create policy locations_public_read on public.locations
  for select
  using (deleted_at is null and discoverability in ('listed','unlisted'));

create policy locations_owner_update on public.locations
  for update
  using (member_id = auth.uid());

comment on table public.locations is
  'Phase 1 floor: Location primitive spine. One row per Location across all three kinds (permanent / recurring_temporary / area). geography column is a Point for all kinds; areas write the polygon centroid via the sync_area_centroid trigger on location_areas. Writes only via the action layer (ADR-7). Reserved columns: parent_location_id (T2 sub-venue; no self-FK yet), embedding_id (T3 pipeline; no FK), federation_origin (Loop 13). brand_label is the Location-level fallback when no kind=business Group is anchored.';

------------------------------------------------------------
-- 2. Child tables: permanent / recurring_temporary / areas
------------------------------------------------------------

create table public.location_permanent (
  location_id          uuid          primary key references public.locations(id) on delete cascade,
  street_address       text,
  public_hours         jsonb,
  accessibility_notes  text          check (accessibility_notes is null or char_length(accessibility_notes) <= 1000)
);

alter table public.location_permanent enable row level security;

create policy location_permanent_public_read on public.location_permanent
  for select
  using (
    exists (
      select 1
      from public.locations l
      where l.id = location_permanent.location_id
        and l.deleted_at is null
        and l.discoverability in ('listed','unlisted')
    )
  );

create table public.location_recurring_temporary (
  location_id          uuid          primary key references public.locations(id) on delete cascade,
  recurrence_rule      text,
  session_start_time   time,
  session_end_time     time
);

alter table public.location_recurring_temporary enable row level security;

create policy location_recurring_temporary_public_read on public.location_recurring_temporary
  for select
  using (
    exists (
      select 1
      from public.locations l
      where l.id = location_recurring_temporary.location_id
        and l.deleted_at is null
        and l.discoverability in ('listed','unlisted')
    )
  );

create table public.location_areas (
  location_id          uuid          primary key references public.locations(id) on delete cascade,
  polygon              geography(Polygon, 4326) not null,
  area_kind            text          not null
                                     check (area_kind in ('service_radius','neighborhood','city','region','custom')),
  radius_meters        integer
);

alter table public.location_areas enable row level security;

create policy location_areas_public_read on public.location_areas
  for select
  using (
    exists (
      select 1
      from public.locations l
      where l.id = location_areas.location_id
        and l.deleted_at is null
        and l.discoverability in ('listed','unlisted')
    )
  );

-- Centroid-sync trigger: when a location_areas row is inserted or its polygon
-- updated, write ST_Centroid(polygon) back to the spine row so proximity
-- queries on locations.geography see a single Point for all kinds.
create or replace function public.sync_area_centroid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.locations
  set geography = ST_Centroid(new.polygon)::geography(Point, 4326)
  where id = new.location_id;
  return new;
end;
$$;

create trigger location_areas_sync_centroid
  before insert or update on public.location_areas
  for each row execute function public.sync_area_centroid();

------------------------------------------------------------
-- 3. public.location_events (partitioned monthly per ADR-10)
------------------------------------------------------------

create table public.location_events (
  id                 uuid          not null default gen_random_uuid(),
  location_id        uuid          not null references public.locations(id) on delete cascade,
  event_kind         text          not null
                                   check (event_kind in (
                                     -- Emitted at b1:
                                     'location.created',
                                     'location.updated',
                                     'location.moved',
                                     'location.polygon_updated',
                                     'location.hours_updated',
                                     'location.deleted',
                                     'location.restored',
                                     -- Reserved at b1 (not yet emitted; surface T2):
                                     'location.claim_requested',
                                     'location.claim_resolved',
                                     'location.contributor_added',
                                     'location.followed',
                                     'location.unfollowed'
                                   )),
  payload            jsonb         not null default '{}'::jsonb,
  acting_member_id   uuid          not null references public.members(id) on delete restrict,
  via_delegation_id  uuid,         -- FK added when member_delegations lands (b2)
  created_at         timestamptz   not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create index idx_location_events_location
  on public.location_events (location_id, created_at desc);

create index idx_location_events_acting
  on public.location_events (acting_member_id, created_at desc);

alter table public.location_events enable row level security;

create policy location_events_owner_read on public.location_events
  for select
  using (
    location_id in (select id from public.locations where member_id = auth.uid())
    or acting_member_id = auth.uid()
  );

-- Partition rotation. Idempotent. Mirrors the T042 pattern for member_events.
create or replace function public.ensure_location_events_partition(target_month date)
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
  partition_name := format('location_events_y%sm%s',
                           to_char(range_start, 'YYYY'),
                           to_char(range_start, 'MM'));

  execute format(
    'create table if not exists public.%I partition of public.location_events
       for values from (%L) to (%L)',
    partition_name, range_start, range_end
  );
end;
$$;

create or replace function public.rotate_location_events_partitions()
returns void
language plpgsql
as $$
declare
  base date := date_trunc('month', now())::date;
begin
  perform public.ensure_location_events_partition(base);
  perform public.ensure_location_events_partition((base + interval '1 month')::date);
  perform public.ensure_location_events_partition((base + interval '2 months')::date);
end;
$$;

select public.rotate_location_events_partitions();

-- Schedule monthly rotation later via pg_cron (mirrors member_events comment):
--   select cron.schedule(
--     'location-events-partition-rotation',
--     '0 0 1 * *',
--     'select public.rotate_location_events_partitions();'
--   );

comment on table public.location_events is
  'Append-only event log per ADR-10. Monthly partitioned. Audit fields (acting_member_id, via_delegation_id) per ADR-6. Writes only via the action layer (ADR-7).';
