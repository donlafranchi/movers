import { describe, it, expect, vi, beforeEach } from 'vitest'
import { geocode } from '@/lib/geocoding'

describe('geocode', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token')
  })

  it('returns empty array for empty query', async () => {
    const result = await geocode('')
    expect(result).toEqual([])
  })

  it('returns empty array for whitespace query', async () => {
    const result = await geocode('   ')
    expect(result).toEqual([])
  })

  it('returns empty array when no token', async () => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', '')
    const result = await geocode('Austin TX')
    expect(result).toEqual([])
  })

  it('parses Mapbox response into GeocodingResult array', async () => {
    const mockResponse = {
      features: [
        { place_name: 'Austin, TX', center: [-97.7431, 30.2672] },
        { place_name: 'Austin, MN', center: [-92.9747, 43.6666] },
      ],
    }

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })

    const results = await geocode('Austin')
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      name: 'Austin, TX',
      coordinates: [-97.7431, 30.2672],
    })
  })

  it('returns empty array on fetch error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false })
    const results = await geocode('Austin')
    expect(results).toEqual([])
  })
})
