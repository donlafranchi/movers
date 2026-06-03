// T092 — Public Member page resolver (F032 read surface).
// Spec:   planning/now/scenario-F032-viewer-finds-member-page-and-follows.md
//
// Resolves the Member at /m/[handle] plus everything the page renders:
// authored published Items, listed Group memberships, standing-presence, and
// (for an auth'd viewer) the follow state. Supabase-client-shaped so it runs
// from a server component with the session-bound client — same convention as
// resolve-shop.ts.
//
// Visibility is enforced by RLS + the public projection views (migration 029):
//   - members_public_read filters soft-deleted + the system Member → a
//     deleted/nonexistent handle yields null → 404.
//   - items_select_published gates Items (we also filter state='published').
//   - member_public_group_memberships only exposes active explicit memberships
//     in non-dissolved, LISTED Groups — unlisted/private never surface, and
//     place-interests are never queried.

import type { SupabaseClient } from '@supabase/supabase-js'
import { itemHref } from '@/lib/feed/item-url'

export interface MemberItem {
  itemId: string
  kind: string
  title: string
  brandLabel: string | null
  href: string
}

export interface MemberGroup {
  slug: string
  name: string
  kind: string
}

export interface ResolvedMemberPage {
  memberId: string
  handle: string
  displayName: string
  bio: string | null
  pronouns: string | null
  avatarUrl: string | null
  hasStandingPresence: boolean
  items: MemberItem[]
  groups: MemberGroup[]
  isSelf: boolean
  isFollowing: boolean
}

interface MemberRow {
  id: string
  handle: string
  display_name: string
  bio: string | null
  pronouns: string | null
  avatar_url: string | null
}

interface ItemRow {
  id: string
  kind: string
  title: string
  brand_label: string | null
}

interface GroupRow {
  slug: string
  name: string
  kind: string
}

export async function resolveMemberPage(
  supabase: SupabaseClient,
  args: { handle: string; viewerId?: string | null },
): Promise<ResolvedMemberPage | null> {
  const { data: memberData, error: memberErr } = await supabase
    .from('members')
    .select('id, handle, display_name, bio, pronouns, avatar_url')
    .eq('handle', args.handle)
    .limit(1)
    .maybeSingle()

  if (memberErr || !memberData) return null
  const member = memberData as unknown as MemberRow

  const viewerId = args.viewerId ?? null
  const isSelf = viewerId !== null && viewerId === member.id

  // Authored, published, non-deleted Items (newest first).
  const { data: itemData } = await supabase
    .from('items')
    .select('id, kind, title, brand_label')
    .eq('member_id', member.id)
    .eq('state', 'published')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const items: MemberItem[] = ((itemData as unknown as ItemRow[]) ?? []).map((row) => ({
    itemId: row.id,
    kind: row.kind,
    title: row.title,
    brandLabel: row.brand_label,
    href: itemHref({
      kind: row.kind,
      ownerHandle: member.handle,
      title: row.title,
      itemId: row.id,
    }),
  }))

  // Listed Group memberships via the privacy-preserving public projection.
  const { data: groupData } = await supabase
    .from('member_public_group_memberships')
    .select('slug, name, kind')
    .eq('member_id', member.id)
    .order('name', { ascending: true })

  const groups: MemberGroup[] = ((groupData as unknown as GroupRow[]) ?? []).map((row) => ({
    slug: row.slug,
    name: row.name,
    kind: row.kind,
  }))

  // Standing-presence badge.
  const { data: standingData } = await supabase
    .from('member_has_standing_presence')
    .select('member_id')
    .eq('member_id', member.id)
    .limit(1)
    .maybeSingle()
  const hasStandingPresence = !!standingData

  // Follow state — only meaningful for an auth'd, non-self viewer.
  let isFollowing = false
  if (viewerId && !isSelf) {
    const { data: followData } = await supabase
      .from('member_follows')
      .select('follower_member_id')
      .eq('follower_member_id', viewerId)
      .eq('followed_member_id', member.id)
      .is('unfollowed_at', null)
      .limit(1)
      .maybeSingle()
    isFollowing = !!followData
  }

  return {
    memberId: member.id,
    handle: member.handle,
    displayName: member.display_name,
    bio: member.bio,
    pronouns: member.pronouns,
    avatarUrl: member.avatar_url,
    hasStandingPresence,
    items,
    groups,
    isSelf,
    isFollowing,
  }
}
