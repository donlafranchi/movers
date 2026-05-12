-- T047 — Members augmentation: FK fortification + privacy + handle history
-- Source: notes/migration-to-primitives.md § Phase 1 (Member surface);
--         product/systems/member.md § Data model implications;
--         development/tickets/T047-members-phase1-fk-privacy-handle-history.md
--
-- Numbering note: the rebuild plan called this 007_*; locations took 007/008
-- in the Phase 1 dependency reorder. Recorded in DEVIATIONS.md.
--
-- Three logical sections in one file:
--   1. public.members augmentations
--        a. home_location_id FK to public.locations(id) (not-valid / validate
--           two-step — muscle memory for future populated-table runs).
--        b. Constraint trigger asserting members.id ∈ auth.users OR equals
--           the system-Member id. Postgres CHECK can't subquery; FK won't
--           tolerate the system-Member exception. The constraint trigger is
--           the realistic third path. DEFERRABLE INITIALLY DEFERRED so the
--           action handler can write the auth.users + members rows in either
--           order within one transaction.
--        c. NO primary_group_id FK — public.groups doesn't exist yet. That
--           constraint lands in a later "Phase 1 Members FK closeout"
--           ticket once T0NN-groups ships.
--   2. public.member_privacy: per-Member opt-out defaults per ADR-9.
--        + member_privacy_set_updated_at trigger
--        + RLS owner-read + owner-update (no INSERT/DELETE — action layer)
--        + create_member_privacy_defaults() bootstrap trigger on members
--          insert so every Member gets a privacy row on day zero.
--        + Explicit system-Member backfill row — bootstrap trigger fires only
--          on future inserts; the row inserted in 002_members.sql needs an
--          explicit backfill.
--
-- Trigger ordering on `public.members` AFTER INSERT (load-bearing — do not
-- reorder without re-reading this header):
--
--   1. `members_create_privacy_defaults` (regular AFTER INSERT row trigger,
--      not deferrable) runs immediately after each row insert. By end of
--      statement, the matching `member_privacy` row exists.
--   2. `members_assert_id_in_auth_users` (CONSTRAINT trigger, DEFERRABLE
--      INITIALLY DEFERRED) runs at COMMIT. If it raises, the entire
--      transaction rolls back — including the privacy row created above.
--      This is the desired behavior: an invalid Member never gets a
--      privacy row left behind.
--
-- The two triggers MUST stay on the same table so they participate in the
-- same transaction. Splitting the constraint trigger to a different table
-- would break the rollback chain.
--   3. public.member_handle_history: T2 placeholder schema. No bootstrap
--      trigger; the action handler `member.handle.set` (T2) writes rows.

------------------------------------------------------------
-- 1. public.members augmentations
------------------------------------------------------------

-- 1a. home_location_id → public.locations(id) on delete set null.
-- Two-step not-valid / validate pattern: avoids a table-scan lock on populated
-- tables. Zero rows today, so validation is a no-op. Cheap muscle memory.
alter table public.members
  add constraint members_home_location_fkey
  foreign key (home_location_id) references public.locations(id)
  on delete set null
  not valid;

alter table public.members
  validate constraint members_home_location_fkey;

-- 1b. Constraint trigger asserting members.id ∈ auth.users OR ∈ {system-Member}.
-- See ticket Notes for the rationale (CHECK can't subquery; FK can't allow
-- the system-Member exception). Constraint trigger is the third realistic
-- path. DEFERRABLE INITIALLY DEFERRED so the action handler can insert in
-- either order inside one transaction.
create or replace function public.assert_member_id_in_auth_users()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- System-Member exception: the platform-owned row has no auth.users row.
  if new.id = '00000000-0000-0000-0000-000000000001'::uuid then
    return new;
  end if;

  if not exists (select 1 from auth.users where id = new.id) then
    raise exception 'member id not in auth.users (and not system): %', new.id
      using errcode = '23503';
  end if;

  return new;
end;
$$;

create constraint trigger members_assert_id_in_auth_users
  after insert or update of id on public.members
  deferrable initially deferred
  for each row execute function public.assert_member_id_in_auth_users();

comment on function public.assert_member_id_in_auth_users() is
  'Constraint-trigger substitute for a FK from members.id to auth.users.id. CHECK cannot subquery and a real FK rejects the system-Member row. Trigger is DEFERRABLE INITIALLY DEFERRED so the action handler can insert auth.users + members in either order within one transaction.';

------------------------------------------------------------
-- 2. public.member_privacy
------------------------------------------------------------

create table public.member_privacy (
  member_id              uuid          primary key references public.members(id) on delete cascade,
  profile_visibility     text          not null default 'public'
                                       check (profile_visibility in ('public','unlisted','members_only')),
  show_items_on_profile  boolean       not null default true,
  show_following         boolean       not null default false,
  show_followers         boolean       not null default false,
  allow_direct_messages  boolean       not null default true,
  locality_precision     text          not null default 'city'
                                       check (locality_precision in ('city','neighborhood','none')),
  updated_at             timestamptz   not null default now()
);

-- Reuses the function defined in 002_members.sql.
create trigger member_privacy_set_updated_at
  before update on public.member_privacy
  for each row execute function public.update_updated_at_column();

alter table public.member_privacy enable row level security;

create policy member_privacy_owner_read on public.member_privacy
  for select
  using (member_id = auth.uid());

create policy member_privacy_owner_update on public.member_privacy
  for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- Bootstrap trigger: every new public.members row gets a member_privacy row
-- with defaults. Idempotent via on conflict. Action handler member.create
-- doesn't need to know about this table — invariant is DB-enforced.
create or replace function public.create_member_privacy_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.member_privacy (member_id)
  values (new.id)
  on conflict (member_id) do nothing;
  return new;
end;
$$;

create trigger members_create_privacy_defaults
  after insert on public.members
  for each row execute function public.create_member_privacy_defaults();

comment on function public.create_member_privacy_defaults() is
  'Bootstrap trigger that creates a default member_privacy row for every new public.members insert. SECURITY DEFINER so it bypasses RLS (member_privacy has no INSERT policy — action-layer-only). Idempotent via on conflict. Pairs with the system-Member backfill below for the pre-trigger row.';

-- System-Member backfill. The bootstrap trigger only fires on future inserts;
-- the system-Member row inserted in 002_members.sql predates this trigger
-- and needs an explicit row here.
insert into public.member_privacy (member_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (member_id) do nothing;

comment on table public.member_privacy is
  'Per-Member opt-out privacy controls per ADR-9. One row per Member. Bootstrapped by a trigger on members insert; writes only via the action layer.';

------------------------------------------------------------
-- 3. public.member_handle_history (T2 placeholder)
------------------------------------------------------------

create table public.member_handle_history (
  member_id   uuid          not null references public.members(id) on delete cascade,
  handle      text          not null
                            check (char_length(handle) between 4 and 30
                                   and handle ~ '^[a-z0-9-]+$'),
  changed_at  timestamptz   not null default now(),
  primary key (member_id, handle)
);

alter table public.member_handle_history enable row level security;

create policy member_handle_history_owner_read on public.member_handle_history
  for select
  using (member_id = auth.uid());

comment on table public.member_handle_history is
  'T2 placeholder schema (no surface at b1). Rows written by the action handler member.handle.set when a Member changes their handle; old handles redirect to /m/[current-handle] for 90 days. No bootstrap trigger — initial handle lives in members.handle only.';
