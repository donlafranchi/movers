// T059 — Reverse-geocoder (lat/lon → place_id)
//
// Spec: product/systems/places.md § Data model implications → Reverse-geocoder contract.
// ADR-20 § Anchoring rules + § Costs.
//
// Two-layer resolution:
//   1. Polygon containment via public.place_for_coords (SECURITY DEFINER).
//      Most-specific match wins (neighborhood > city > county > state).
//   2. Mapbox reverse-geocode fallback when no polygon covers the point.
//      The fallback maps the returned admin levels onto places rows by
//      slug-of-display-name matching against the immediate parent. Brittle
//      by design — name matching is heuristic — and only fires when the
//      polygon library is incomplete.
//
// Cache: in-memory LRU (1k entries, 24h TTL) keyed by 4-decimal-place
// coordinates (~10m precision — sufficient for place granularity). Pre-
// quantizing the key collapses near-duplicate queries onto a single cache
// entry.

import type { PoolClient } from 'pg'

export type PlaceKind = 'region' | 'state' | 'county' | 'city' | 'neighborhood'

export interface ReverseGeocodeResult {
  placeId: string
  resolvedKind: PlaceKind
  source: 'polygon' | 'mapbox'
}

interface CacheEntry {
  result: ReverseGeocodeResult | null
  expiresAt: number
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 1000

// Module-level LRU — Map preserves insertion order, so the oldest key is
// always the first one. Eviction is bounded; no external dep needed.
const cache = new Map<string, CacheEntry>()

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`
}

function cacheGet(key: string): CacheEntry | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  // Refresh LRU position.
  cache.delete(key)
  cache.set(key, entry)
  return entry
}

function cacheSet(key: string, result: ReverseGeocodeResult | null): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

// Test-only — let the eval reset cache state between cases without
// shipping a public clear() in the surface.
export function _resetReverseGeocodeCacheForTests(): void {
  cache.clear()
}

// ----------------------------------------------------------------------------
// Layer 1: Postgres polygon containment.
// ----------------------------------------------------------------------------

async function resolveViaPolygon(
  client: PoolClient,
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResult | null> {
  const res = await client.query<{ place_id: string; kind: PlaceKind }>(
    `select place_id, kind from public.place_for_coords($1, $2)`,
    [lat, lon],
  )
  if (res.rowCount === 0) return null
  const row = res.rows[0]!
  return {
    placeId: row.place_id,
    resolvedKind: row.kind,
    source: 'polygon',
  }
}

// ----------------------------------------------------------------------------
// Layer 2: Mapbox fallback.
//
// Calls Mapbox Geocoding API with the project's MAPBOX_GEOCODING_TOKEN
// (server-only — DO NOT use NEXT_PUBLIC_MAPBOX_TOKEN here; that's
// browser-exposed and would expose the geocode billing surface).
//
// Maps the highest-specificity returned admin level to a places row by:
//   - For each Mapbox feature in priority order (neighborhood, locality,
//     place, region):
//       a. Slugify its `text` field (lowercase, hyphenated).
//       b. Match a places row whose slug = that slugified text. Restrict
//          to non-deleted rows. Tie-breaks not handled at b1 — if multiple
//          rows match, the first wins; the parent_id filter below dodges
//          most ambiguity by anchoring to the next-coarser feature's parent.
// ----------------------------------------------------------------------------

interface MapboxFeature {
  id: string
  place_type?: string[]
  text?: string
  // additional fields exist in the API response; only `text` and `place_type`
  // are consumed.
}

interface MapboxResponse {
  features?: MapboxFeature[]
}

// Mapbox specificity, smallest first.
// Mapbox `district` is the admin-level-2 equivalent — U.S. counties,
// Louisiana parishes, Alaska boroughs. Maps to our `county` kind per
// ADR-0022's county-replaces-MSA decision.
const MAPBOX_SPECIFICITY = ['neighborhood', 'locality', 'place', 'district', 'region'] as const

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    // Strip "Mark, Nonspacing" code points (Unicode property \p{Mn}) —
    // after NFD normalization "café" becomes 'c','a','f','e','́' and
    // \p{Mn} matches the combining diacritic without source-file legibility
    // hazards from literal codepoints in a character class.
    .replace(/\p{Mn}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function fetchMapboxFeatures(
  lat: number,
  lon: number,
  token: string,
  fetchImpl: typeof fetch,
): Promise<MapboxFeature[]> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json` +
    `?types=neighborhood,locality,place,district,region&access_token=${encodeURIComponent(token)}`
  const res = await fetchImpl(url)
  if (!res.ok) return []
  const body = (await res.json()) as MapboxResponse
  return body.features ?? []
}

async function resolveViaMapbox(
  client: PoolClient,
  lat: number,
  lon: number,
  opts: { token: string; fetchImpl: typeof fetch },
): Promise<ReverseGeocodeResult | null> {
  let features: MapboxFeature[]
  try {
    features = await fetchMapboxFeatures(lat, lon, opts.token, opts.fetchImpl)
  } catch {
    // Network / parse failure — return null rather than throw. Caller
    // decides the disposition.
    return null
  }
  if (features.length === 0) return null

  // Walk specificity smallest-first, match the first slug we can pair to a
  // places row.
  for (const level of MAPBOX_SPECIFICITY) {
    const feature = features.find((f) => f.place_type?.includes(level))
    if (!feature?.text) continue
    const slug = slugify(feature.text)
    if (!slug) continue
    const res = await client.query<{ id: string; kind: PlaceKind }>(
      `select id, kind from public.places
       where slug = $1 and deleted_at is null
       order by case kind
         when 'neighborhood' then 1
         when 'city' then 2
         when 'county' then 3
         when 'state' then 4
         when 'region' then 5
         else 6
       end asc
       limit 1`,
      [slug],
    )
    if (res.rowCount && res.rowCount > 0) {
      const row = res.rows[0]!
      return { placeId: row.id, resolvedKind: row.kind, source: 'mapbox' }
    }
  }
  return null
}

// ----------------------------------------------------------------------------
// Public entry point.
// ----------------------------------------------------------------------------

export interface ReverseGeocodeOptions {
  /** Override Mapbox token; defaults to MAPBOX_GEOCODING_TOKEN env var. */
  mapboxToken?: string
  /** Override fetch (for tests); defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Skip the cache (for tests). */
  bypassCache?: boolean
}

export async function reverseGeocodeToPlace(
  client: PoolClient,
  lat: number,
  lon: number,
  opts: ReverseGeocodeOptions = {},
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('reverseGeocodeToPlace: lat and lon must be finite numbers')
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('reverseGeocodeToPlace: lat/lon out of WGS84 range')
  }

  const key = cacheKey(lat, lon)
  if (!opts.bypassCache) {
    const hit = cacheGet(key)
    if (hit) return hit.result
  }

  // Layer 1 — polygon containment.
  const polygon = await resolveViaPolygon(client, lat, lon)
  if (polygon) {
    cacheSet(key, polygon)
    return polygon
  }

  // Layer 2 — Mapbox fallback. Skip silently if no token configured.
  const token = opts.mapboxToken ?? process.env.MAPBOX_GEOCODING_TOKEN
  if (!token) {
    cacheSet(key, null)
    return null
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const mapbox = await resolveViaMapbox(client, lat, lon, { token, fetchImpl })
  cacheSet(key, mapbox)
  return mapbox
}
