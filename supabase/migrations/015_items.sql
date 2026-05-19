-- T056 — Phase 1: Items schema.
--
-- Ships:
--   1.  public.items (spine; 7-kind enum, 5-state enum)
--   2.  public.item_products       (1:1 child, kind='product')
--   3.  public.item_services       (1:1 child, kind='service'; PostGIS service area)
--   4.  public.item_gatherings     (1:1 child, kind='gathering')
--   5.  public.item_wonders        (1:1 child, kind='wonder'; expires_at default +90d)
--   6.  public.item_locations      (M:N join)
--   7.  public.item_responses      (M:N join)
--   8.  public.item_tags           (controlled vocab)
--   9.  public.item_hashtags       (free-form, normalized)
--  10.  public.item_events         (monthly partitioned per ADR-10)
--
--   + Close T055's deferred FK on group_event_anchored.seeded_by_item_id.
--
-- Spec anchors:
--   product/systems/item.md
--   planning/adrs/ADR-0005-markets-as-gathering-items.md
--   planning/adrs/ADR-0010-action-layer-event-log.md
--   planning/adrs/ADR-0007-action-layer.md
--   planning/adrs/ADR-0006-agent-assistance.md
--
-- DEVIATION (logged in DEVIATIONS.md at close): item.md line 99 carried
-- the operational-state vocabulary (active/fulfilled/withdrawn/closed) while
-- line 128 referenced lifecycle states (draft/published) for publish events.
-- T056 reconciles to ('draft','published','withdrawn','fulfilled','closed').
-- 'active' is dropped as redundant with 'published'. The F018 rewrite punch
-- list (now deferred with F018) will land the corresponding spec text edit
-- when F018 promotes from backlog. The publish trigger semantics from
-- item.md § 'Key event semantics — item.published' still apply: fires when
-- state transitions to 'published' from any prior state.
--
-- Action handlers do NOT ship in this ticket. Per T045–T055 pattern, schema
-- only; handlers land with Phase 2 surface composers.

------------------------------------------------------------
-- 1. public.items (spine)
------------------------------------------------------------

create table public.items (
  id                  uuid          not null default gen_random_uuid() primary key,
  member_id           uuid          not null references public.members(id) on delete cascade,
  kind                text          not null
                                    check (kind in (
                                      'product','service','gathering','wonder',
                                      'offer','ask','initiative'
                                    )),
  group_id            uuid                   references public.groups(id) on delete set null,
  title               text          not null
                                    check (length(title) between 1 and 200),
  description         text          not null default '',
  state               text          not null default 'draft'
                                    check (state in ('draft','published','withdrawn','fulfilled','closed')),
  category            text,
  brand_label         text,
  qr_card_url         text,
  ambient_extras      jsonb         not null default '{}'::jsonb,
  parent_item_id      uuid                   references public.items(id) on delete set null,  -- T2 surface (Wonder conversions); reserved at b1
  collection_id       uuid,                                                                    -- T2 surface; reserved
  federation_origin   text,                                                                    -- T3 surface; reserved
  embedding_id        uuid,                                                                    -- T3 vector search; reserved
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  fulfilled_at        timestamptz,
  deleted_at          timestamptz
);

create index idx_items_member_active
  on public.items (member_id)
  where deleted_at is null;

create index idx_items_group_active
  on public.items (group_id)
  where deleted_at is null and group_id is not null;

create index idx_items_kind_state
  on public.items (kind, state)
  where deleted_at is null;

create index idx_items_published
  on public.items (state)
  where state = 'published' and deleted_at is null;

create index idx_items_brand_label
  on public.items (brand_label)
  where brand_label is not null and deleted_at is null;

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.update_updated_at_column();

alter table public.items enable row level security;

-- Owner sees their own (any state).
create policy items_select_owner on public.items
  for select
  using (member_id = auth.uid());

