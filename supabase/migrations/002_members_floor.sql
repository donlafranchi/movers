-- T042 — Members floor (Phase 0)
-- Source: notes/migration-to-primitives.md § Phase 0; product/systems/member.md § Data model implications
--
-- This is the MINIMAL members table needed for Phase 0 work. Phase 1's
-- 007_* series augments with: member_privacy, member_interests,
-- member_follows, member_handle_history, member_threads + messages +
-- participants, member_self_records, member_delegations,
-- member_location_affinities, and the FK constraints to auth.users /
-- locations / groups that depend on tables Phase 1 creates.
--
-- DEVIATIONS from product/systems/member.md (recorded in DEVIATIONS.md):
--   1. `id` has NO FK to auth.users at Phase 0 — the system Member has no
--      auth.users counterpart, so we use a plain uuid + gen_random_uuid().
--      Phase 1's augmentation adds the FK (path 2 per T042 Notes).
--   2. `home_location_id`, `primary_group_id`, `embedding_id` have NO FK
--      yet — their parent tables land in Phase 1 / T3.
--   3. `member_privacy` table is NOT created here — it lands in Phase 1.
--      The privacy posture in member.md (opt-out defaults per ADR-9) is
--      enforced by the Phase 1 trigger when that table lands.
--
-- ADDITIONS beyond member.md (recorded in DEVIATIONS.md):
--   1. `login_disabled boolean not null default false` — the system-Member
--      gate. The auth signup hook (T044) refuses to provision a `members`
--      row whose `id` collides with a `login_disabled=true` row's handle,
--      and the action layer refuses login if any future code path lands one.

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.members (
  id                     uuid          primary key default gen_random_uuid(),
  handle                 text          unique not null
                                       check (char_length(handle) between 4 and 30
                                              and handle ~ '^[a-z0-9-]+$'),
  display_name           text          not null
                                       check (char_length(display_name) between 1 and 60),
  bio                    text          check (bio is null or char_length(bio) <= 500),
  avatar_url             text,
  pronouns               text          check (pronouns is null or char_length(pronouns) <= 30),
  home_location_id       uuid,                                              -- FK added in Phase 1
  primary_group_id       uuid,                                              -- FK added in Phase 1
  stakeholder_visibility text          not null default 'private'
                                       check (stakeholder_visibility in ('private','community_only','public')),
  maker_mode_enabled     boolean       not null default false,
  embedding_id           uuid,                                              -- populated by T3 embedding pipeline
  login_disabled         boolean       not null default false,
  deleted_at             timestamptz,
  created_at             timestamptz   not null default now(),
  updated_at             timestamptz   not null default now()
);

create index idx_members_home_location
  on public.members (home_location_id)
  where home_location_id is not null;

create index idx_members_primary_group
  on public.members (primary_group_id)
  where primary_group_id is not null;

create index idx_members_active
  on public.members (deleted_at)
  where deleted_at is null;

create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.update_updated_at_column();

alter table public.members enable row level security;

-- members_public_read: anon + authed can read non-deleted, non-system rows.
-- The login_disabled clause is the system-Member gate — keeps the system
-- Member invisible to the public surface.
create policy members_public_read on public.members
  for select
  using (deleted_at is null and login_disabled = false);

-- members_owner_update: owners can update their own row only.
-- Insert via action layer (service role); no direct INSERT policy.
-- No DELETE policy — soft-delete only via action handler.
create policy members_owner_update on public.members
  for update
  using (id = auth.uid());

comment on table public.members is
  'Phase 0 floor: minimal members table for the action layer + auth signup hook to write to. Phase 1''s 007_* series augments with privacy, interests, follows, threads, affinities, delegations, self-records.';

comment on column public.members.id is
  'Phase 0: plain uuid (gen_random_uuid). Phase 1 adds FK to auth.users(id) with an exception for the system Member.';

comment on column public.members.login_disabled is
  'When true, the row cannot be logged in as. Reserved for the system Member (handle=''system''). Filtered out by members_public_read.';
