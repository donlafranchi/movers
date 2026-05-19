-- T055 — Phase 1: Groups schema.
--
-- Ships:
--   1. public.groups (spine; six-kind enum; family→private discoverability default)
--   2. public.group_businesses (1:1 child for kind='business')
--   3. public.group_event_anchored (1:1 child for kind='event_anchored';
--      seeded_by_item_id is a forward-FK to items, constraint added by T056)
--   4. public.group_memberships (composite PK; explicit / soft_via_* source enum)
--   5. public.current_member_explicit_group_ids() — SECURITY DEFINER helper
--      that returns the calling Member's active explicit Group IDs, bypassing
--      RLS to prevent cross-table policy recursion (SQLSTATE 42P17).
--   6. Cross-table RLS policies on groups + group_memberships using the helper.
--   7. public.group_events (monthly partitioned; audit fields per ADR-6)
--   8. public.member_has_standing_presence (view; ≥1 business owner/staff
--      membership OR steward role in any non-business Group)
--
-- Spec anchors:
--   product/systems/groups.md (six kinds; Member-business carry; standing-tier view)
--   planning/adrs/ADR-0013-groups-consolidation.md (supersedes Community/Operations/Cooperative)
--   planning/adrs/ADR-0010-action-layer-event-log.md (same-transaction event commit; partitioning)
--   planning/adrs/ADR-0007-action-layer.md (no writes outside action layer)
--   planning/adrs/ADR-0006-agent-assistance.md (audit fields on every event row)
--
-- Phase 1 absolutes encoded here (per absolutes audit 2026-05-19):
--   (a) family-kind defaults discoverability='private' (BEFORE INSERT trigger).
--   (b) Groups never auto-assigned: source enum permits soft_via_* values
--       for substrate symmetry, but no trigger writes them — explicit only.
--   (c) Soft membership is query-time only: addressability filters
--       source='explicit'; handlers (Phase 2) refuse soft_via_* writes for
--       business kind; surface inference is read-only.
--   (d) discoverability gates anon reads via RLS.
--
-- Action handlers do NOT ship in this ticket. Per T045–T053 pattern, schema
-- only; handlers land with Phase 2 surface composers.
--
-- Deferred FK: group_event_anchored.seeded_by_item_id has no FK constraint
-- yet — items table doesn't exist. T056 will add:
--   alter table public.group_event_anchored
--     add constraint group_event_anchored_seeded_by_item_fkey
--     foreign key (seeded_by_item_id) references public.items(id)
--     on delete set null;

------------------------------------------------------------
-- 1. public.groups (spine)
------------------------------------------------------------