-- Public-published: anon + auth see published, non-deleted Items where
-- the Item is either standalone (group_id IS NULL) or filed under a listed
-- non-dissolved Group.
create policy items_select_published on public.items
  for select
  using (
    state = 'published'
    and deleted_at is null
    and (
      group_id is null
      or group_id in (
        select id from public.groups
         where discoverability = 'listed' and dissolved_at is null
      )
    )
  );

-- Group member: Items in unlisted/private Groups visible to active explicit
-- members of those Groups. Uses the T055 helper for recursion safety.
create policy items_select_group_member on public.items
  for select
  using (
    group_id is not null
    and group_id in (select public.current_member_explicit_group_ids())
    and deleted_at is null
  );

comment on table public.items is
  'Item primitive spine per item.md. Seven kinds (product/service/gathering/wonder at b1; offer/ask/initiative reserved). Five-state lifecycle (draft/published/withdrawn/fulfilled/closed). Action-layer-only writes per ADR-7. Anon read gated by state=published AND (no group OR listed group).';

------------------------------------------------------------
-- 2. public.item_products
------------------------------------------------------------

create table public.item_products (
  item_id          uuid          not null primary key references public.items(id) on delete cascade,
  price_cents      integer                check (price_cents is null or price_cents >= 0),
  price_unit       text,
  composition      text,
  photo_urls       text[]        not null default array[]::text[],
  available_until  timestamptz
);

create index idx_item_products_price
  on public.item_products (price_cents)
  where price_cents is not null;

alter table public.item_products enable row level security;

create policy item_products_select_via_parent on public.item_products
  for select
  using (item_id in (select id from public.items));

comment on table public.item_products is
  'kind=product child per item.md. price_unit examples: "loaf", "dozen", "lb".';

------------------------------------------------------------
-- 3. public.item_services (PostGIS service area)
------------------------------------------------------------

create table public.item_services (
  item_id                  uuid          not null primary key references public.items(id) on delete cascade,
  rate_model               text          not null
                                         check (rate_model in ('hourly','flat','quote','membership')),
  rate_cents               integer                check (rate_cents is null or rate_cents >= 0),
  service_area_geography   geography(Polygon, 4326),
  hours                    jsonb         not null default '{}'::jsonb,
  license_info             jsonb,
  on_call                  boolean       not null default false,
  accepts_new_clients      boolean       not null default true
);

create index idx_item_services_area
  on public.item_services using gist (service_area_geography);

alter table public.item_services enable row level security;

create policy item_services_select_via_parent on public.item_services
  for select
  using (item_id in (select id from public.items));

comment on table public.item_services is
  'kind=service child per item.md. PostGIS service_area_geography drives area-inclusion queries. hours is structured weekly availability.';

------------------------------------------------------------
-- 4. public.item_gatherings
------------------------------------------------------------

create table public.item_gatherings (
  item_id          uuid          not null primary key references public.items(id) on delete cascade,
  starts_at        timestamptz,
  ends_at          timestamptz,
  recurrence_rule  text,
  capacity         integer                check (capacity is null or capacity > 0),
  cost_cents       integer                check (cost_cents is null or cost_cents >= 0),
  what_to_bring    text,
  host_member_id   uuid                   references public.members(id) on delete set null,
  rsvp_cutoff      timestamptz
);

create index idx_item_gatherings_starts_at
  on public.item_gatherings (starts_at)
  where starts_at is not null;

create index idx_item_gatherings_host
  on public.item_gatherings (host_member_id)
  where host_member_id is not null;

alter table public.item_gatherings enable row level security;

create policy item_gatherings_select_via_parent on public.item_gatherings
  for select
  using (item_id in (select id from public.items));

comment on table public.item_gatherings is
  'kind=gathering child per item.md. host_member_id usually = items.member_id; differs for delegated hosting. recurrence_rule is RRULE format.';

------------------------------------------------------------
-- 5. public.item_wonders
------------------------------------------------------------

