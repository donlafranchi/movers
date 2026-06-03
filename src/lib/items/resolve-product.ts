// T079 — Public product resolver (F038 Item page).
// Spec:   planning/now/scenario-F038-producer-lists-product.md
// Ticket: development/tickets/T079-product-item-page.md
//
// Resolves a published kind='product' Item for the public page at
//   /p/[…place]/g/[group-slug]/p/[item-slug]   (filed under a business Group)
//   /m/[handle]/p/[item-slug]                   (sold as individual)
//
// items has no slug column at b1 (see T079 DEVIATIONS). The composer (T078)
// builds the URL slug as `toSlug(title)-<first 8 chars of items.id>`; the
// trailing fragment is the addressing key. We resolve the owning scope
// (Group or Member), then match the row whose id starts with that fragment.
// RLS (items_select_published) is the visibility gate — drafts never resolve.
//
// Supabase-client-shaped (session-bound), same convention as resolve-shop.ts.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolvedProductPickup {
  label: string
}

/**
 * T095 — Item attribution model. Items filed under a Group attribute to the Group
 * (always public); items sold as an individual attribute to the Member with a
 * conditional link gated by is_discoverable. Selling something publicly does not
 * require the seller's personal profile to be searchable.
 */
export type ItemAttribution =
  | { kind: 'group'; name: string }
  | { kind: 'member'; handle: string; displayName: string; isDiscoverable: boolean }

export interface ResolvedProduct {
  itemId: string
  title: string
  description: string
  priceCents: number | null
  priceUnit: string | null
  photoUrls: string[]
  /** Group display_name (denormalized onto items.brand_label); null when sold as individual.
   *  Kept for generateMetadata page-title fallback; attribution drives all surfaces. */
  brandLabel: string | null
  attribution: ItemAttribution
  pickup: ResolvedProductPickup | null
  /** F039 — null until a Locally Made claim lands; gates the badge. */
  madeAtPlaceId: string | null
}

/**
 * Split a place catch-all slug array at `/g/<group>/p/<item>`.
 * `['ca','sacramento','oak-park','g','oak-park-sourdough-a1','p','loaf-deadbeef']`
 *   → { placeSegments: ['ca','sacramento','oak-park'], groupSlug: 'oak-park-sourdough-a1', itemSlug: 'loaf-deadbeef' }
 * Returns null for a bare `…/g/<group>` (that stays the Shop page) or any
 * path without the trailing `/p/<item>`.
 */
export function splitItemSlug(
  segments: string[],
): { placeSegments: string[]; groupSlug: string; itemSlug: string } | null {
  const gIndex = segments.indexOf('g')
  if (gIndex === -1) return null
  const groupSlug = segments[gIndex + 1]
  if (!groupSlug) return null
  // Inner product marker: the segment after the group slug must be 'p'.
  if (segments[gIndex + 2] !== 'p') return null
  const itemSlug = segments[gIndex + 3]
  if (!itemSlug) return null
  return { placeSegments: segments.slice(0, gIndex), groupSlug, itemSlug }
}

/** The addressing key is the slug's trailing hyphen segment (first 8 chars of
 *  the item id). Returns '' for a slug with no hyphen (won't match anything). */
export function parseIdFragment(itemSlug: string): string {
  const idx = itemSlug.lastIndexOf('-')
  return idx === -1 ? '' : itemSlug.slice(idx + 1)
}

interface ProductRow {
  id: string
  title: string
  description: string
  brand_label: string | null
  made_at_place_id: string | null
  member_id: string
  item_products:
    | { price_cents: number | null; price_unit: string | null; photo_urls: string[] }[]
    | { price_cents: number | null; price_unit: string | null; photo_urls: string[] }
    | null
  // owner embed is only present on the individual-sale path; null otherwise (selected away).
  owner:
    | { handle: string; display_name: string }[]
    | { handle: string; display_name: string }
    | null
  item_locations:
    | { removed_at: string | null; locations: { label: string }[] | { label: string } | null }[]
    | null
}

function firstEmbed<T>(embed: T[] | T | null | undefined): T | null {
  if (Array.isArray(embed)) return embed[0] ?? null
  return embed ?? null
}

export async function resolveProduct(
  supabase: SupabaseClient,
  args: { groupSlug?: string; handle?: string; itemSlug: string },
): Promise<ResolvedProduct | null> {
  const idFrag = parseIdFragment(args.itemSlug)
  if (!idFrag) return null

  // Resolve the owning scope to a filter on items.
  let scope: { column: 'group_id' | 'member_id'; value: string; individual: boolean } | null =
    null
  if (args.groupSlug) {
    const { data: g } = await supabase
      .from('groups')
      .select('id')
      .eq('slug', args.groupSlug)
      .eq('kind', 'business')
      .limit(1)
      .maybeSingle()
    if (!g) return null
    scope = { column: 'group_id', value: (g as { id: string }).id, individual: false }
  } else if (args.handle) {
    const { data: m } = await supabase
      .from('members')
      .select('id')
      .eq('handle', args.handle)
      .limit(1)
      .maybeSingle()
    if (!m) return null
    scope = { column: 'member_id', value: (m as { id: string }).id, individual: true }
  }
  if (!scope) return null

  // T095 — Attribution model. Group-filed items attribute to the Group (always
  // public); the members embed is dropped on that path so item pages no longer
  // require a base-table read of members. Individual items still embed the
  // author's member row for the attribution name + handle, plus a separate read
  // of member_public_discoverability for the conditional link.
  const baseSelect =
    'id, title, description, brand_label, made_at_place_id, member_id, ' +
    'item_products(price_cents, price_unit, photo_urls), ' +
    'item_locations(removed_at, locations(label))'
  const select = scope.individual
    ? baseSelect + ', owner:members!member_id(handle, display_name)'
    : baseSelect

  let query = supabase
    .from('items')
    .select(select)
    .eq(scope.column, scope.value)
    .eq('kind', 'product')
    .eq('state', 'published')
    .is('deleted_at', null)
  // Individual products carry no Group filing.
  if (scope.individual) query = query.is('group_id', null)

  const { data, error } = await query
  if (error || !data) return null

  const row = (data as unknown as ProductRow[]).find((r) => r.id.slice(0, 8) === idFrag)
  if (!row) return null

  const prod = firstEmbed(row.item_products)

  // First active (non-removed) pickup Location.
  const activeLoc = (row.item_locations ?? []).find((il) => il.removed_at === null)
  const locEmbed = activeLoc ? firstEmbed(activeLoc.locations) : null

  // Build attribution by scope.
  let attribution: ItemAttribution
  if (scope.individual) {
    const owner = firstEmbed(row.owner)
    if (!owner) return null
    const { data: disc } = await supabase
      .from('member_public_discoverability')
      .select('is_discoverable')
      .eq('member_id', row.member_id)
      .maybeSingle()
    attribution = {
      kind: 'member',
      handle: owner.handle,
      displayName: owner.display_name,
      isDiscoverable: (disc as { is_discoverable: boolean } | null)?.is_discoverable ?? false,
    }
  } else {
    // Group-filed: brand_label is the denormalized Group display_name.
    if (!row.brand_label) return null
    attribution = { kind: 'group', name: row.brand_label }
  }

  return {
    itemId: row.id,
    title: row.title,
    description: row.description,
    priceCents: prod?.price_cents ?? null,
    priceUnit: prod?.price_unit ?? null,
    photoUrls: prod?.photo_urls ?? [],
    brandLabel: row.brand_label,
    attribution,
    pickup: locEmbed ? { label: locEmbed.label } : null,
    madeAtPlaceId: row.made_at_place_id,
  }
}
