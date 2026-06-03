-- T095 — Member discoverability default = private (with prompt-on-acquisition)
-- Spec:   product/systems/member.md § Privacy controls (Ratified 2026-06-03) +
--                                  § Prompt-on-acquisition for producers / organizers
-- Pattern: playbooks/PLATFORM-PATTERNS.md § Default Member discoverability to private (Ratified 2026-05-30)
-- Ticket:  development/tickets/T095-member-discoverability-default-private.md
--
-- Corrects the as-shipped F032 default (public + no discoverability gate) to the
-- ratified platform pattern: a Member is not findable as a person until they opt
-- in. Greenfield — no existing Member rows to grandfather (the add-column default
-- and the alter-default cover every future insert via the 009 bootstrap trigger).
--
-- Two orthogonal gates, per member.md § Privacy controls:
--   - profile_visibility  → who may VIEW /m/[handle] (audience gate)
--       public        : anyone with the URL (anon + signed-in); indexable iff is_discoverable
--       unlisted      : anyone with the URL; never indexed
--       members_only  : signed-in viewers only (the new b1 default)
--       private       : the Member themselves only; signed-in others get a tombstone
--   - is_discoverable     → whether the Member SURFACES in search / directory /
--       autocomplete / external index. Orthogonal to the audience gate: a public
--       Member with is_discoverable=false is viewable by URL but never indexed and
--       never surfaced in a listing.
--
-- The base-table read (members_public_read) cannot consult member_privacy with a
-- plain subquery — member_privacy is owner-only under RLS, so the subquery would
-- see nothing for non-owners. Both gate helpers are SECURITY DEFINER (same
-- technique as member_has_standing_presence / member_public_group_memberships in
-- 029) so they read member_privacy with owner privileges and expose only a
-- boolean / a collapsed verdict — never the raw privacy row.

------------------------------------------------------------
-- 1. member_privacy: discoverability gate + private tier + default flip
------------------------------------------------------------

alter table public.member_privacy
  add column is_discoverable boolean not null default false;

comment on column public.member_privacy.is_discoverable is
  'T095 — the single b1 discoverability switch (default false). Gates search / directory / autocomplete / handle-direct surfacing and external-index of /m/[handle]. Orthogonal to profile_visibility: a public+non-discoverable Member is viewable by direct URL but never indexed or listed. Producers/organizers are offered a one-time prompt to flip this on (see member_prompts); never auto-flipped.';

-- New b1 default: members_only (was public). A non-discoverable Member is
-- unfindable in search, but a friend who pastes the URL can still see the page
-- when signed in. Members wanting full invisibility set 'private'.
alter table public.member_privacy
  alter column profile_visibility set default 'members_only';

-- Extend the enum with 'private' (self-only view → tombstone for signed-in others).
-- The inline column check from 009 is auto-named member_privacy_profile_visibility_check.
alter table public.member_privacy
  drop constraint if exists member_privacy_profile_visibility_check;
alter table public.member_privacy
  add constraint member_privacy_profile_visibility_check
  check (profile_visibility in ('public','unlisted','members_only','private'));

------------------------------------------------------------
-- 2. member_prompts: one-time prompt substrate (prompt-on-acquisition)
------------------------------------------------------------

create table public.member_prompts (
  member_id     uuid          not null references public.members(id) on delete cascade,
  prompt_kind   text          not null
                              check (prompt_kind in ('discoverability_on_acquisition')),
  shown_at      timestamptz,
  dismissed_at  timestamptz,
  accepted_at   timestamptz,
  created_at    timestamptz   not null default now(),
  primary key (member_id, prompt_kind)
);

alter table public.member_prompts enable row level security;

create policy member_prompts_owner_read on public.member_prompts
  for select
  using (member_id = auth.uid());

create policy member_prompts_owner_update on public.member_prompts
  for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- No INSERT/DELETE policy: rows are written by the action layer (the membership
-- handler enqueues; the prompt-response handler stamps) via SECURITY DEFINER, not
-- by the client directly. Mirrors member_privacy's action-layer-only write posture.

comment on table public.member_prompts is
  'T095 — one-time UI prompts keyed (member_id, prompt_kind). b1 carries a single kind: discoverability_on_acquisition, enqueued by the membership action handler when a Member acquires their first business-Group membership or first steward role. shown/dismissed/accepted stamps make the prompt-not-yet-shown state queryable and the offer one-per-lifetime. Owner-only read; action-layer-only write.';

------------------------------------------------------------
-- 3. Gate helpers (SECURITY DEFINER — read member_privacy with owner privileges)
------------------------------------------------------------

