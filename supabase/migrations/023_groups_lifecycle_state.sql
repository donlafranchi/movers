-- T070 — Groups lifecycle_state column + draft-aware RLS + group.activated event
-- Source: development/tickets/T070-groups-lifecycle-state-and-draft-handlers.md
-- Spec:   product/systems/groups.md § Schema (lifecycle_state column + RLS rule)
--         product/ui/design-language.md § Multi-step composer (the contract this substrate backs)
--
-- Adds the composer-draft state machinery the Multi-step composer recipe depends on:
--   'draft'     — in-flight composer; never publicly visible.
--   'active'    — live and discoverable (subject to existing discoverability scope).
--   'dissolved' — ended via explicit group.dissolve; dissolved_at also set in same write.
--
-- Backfills existing rows to 'active' (the default), so this migration is safe
-- against the live group set shipped by T055 (014_groups.sql).

------------------------------------------------------------
-- 1. Add the lifecycle_state column with default 'active'.
------------------------------------------------------------

alter table public.groups
  add column if not exists lifecycle_state text not null default 'active';

alter table public.groups
  drop constraint if exists groups_lifecycle_state_check;

alter table public.groups
  add constraint groups_lifecycle_state_check
  check (lifecycle_state in ('draft', 'active', 'dissolved'));

comment on column public.groups.lifecycle_state is
  'Composer + lifecycle state machine. ''draft'' is the in-flight Multi-step composer state — never publicly visible (RLS: founder-only). Promotes to ''active'' via group.activate on final-step submit. ''dissolved'' is set in the same write as dissolved_at by explicit group.dissolve. Default ''active'' so direct inserts (existing Phase-1 rows, seed scripts) are immediately discoverable.';

------------------------------------------------------------
-- 2. Partial index on lifecycle_state for non-dissolved rows.
------------------------------------------------------------

create index if not exists idx_groups_lifecycle
  on public.groups (lifecycle_state)
  where dissolved_at is null;

------------------------------------------------------------
-- 3. Replace the public-select policy with a draft-aware one.
--    Discovery surfaces must never leak in-flight composer state;
--    drafts are visible only to their founder.
------------------------------------------------------------

drop policy if exists groups_select_listed on public.groups;

create policy groups_select_active_or_own_draft on public.groups
  for select
  using (
    -- Public path: active + listed + not dissolved (the prior groups_select_listed scope,
    -- now narrowed by lifecycle_state).
    (lifecycle_state = 'active' and discoverability = 'listed' and dissolved_at is null)
    or
    -- Founder's-own-draft carve-out: the composer's resume contract reads the in-flight
    -- row to rehydrate prior step fields. groups_select_founder still covers active +
    -- non-listed founder visibility; this clause is the draft addition.
    (lifecycle_state = 'draft' and founder_member_id = auth.uid())
  );

------------------------------------------------------------
-- 4. Extend group_events.event_kind CHECK to include group.activated.
--    Per groups.md § Event log entries (2026-05-31 amendment): the
--    draft → active promotion fires its own event; per-step update_draft
--    writes do NOT emit events (would flood the log).
------------------------------------------------------------

alter table public.group_events
  drop constraint if exists group_events_event_kind_check;

alter table public.group_events
  add constraint group_events_event_kind_check
  check (event_kind in (
    'group.created',
    'group.activated',
    'group.member_joined',
    'group.member_left',
    'group.role_changed',
    'group.steward_transferred',
    'group.dormant',
    'group.dormancy_extended',
    'group.revived',
    'group.dissolved'
  ));
-- Note: 'group.member_removed' is intentionally NOT in this constraint —
-- T070 does not ship a producer for it. Add it (in a follow-up migration)
-- alongside the group.member_remove handler.
