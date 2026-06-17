-- T105 — Venue page content sections (F033): "What's happening here" +
-- "What's happening nearby".
--
-- Spec:   planning/next/scenario-F033-viewer-finds-venue-page.md
-- Ticket: development/tickets/T105-venue-page-content-sections.md
--
-- Two read functions, both shaped to match locality_feed_items (T087) so the UI
-- maps them through the same FeedItem type and renders them with the same
-- <ItemFeedCard>. Both security invoker:
--   * venue_hosted_items reads base tables — items RLS (items_select_published)
--     is the public-visibility gate (published + listed-or-null group), the
--     same gate the locality feed inherits from the MV's WHERE clause.
--   * venue_nearby_items reads the already-public discoverable_items MV.

------------------------------------------------------------
-- 1. "What's happening here" — items HOSTED by the venue's owning Group
--    (items.group_id = owning Group) AND attached to this Location.
--    Base tables, NOT the MV: the MV's nearest_location_id is only the
--    first-created item_locations row, so a Group hosting at multiple
--    Locations could have a different "nearest" than this venue.
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
  order by ig.starts_at asc nulls last, i.updated_at desc;
$$;

revoke all on function public.venue_hosted_items(uuid, uuid) from public;
grant execute on function public.venue_hosted_items(uuid, uuid) to anon, authenticated;

comment on function public.venue_hosted_items(uuid, uuid) is
  'F033 "What''s happening here": published Items hosted by the venue''s owning Group (items.group_id) and attached to this Location. Base-table join (not the MV — MV nearest_location_id is first-location-only). security invoker: items_select_published RLS is the public-visibility gate.';

------------------------------------------------------------
-- 2. "What's happening nearby" — public Items within radius, hosted by
--    someone OTHER than the venue's owning Group. Reads the public MV.
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
    -- Exclude the venue's own Host (already in "What's happening here").
    -- When there is no owning Group (minimal page), include everything nearby.
    and (p_owning_group_id is null or di.group_id is distinct from p_owning_group_id)
  order by st_distance(di.nearest_location_geography, v.geography) asc,
           di.published_at desc
  limit 20;
$$;

revoke all on function public.venue_nearby_items(uuid, uuid, double precision) from public;
grant execute on function public.venue_nearby_items(uuid, uuid, double precision) to anon, authenticated;

comment on function public.venue_nearby_items(uuid, uuid, double precision) is
  'F033 "What''s happening nearby": public discoverable_items within p_radius_m of the venue, excluding the owning Group''s Items. Reads the anon-readable MV (already filtered to published + listed-or-null group), so it carries no item-level discoverability filter (no such column exists). Default radius 5 km.';