create table public.item_wonders (
  item_id                 uuid          not null primary key references public.items(id) on delete cascade,
  interest_count          integer       not null default 0
                                        check (interest_count >= 0),
  expires_at              timestamptz   not null default (now() + interval '90 days'),
  conversion_target_kind  text                   check (conversion_target_kind is null or conversion_target_kind in ('gathering','initiative')),
  converted_to_item_id    uuid                   references public.items(id) on delete set null
);

create index idx_item_wonders_interest
  on public.item_wonders (interest_count desc, expires_at);

alter table public.item_wonders enable row level security;

create policy item_wonders_select_via_parent on public.item_wonders
  for select
  using (item_id in (select id from public.items));

comment on table public.item_wonders is
  'kind=wonder child per item.md. interest_count denormalized from item_responses for fast sort. expires_at defaults to 90 days from creation.';

------------------------------------------------------------
-- 6. public.item_locations
------------------------------------------------------------

create table public.item_locations (
  id                 uuid          not null default gen_random_uuid() primary key,
  item_id            uuid          not null references public.items(id)     on delete cascade,
  location_id        uuid          not null references public.locations(id) on delete cascade,
  schedule_kind      text          not null
                                   check (schedule_kind in ('one_time','recurring','ongoing','by_appointment')),
  schedule_metadata  jsonb         not null default '{}'::jsonb,
  status             text          not null default 'approved'
                                   check (status in ('pending','approved','declined')),
  created_at         timestamptz   not null default now(),
  removed_at         timestamptz
);

create index idx_item_locations_item
  on public.item_locations (item_id, removed_at);

create index idx_item_locations_location
  on public.item_locations (location_id, removed_at);

alter table public.item_locations enable row level security;

create policy item_locations_select_via_parent on public.item_locations
  for select
  using (item_id in (select id from public.items));

comment on table public.item_locations is
  'Item↔Location M:N join per item.md. status handles cross-Member Location attachments (pending approval).';

------------------------------------------------------------
-- 7. public.item_responses
------------------------------------------------------------

create table public.item_responses (
  id                    uuid          not null default gen_random_uuid() primary key,
  item_id               uuid          not null references public.items(id)   on delete cascade,
  responder_member_id   uuid          not null references public.members(id) on delete cascade,
  response_kind         text          not null
                                      check (response_kind in (
                                        'interest','rsvp','follow','save',
                                        'pledge','purchase','support'
                                      )),
  metadata              jsonb         not null default '{}'::jsonb,
  created_at            timestamptz   not null default now(),
  withdrawn_at          timestamptz
);

create index idx_item_responses_item_kind_active
  on public.item_responses (item_id, response_kind)
  where withdrawn_at is null;

create index idx_item_responses_responder
  on public.item_responses (responder_member_id, response_kind);

alter table public.item_responses enable row level security;

-- Responder sees their own responses.
create policy item_responses_select_self on public.item_responses
  for select
  using (responder_member_id = auth.uid());

-- Public responses on published Items are visible (powers visible counts on
-- public Item pages).
create policy item_responses_select_public on public.item_responses
  for select
  using (
    item_id in (
      select id from public.items
       where state = 'published' and deleted_at is null
    )
  );

comment on table public.item_responses is
  'Uniform response join per item.md. response_kind values: interest/rsvp/follow/save/pledge/purchase/support. pledge is reserved at b1 for Initiative cohort items (b2+ surface).';

------------------------------------------------------------
-- 8. public.item_tags (controlled vocabulary)
------------------------------------------------------------

create table public.item_tags (
  item_id  uuid not null references public.items(id) on delete cascade,
  tag      text not null
                check (length(tag) between 1 and 60),
  primary key (item_id, tag)
);

create index idx_item_tags_tag
  on public.item_tags (tag, item_id);

alter table public.item_tags enable row level security;

create policy item_tags_select_via_parent on public.item_tags
  for select
  using (item_id in (select id from public.items));

