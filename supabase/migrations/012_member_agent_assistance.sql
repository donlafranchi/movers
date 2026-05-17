-- T050 — Agent-assistance substrate (Phase 1 Member surface continuation)
-- Source: notes/migration-to-primitives.md § Phase 1 (rebuild plan labels
--         007g_member_self_records.sql + 007h_member_delegations.sql;
--         consolidated to 012_* here — Supabase CLI rejects alpha-suffix
--         numbering and the two tables ship together because they gate the
--         FK retrofits on the existing event-log tables);
--         product/systems/member.md lines 368-394 (substrate) +
--         lines 402-407 (audit fields);
--         planning/DECISIONS.md ADR-6 (audit fields) + ADR-7 (action layer);
--         development/tickets/T050-member-agent-assistance-substrate.md.
--
-- Three logical sections in one file:
--   1. public.member_self_records — Member-owned context document
--        - Surface lands at b2 (assistant-context.md). Substrate at b1.
--        - No bootstrap trigger — the only Member-related table that
--          intentionally lacks a row-per-Member at signup. Rows exist only
--          when a Member opts into agent assistance; the action handler
--          member.self_record.update does insert-or-update on first write.
--        - RLS owner-read + owner-update. No INSERT/DELETE policy:
--          action-layer-only writes per ADR-7 so every row carries
--          acting_member_id + via_delegation_id audit fields and emits the
--          corresponding member.self_record_* event in the same transaction.
--   2. public.member_delegations — scoped, expiring permission grants
--        - Surface lands at b2 (delegation.md). Substrate at b1.
--        - Owner-read only. No INSERT/UPDATE/DELETE policy.
--        - `scopes` is text[], not a join table. Controlled vocabulary
--          (item.read, item.create.draft, item.publish, etc.) is enforced
--          by the action handler member.delegation.grant — schema can't
--          reject unknown scopes; the handler must. Mirrors the
--          member_interests.tag pattern.
--        - Partial index drops the `expires_at > now()` predicate from
--          member.md line 393 — partial-index predicates are evaluated at
--          INSERT time, not query time, so the now() predicate is misleading
--          at best (rows stay in the index after their expires_at has
--          advanced past now()). Index on (member_id) where revoked_at is
--          null; the action layer applies the expires_at filter at query
--          time. Schema-spec divergence recorded in DEVIATIONS.md; member.md
--          flagged for pipeline-product.
--   3. FK retrofits on existing event-log tables — close the
--      via_delegation_id circle reserved by T042 + T045:
--        - public.member_events.via_delegation_id  → member_delegations(id)
--        - public.location_events.via_delegation_id → member_delegations(id)
--      Both `not valid` + `validate constraint` two-step (zero rows today,
--      so the validation is a no-op; cheap muscle memory for future
--      populated-table runs). on delete set null because a hard-deleted
--      Delegation must not cascade-delete the append-only event rows that
--      reference it (per ADR-10); the audit field becomes null, preserving
--      the row's other truth ("this write was originally delegated; the
--      Delegation row was later hard-deleted"). Hard delete of a Delegation
--      is admin-only per the soft-delete model; b1 won't actually hard-
--      delete any.
--
-- No event-log shape changes. The relevant event kinds
-- (member.delegation_granted / member.delegation_revoked /
-- member.self_record_updated) are already in T042's member_events enum.

------------------------------------------------------------
-- 1. public.member_self_records
------------------------------------------------------------

create table public.member_self_records (
  member_id        uuid          primary key references public.members(id) on delete cascade,
  document         jsonb         not null default '{}'::jsonb,
  scratch_or_full  text          not null default 'scratch'
                                 check (scratch_or_full in ('scratch','full')),
  updated_at       timestamptz   not null default now()
);

-- Reuses the function defined in 002_members.sql.
create trigger member_self_records_set_updated_at
  before update on public.member_self_records
  for each row execute function public.update_updated_at_column();

alter table public.member_self_records enable row level security;

create policy member_self_records_owner_read on public.member_self_records
  for select
  using (member_id = auth.uid());

create policy member_self_records_owner_update on public.member_self_records
  for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- No INSERT / DELETE policy — action-layer-only writes per ADR-7.
