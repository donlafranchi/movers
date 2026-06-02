import { describe, it, expect } from 'vitest'
import { parseSeedRows, reverseGeocode } from './places-poly-fixtures'

// T076 — reverse-geocode spot-checks for the Sacramento-region seed.
//
// Mirrors place_for_coords (022_places_reverse_geocode.sql): the smallest-area
// polygon covering a coordinate wins (neighbourhood beats city beats county
// beats state). Run in pure JS against the WKT parsed from the migration —
// the live ST_Covers version lives in evals/phase-1/reverse-geocode.spec.ts.
//
// Points are [lon, lat] (PostGIS ST_MakePoint(lon, lat) order).

const rows = parseSeedRows()

describe('T076 — downtown coordinates resolve to the right city', () => {
  it('downtown Davis resolves to Davis (not the Yolo County fallback)', () => {
    const hit = reverseGeocode([-121.7405, 38.5449], rows)
    expect(hit?.slug).toBe('davis')
    expect(hit?.kind).toBe('city')
  })

  it('Folsom resolves to Folsom', () => {
    const hit = reverseGeocode([-121.1761, 38.6779], rows)
    expect(hit?.slug).toBe('folsom')
    expect(hit?.kind).toBe('city')
  })

  it('downtown Roseville resolves to Roseville', () => {
    const hit = reverseGeocode([-121.288, 38.7521], rows)
    expect(hit?.slug).toBe('roseville')
    expect(hit?.kind).toBe('city')
  })
})

describe('T076 — neighbourhood resolution is deterministic', () => {
  it('a point inside Oak Park (near the Curtis Park boundary) resolves to Oak Park, not Curtis Park', () => {
    const hit = reverseGeocode([-121.464, 38.546], rows)
    expect(hit?.slug).toBe('oak-park')
    expect(hit?.kind).toBe('neighborhood')
  })

  it('a point inside Curtis Park resolves to Curtis Park', () => {
    const hit = reverseGeocode([-121.483, 38.546], rows)
    expect(hit?.slug).toBe('curtis-park')
    expect(hit?.kind).toBe('neighborhood')
  })

  it('neighbourhood polygons do not overlap (each Sacramento-city point hits at most one)', () => {
    const nbhd = rows.filter((r) => r.kind === 'neighborhood')
    // Sample a grid across the Sacramento city bbox; no point may land in 2+.
    for (let lon = -121.55; lon <= -121.37; lon += 0.005) {
      for (let lat = 38.45; lat <= 38.67; lat += 0.005) {
        const hits = nbhd.filter((r) =>
          reverseGeocode([lon, lat], [r])?.slug === r.slug,
        )
        expect(hits.length).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('T076 — coverage falls through to the coarsest covering polygon', () => {
  it('a rural Placer County point (no city) resolves to Placer County', () => {
    // East of Roseville, still inside the county box, no city polygon.
    const hit = reverseGeocode([-120.8, 39.0], rows)
    expect(hit?.slug).toBe('placer')
    expect(hit?.kind).toBe('county')
  })

  it('a coordinate outside every seeded polygon resolves to null (caller falls back to Mapbox)', () => {
    // Off the California coast — outside even the state box.
    expect(reverseGeocode([-130.0, 40.0], rows)).toBeNull()
  })
})
