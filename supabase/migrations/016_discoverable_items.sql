-- T057 — Phase 1: discoverable_items materialized view + refresh trigger.
--
-- Ships:
--   1. public.discoverable_items materialized view — denormalized join
--      across items + members + locations + groups, filtered to
--      public-readable rows (state='published' AND not soft-deleted AND
--      (no group OR group is listed-and-not-dissolved)).
--   2. unique_idx_discoverable_items on (item_id) — pre-condition for
--      REFRESH MATERIALIZED VIEW CONCURRENTLY.
--   3. Supporting browse indexes (kind, category, group_id, GIST on geography).
--   4. SECURITY DEFINER trigger function refresh_discoverable_items_on_publish
--      that runs `refresh materialized view concurrently` synchronously.
--   5. Row-level AFTER INSERT trigger on item_events filtered to
--      event_kind='item.published'. Per ADR-10 the refresh is synchronous
--      at b1; T2 transition (async) triggers when p99 > 30s for one week.
--   6. GRANT SELECT on the view to anon + authenticated.
--
-- Spec anchors:
--   product/systems/item.md § "Discoverable-items refresh trigger"
--   planning/adrs/ADR-0010-action-layer-event-log.md
--   planning/adrs/ADR-0007-action-layer.md
--
-- Why SECURITY DEFINER on the refresh function: REFRESH MATERIALIZED VIEW
-- requires read access to all base tables; under RLS the calling Member
-- would only see their own rows. Running as the function owner (postgres)
-- bypasses RLS for the refresh, which is correct because the view's WHERE
-- clause already filters to the public-readable subset.

------------------------------------------------------------
-- 1. discoverable_items materialized view
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

-- Supporting browse indexes.
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

comment on materialized view public.discoverable_items is
  'Locality-first index per item.md. Anon-readable. Refreshed synchronously on item.published events at b1; T2 transitions to async when p99 > 30s/week per ADR-10. The view''s WHERE clause filters to the public-readable subset (state=published, not deleted, no group OR listed group); materialized views do not support RLS, so the WHERE is the gate.';

grant select on public.discoverable_items to anon, authenticated;

------------------------------------------------------------
-- 2. Refresh trigger
------------------------------------------------------------

create or replace function public.refresh_discoverable_items_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  refresh materialized view concurrently public.discoverable_items;
  return null;
end;
$$;

create trigger trg_refresh_discoverable_items
  after insert on public.item_events
  for each row
  when (NEW.event_kind = 'item.published')
  execute function public.refresh_discoverable_items_on_publish();

comment on function public.refresh_discoverable_items_on_publish is
  'Synchronous CONCURRENT refresh of discoverable_items, triggered AFTER INSERT on item_events where event_kind = item.published. SECURITY DEFINER so the refresh reads base tables without being filtered by the calling Member''s RLS context. Per ADR-10 the b1 refresh is synchronous; T2 transitions to async when p99 > 30s for one week.';
