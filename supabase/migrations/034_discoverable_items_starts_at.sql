-- T106 — Add starts_at to the discoverable_items MV (substrate).
--
-- Spec:   product/systems/item.md § Discoverable-items MV; SPEC-PATCHES 2026-06-16.
-- Ticket: development/tickets/T106-mv-starts-at-column.md
-- Depends on: T057 (original MV, 016), T105 (venue_nearby_items, 033).
--
-- The MV had no schedule column, so any surface reading it (locality feed,
-- venue "nearby") could neither filter out past gatherings nor sort by next
-- occurrence — a last-month trivia night still showed up next to tomorrow's.
-- Postgres can't ALTER a column into an MV, so the MV is dropped and rebuilt
-- with a starts_at column sourced from the item_gatherings child, plus a
-- supporting index. The two consuming RPCs are then CREATE OR REPLACE'd to use
-- it.
--
-- Drop safety: locality_feed_items and venue_nearby_items are classic
-- string-body SQL functions — Postgres records no pg_depend edge from such a
-- function to relations referenced in its body, so a plain DROP of the MV does
-- not cascade to (or get blocked by) them. They re-resolve discoverable_items
-- by name at call time and are rebuilt below regardless. The refresh trigger
-- (trg_refresh_discoverable_items on item_events) and its function are likewise
-- name-resolved and untouched.

drop materialized view if exists public.discoverable_items;

------------------------------------------------------------
-- 1. Rebuild the MV with starts_at (next gathering occurrence).
------------------------------------------------------------

create materialized view public.discoverable_items as
  select
    i.id                                                       as item_id,
    i.member_id,
    m.handle                                                   as member_handle,
    m.display_name                                             as member_display_name,
    i.kind                                                     as item_kind,
    i.title,
    i.description,
    i.category,
    i.brand_label,
    i.group_id,
    g.name                                                     as group_name,
    g.kind                                                     as group_kind,
    gb.display_name                                            as group_business_display_name,
    nearest.location_id                                        as nearest_location_id,
    l.label                                                    as nearest_location_label,
    l.slug                                                     as nearest_location_slug,
    l.geography                                                as nearest_location_geography,
    coalesce(rc.response_count, 0)                             as response_count,
    pt.tag                                                     as primary_tag,
    gs.starts_at                                               as starts_at,
    i.updated_at                                               as published_at
  from public.items i
  join public.members m
    on m.id = i.member_id
   and m.deleted_at is null
  left join public.groups g
    on g.id = i.group_id
  left join public.group_businesses gb
    on gb.group_id = g.id
   and g.kind = 'business'
  left join lateral (
    select il.location_id
      from public.item_locations il
     where il.item_id = i.id
       and il.removed_at is null
       and il.status = 'approved'
     order by il.created_at asc
     limit 1
  ) nearest on true
  left join public.locations l
    on l.id = nearest.location_id
   and l.deleted_at is null
  left join lateral (
    select count(*) as response_count
      from public.item_responses r
     where r.item_id = i.id
       and r.withdrawn_at is null
  ) rc on true
  left join lateral (
    select tag
      from public.item_tags t
     where t.item_id = i.id
     order by t.tag asc
     limit 1
  ) pt on true
  left join lateral (
    select ig.starts_at
      from public.item_gatherings ig
     where ig.item_id = i.id
     order by ig.starts_at asc
     limit 1
  ) gs on true
  where
    i.state = 'published'
    and i.deleted_at is null
    and (
      i.group_id is null
      or (g.discoverability = 'listed' and g.dissolved_at is null)
    );

-- CONCURRENTLY refresh requires a unique index on the materialized view.
create unique index unique_idx_discoverable_items
  on public.discoverable_items (item_id);

-- Existing browse indexes (recreated 1:1 with the MV rebuild).
create index idx_discoverable_items_kind
  on public.discoverable_items (item_kind);

create index idx_discoverable_items_category
  on public.discoverable_items (category)
  where category is not null;

create index idx_discoverable_items_group
  on public.discoverable_items (group_id)
  where group_id is not null;

create index idx_discoverable_items_geography
  on public.discoverable_items using gist (nearest_location_geography);

create index idx_discoverable_items_recency
  on public.discoverable_items (published_at desc);

-- New: schedule index for past-event filtering + next-occurrence sort.
create index idx_discoverable_items_starts_at
  on public.discoverable_items (starts_at asc nulls last)
  where starts_at is not null;

comment on materialized view public.discoverable_items is
  'Locality-first index per item.md. Anon-readable. Refreshed synchronously on item.published events at b1. starts_at (T106) carries the earliest item_gatherings occurrence (null for non-gathering kinds) so discovery surfaces can filter past gatherings and sort by next occurrence. The WHERE clause is the public-readable gate (state=published, not deleted, no group OR listed group); MVs do not support RLS.';

grant select on public.discoverable_items to anon, authenticated;

------------------------------------------------------------
-- 2. venue_nearby_items — exclude past gatherings, sort by next occurrence.
------------------------------------------------------------

