// T060 — Place-path resolver.
//
// Spec: product/systems/places.md § URL-prefix derivation; ADR-20 § URL hierarchy;
//       ADR-0022 § Trade-offs ("URL hierarchy being skippable — a city can be
//       addressed without naming its county where that reads better").
//
// URL convention per ADR-0022:
//   - State slugs use 2-letter USPS codes (`ca`, not `california`).
//   - Counties are skipped in URL paths when a city of the same slug exists
//     under the state. `/p/ca/sacramento/oak-park` resolves city Sacramento
//     (under Sacramento County), not the county. The county tier exists in
//     the data — it is just transparent in URLs because most navigation
//     happens at the city/neighborhood granularity.
//   - A county appears in a URL only when no city of that slug exists
//     under the state (e.g., `/p/ca/yolo` resolves Yolo County because
//     no city `yolo` exists).
//
// Resolution algorithm:
//   - segments[0] must match a row with parent_id IS NULL  (top-level: a
//     country root, or a state when country is reserved).
//   - segments[i] for i > 0 chooses the most-specific user-facing match:
//       1. A city under the same state (skips county tier).
//       2. A direct child of the previous row whose kind is NOT 'county'
//          (neighborhoods, regions, future country-rows).
//       3. A direct child whose kind IS 'county' (URL falls through to
//          county-level when no city matches).
//   - The walk halts on first miss → null.
//
// Returns the innermost place + its URL-form ancestor chain (excluding
// self). Because the URL skips counties, the ancestors array also skips
// counties — the chain reflects what the URL actually addresses, not the
// full parent_id walk.

import type { SupabaseClient } from '@supabase/supabase-js'

export type PlaceKind = 'region' | 'state' | 'county' | 'city' | 'neighborhood'

export interface PlaceRow {
  id: string
  parent_id: string | null
  ancestor_state_id: string | null
  slug: string
  display_name: string
  kind: PlaceKind
}

export interface ResolvedPath {
  place: PlaceRow
  ancestors: PlaceRow[] // outermost first, innermost-but-not-self last
}

const SELECT_COLS = 'id, parent_id, ancestor_state_id, slug, display_name, kind'

async function resolveRoot(
  supabase: SupabaseClient,
  slug: string,
): Promise<PlaceRow | null> {
  const { data, error } = await supabase
    .from('places')
    .select(SELECT_COLS)
    .eq('slug', slug)
    .is('parent_id', null)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as PlaceRow
}

async function resolveCityUnderState(
  supabase: SupabaseClient,
  stateId: string,
  slug: string,
): Promise<PlaceRow | null> {
  const { data, error } = await supabase
    .from('places')
    .select(SELECT_COLS)
    .eq('slug', slug)
    .eq('kind', 'city')
    .eq('ancestor_state_id', stateId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as PlaceRow
}

async function resolveDirectChild(
  supabase: SupabaseClient,
  parentId: string,
  slug: string,
  excludeKind: PlaceKind | null,
): Promise<PlaceRow | null> {
  let builder = supabase
    .from('places')
    .select(SELECT_COLS)
    .eq('slug', slug)
    .eq('parent_id', parentId)
    .is('deleted_at', null)
  if (excludeKind) builder = builder.neq('kind', excludeKind)
  const { data, error } = await builder.limit(1).maybeSingle()
  if (error || !data) return null
  return data as PlaceRow
}

async function resolveCountyChild(
  supabase: SupabaseClient,
  parentId: string,
  slug: string,
): Promise<PlaceRow | null> {
  const { data, error } = await supabase
    .from('places')
    .select(SELECT_COLS)
    .eq('slug', slug)
    .eq('parent_id', parentId)
    .eq('kind', 'county')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data as PlaceRow
}

export async function resolvePlacePath(
  supabase: SupabaseClient,
  segments: string[],
): Promise<ResolvedPath | null> {
  if (segments.length === 0) return null

  const chain: PlaceRow[] = []

  // Segment 0 — must be a NULL-parent root (state or future country).
  const head = segments[0]!
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(head)) return null
  const root = await resolveRoot(supabase, head)
  if (!root) return null
  chain.push(root)

  // Segments 1..N — walk with county-skip semantics.
  for (let i = 1; i < segments.length; i += 1) {
    const slug = segments[i]!
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) return null
    const prev = chain[chain.length - 1]!

    let next: PlaceRow | null = null

    // County-skip is only relevant when stepping out of a state-kind row;
    // below the state, the hierarchy is plain parent_id chaining.
    if (prev.kind === 'state') {
      // (a) prefer a city under this state.
      next = await resolveCityUnderState(supabase, prev.id, slug)
      // (b) else any direct child that is NOT a county (region, future shapes).
      if (!next) {
        next = await resolveDirectChild(supabase, prev.id, slug, 'county')
      }
      // (c) else fall through to a direct county child (county is URL-
      //     addressable only when no city of that slug exists).
      if (!next) {
        next = await resolveCountyChild(supabase, prev.id, slug)
      }
    } else {
      // Below the state level — direct parent_id walk. No county-skipping
      // here because URLs that have already chosen a city/region anchor
      // don't traverse further counties.
      next = await resolveDirectChild(supabase, prev.id, slug, null)
    }

    if (!next) return null
    chain.push(next)
  }

  const place = chain[chain.length - 1]!
  const ancestors = chain.slice(0, -1)
  return { place, ancestors }
}

// TODO(b1.1): redirect middleware for moved resources lives at this layer.
// See places.md § URL-history (deferred to T2). When *_url_history tables
// land, the catch-all route checks them on 404 before falling through.
