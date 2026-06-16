// T104 — Unit tests for the public Venue resolver (F033 read surface, shell).
// Trace: planning/next/scenario-F033-viewer-finds-venue-page.md
//        development/tickets/T104-venue-page-shell.md

import { describe, it, expect } from 'vitest'
import {
  splitLocationSlug,
  resolveVenue,
  venueDistanceMeters,
  existingVenueSavedSearchId,
} from './resolve-venue'

describe('splitLocationSlug', () => {
  it('returns null when there is no /l/ marker (bare place path)', () => {
    expect(splitLocationSlug(['ca', 'sacramento', 'oak-park'])).toBeNull()
  })

  it('splits a place path and the location slug at the /l/ marker', () => {
    expect(splitLocationSlug(['ca', 'sacramento', 'oak-park', 'l', 'drakes'])).toEqual({
      placeSegments: ['ca', 'sacramento', 'oak-park'],
      locationSlug: 'drakes',
    })
  })

  it('returns null when /l/ is present but no slug follows it', () => {
    expect(splitLocationSlug(['ca', 'sacramento', 'l'])).toBeNull()
  })

  it('handles a location directly under a top-level place', () => {
    expect(splitLocationSlug(['ca', 'l', 'statewide-venue'])).toEqual({
      placeSegments: ['ca'],
      locationSlug: 'statewide-venue',
    })
  })

  it('does not match a Group path (/g/ marker only)', () => {
    expect(splitLocationSlug(['ca', 'sacramento', 'g', 'oak-park-sourdough'])).toBeNull()
  })
})

// Supabase stub: a single chainable builder over `locations` (the resolver does
// one query with location_permanent embedded). The embed travels inside the
// location row, mirroring PostgREST.
function makeSupabaseStub(routes: { location?: unknown; locationError?: unknown }) {
  return {
    from: () => {
      const chain: Record<string, unknown> = {}
      const pass = () => chain
      chain.select = pass
      chain.eq = pass
      chain.is = pass
      chain.limit = pass
      chain.maybeSingle = () =>
        Promise.resolve({ data: routes.location ?? null, error: routes.locationError ?? null })
      return chain
    },
  } as unknown as Parameters<typeof resolveVenue>[0]
}

const PERMANENT_ROW = {
  id: 'loc-1',
  slug: 'drakes',
  label: "Drake's",
  kind: 'permanent',
  description: 'A neighborhood bar with a weekly trivia night.',
  location_permanent: [
    {
      street_address: '1400 16th St, Sacramento, CA',
      accessibility_notes: 'Ramp at the side entrance; ADA restroom.',
    },
  ],
}

describe('resolveVenue', () => {
  it('returns null when RLS yields no row (private, soft-deleted, nonexistent)', async () => {
    expect(await resolveVenue(makeSupabaseStub({ location: null }), 'whatever')).toBeNull()
  })

  it('returns null on a query error rather than throwing', async () => {
    const venue = await resolveVenue(
      makeSupabaseStub({ location: null, locationError: { message: 'boom' } }),
      'x',
    )
    expect(venue).toBeNull()
  })

  it('maps a permanent Location with its address + accessibility notes', async () => {
    const venue = await resolveVenue(makeSupabaseStub({ location: PERMANENT_ROW }), 'drakes')
    expect(venue).toEqual({
      locationId: 'loc-1',
      slug: 'drakes',
      label: "Drake's",
      kind: 'permanent',
      description: 'A neighborhood bar with a weekly trivia night.',
      heroImageUrl: null,
      streetAddress: '1400 16th St, Sacramento, CA',
      accessibilityNotes: 'Ramp at the side entrance; ADA restroom.',
    })
  })

  it('omits the address for a non-permanent kind (no location_permanent child)', async () => {
    const venue = await resolveVenue(
      makeSupabaseStub({
        location: { ...PERMANENT_ROW, kind: 'area', description: null, location_permanent: null },
      }),
      'drakes',
    )
    expect(venue?.kind).toBe('area')
    expect(venue?.streetAddress).toBeNull()
    expect(venue?.accessibilityNotes).toBeNull()
    expect(venue?.description).toBeNull()
  })

  it('hero image is always null at b1 (no image column on locations)', async () => {
    const venue = await resolveVenue(makeSupabaseStub({ location: PERMANENT_ROW }), 'drakes')
    expect(venue?.heroImageUrl).toBeNull()
  })
})

describe('existingVenueSavedSearchId', () => {
  function makeFollowStub(result: { data: unknown; error?: unknown }) {
    return {
      from: () => {
        const chain: Record<string, unknown> = {}
        const pass = () => chain
        chain.select = pass
        chain.eq = pass
        chain.is = pass
        chain.limit = pass
        chain.maybeSingle = () => Promise.resolve(result)
        return chain
      },
    } as unknown as Parameters<typeof existingVenueSavedSearchId>[0]
  }

  it('returns the saved-search id when the viewer already follows the venue', async () => {
    expect(
      await existingVenueSavedSearchId(makeFollowStub({ data: { id: 'ss-1' } }), 'loc-1'),
    ).toBe('ss-1')
  })

  it('returns null when there is no active follow (or anon viewer)', async () => {
    expect(await existingVenueSavedSearchId(makeFollowStub({ data: null }), 'loc-1')).toBeNull()
  })

  it('returns null on error rather than throwing', async () => {
    expect(
      await existingVenueSavedSearchId(
        makeFollowStub({ data: null, error: { message: 'boom' } }),
        'loc-1',
      ),
    ).toBeNull()
  })
})

describe('venueDistanceMeters', () => {
  function makeRpcStub(result: { data: unknown; error?: unknown }) {
    return {
      rpc: (_name: string, _params: { p_location_id: string }) => Promise.resolve(result),
    } as unknown as Parameters<typeof venueDistanceMeters>[0]
  }

  it('returns the distance the RPC reports for an auth\'d viewer with a primary home', async () => {
    expect(await venueDistanceMeters(makeRpcStub({ data: 2413.7 }), 'loc-1')).toBeCloseTo(2413.7)
  })

  it('returns null when the RPC yields no distance (anon, or no primary-home interest)', async () => {
    expect(await venueDistanceMeters(makeRpcStub({ data: null }), 'loc-1')).toBeNull()
  })

  it('returns null on an RPC error rather than throwing', async () => {
    expect(
      await venueDistanceMeters(makeRpcStub({ data: null, error: { message: 'boom' } }), 'loc-1'),
    ).toBeNull()
  })
})
