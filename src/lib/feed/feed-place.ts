// T088 — Feed Place resolution (F030).
//
// Precedence: an authenticated Member's primary_home → an explicit scope-picker
// slug → the launch-locality default. b1 IP geolocation is DEFERRED — the
// launch default stands in for the IP-geolocated locality. Returns null only
// when even the default row is missing (caller shows a picker-first state per
// the IP-fail edge case).

import type { SupabaseClient } from '@supabase/supabase-js'

/** b1 launch locality. Stands in for IP geolocation until that lands. */
export const LAUNCH_PLACE_SLUG = 'sacramento'

export interface FeedPlace {
  placeId: string
  displayName: string
  slug: string
}

type FromClient = Pick<SupabaseClient, 'from'>

async function byId(supabase: FromClient, id: string): Promise<FeedPlace | null> {
  const { data, error } = await supabase
    .from('places')
    .select('id, display_name, slug')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const p = data as { id: string; display_name: string; slug: string }
  return { placeId: p.id, displayName: p.display_name, slug: p.slug }
}

async function bySlug(supabase: FromClient, slug: string): Promise<FeedPlace | null> {
  // A neighborhood/city slug can collide with a county slug (e.g. 'sacramento');
  // prefer the most specific (neighborhood > city > county) via kind ordering.
  const { data, error } = await supabase
    .from('places')
    .select('id, display_name, slug, kind')
    .eq('slug', slug)
    .is('deleted_at', null)
  if (error) throw error
  const rows = (data ?? []) as { id: string; display_name: string; slug: string; kind: string }[]
  if (rows.length === 0) return null
  const rank: Record<string, number> = { neighborhood: 0, city: 1, county: 2, state: 3, region: 4 }
  rows.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9))
  const p = rows[0]
  return { placeId: p.id, displayName: p.display_name, slug: p.slug }
}

export async function resolveFeedPlace(
  supabase: FromClient,
  opts: { memberPlaceId?: string | null; requestedSlug?: string | null },
): Promise<FeedPlace | null> {
  if (opts.memberPlaceId) {
    const p = await byId(supabase, opts.memberPlaceId)
    if (p) return p
  }
  if (opts.requestedSlug) {
    const p = await bySlug(supabase, opts.requestedSlug)
    if (p) return p
  }
  return bySlug(supabase, LAUNCH_PLACE_SLUG)
}
