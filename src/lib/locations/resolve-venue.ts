// T104 — Public Venue resolver (F033 read surface, shell).
// Spec:   planning/next/scenario-F033-viewer-finds-venue-page.md
// Ticket: development/tickets/T104-venue-page-shell.md
//
// Resolves a Location for the public venue page at /p/[…place]/l/[slug].
// `locations.slug` is globally unique (migration 007), so the lookup keys off
// the slug alone — the place path is breadcrumb/URL context, not an FK (there
// is no locations.place_id at b1). RLS (locations_public_read) is the
// visibility gate: a private or soft-deleted Location yields no row → null →
// 404 to non-owners, mirroring the Group dispatch (resolveShop, T074).
//
// Supabase-client-shaped (not pg-shaped) so it runs from the server component
// with the session-bound client.

import type { SupabaseClient } from '@supabase/supabase-js'

export type LocationKind = 'permanent' | 'recurring_temporary' | 'area'

export interface ResolvedVenue {
  locationId: string
  slug: string
  label: string
  kind: LocationKind
  description: string | null
  /** Always null at b1 — locations has no image column (hero space collapses). */
  heroImageUrl: string | null
  /** From location_permanent.street_address; null for non-permanent kinds. */
  streetAddress: string | null
  /** From location_permanent.accessibility_notes; null when absent. */
  accessibilityNotes: string | null
}

/**
 * Split a place catch-all slug array at the `/l/` marker.
 * `['ca','sacramento','oak-park','l','drakes']`
 *   → { placeSegments: ['ca','sacramento','oak-park'], locationSlug: 'drakes' }
 * Returns null when there is no location segment (bare place path / Group path)
 * or when the `l` marker has no slug after it.
 */
export function splitLocationSlug(
  segments: string[],
): { placeSegments: string[]; locationSlug: string } | null {
  const lIndex = segments.indexOf('l')
  if (lIndex === -1) return null
  const locationSlug = segments[lIndex + 1]
  if (!locationSlug) return null
  return { placeSegments: segments.slice(0, lIndex), locationSlug }
}

// PostgREST returns an embedded relation as either an array or a single object
// depending on cardinality hints. Normalise to the first row.
function firstEmbed<T>(embed: T[] | T | null | undefined): T | null {
  if (Array.isArray(embed)) return embed[0] ?? null
  return embed ?? null
}

interface LocationRow {
  id: string
  slug: string
  label: string
  kind: string
  description: string | null
  location_permanent:
    | { street_address: string | null; accessibility_notes: string | null }[]
    | { street_address: string | null; accessibility_notes: string | null }
    | null
}

export async function resolveVenue(
  supabase: SupabaseClient,
  slug: string,
): Promise<ResolvedVenue | null> {
  const { data, error } = await supabase
    .from('locations')
    .select(
      'id, slug, label, kind, description, ' +
        'location_permanent(street_address, accessibility_notes)',
    )
    .eq('slug', slug)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const row = data as unknown as LocationRow
  const permanent = firstEmbed(row.location_permanent)

  return {
    locationId: row.id,
    slug: row.slug,
    label: row.label,
    kind: row.kind as LocationKind,
    description: row.description ?? null,
    heroImageUrl: null,
    streetAddress: permanent?.street_address ?? null,
    accessibilityNotes: permanent?.accessibility_notes ?? null,
  }
}

type FromClient = Pick<SupabaseClient, 'from'>

/**
 * The current viewer's active saved-search id for this venue, or null.
 *
 * member_saved_searches is owner-only RLS (migration 019), so this returns a row
 * only for the viewer's own follow — no member_id filter needed. Server-rendered
 * into <FollowVenueButton> so the button mounts in the correct Follow/Following
 * state with no client fetch. Returns null for anon (RLS yields no rows).
 */
export async function existingVenueSavedSearchId(
  supabase: FromClient,
  locationId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('member_saved_searches')
    .select('id')
    .eq('location_id', locationId)
    .is('removed_at', null)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return (data as { id: string }).id
}

type RpcClient = Pick<SupabaseClient, 'rpc'>

/**
 * Distance (metres) from the viewer's primary-home Place centroid to the venue.
 *
 * Reads via the venue_distance_meters RPC (migration 032), a security-invoker
 * function: it runs as the viewer, so member_place_interests owner-only RLS lets
 * an auth'd Member read their own primary_home, and an anon viewer (auth.uid()
 * null) gets no row → null. Null-safe: any RPC error or null result → null, so
 * the header simply omits the distance line.
 */
export async function venueDistanceMeters(
  supabase: RpcClient,
  locationId: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('venue_distance_meters', {
    p_location_id: locationId,
  })
  if (error || data == null) return null
  return Number(data)
}
