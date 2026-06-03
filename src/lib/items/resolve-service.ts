// T083 — Public service resolver (F040 Item page).
// Spec:   planning/now/scenario-F040-producer-lists-service.md
// Ticket: development/tickets/T083-service-item-page.md
//
// Resolves a published kind='service' Item for the public page at
//   /p/[…place]/g/[group-slug]/s/[item-slug]   (filed under a business Group)
//   /m/[handle]/s/[item-slug]                   (sold as individual)
//
// Mirrors resolve-product.ts: items has no slug column at b1, so the URL slug
// is `toSlug(title)-<first 8 chars of items.id>` and we match the trailing
// fragment. RLS (items_select_published) is the visibility gate.

import type { SupabaseClient } from '@supabase/supabase-js'
import { parseIdFragment } from './resolve-product'
import type { ItemAttribution } from './resolve-product'
import type { RateModel } from '@/components/sell/ServiceComposer'

export interface ResolvedServiceAnchor {
  label: string
}

export interface ResolvedService {
  itemId: string
  title: string
  description: string
  rateModel: RateModel
  rateCents: number | null
  /** True when a service_area_geography circle is set (drives the area section). */
  hasServiceArea: boolean
  /** Group display_name (denormalized onto items.brand_label); null when individual.
   *  Kept for generateMetadata page-title fallback; attribution drives all surfaces. */
  brandLabel: string | null
  attribution: ItemAttribution
  /** Optional anchor Location label (the service-area center). */
  anchor: ResolvedServiceAnchor | null
}

/**
 * Split a place catch-all slug array at `/g/<group>/s/<item>`.
 * Returns null for a product path (`/p/`), a bare `…/g/<group>`, or any path
 * without the trailing `/s/<item>`.
 */
export function splitServiceSlug(
  segments: string[],
): { placeSegments: string[]; groupSlug: string; itemSlug: string } | null {
  const gIndex = segments.indexOf('g')
  if (gIndex === -1) return null
  const groupSlug = segments[gIndex + 1]
  if (!groupSlug) return null
  // Inner service marker: the segment after the group slug must be 's'.
  if (segments[gIndex + 2] !== 's') return null
  const itemSlug = segments[gIndex + 3]
  if (!itemSlug) return null
  return { placeSegments: segments.slice(0, gIndex), groupSlug, itemSlug }
}

interface ServiceRow {
  id: string
  title: string
  description: string
  brand_label: string | null
  member_id: string
  item_services:
    | {
        rate_model: string
        rate_cents: number | null
        service_area_geography: string | null
      }[]
    | { rate_model: string; rate_cents: number | null; service_area_geography: string | null }
    | null
  // owner embed only present on the individual-sale path.
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

export async function resolveService(
  supabase: SupabaseClient,
  args: { groupSlug?: string; handle?: string; itemSlug: string },
): Promise<ResolvedService | null> {
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

  // T095 — Group-filed services attribute to the Group (no members embed needed);
  // individual services embed the author + read discoverability separately.
  const baseSelect =
    'id, title, description, brand_label, member_id, ' +
    'item_services(rate_model, rate_cents, service_area_geography), ' +
    'item_locations(removed_at, locations(label))'
  const select = scope.individual
    ? baseSelect + ', owner:members!member_id(handle, display_name)'
    : baseSelect

  let query = supabase
    .from('items')
    .select(select)
    .eq(scope.column, scope.value)
    .eq('kind', 'service')
    .eq('state', 'published')
    .is('deleted_at', null)
  // Individual services carry no Group filing.
  if (scope.individual) query = query.is('group_id', null)

  const { data, error } = await query
  if (error || !data) return null

  const row = (data as unknown as ServiceRow[]).find((r) => r.id.slice(0, 8) === idFrag)
  if (!row) return null

  const svc = firstEmbed(row.item_services)

  // First active (non-removed) anchor Location.
  const activeLoc = (row.item_locations ?? []).find((il) => il.removed_at === null)
  const locEmbed = activeLoc ? firstEmbed(activeLoc.locations) : null

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
    if (!row.brand_label) return null
    attribution = { kind: 'group', name: row.brand_label }
  }

  return {
    itemId: row.id,
    title: row.title,
    description: row.description,
    rateModel: (svc?.rate_model ?? 'quote') as RateModel,
    rateCents: svc?.rate_cents ?? null,
    hasServiceArea: Boolean(svc?.service_area_geography),
    brandLabel: row.brand_label,
    attribution,
    anchor: locEmbed ? { label: locEmbed.label } : null,
  }
}
