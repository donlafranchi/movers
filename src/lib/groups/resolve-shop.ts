// T074 — Public Shop resolver (F035 read surface).
// Spec:   planning/now/scenario-F035-rosa-finds-mayas-shop.md
// Ticket: development/tickets/T074-shop-public-page.md
//
// Resolves a kind='business' Group ("Shop") for the public page at
// /p/[…place]/g/[slug]. RLS does the visibility work (T070's
// groups_select_active_or_own_draft): a returned 'draft' row implies the
// viewer is the founder (founder_member_id = auth.uid()), so the page can
// render the owner preview off lifecycleState alone. A non-owner / anon
// viewing a draft, dissolved, or nonexistent slug gets no row → null → 404.
//
// Supabase-client-shaped (not pg-shaped) so it runs from a server component
// with the session-bound client. Same convention as src/lib/sell/getDraftGroup.ts.

import type { SupabaseClient } from '@supabase/supabase-js'

export type GroupLifecycleState = 'draft' | 'active' | 'dissolved'

export interface ShopFounder {
  handle: string
  displayName: string
  avatarUrl: string | null
}

export interface ResolvedShop {
  groupId: string
  slug: string
  displayName: string
  publicDescription: string
  lifecycleState: GroupLifecycleState
  anchorLocationId: string | null
  founder: ShopFounder | null
}

export interface ShopItem {
  id: string
  title: string
  kind: string
}

export interface LocalOwnerBadge {
  label: string
}

/**
 * Split a place catch-all slug array at the `/g/` marker.
 * `['ca','sacramento','oak-park','g','oak-park-sourdough']`
 *   → { placeSegments: ['ca','sacramento','oak-park'], groupSlug: 'oak-park-sourdough' }
 * Returns null when there is no group segment (bare place path) or when the
 * `g` marker has no slug after it. A Group slug is a single segment; anything
 * past it (Item segments) is out of F035 scope.
 */
export function splitGroupSlug(
  segments: string[],
): { placeSegments: string[]; groupSlug: string } | null {
  const gIndex = segments.indexOf('g')
  if (gIndex === -1) return null
  const groupSlug = segments[gIndex + 1]
  if (!groupSlug) return null
  return { placeSegments: segments.slice(0, gIndex), groupSlug }
}

// PostgREST returns an embedded relation as either an array or a single
// object depending on cardinality hints. Normalise to the first row.
function firstEmbed<T>(embed: T[] | T | null | undefined): T | null {
  if (Array.isArray(embed)) return embed[0] ?? null
  return embed ?? null
}

interface ShopRow {
  id: string
  slug: string
  kind: string
  lifecycle_state: string
  anchor_location_id: string | null
  group_businesses:
    | { display_name: string; public_description: string }[]
    | { display_name: string; public_description: string }
    | null
  founder:
    | { handle: string; display_name: string; avatar_url: string | null }[]
    | { handle: string; display_name: string; avatar_url: string | null }
    | null
}

export async function resolveShop(
  supabase: SupabaseClient,
  slug: string,
): Promise<ResolvedShop | null> {
  const { data, error } = await supabase
    .from('groups')
    .select(
      'id, slug, kind, lifecycle_state, anchor_location_id, ' +
        'group_businesses(display_name, public_description), ' +
        'founder:members!founder_member_id(handle, display_name, avatar_url)',
    )
    .eq('slug', slug)
    .eq('kind', 'business')
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const row = data as unknown as ShopRow
  const biz = firstEmbed(row.group_businesses)
  const founderRow = firstEmbed(row.founder)

  return {
    groupId: row.id,
    slug: row.slug,
    displayName: biz?.display_name ?? '',
    publicDescription: biz?.public_description ?? '',
    lifecycleState: row.lifecycle_state as GroupLifecycleState,
    anchorLocationId: row.anchor_location_id,
    founder: founderRow
      ? {
          handle: founderRow.handle,
          displayName: founderRow.display_name,
          avatarUrl: founderRow.avatar_url,
        }
      : null,
  }
}

export async function resolveShopItems(
  supabase: SupabaseClient,
  groupId: string,
): Promise<ShopItem[]> {
  const { data, error } = await supabase
    .from('items')
    .select('id, title, kind')
    .eq('group_id', groupId)
    .in('kind', ['product', 'service'])
    .eq('state', 'published')
    .is('deleted_at', null)
  if (error || !data) return []
  return (data as ShopItem[]).map((r) => ({ id: r.id, title: r.title, kind: r.kind }))
}

/**
 * Beat 2 — "Claimed local owner" badge.
 *
 * FORWARD-DEP (F035 scope note): the data this needs —
 * `member_business_jurisdictions` + `public.zip_is_proximal_to_location()` —
 * ships with F037 / S-jurisdictions and does not exist yet. Until it does,
 * there is nothing to evaluate, so the badge never renders and the surface
 * stays clean (no "not locally owned" negative space). This is the single
 * render-path seam: when the substrate lands, this resolver queries a current
 * owner's jurisdiction, runs the proximity test against the Shop's anchor
 * Location, and returns `{ label: 'Claimed local owner' }` (Tier 0) on a pass.
 */
export async function resolveLocalOwnerBadge(
  _supabase: SupabaseClient,
  _shop: { groupId: string; anchorLocationId: string | null },
): Promise<LocalOwnerBadge | null> {
  return null
}