create or replace function public.venue_nearby_items(
  p_location_id     uuid,
  p_owning_group_id uuid,
  p_radius_m        double precision default 5000
)
returns table (
  item_id                uuid,
  member_handle          text,
  member_display_name    text,
  item_kind              text,
  title                  text,
  category               text,
  brand_label            text,
  group_id               uuid,
  nearest_location_label text,
  response_count         bigint,
  primary_tag            text,
  published_at           timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    di.item_id,
    di.member_handle,
    di.member_display_name,
    di.item_kind,
    di.title,
    di.category,
    di.brand_label,
    di.group_id,
    di.nearest_location_label,
    di.response_count,
    di.primary_tag,
    di.published_at
  from public.discoverable_items di
  join public.locations v
    on v.id = p_location_id
   and v.deleted_at is null
  where di.nearest_location_geography is not null
    and st_dwithin(di.nearest_location_geography, v.geography, p_radius_m)
    and (p_owning_group_id is null or di.group_id is distinct from p_owning_group_id)
    -- T106: only upcoming items. Past gatherings excluded; non-gathering items
    -- (starts_at null) pass; dateless gatherings excluded.
    and (di.starts_at is null or di.starts_at >= now())
    and (di.item_kind <> 'gathering' or di.starts_at is not null)
  order by st_distance(di.nearest_location_geography, v.geography) asc,
           di.starts_at asc nulls last,
           di.published_at desc
  limit 20;
$$;

comment on function public.venue_nearby_items(uuid, uuid, double precision) is
  'F033 "What''s happening nearby": public discoverable_items within p_radius_m of the venue, excluding the owning Group. T106: only-upcoming filter (past + dateless gatherings excluded; non-gatherings pass); sort distance → next occurrence → recency. Default radius 5 km.';

------------------------------------------------------------
-- 3. venue_hosted_items — same only-upcoming filter on the base-table query.
--    (Defined in 033; recreated here so all three discovery RPCs share the
--    past/dateless-gathering exclusion.)
------------------------------------------------------------

create or replace function public.venue_hosted_items(
  p_location_id     uuid,
  p_owning_group_id uuid
)
returns table (
  item_id                uuid,
  member_handle          text,
  member_display_name    text,
  item_kind              text,
  title                  text,
  category               text,
  brand_label            text,
  group_id               uuid,
  nearest_location_label text,
  response_count         bigint,
  primary_tag            text,
  published_at           timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    i.id,
    m.handle,
    m.display_name,
    i.kind,
    i.title,
    i.category,
    i.brand_label,
    i.group_id,
    null::text       as nearest_location_label,  -- redundant on the venue's own page
    0::bigint        as response_count,
    null::text       as primary_tag,
    i.updated_at     as published_at
  from public.items i
  join public.item_locations il
    on il.item_id = i.id
   and il.location_id = p_location_id
   and il.removed_at is null
   and il.status = 'approved'
  join public.members m
    on m.id = i.member_id
   and m.deleted_at is null
  left join public.item_gatherings ig
    on ig.item_id = i.id
  where i.group_id = p_owning_group_id
    and i.state = 'published'
    and i.deleted_at is null
    -- T106: only upcoming items. Past gatherings excluded; non-gathering items
    -- (no item_gatherings row → starts_at null) pass; dateless gatherings excluded.
    and (ig.starts_at is null or ig.starts_at >= now())
    and (i.kind <> 'gathering' or ig.starts_at is not null)
  order by ig.starts_at asc nulls last, i.updated_at desc;
$$;

comment on function public.venue_hosted_items(uuid, uuid) is
  'F033 "What''s happening here": published Items hosted by the venue''s owning Group (items.group_id) at this Location. Base-table join (not the MV). T106: only-upcoming filter (past + dateless gatherings excluded; non-gatherings pass). security invoker: items_select_published RLS is the public-visibility gate.';

------------------------------------------------------------
-- 4. locality_feed_items — upcoming-only filter; gatherings sort by next occ.
------------------------------------------------------------

create or replace function public.locality_feed_items(
  p_place_id uuid,
  p_tags     text[] default null,
  p_limit    int    default 50
)
returns table (
  item_id               uuid,
  member_handle         text,
  member_display_name   text,
  item_kind             text,
  title                 text,
  category              text,
  brand_label           text,
  group_id              uuid,
  nearest_location_label text,
  response_count        bigint,
  primary_tag           text,
  published_at          timestamptz
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    di.item_id,
    di.member_handle,
    di.member_display_name,
    di.item_kind,
    di.title,
    di.category,
    di.brand_label,
    di.group_id,
    di.nearest_location_label,
    di.response_count,
    di.primary_tag,
    di.published_at
  from public.discoverable_items di
  join public.places p
    on p.id = p_place_id
   and p.deleted_at is null
  where di.nearest_location_geography is not null
    and st_intersects(di.nearest_location_geography, p.geography)
    -- T106: only upcoming items surface. Non-gathering items (starts_at null)
    -- pass; past gatherings are excluded; gatherings with no date set are
    -- excluded (a dateless gathering isn't yet a real listing).
    and (di.starts_at is null or di.starts_at >= now())
    and (di.item_kind <> 'gathering' or di.starts_at is not null)
  order by
    case
      when p_tags is not null
       and cardinality(p_tags) > 0
       and di.primary_tag = any (p_tags)
      then 0 else 1
    end,
    di.starts_at asc nulls last,
    di.published_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

comment on function public.locality_feed_items(uuid, text[], int) is
  'F030 locality-first home feed: published discoverable_items inside a Place polygon, tag-boosted then (T106) upcoming-gathering-boosted, then recency-ordered. Place feed, not Location feed (anti-Nextdoor).';
