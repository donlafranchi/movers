// T108 — Unified follows reader (F042, Loop 8).
//
// One reader, two surfaces: the `/you` "Following" card scroll and the
// `/you/following` management page both read this. Centralizing the union keeps
// the three-substrate distinction from leaking into divergent query paths
// (review-F042 § Recommendations).
//
// Sources (all owner-readable — no SECURITY DEFINER / RPC needed):
//   - People  → member_follows (public-read; member.md:279)
//   - Groups  → group_memberships, source='explicit' only (groups.md:393,
//               Ratified 2026-05-31 — soft-suggested memberships are not follows)
//   - Venues  → member_saved_searches with location_id set (owner-only RLS;
//               member.md:368, Ratified 2026-05-23)
//
// Isomorphic: takes a SupabaseClient so the server page (`/you/following`) and
// the client summary (`/you`) call the same code, each RLS-bound to the
// authenticated Member. Groups and Locations carry no image column at b1, so
// only People resolve a thumbnail; Groups/Venues fall back to a placeholder.

import type { SupabaseClient } from '@supabase/supabase-js'

export type FollowKind = 'person' | 'group' | 'venue'

export interface FollowEntry {
  kind: FollowKind
  /** Person → followed_member_id · Group → group_id · Venue → saved_search_id. */
  entityId: string
  displayName: string
  thumbnailUrl: string | null
  createdAt: string
  href: string
  isTombstone: boolean
}

const TOMBSTONE_NAME = 'A member'

interface FollowRow {
  followed_member_id: string
  created_at: string
}
interface MemberRow {
  id: string
  handle: string
  display_name: string
  avatar_url: string | null
  deleted_at: string | null
}
interface DiscRow {
  member_id: string
  is_discoverable: boolean
}
interface MembershipRow {
  group_id: string
  joined_at: string
}
interface GroupRow {
  id: string
  slug: string
  name: string
}
interface SavedSearchRow {
  id: string
  label: string
  location_id: string
  created_at: string
}
interface LocationRow {
  id: string
  slug: string
  label: string
}

async function readPeople(
  supabase: SupabaseClient,
  memberId: string,
): Promise<FollowEntry[]> {
  const { data: followsData } = await supabase
    .from('member_follows')
    .select('followed_member_id, created_at')
    .eq('follower_member_id', memberId)
    .is('unfollowed_at', null)
  const follows = (followsData as FollowRow[] | null) ?? []
  if (follows.length === 0) return []

  const ids = follows.map((f) => f.followed_member_id)
  const [{ data: memberData }, { data: discData }] = await Promise.all([
    supabase.from('members').select('id, handle, display_name, avatar_url, deleted_at').in('id', ids),
    supabase.from('member_public_discoverability').select('member_id, is_discoverable').in('member_id', ids),
  ])
  const members = new Map(((memberData as MemberRow[] | null) ?? []).map((m) => [m.id, m]))
  const disc = new Map(((discData as DiscRow[] | null) ?? []).map((d) => [d.member_id, d.is_discoverable]))

  return follows.map((f) => {
    const m = members.get(f.followed_member_id)
    // Tombstone: missing row, soft-deleted, or non-discoverable. Never a 404 —
    // the row stays so the Member can still unfollow it.
    const isTombstone = !m || m.deleted_at !== null || disc.get(f.followed_member_id) !== true
    return {
      kind: 'person' as const,
      entityId: f.followed_member_id,
      displayName: isTombstone ? TOMBSTONE_NAME : m!.display_name,
      thumbnailUrl: isTombstone ? null : m!.avatar_url,
      createdAt: f.created_at,
      href: isTombstone || !m ? '#' : `/m/${m.handle}`,
      isTombstone,
    }
  })
}

async function readGroups(
  supabase: SupabaseClient,
  memberId: string,
): Promise<FollowEntry[]> {
  const { data: gmData } = await supabase
    .from('group_memberships')
    .select('group_id, joined_at')
    .eq('member_id', memberId)
    .is('left_at', null)
    .eq('source', 'explicit')
  const memberships = (gmData as MembershipRow[] | null) ?? []
  if (memberships.length === 0) return []

  const ids = memberships.map((g) => g.group_id)
  const { data: groupData } = await supabase.from('groups').select('id, slug, name').in('id', ids)
  const groups = new Map(((groupData as GroupRow[] | null) ?? []).map((g) => [g.id, g]))

  return memberships.flatMap((gm) => {
    const g = groups.get(gm.group_id)
    // RLS-hidden / dissolved group the Member can no longer read → drop the row.
    if (!g) return []
    return [
      {
        kind: 'group' as const,
        entityId: gm.group_id,
        displayName: g.name,
        thumbnailUrl: null,
        createdAt: gm.joined_at,
        href: `/p/g/${g.slug}`,
        isTombstone: false,
      },
    ]
  })
}

async function readVenues(
  supabase: SupabaseClient,
  memberId: string,
): Promise<FollowEntry[]> {
  const { data: ssData } = await supabase
    .from('member_saved_searches')
    .select('id, label, location_id, created_at')
    .eq('member_id', memberId)
    .is('removed_at', null)
    .not('location_id', 'is', null)
  const searches = (ssData as SavedSearchRow[] | null) ?? []
  if (searches.length === 0) return []

  const ids = searches.map((s) => s.location_id)
  const { data: locData } = await supabase.from('locations').select('id, slug, label').in('id', ids)
  const locations = new Map(((locData as LocationRow[] | null) ?? []).map((l) => [l.id, l]))

  return searches.map((s) => {
    const loc = locations.get(s.location_id)
    return {
      kind: 'venue' as const,
      entityId: s.id, // saved-search id — member.saved_search.remove targets this
      displayName: loc?.label ?? s.label,
      thumbnailUrl: null,
      createdAt: s.created_at,
      href: loc ? `/p/l/${loc.slug}` : '#',
      isTombstone: false,
    }
  })
}

/**
 * Normalized, recency-ordered union of everything `memberId` follows across the
 * three substrates. Runs as the authenticated Member (RLS owner-scoped).
 */
export async function getMemberFollows(
  supabase: SupabaseClient,
  memberId: string,
): Promise<FollowEntry[]> {
  const [people, groups, venues] = await Promise.all([
    readPeople(supabase, memberId),
    readGroups(supabase, memberId),
    readVenues(supabase, memberId),
  ])
  // ISO-8601 timestamps sort lexicographically; DESC = most recent first.
  return [...people, ...groups, ...venues].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
