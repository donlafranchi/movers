-- T064 — Items provenance: `made_at_*` columns + event-kind extension.
--
-- Ships:
--   1. public.items.made_at_place_id              (nullable FK → places)
--   2. public.items.made_at_verification_source   (4-value enum, default 'none')
--   3. items_made_at_only_on_products CHECK       (made_at_place_id valid only for kind='product')
--   4. public.item_events event_kind CHECK        (extended with 3 new kinds)
--
-- Spec anchors:
--   product/systems/item.md § Provenance claims — "Locally Made"
--   planning/adrs/ADR-0021-member-geography-substrate-split.md (verification-ladder reshape, Ratified 2026-05-23)
--   planning/adrs/ADR-0010-events-from-day-one.md
--   planning/rebuild-plan.md b1 rule 8 (authoritative 4-value form)
--   planning/bundles/b1x-substrate-sprint.md § B4
--
-- Encodes ratified absolutes:
--   * 4-value verification ladder
--     ('none','self_attested','community_attested','document_supported').
--     — ADR-21 verification-ladder reshape (recheck CLEAN 2026-05-23).
--     The community_attested value supersedes the original sos_lookup form
--     dropped by the same recheck.
--   * `made_at_*` is meaningful only on kind='product'.
--     — item.md § Provenance Intent. Enforced by items_made_at_only_on_products
--       CHECK so a buggy composer cannot stamp provenance onto a service /
--       gathering / wonder / offer / ask / initiative row.
--
-- No surface ships at this ticket. The "Locally Made" badge is F027 (b1.2).

alter table public.items
  add column if not exists made_at_place_id uuid
    references public.places(id) on delete restrict;

alter table public.items
  add column if not exists made_at_verification_source text
    not null default 'none';

alter table public.items
  drop constraint if exists items_made_at_verification_source_check;

alter table public.items
  add constraint items_made_at_verification_source_check
  check (made_at_verification_source in (
    'none',
    'self_attested',
    'community_attested',
    'document_supported'
  ));

alter table public.items
  drop constraint if exists items_made_at_only_on_products;

alter table public.items
  add constraint items_made_at_only_on_products
  check (made_at_place_id is null or kind = 'product');

-- Reader-side surface (future "Locally Made" badge + locality-derived filters).
create index if not exists idx_items_made_at_place
  on public.items (made_at_place_id)
  where made_at_place_id is not null and deleted_at is null;

------------------------------------------------------------
-- Extend item_events.event_kind CHECK with the 3 new kinds.
-- The future item.update handler (Phase 2 composer) will emit these; the
-- allow-list lands now so the substrate is ready when the surface arrives.
------------------------------------------------------------

alter table public.item_events
  drop constraint if exists item_events_event_kind_check;

alter table public.item_events
  add constraint item_events_event_kind_check
  check (event_kind in (
    -- 015 original
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
    'item.qr_card_requested',
    -- T064 additions
    'item.made_at_set',
    'item.made_at_removed',
    'item.made_at_verified'
  ));