create table public.groups (
  id                  uuid          not null default gen_random_uuid() primary key,
  name                text          not null
                                    check (length(name) between 1 and 120),
  slug                text          not null unique
                                    check (length(slug) between 1 and 80),
  kind                text          not null
                                    check (kind in (
                                      'place','interest','practice',
                                      'event_anchored','family','business'
                                    )),
  anchor_location_id  uuid                   references public.locations(id) on delete set null,
  parent_group_id     uuid                   references public.groups(id)    on delete set null,
  founder_member_id   uuid          not null references public.members(id),
  description         text          not null default '',
  discoverability     text          not null
                                    check (discoverability in ('listed','unlisted','private')),
  metadata            jsonb         not null default '{}'::jsonb,
  established_on      date,
  dormant_at          timestamptz,
  dissolves_at        timestamptz,
  dissolved_at        timestamptz,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

create index idx_groups_kind_listed
  on public.groups (kind)
  where dissolved_at is null and discoverability = 'listed';

create index idx_groups_anchor_active
  on public.groups (anchor_location_id)
  where dissolved_at is null;

create index idx_groups_founder
  on public.groups (founder_member_id)
  where dissolved_at is null;

create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.update_updated_at_column();

-- Family-kind defaults to private; everything else to listed.
create or replace function public.groups_default_discoverability()
returns trigger
language plpgsql
as $$
begin
  if NEW.discoverability is null then
    NEW.discoverability := case NEW.kind when 'family' then 'private' else 'listed' end;
  end if;
  return NEW;
end;
$$;

create trigger trg_groups_default_discoverability
  before insert on public.groups
  for each row execute function public.groups_default_discoverability();

alter table public.groups enable row level security;

-- Non-recursive policies first; the member-of-group policy lands after the
-- helper function exists (which requires group_memberships to exist).
create policy groups_select_listed on public.groups
  for select
  using (discoverability = 'listed' and dissolved_at is null);

create policy groups_select_founder on public.groups
  for select
  using (founder_member_id = auth.uid());

comment on table public.groups is
  'Group primitive spine per groups.md + ADR-13. Six kinds: place/interest/practice/event_anchored/family/business. Action-layer-only writes per ADR-7. Family defaults to private discoverability via trg_groups_default_discoverability.';

------------------------------------------------------------
-- 2. public.group_businesses (kind='business')
------------------------------------------------------------

create table public.group_businesses (
  group_id            uuid          not null primary key
                                    references public.groups(id) on delete cascade,
  display_name        text          not null
                                    check (length(display_name) between 1 and 120),
  public_description  text          not null default '',
  legal_entity_kind   text                   check (legal_entity_kind in ('llc','sole_prop','partnership','other')),
  state_of_formation  text,
  formed_at           date
);

alter table public.group_businesses enable row level security;

create policy group_businesses_select_via_parent on public.group_businesses
  for select
  using (group_id in (select id from public.groups));

comment on table public.group_businesses is
  'kind=business child per groups.md. Brand label (display_name) drives Item resolve-up rendering. Member-owned operating Group — no corporate-shell entity.';

------------------------------------------------------------
-- 3. public.group_event_anchored (kind='event_anchored')
------------------------------------------------------------

create table public.group_event_anchored (
  group_id           uuid          not null primary key
                                   references public.groups(id) on delete cascade,
  seeded_by_item_id  uuid          -- FK added in T056 (items doesn't exist yet)
);

alter table public.group_event_anchored enable row level security;

create policy group_event_anchored_select_via_parent on public.group_event_anchored
  for select
  using (group_id in (select id from public.groups));

comment on table public.group_event_anchored is
  'kind=event_anchored child per groups.md. seeded_by_item_id is the gathering Item that catalyzed the Group; FK constraint deferred to T056 (items migration).';

------------------------------------------------------------
-- 4. public.group_memberships
------------------------------------------------------------

create table public.group_memberships (
  group_id               uuid          not null references public.groups(id)  on delete cascade,
  member_id              uuid          not null references public.members(id) on delete cascade,
  role                   text          not null
                                       check (length(role) between 1 and 60),
  source                 text          not null default 'explicit'
                                       check (source in ('explicit','soft_via_follow','soft_via_attendance')),
  joined_at              timestamptz   not null default now(),
  left_at                timestamptz,
  confirmed_by_member_id uuid                   references public.members(id) on delete set null,
  confirmed_at           timestamptz,
  primary key (group_id, member_id)
);

create index idx_memberships_member_explicit_active
  on public.group_memberships (member_id, group_id)
  where left_at is null and source = 'explicit';

create index idx_memberships_group_role_active
  on public.group_memberships (group_id, role)
  where left_at is null;

create index idx_memberships_group_active
  on public.group_memberships (group_id)
  where left_at is null;

alter table public.group_memberships enable row level security;

-- Self-only policy is non-recursive and lands inline.
create policy memberships_select_self on public.group_memberships
  for select
  using (member_id = auth.uid());

comment on table public.group_memberships is
  'Membership join per groups.md. source=explicit only for addressability; soft_via_* values are reserved substrate (action handlers at Phase 2 enforce explicit-only writes for business kind and the no-auto-assignment absolute). Action-layer-only writes per ADR-7.';

------------------------------------------------------------
-- 5. Cross-table RLS — helper + the policies that need it.
------------------------------------------------------------

-- SECURITY DEFINER helper. Postgres RLS policies that subquery a second
-- table whose own RLS references the first table will infinite-loop
-- (SQLSTATE 42P17). This function bypasses RLS on the lookup (it runs as
-- the function owner, postgres) while still being safe because the body
-- filters strictly on auth.uid().
create or replace function public.current_member_explicit_group_ids()
returns setof uuid
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select group_id
    from public.group_memberships
   where member_id = auth.uid()
     and left_at is null
     and source = 'explicit';
$$;

-- A Member sees Groups they are an active explicit member of.
create policy groups_select_member on public.groups
  for select
  using (id in (select public.current_member_explicit_group_ids()));

-- Co-member read: Members of a Group see their fellow members (any source,
-- any left_at — the Group is yours, see everyone). Uses the helper to
-- prevent recursion against group_memberships' own RLS.
create policy memberships_select_co_member on public.group_memberships
  for select
  using (group_id in (select public.current_member_explicit_group_ids()));

-- Listed-Group public roster: anon + auth see explicit active memberships
-- of listed, non-dissolved Groups. Private / unlisted Group rosters are
-- members-only. The subquery against public.groups is safe — groups_select_*
-- policies don't recurse back through group_memberships when the helper
-- is in use (groups_select_member now goes through the bypass).
create policy memberships_select_listed_group on public.group_memberships
  for select
  using (
    group_id in (
      select id from public.groups
       where discoverability = 'listed' and dissolved_at is null
    )
    and left_at is null
    and source = 'explicit'
  );

------------------------------------------------------------
-- 6. public.group_events (partitioned monthly per ADR-10)
------------------------------------------------------------

create table public.group_events (
  id                 uuid          not null default gen_random_uuid(),
  group_id           uuid          not null references public.groups(id) on delete cascade,
  event_kind         text          not null
                                   check (event_kind in (
                                     'group.created',
                                     'group.member_joined',
                                     'group.member_left',
                                     'group.role_changed',
                                     'group.steward_transferred',
                                     'group.dormant',
                                     'group.dormancy_extended',
                                     'group.revived',
                                     'group.dissolved'
                                   )),
  payload            jsonb         not null default '{}'::jsonb,
  acting_member_id   uuid          not null references public.members(id) on delete restrict,
  via_delegation_id  uuid                   references public.member_delegations(id) on delete set null,
  created_at         timestamptz   not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create index idx_group_events_group
  on public.group_events (group_id, created_at desc);

create index idx_group_events_acting
  on public.group_events (acting_member_id, created_at desc);

alter table public.group_events enable row level security;

create policy group_events_select_acting_self on public.group_events
  for select
  using (acting_member_id = auth.uid());

-- Members of the Group see its events. Uses the helper for recursion safety.
create policy group_events_select_member_of_group on public.group_events
  for select
  using (group_id in (select public.current_member_explicit_group_ids()));

-- Partition rotation — mirrors the member_events / location_events pattern.
create or replace function public.ensure_group_events_partition(target_month date)
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
  partition_name := format('group_events_y%sm%s',
                           to_char(range_start, 'YYYY'),
                           to_char(range_start, 'MM'));

  execute format(
    'create table if not exists public.%I partition of public.group_events
       for values from (%L) to (%L)',
    partition_name, range_start, range_end
  );
end;
$$;

create or replace function public.rotate_group_events_partitions()
returns void
language plpgsql
as $$
declare
  base date := date_trunc('month', now())::date;
begin
  perform public.ensure_group_events_partition(base);
  perform public.ensure_group_events_partition((base + interval '1 month')::date);
  perform public.ensure_group_events_partition((base + interval '2 months')::date);
end;
$$;

select public.rotate_group_events_partitions();

comment on table public.group_events is
  'Append-only event log per ADR-10. Monthly partitioned. Audit fields (acting_member_id, via_delegation_id) per ADR-6. Writes only via the action layer.';

------------------------------------------------------------
-- 7. public.member_has_standing_presence (view)
------------------------------------------------------------

create or replace view public.member_has_standing_presence as
  select distinct m.id as member_id
    from public.members m
    join public.group_memberships gm on gm.member_id = m.id and gm.left_at is null
    join public.groups g            on g.id = gm.group_id  and g.dissolved_at is null
   where (g.kind = 'business' and gm.role in ('owner','staff'))
      or (g.kind <> 'business' and gm.role = 'steward');

comment on view public.member_has_standing_presence is
  'Standing-tier per groups.md: Member has standing presence iff ≥1 active owner/staff role in any kind=business Group OR steward role in any non-business Group. Replaces the prior member_operations-derived view.';
