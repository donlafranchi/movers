// T087 — Locality feed read helper (F030).
//
// Supabase-client-shaped (calls the locality_feed_items RPC) so it runs from a
// server component with the session-bound or anon client. Same convention as
// src/lib/groups/resolve-shop.ts.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface FeedItem {
  itemId: string
  kind: string
  title: string
  category: string | null
  brandLabel: string | null
  groupId: string | null
  ownerHandle: string
  ownerDisplayName: string
  nearestLocationLabel: string | null
  responseCount: number
  primaryTag: string | null
  publishedAt: string
}

const TAG_RE = /^[a-z0-9-]{1,60}$/

/** Lowercase, dedupe, drop invalid tags. Empty result → null (no tag filter). */
export function normalizeTags(tags: readonly string[] | null | undefined): string[] | null {
  if (!tags) return null
  const clean = Array.from(
    new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => TAG_RE.test(t))),
  )
  return clean.length > 0 ? clean : null
}

/** Clamp the feed page size to 1..100, default 50. */
export function clampLimit(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 50
  return Math.max(1, Math.min(100, Math.floor(n)))
}

interface LocalityFeedRow {
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

type RpcClient = Pick<SupabaseClient, 'rpc'>

export async function getLocalityFeed(
  supabase: RpcClient,
  opts: { placeId: string; interestTags?: readonly string[] | null; limit?: number | null },
): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc('locality_feed_items', {
    p_place_id: opts.placeId,
    p_tags: normalizeTags(opts.interestTags),
    p_limit: clampLimit(opts.limit),
  })
  if (error) throw error
  const rows = (data ?? []) as LocalityFeedRow[]
  return rows.map((r) => ({
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
  }))
}

type FromClient = Pick<SupabaseClient, 'from'>

/**
 * Resolve the parent Place for the widen-locality empty-state CTA.
 * Returns null at the root (no parent) so the caller can fall back to
 * "any Place in your state".
 */
export async function widenLocality(
  supabase: FromClient,
  placeId: string,
): Promise<{ placeId: string; displayName: string; slug: string } | null> {
  const { data: current, error: e1 } = await supabase
    .from('places')
    .select('parent_id')
    .eq('id', placeId)
    .maybeSingle()
  if (e1) throw e1
  const parentId = (current as { parent_id: string | null } | null)?.parent_id
  if (!parentId) return null

  const { data: parent, error: e2 } = await supabase
    .from('places')
    .select('id, display_name, slug')
    .eq('id', parentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (e2) throw e2
  if (!parent) return null
  const p = parent as { id: string; display_name: string; slug: string }
  return { placeId: p.id, displayName: p.display_name, slug: p.slug }
}