-- Resolver verdict: collapses (handle, viewer, visibility, discoverability)
-- into render | tombstone | notfound, and returns the row id + flags the page
-- needs for robots meta. Never reveals a Member's existence to a viewer who
-- shouldn't see it (anon → notfound for anything but public/unlisted; signed-in
-- → tombstone only for 'private', else notfound when no handle matches).
-- p_via_direct_link: true for the /m/[handle] page (a URL navigation); false for
-- a search / directory / autocomplete origin, which additionally requires
-- is_discoverable=true. No such listing surface exists at b1, but the gate ships
-- with the resolver so the surface can pass false when it lands.
create or replace function public.resolve_member_page_visibility(
  p_handle text,
  p_via_direct_link boolean default true
)
returns table (
  member_id uuid,
  verdict text,
  is_discoverable boolean,
  profile_visibility text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  m_id uuid;
  m_vis text;
  m_disc boolean;
  caller uuid := auth.uid();
begin
  select mm.id, mp.profile_visibility, mp.is_discoverable
    into m_id, m_vis, m_disc
    from public.members mm
    join public.member_privacy mp on mp.member_id = mm.id
   where mm.handle = p_handle
     and mm.deleted_at is null
     and mm.login_disabled = false;

  if not found then
    return query select null::uuid, 'notfound'::text, false, null::text;
    return;
  end if;

  -- Self always renders.
  if caller is not null and caller = m_id then
    return query select m_id, 'render'::text, m_disc, m_vis;
    return;
  end if;

  -- Search / directory / autocomplete origin: must be discoverable on top of the
  -- audience gate below. Collapse to notfound so a listing never leaks a
  -- non-discoverable Member.
  if not p_via_direct_link and not m_disc then
    return query select null::uuid, 'notfound'::text, false, null::text;
    return;
  end if;

  if caller is null then
    -- anon: public/unlisted are URL-viewable; everything else is invisible.
    if m_vis in ('public','unlisted') then
      return query select m_id, 'render'::text, m_disc, m_vis;
    else
      return query select null::uuid, 'notfound'::text, false, null::text;
    end if;
    return;
  end if;

  -- signed-in, non-self.
  if m_vis = 'private' then
    return query select m_id, 'tombstone'::text, m_disc, m_vis;
  elsif m_vis in ('public','unlisted','members_only') then
    return query select m_id, 'render'::text, m_disc, m_vis;
  else
    return query select null::uuid, 'notfound'::text, false, null::text;
  end if;
end;
$$;

comment on function public.resolve_member_page_visibility(text, boolean) is
  'T095 — single source of truth for the /m/[handle] render/tombstone/404 decision. SECURITY DEFINER over member_privacy. Returns verdict in (render, tombstone, notfound) plus is_discoverable + profile_visibility for robots-meta. anon never learns a non-public Member exists (notfound); signed-in non-self gets a tombstone only for private; p_via_direct_link=false (search/directory origin) additionally requires is_discoverable.';

grant execute on function public.resolve_member_page_visibility(text, boolean) to anon, authenticated;

------------------------------------------------------------
-- 4. member_public_discoverability (projection view)
------------------------------------------------------------
-- Anon-readable projection of (member_id, is_discoverable). Drives the
-- conditional Member link on item-page attribution (when an item is sold as an
-- individual rather than under a Group) and the Shop "Founded by" line. Uses
-- the same owner-privileges-bypass pattern as member_public_group_memberships
-- in 029: a regular view runs with view-owner privileges, so the read of the
-- owner-only member_privacy table works for non-owners; the projection exposes
-- only the boolean.

create or replace view public.member_public_discoverability as
  select mp.member_id, mp.is_discoverable
    from public.member_privacy mp;

comment on view public.member_public_discoverability is
  'T095 — anon-readable projection of is_discoverable from member_privacy. Drives the conditional Member-link logic on Shop "Founded by" + individual-Item attribution. Regular view, runs with owner privileges (same pattern as member_public_group_memberships in 029). Exposes only the boolean — no other privacy column.';

grant select on public.member_public_discoverability to anon, authenticated;

------------------------------------------------------------
-- Note on members_public_read (intentionally NOT tightened here)
------------------------------------------------------------
-- The discoverability gate lives in resolve_member_page_visibility (the
-- /m/[handle] page), the robots-noindex meta (external index), and the
-- search/directory/autocomplete callers (via p_via_direct_link = false). The
-- base members_public_read policy is deliberately left permissive at b1.
--
-- T095 revision (Group-attribution model): Item pages no longer embed the
-- seller's member row for the common case — they attribute to the Group, which
-- is public-by-default. The only remaining cross-Member base-table reads at b1
-- are (a) the Shop "Founded by" lookup (which still needs handle + display_name
-- + avatar) and (b) individual-Item attribution (gathering hosted as a Member
-- with no Group). Both paths read the public projection above for the
-- discoverability boolean, but still embed the base members row for handle +
-- display_name + avatar.
--
-- Fully closing the direct-enumeration vector (anon hitting /rest/v1/members to
-- list everyone) requires migrating those last two paths onto a SECURITY DEFINER
-- projection or a similar handle/display_name/avatar-only view — tracked as a
-- T095 follow-up in SPEC-PATCHES, out of scope for this ticket.
