import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MIGRATION_FILE,
  readMigration,
  parseSeedRows,
  pointInRing,
  ringCentroid,
} from './places-poly-fixtures'

// T076 — Sacramento-region polygon + centroid seed.
// Source ticket: development/tickets/T076-places-polygon-centroid-seed.md.
// Spec: product/systems/places.md § T1 + § Reverse-geocoder.
// D3 (Ratified 2026-06-02): metros live in metro_polygons overlay, NOT the
// place tree — this seed adds no kind='region'/metro row.
//
// vitest has no live Postgres (DB containment lives in Playwright evals), so
// these assertions split into (a) static SQL-shape checks and (b) pure-JS
// geometry checks against the WKT parsed from the migration.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')
const stripComments = (sql: string) =>
  sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('T076 — migration exists', () => {
  it('lists 026_places_polygon_centroid_seed.sql in the migrations dir', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    expect(files).toContain(MIGRATION_FILE)
  })
})

describe('T076 — centroid column + index (schema)', () => {
  const sql = stripComments(readMigration())

  it('adds centroid geography(Point, 4326)', () => {
    expect(sql).toMatch(/add column[\s\S]*?centroid\s+geography\(Point,\s*4326\)/i)
  })

  it('creates idx_places_centroid GiST index with the NOT NULL + not-deleted predicate', () => {
    expect(sql).toMatch(
      /create index[\s\S]*?idx_places_centroid[\s\S]*?using\s+gist\s*\(\s*centroid\s*\)[\s\S]*?where\s+centroid\s+is\s+not\s+null\s+and\s+deleted_at\s+is\s+null/i,
    )
  })
})

describe('T076 — D3 invariant: no metro/region row', () => {
  const sql = stripComments(readMigration())

  it('does not insert any kind=region row', () => {
    expect(sql).not.toMatch(/'region'/)
  })

  it("does not seed a Sacramento MSA / metro row", () => {
    expect(sql).not.toMatch(/\bmsa\b/i)
    expect(sql).not.toMatch(/metro_polygons/i) // overlay table is S-metro's, not seeded here
  })
})

describe('T076 — the four new rows (3 cities; Placer pre-exists)', () => {
  const rows = parseSeedRows()
  const find = (slug: string, kind: string) =>
    rows.find((r) => r.slug === slug && r.kind === kind)

  it('inserts Davis as a city under Yolo County', () => {
    const d = find('davis', 'city')
    expect(d?.isNew).toBe(true)
    expect(d?.parentSlug).toBe('yolo')
    expect(d?.parentKind).toBe('county')
  })

  it('inserts Roseville as a city under Placer County', () => {
    const r = find('roseville', 'city')
    expect(r?.isNew).toBe(true)
    expect(r?.parentSlug).toBe('placer')
    expect(r?.parentKind).toBe('county')
  })

  it('inserts Folsom as a city under Sacramento County (not the like-named city)', () => {
    const f = find('folsom', 'city')
    expect(f?.isNew).toBe(true)
    expect(f?.parentSlug).toBe('sacramento')
    expect(f?.parentKind).toBe('county')
  })

  it('backfills Placer County (pre-seeded by T058) rather than inserting a duplicate', () => {
    const p = find('placer', 'county')
    expect(p).toBeDefined()
    expect(p?.isNew).toBe(false)
  })
})

describe('T076 — every AC-named row has a polygon whose centroid lies inside it', () => {
  const rows = parseSeedRows()
  const named = [
    'ca', 'sacramento', 'yolo', 'placer', 'west-sacramento', 'davis',
    'roseville', 'folsom', 'oak-park', 'curtis-park', 'east-sacramento',
    'midtown', 'land-park',
  ]

  it('covers all 14 touched rows', () => {
    expect(rows.length).toBe(14)
  })

  for (const slug of named) {
    it(`${slug}: centroid is contained by its polygon`, () => {
      const matches = rows.filter((r) => r.slug === slug)
      expect(matches.length).toBeGreaterThan(0)
      for (const r of matches) {
        const c = ringCentroid(r.ring)
        expect(pointInRing(c, r.ring)).toBe(true)
      }
    })
  }
})

describe('T076 — parent-walk geometry: cities nest inside their counties', () => {
  const rows = parseSeedRows()
  const ring = (slug: string, kind: string) =>
    rows.find((r) => r.slug === slug && r.kind === kind)!.ring
  const bbox = (r: [number, number][]) => ({
    minLon: Math.min(...r.map((p) => p[0])), maxLon: Math.max(...r.map((p) => p[0])),
    minLat: Math.min(...r.map((p) => p[1])), maxLat: Math.max(...r.map((p) => p[1])),
  })
  // Rectangles: child nests in parent iff its bbox is inside the parent bbox.
  const within = (child: [number, number][], parent: [number, number][]) => {
    const c = bbox(child); const p = bbox(parent)
    return c.minLon >= p.minLon && c.maxLon <= p.maxLon &&
           c.minLat >= p.minLat && c.maxLat <= p.maxLat
  }

  it('Davis ⊂ Yolo County', () => {
    expect(within(ring('davis', 'city'), ring('yolo', 'county'))).toBe(true)
  })
  it('Roseville ⊂ Placer County', () => {
    expect(within(ring('roseville', 'city'), ring('placer', 'county'))).toBe(true)
  })
  it('Folsom ⊂ Sacramento County', () => {
    expect(within(ring('folsom', 'city'), ring('sacramento', 'county'))).toBe(true)
  })
  it('all five neighbourhoods ⊂ Sacramento City', () => {
    const city = ring('sacramento', 'city')
    for (const n of ['oak-park', 'curtis-park', 'east-sacramento', 'midtown', 'land-park']) {
      expect(within(ring(n, 'neighborhood'), city), `${n} must nest in Sacramento city`).toBe(true)
    }
  })
})

describe('T076 — centroid computation + concave fallback (SQL)', () => {
  const sql = stripComments(readMigration())

  it('computes centroid via ST_Centroid', () => {
    expect(sql).toMatch(/ST_Centroid\s*\(/i)
  })

  it('falls back to ST_PointOnSurface when the centroid escapes the polygon', () => {
    expect(sql).toMatch(/ST_Contains\s*\([\s\S]*?ST_PointOnSurface\s*\(/i)
  })

  it('records the substitution in metadata.centroid_method', () => {
    expect(sql).toMatch(/centroid_method/i)
  })
})

describe('T076 — place_events: one per row, single correlation_id', () => {
  const sql = stripComments(readMigration())

  it('rotates partitions before inserting events', () => {
    expect(sql).toMatch(/rotate_place_events_partitions\(\)/i)
  })

  it('inserts place.created for new rows and place.updated for backfills', () => {
    expect(sql).toMatch(/case when s\.is_new then 'place\.created' else 'place\.updated' end/i)
  })

  it('carries a single correlation_id across the batch', () => {
    const ids = [...sql.matchAll(/'correlation_id',\s*'([0-9a-f-]+)'/gi)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(1)
  })

  it('acts as the system Member', () => {
    expect(sql).toMatch(/00000000-0000-0000-0000-000000000001/)
  })
})
