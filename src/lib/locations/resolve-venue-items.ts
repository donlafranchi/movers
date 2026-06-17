// T105 — Venue content-section resolvers (F033).
// Spec:   planning/next/scenario-F033-viewer-finds-venue-page.md
// Ticket: development/tickets/T105-venue-page-content-sections.md
//
// Owning-Group resolution (deferred here from T104 per its deviation 5 — no
// T104 shell surface consumed it) plus the two section feeds. Both feeds return
// the shared FeedItem shape (locality-feed.ts) so the page renders them with the
// same <ItemFeedCard> as the locality feed.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FeedItem } from '@/lib/feed/locality-feed'

const DEFAULT_NEARBY_RADIUS_M = 5000

type FromClient = Pick<SupabaseClient, 'from'>
type RpcClient = Pick<SupabaseClient, 'rpc'>

/**
 * The venue's owning kind='business' Group, or null (minimal-page variant).
 * Deterministic on collisions: first ACTIVE business Group anchored at this
 * Location by created_at. Draft / dissolved Groups never scope a public page.
 */
export async function resolveOwningGroup(
  supabase: FromClient,
  locationId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('groups')
    .select('id')
    .eq('anchor_location_id', locationId)
    .eq('kind', 'business')
    .eq('lifecycle_state', 'active')
    .is('dissolved_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return (data as { id: string }).id
}

interface FeedRow {
  item_id: string
  member_handle: string
  member_display_name: string
  item_kind: string
  title: string
  category: string | null
  brand_label: string | null
  group_id: string | null
  nearest_location_label: string | null
  response_count: number | string
  primary_tag: string | null
  published_at: string
}

function mapFeedRow(r: FeedRow): FeedItem {
  return {
    itemId: r.item_id,
    kind: r.item_kind,
    title: r.title,
    category: r.category,
    brandLabel: r.brand_label,
    groupId: r.group_id,
    ownerHandle: r.member_handle,
    ownerDisplayName: r.member_display_name,
    nearestLocationLabel: r.nearest_location_label,
    responseCount: Number(r.response_count ?? 0),
    primaryTag: r.primary_tag,
    publishedAt: r.published_at,
  }
}

/**
 * "What's happening here" — Items hosted by the owning Group at this venue.
 * Empty (no RPC) when there is no owning Group. Null-safe: an RPC error → [].
 */
export async function getVenueHostedItems(
  supabase: RpcClient,
  args: { locationId: string; owningGroupId: string | null },
): Promise<FeedItem[]> {
  if (!args.owningGroupId) return []
  const { data, error } = await supabase.rpc('venue_hosted_items', {
    p_location_id: args.locationId,
    p_owning_group_id: args.owningGroupId,
  })
  if (error || !data) return []
  return (data as FeedRow[]).map(mapFeedRow)
}

/**
 * "What's happening nearby" — public Items within radius, excluding the owning
 * Group. Works with a null owning Group (minimal page). Null-safe: error → [].
 */
export async function getVenueNearbyItems(
  supabase: RpcClient,
  args: { locationId: string; owningGroupId: string | null; radiusMeters?: number },
): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc('venue_nearby_items', {
    p_location_id: args.locationId,
    p_owning_group_id: args.owningGroupId,
    p_radius_m: args.radiusMeters ?? DEFAULT_NEARBY_RADIUS_M,
  })
  if (error || !data) return []
  return (data as FeedRow[]).map(mapFeedRow)
}