-- No bootstrap trigger on public.members — see header note (2).

comment on table public.member_self_records is
  'Member-owned context document substrate (per assistant-context.md, surface at b2). One row per Member who has opted into agent assistance; absent otherwise — the only Member-related table at b1 that intentionally lacks a row-per-Member at signup. Writes only via the action layer (member.self_record.update, insert-or-update on first write). RLS owner-read + owner-update; no INSERT/DELETE policy.';

------------------------------------------------------------
-- 2. public.member_delegations
------------------------------------------------------------

create table public.member_delegations (
  id             uuid          primary key default gen_random_uuid(),
  member_id      uuid          not null references public.members(id) on delete cascade,
  grantee_label  text          not null
                               check (char_length(grantee_label) between 1 and 120),
  scopes         text[]        not null
                               check (array_length(scopes, 1) >= 1),
  granted_at     timestamptz   not null default now(),
  expires_at     timestamptz,
  revoked_at     timestamptz,
  metadata       jsonb         not null default '{}'::jsonb
);

-- Schema-spec divergence: member.md line 393 declares this index with
-- `expires_at is null or expires_at > now()` in the WHERE clause. Postgres
-- evaluates partial-index predicates at INSERT time, not query time — so a
-- row inserted today with expires_at = today+1day enters the index, and
-- tomorrow when now() has advanced past expires_at, the row is still in the
-- index until the next INSERT recomputes (which it won't, for that row).
-- The predicate is misleading at best, incorrect at worst.
--
-- Fix: drop the time predicate; index on (member_id) where revoked_at is
-- null only. The action layer applies the expires_at filter at query time.
-- Slightly larger index, but correct. Recorded in DEVIATIONS.md; member.md
-- flagged for pipeline-product.
create index idx_delegations_member_active
  on public.member_delegations (member_id)
  where revoked_at is null;

alter table public.member_delegations enable row level security;

-- Owner-only row access. Delegations carry the full surface of what non-
-- human actors can do on a Member's behalf — scopes, expiry, grantee
-- labels. Exposing them peer- or anon-readable would let bad actors
-- enumerate which Members have which agent capabilities (reconnaissance
-- for prompt-injection / capability-misuse). Owner-only is the structural
-- floor; narrow scalars (e.g., "does this Member have an active Delegation
-- for scope X" boolean) can land later as SECURITY DEFINER functions if a
-- use case earns it — same door-open pattern as T049's access catalog.
create policy member_delegations_owner_read on public.member_delegations
  for select
  using (member_id = auth.uid());

-- No INSERT / UPDATE / DELETE policy — action-layer-only writes per ADR-7.
-- The handler member.delegation.grant is also the only place where the
-- scopes-vocabulary enum is enforced (schema can't reject unknown scopes
-- because scopes is text[], not an FK to an enum table).

comment on table public.member_delegations is
  'Scoped, expiring permission grants from a Member to a non-human actor (assistant, Skill, federation peer). Substrate at b1, surface at b2 (delegation.md). scopes is text[]; the controlled vocabulary lives in the action layer (member.delegation.grant handler). Partial index intentionally omits the expires_at predicate per the schema-spec divergence noted at create-index above. Owner-read RLS only; no INSERT/UPDATE/DELETE policies — action-layer-only writes per ADR-7.';

------------------------------------------------------------
-- 3. FK retrofits — close the via_delegation_id circle
------------------------------------------------------------

-- T042's member_events.via_delegation_id was reserved without FK because
-- member_delegations did not yet exist. Two-step not-valid / validate
-- pattern: avoids a table-scan lock on populated tables. Zero rows today,
-- so validation is a no-op; cheap muscle memory for future runs.
alter table public.member_events
  add constraint member_events_via_delegation_fkey
  foreign key (via_delegation_id) references public.member_delegations(id)
  on delete set null
  not valid;

alter table public.member_events
  validate constraint member_events_via_delegation_fkey;

-- T045's location_events.via_delegation_id, same rationale.
alter table public.location_events
  add constraint location_events_via_delegation_fkey
  foreign key (via_delegation_id) references public.member_delegations(id)
  on delete set null
  not valid;

alter table public.location_events
  validate constraint location_events_via_delegation_fkey;