comment on table public.item_tags is
  'Item↔controlled-vocab tag join per item.md. Powers locality-index facets and structured filters. Vocabulary curated by the platform.';

------------------------------------------------------------
-- 9. public.item_hashtags (free-form, normalized)
------------------------------------------------------------

create table public.item_hashtags (
  item_id     uuid          not null references public.items(id) on delete cascade,
  hashtag     text          not null
                            check (length(hashtag) between 1 and 80),
  created_at  timestamptz   not null default now(),
  primary key (item_id, hashtag)
);

create index idx_item_hashtags_hashtag
  on public.item_hashtags (hashtag, item_id);

create index idx_item_hashtags_trending
  on public.item_hashtags (hashtag, created_at desc);

alter table public.item_hashtags enable row level security;

create policy item_hashtags_select_via_parent on public.item_hashtags
  for select
  using (item_id in (select id from public.items));

comment on table public.item_hashtags is
  'Item↔free-form-hashtag join per item.md. hashtag stored normalized (lowercased, leading-# stripped, whitespace stripped) — normalization enforced by the action handler at Phase 2.';

------------------------------------------------------------
-- 10. public.item_events (partitioned monthly per ADR-10)
------------------------------------------------------------

create table public.item_events (
  id                 uuid          not null default gen_random_uuid(),
  item_id            uuid          not null references public.items(id) on delete cascade,
  event_kind         text          not null
                                   check (event_kind in (
                                     'item.created',
                                     'item.updated',
                                     'item.published',
                                     'item.location_attached',
                                     'item.location_removed',
                                     'item.responded',
                                     'item.response_withdrawn',
                                     'item.state_changed',
                                     'item.fulfilled',
                                     'item.deleted',
                                     'item.group_changed',
                                     'item.brand_label_changed',
                                     'item.qr_card_requested'
                                   )),
  payload            jsonb         not null default '{}'::jsonb,
  acting_member_id   uuid          not null references public.members(id) on delete restrict,
  via_delegation_id  uuid                   references public.member_delegations(id) on delete set null,
  created_at         timestamptz   not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create index idx_item_events_item
  on public.item_events (item_id, created_at desc);

create index idx_item_events_acting
  on public.item_events (acting_member_id, created_at desc);

alter table public.item_events enable row level security;

-- Acting Member sees events they originated.
create policy item_events_select_acting on public.item_events
  for select
  using (acting_member_id = auth.uid());

-- Item owner sees all events on their Item.
create policy item_events_select_item_owner on public.item_events
  for select
  using (
    item_id in (
      select id from public.items where member_id = auth.uid()
    )
  );

-- Partition rotation — mirrors member_events / location_events / group_events.
create or replace function public.ensure_item_events_partition(target_month date)
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
  partition_name := format('item_events_y%sm%s',
                           to_char(range_start, 'YYYY'),
                           to_char(range_start, 'MM'));

  execute format(
    'create table if not exists public.%I partition of public.item_events
       for values from (%L) to (%L)',
    partition_name, range_start, range_end
  );
end;
$$;

create or replace function public.rotate_item_events_partitions()
returns void
language plpgsql
as $$
declare
  base date := date_trunc('month', now())::date;
begin
  perform public.ensure_item_events_partition(base);
  perform public.ensure_item_events_partition((base + interval '1 month')::date);
  perform public.ensure_item_events_partition((base + interval '2 months')::date);
end;
$$;

select public.rotate_item_events_partitions();

comment on table public.item_events is
  'Append-only event log per ADR-10. Monthly partitioned. Audit fields per ADR-6. Writes only via the action layer. item.published is the trigger for discoverable_items refresh (T057).';

------------------------------------------------------------
-- 11. Close T055's deferred FK on group_event_anchored.seeded_by_item_id.
------------------------------------------------------------

alter table public.group_event_anchored
  add constraint group_event_anchored_seeded_by_item_fkey
  foreign key (seeded_by_item_id) references public.items(id) on delete set null;
