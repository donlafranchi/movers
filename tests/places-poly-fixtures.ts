// T076 — shared fixtures/parsers for the polygon-seed + reverse-geocode
// unit tests. NOT a *.test.ts file, so vitest does not collect it as a suite.
//
// The vitest harness has no live Postgres (DB-touching containment lives in
// Playwright evals). These helpers parse the WKT MULTIPOLYGON literals out of
// the migration and run point-in-polygon / smallest-covering-polygon in pure
// JS — genuinely verifying the seed geometry, not just matching text.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const MIGRATION_FILE = '026_places_polygon_centroid_seed.sql'

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

export const readMigration = (): string =>
  readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8')

export interface SeedRow {
  slug: string
  kind: string
  parentSlug: string | null
  parentKind: string | null
  isNew: boolean
  displayName: string
  /** Outer ring as [lon, lat] pairs (first ring of the first polygon). */
  ring: [number, number][]
}

const RING_RE = /MULTIPOLYGON\(\(\(([^)]*)\)\)\)/

function parseRing(wkt: string): [number, number][] {
  const m = wkt.match(RING_RE)
  if (!m) throw new Error(`unparseable WKT: ${wkt}`)
  return m[1]
    .split(',')
    .map((pair) => pair.trim().split(/\s+/).map(Number) as [number, number])
}

/**
 * Parse the `_t076_seed` VALUES block. Each row is on its own line:
 *   ('slug','kind',parent|null,parentKind|null,bool,'Display','MULTIPOLYGON(...)')
 */
export function parseSeedRows(sql: string = readMigration()): SeedRow[] {
  const rows: SeedRow[] = []
  for (const line of sql.split('\n')) {
    const t = line.trim()
    if (!t.startsWith("('") || !t.includes('MULTIPOLYGON')) continue
    const slug = t.match(/^\('([^']+)'/)?.[1]
    const kind = t.match(/^\('[^']+','([^']+)'/)?.[1]
    if (!slug || !kind) continue
    const parentSlug = /,'([a-z-]+)','(state|county|city)',(true|false)/.exec(t)
    const isNew = /,(true|false),'[^']*','MULTIPOLYGON/.exec(t)?.[1] === 'true'
    const displayName = t.match(/,(true|false),'([^']*)','MULTIPOLYGON/)?.[2] ?? ''
    const wkt = t.match(/'(MULTIPOLYGON\(\(\([^)]*\)\)\))'/)?.[1] ?? ''
    rows.push({
      slug,
      kind,
      parentSlug: parentSlug ? parentSlug[1] : null,
      parentKind: parentSlug ? parentSlug[2] : null,
      isNew,
      displayName,
      ring: parseRing(wkt),
    })
  }
  return rows
}

/** Ray-casting point-in-polygon on a single ring. [lon, lat]. */
export function pointInRing(
  [lon, lat]: [number, number],
  ring: [number, number][],
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

/** Shoelace area-weighted centroid of a ring. [lon, lat]. */
export function ringCentroid(ring: [number, number][]): [number, number] {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const cross = xj * yi - xi * yj
    a += cross
    cx += (xj + xi) * cross
    cy += (yj + yi) * cross
  }
  a *= 0.5
  return [cx / (6 * a), cy / (6 * a)]
}

/** Planar bounding-box area of a ring — proxy for ST_Area ordering. */
export function ringBoxArea(ring: [number, number][]): number {
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats))
}

/**
 * Mirror of place_for_coords (022): smallest-area polygon that covers the
 * point. Returns the SeedRow or null.
 */
export function reverseGeocode(
  point: [number, number],
  rows: SeedRow[] = parseSeedRows(),
): SeedRow | null {
  const hits = rows
    .filter((r) => pointInRing(point, r.ring))
    .sort((a, b) => ringBoxArea(a.ring) - ringBoxArea(b.ring))
  return hits[0] ?? null
}
