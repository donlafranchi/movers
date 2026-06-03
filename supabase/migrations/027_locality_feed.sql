-- T087 — Locality-first feed query (F030)
--
-- public.locality_feed_items(place_id, tags, limit) returns the published
-- discoverable_items whose nearest Location falls inside the chosen Place's
-- polygon, ordered tag-match-first then recency. Descendant Places live inside
-- the ancestor polygon, so polygon containment covers the hierarchy without a
-- recursive parent walk.
--
-- This is a *Place* feed, not a Location feed — the anti-Nextdoor boundary
-- (product/systems/location.md). It keys off a places polygon, never a
-- per-Location subscription.
--
-- security invoker: discoverable_items and places are both anon-readable
-- (016/017), so the function needs no elevated rights. Granted to anon +
-- authenticated for the public home feed.

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
  order by
    case
      when p_tags is not null
       and cardinality(p_tags) > 0
       and di.primary_tag = any (p_tags)
      then 0 else 1
    end,
    di.published_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.locality_feed_items(uuid, text[], int) from public;
grant execute on function public.locality_feed_items(uuid, text[], int) to anon, authenticated;

comment on function public.locality_feed_items(uuid, text[], int) is
  'F030 locality-first home feed: published discoverable_items inside a Place polygon, tag-boosted then recency-ordered. Place feed, not Location feed (anti-Nextdoor).';
