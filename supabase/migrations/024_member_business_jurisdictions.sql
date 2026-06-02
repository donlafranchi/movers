-- T075 — member_business_jurisdictions Tier 0 substrate
-- Source: development/tickets/T075-member-business-jurisdictions-substrate.md
-- Spec:   product/systems/business-jurisdiction.md § Data model implications /
--         § Action handlers / § RLS · ADR-21 (first locality signal at b1)
--
-- Ships:
--   1. public.member_business_jurisdictions  (one active row per member+group;
--      soft-delete via removed_at; public-readable claim)
--   2. public.member_events event_kind CHECK  (extended with the two
--      business_jurisdiction kinds)
--
-- Invariant: one active row per (member_id, group_id); historical rows are
-- soft-deleted via removed_at. This lives in the partial unique index below.
-- The spec's `primary key_constraint_note text generated always as (...) stored`
-- column is a documentation artifact — Postgres `generated always` evaluates a
-- row expression, not a fixed literal — so it is deliberately omitted; the
-- invariant is carried by ux_jurisdiction_member_group_active + this comment.
--
-- Writes go through the action layer only (per ADR-7). RLS exposes a public
-- SELECT on non-removed rows — by deliberate contrast with the owner-only
-- member_place_interests / member_saved_searches substrates, the jurisdiction
-- record is a *public* claim rendered on the Group surface.

------------------------------------------------------------
-- 1. public.member_business_jurisdictions
------------------------------------------------------------

create table public.member_business_jurisdictions (
  id                   uuid          primary key default gen_random_uuid(),
  member_id            uuid          not null references public.members(id) on delete cascade,
  group_id             uuid          not null references public.groups(id)  on delete cascade,
  zip                  text          not null check (zip ~ '^[0-9]{5}$'),
  state                text          check (state ~ '^[A-Z]{2}$'),          -- 2-letter; populated at document_upload (T3)
  legal_entity_name    text,                                                -- populated at document_upload (T3)
  verification_source  text          not null
                                     check (verification_source in ('self_attested','community_attested','document_upload')),
  verified_at          timestamptz,                                         -- null for self_attested
  source_document_id   uuid,                                                -- FK target table lands at T3; nullable
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  removed_at           timestamptz
);

-- One active row per (member_id, group_id). Soft-replace retires the prior
-- active row before inserting a fresh one; this index makes a double-write
-- impossible even if a handler is buggy.
create unique index ux_jurisdiction_member_group_active
  on public.member_business_jurisdictions (member_id, group_id)
  where removed_at is null;

-- Active-row ZIP lookup (proximity derivation + locality-claim aggregation).
create index idx_jurisdiction_zip_active
  on public.member_business_jurisdictions (zip)
  where removed_at is null;

alter table public.member_business_jurisdictions enable row level security;

-- Public read of the active claim. Anonymous + authenticated both readable —
-- the Group surface renders the claim; readability is the point.
create policy mbj_select_public_active
  on public.member_business_jurisdictions
  for select
  using (removed_at is null);

-- No INSERT / UPDATE / DELETE policy. Action-layer-only writes per ADR-7;
-- handlers run with the service role inside withTransaction and bypass RLS.
-- T051 CI enforcement catches bypass.

comment on table public.member_business_jurisdictions is
  'Tier 0 self-attested business-locality claim, keyed by (member_id, group_id). One active row per pair; soft-delete via removed_at preserves the audit chain. Public-readable (deliberate contrast with owner-only member_place_interests). Writes via action layer only per ADR-7. Proximity tested against the anchor Location via public.zip_is_proximal_to_location(). Spec: business-jurisdiction.md § Data model implications.';

------------------------------------------------------------
-- 2. Extend member_events.event_kind CHECK with the two jurisdiction kinds.
--    Reproduces the full list from 021 (the prior authoritative rewrite) plus
--    member.business_jurisdiction_set / _removed.
------------------------------------------------------------

alter table public.member_events
  drop constraint if exists member_events_event_kind_check;

alter table public.member_events
  add constraint member_events_event_kind_check
  check (event_kind in (
    'member.created',
    'member.profile_updated',
    'member.home_location_set',
    'member.privacy_changed',
    'member.maker_mode_changed',
    'member.followed',
    'member.unfollowed',
    'member.interest_added',
    'member.interest_removed',
    'member.delegation_granted',
    'member.delegation_revoked',
    'member.deleted',
    'member.restored',
    'member.export_requested',
    'member.purge_executed',
    'member.handle_changed',
    'member.place_interest_added',
    'member.place_interest_removed',
    'member.place_interest_promoted',
    'member.place_interest_demoted',
    'member.saved_search.created',
    'member.saved_search.updated',
    'member.saved_search.removed',
    -- T075 additions (024_member_business_jurisdictions.sql)
    'member.business_jurisdiction_set',
    'member.business_jurisdiction_removed'
  ));

comment on constraint member_events_event_kind_check on public.member_events is
  'Extended by T075 (024): union of the 021 list + member.business_jurisdiction_set / _removed.';
