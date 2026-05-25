import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  reverseGeocodeToPlace,
  _resetReverseGeocodeCacheForTests,
} from '../src/lib/places/reverse-geocode'

// T059 — unit tests for the reverse-geocoder TS module.
// DB-touching containment tests live in evals/phase-1/reverse-geocode.spec.ts.

function makeMockClient(queryImpl: (sql: string, params: unknown[]) => Promise<unknown>) {
  return {
    query: vi.fn(
      async (sql: string, params: unknown[]) => (await queryImpl(sql, params)) as never,
    ),
  } as unknown as Parameters<typeof reverseGeocodeToPlace>[0]
}

describe('T059 — reverseGeocodeToPlace input validation', () => {
  beforeEach(() => _resetReverseGeocodeCacheForTests())

  it('throws on non-finite lat/lon', async () => {
    const client = makeMockClient(async () => ({ rowCount: 0, rows: [] }))
    await expect(reverseGeocodeToPlace(client, Number.NaN, 0)).rejects.toThrow(/finite/)
    await expect(reverseGeocodeToPlace(client, 0, Infinity)).rejects.toThrow(/finite/)
  })

  it('throws on out-of-range coordinates', async () => {
    const client = makeMockClient(async () => ({ rowCount: 0, rows: [] }))
    await expect(reverseGeocodeToPlace(client, 91, 0)).rejects.toThrow(/range/)
    await expect(reverseGeocodeToPlace(client, 0, -181)).rejects.toThrow(/range/)
  })
})

describe('T059 — polygon layer (Layer 1)', () => {
  beforeEach(() => _resetReverseGeocodeCacheForTests())

  it('returns the polygon hit when place_for_coords yields a row', async () => {
    const client = makeMockClient(async (sql) => {
      if (sql.includes('place_for_coords')) {
        return {
          rowCount: 1,
          rows: [{ place_id: 'oak-park-uuid', kind: 'neighborhood' }],
        }
      }
      return { rowCount: 0, rows: [] }
    })
    const result = await reverseGeocodeToPlace(client, 38.55, -121.48)
    expect(result).toEqual({
      placeId: 'oak-park-uuid',
      resolvedKind: 'neighborhood',
      source: 'polygon',
    })
  })

  it('skips Mapbox when the polygon path resolves (no fetch call)', async () => {
    const fetchImpl = vi.fn()
    const client = makeMockClient(async () => ({
      rowCount: 1,
      rows: [{ place_id: 'p1', kind: 'city' }],
    }))
    await reverseGeocodeToPlace(client, 38.58, -121.49, {
      mapboxToken: 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('T059 — Mapbox fallback (Layer 2)', () => {
  beforeEach(() => _resetReverseGeocodeCacheForTests())

  it('resolves a Mapbox neighborhood feature to a places row by slug match', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            features: [
              {
                id: 'f1',
                place_type: ['neighborhood'],
                text: 'Oak Park',
              },
              { id: 'f2', place_type: ['place'], text: 'Sacramento' },
            ],
          }),
          { status: 200 },
        ),
    )
    const client = makeMockClient(async (sql, params) => {
      if (sql.includes('place_for_coords')) return { rowCount: 0, rows: [] }
      if (sql.includes('public.places') && params[0] === 'oak-park') {
        return { rowCount: 1, rows: [{ id: 'oak-park-uuid', kind: 'neighborhood' }] }
      }
      return { rowCount: 0, rows: [] }
    })
    const result = await reverseGeocodeToPlace(client, 38.55, -121.48, {
      mapboxToken: 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toEqual({
      placeId: 'oak-park-uuid',
      resolvedKind: 'neighborhood',
      source: 'mapbox',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns null gracefully when Mapbox returns 500', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('Internal Error', { status: 500 }),
    )
    const client = makeMockClient(async () => ({ rowCount: 0, rows: [] }))
    const result = await reverseGeocodeToPlace(client, 38.55, -121.48, {
      mapboxToken: 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toBeNull()
  })

  it('returns null gracefully when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const client = makeMockClient(async () => ({ rowCount: 0, rows: [] }))
    const result = await reverseGeocodeToPlace(client, 38.55, -121.48, {
      mapboxToken: 'test-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toBeNull()
  })

  it('skips Mapbox entirely when no token is configured', async () => {
    const prior = process.env.MAPBOX_GEOCODING_TOKEN
    delete process.env.MAPBOX_GEOCODING_TOKEN
    const fetchImpl = vi.fn()
    const client = makeMockClient(async () => ({ rowCount: 0, rows: [] }))
    try {
      const result = await reverseGeocodeToPlace(client, 38.55, -121.48, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      })
      expect(result).toBeNull()
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      if (prior !== undefined) process.env.MAPBOX_GEOCODING_TOKEN = prior
    }
  })
})

describe('T059 — cache behaviour', () => {
  beforeEach(() => _resetReverseGeocodeCacheForTests())

  it('serves the second call from cache without re-querying', async () => {
    const client = makeMockClient(async () => ({
      rowCount: 1,
      rows: [{ place_id: 'cached', kind: 'city' }],
    }))
    const queryFn = (client as unknown as { query: ReturnType<typeof vi.fn> }).query

    await reverseGeocodeToPlace(client, 38.5816, -121.4944)
    await reverseGeocodeToPlace(client, 38.5816, -121.4944)

    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('quantizes coordinates to 4 decimal places (~10m precision)', async () => {
    const client = makeMockClient(async () => ({
      rowCount: 1,
      rows: [{ place_id: 'p', kind: 'city' }],
    }))
    const queryFn = (client as unknown as { query: ReturnType<typeof vi.fn> }).query
    // 38.58163 and 38.58168 round to the same 4-decimal key (38.5816 vs 38.5817 — *different* 4-dp!).
    // Use values within 10 microdegrees of each other to share a key.
    await reverseGeocodeToPlace(client, 38.58160, -121.49440)
    await reverseGeocodeToPlace(client, 38.58163, -121.49441)
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('bypassCache:true forces a fresh query each call', async () => {
    const client = makeMockClient(async () => ({
      rowCount: 1,
      rows: [{ place_id: 'p', kind: 'city' }],
    }))
    const queryFn = (client as unknown as { query: ReturnType<typeof vi.fn> }).query
    await reverseGeocodeToPlace(client, 38.5, -121.5, { bypassCache: true })
    await reverseGeocodeToPlace(client, 38.5, -121.5, { bypassCache: true })
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('caches NULL results (no polygon, no Mapbox token) for the same coordinate', async () => {
    const prior = process.env.MAPBOX_GEOCODING_TOKEN
    delete process.env.MAPBOX_GEOCODING_TOKEN
    const client = makeMockClient(async () => ({ rowCount: 0, rows: [] }))
    const queryFn = (client as unknown as { query: ReturnType<typeof vi.fn> }).query
    try {
      const r1 = await reverseGeocodeToPlace(client, 0, 0)
      const r2 = await reverseGeocodeToPlace(client, 0, 0)
      expect(r1).toBeNull()
      expect(r2).toBeNull()
      // The first call hits the DB once (polygon lookup); the second is cache.
      expect(queryFn).toHaveBeenCalledTimes(1)
    } finally {
      if (prior !== undefined) process.env.MAPBOX_GEOCODING_TOKEN = prior
    }
  })
})
