// T105 — Unit tests for venue content-section resolvers (F033).
// Trace: planning/next/scenario-F033-viewer-finds-venue-page.md
//        development/tickets/T105-venue-page-content-sections.md

import { describe, it, expect } from 'vitest'
import {
  resolveOwningGroup,
  getVenueHostedItems,
  getVenueNearbyItems,
} from './resolve-venue-items'

function makeGroupStub(result: { data: unknown; error?: unknown }) {
  return {
    from: () => {
      const chain: Record<string, unknown> = {}
      const pass = () => chain
      chain.select = pass
      chain.eq = pass
      chain.is = pass
      chain.order = pass
      chain.limit = pass
      chain.maybeSingle = () => Promise.resolve(result)
      return chain
    },
  } as unknown as Parameters<typeof resolveOwningGroup>[0]
}

function makeRpcStub(captured: { name?: string; params?: unknown }, result: { data: unknown; error?: unknown }) {
  return {
    rpc: (name: string, params: unknown) => {
      captured.name = name
      captured.params = params
      return Promise.resolve(result)
    },
  } as unknown as Parameters<typeof getVenueHostedItems>[0]
}

const FEED_ROW = {
  item_id: 'it-1',
  member_handle: 'drakes',
  member_display_name: "Drake's",
  item_kind: 'gathering',
  title: 'Trivia Night',
  category: null,
  brand_label: "Drake's",
  group_id: 'grp-owning',
  nearest_location_label: null,
  response_count: 3,
  primary_tag: null,
  published_at: '2026-06-10T00:00:00Z',
}

describe('resolveOwningGroup', () => {
  it('returns the owning business Group id when one is anchored', async () => {
    expect(await resolveOwningGroup(makeGroupStub({ data: { id: 'grp-owning' } }), 'loc-1')).toBe(
      'grp-owning',
    )
  })

  it('returns null when no active business Group is anchored (minimal-page variant)', async () => {
    expect(await resolveOwningGroup(makeGroupStub({ data: null }), 'loc-1')).toBeNull()
  })

  it('returns null on error rather than throwing', async () => {
    expect(
      await resolveOwningGroup(makeGroupStub({ data: null, error: { message: 'boom' } }), 'loc-1'),
    ).toBeNull()
  })
})

describe('getVenueHostedItems', () => {
  it('returns [] without calling the RPC when there is no owning Group', async () => {
    const cap: { name?: string } = {}
    const items = await getVenueHostedItems(makeRpcStub(cap, { data: [] }), {
      locationId: 'loc-1',
      owningGroupId: null,
    })
    expect(items).toEqual([])
    expect(cap.name).toBeUndefined()
  })

  it('calls venue_hosted_items and maps rows to FeedItem', async () => {
    const cap: { name?: string; params?: unknown } = {}
    const items = await getVenueHostedItems(makeRpcStub(cap, { data: [FEED_ROW] }), {
      locationId: 'loc-1',
      owningGroupId: 'grp-owning',
    })
    expect(cap.name).toBe('venue_hosted_items')
    expect(cap.params).toEqual({ p_location_id: 'loc-1', p_owning_group_id: 'grp-owning' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      itemId: 'it-1',
      kind: 'gathering',
      title: 'Trivia Night',
      ownerHandle: 'drakes',
      groupId: 'grp-owning',
      responseCount: 3,
    })
  })

  it('returns [] on RPC error rather than throwing', async () => {
    const items = await getVenueHostedItems(
      makeRpcStub({}, { data: null, error: { message: 'boom' } }),
      { locationId: 'loc-1', owningGroupId: 'grp-owning' },
    )
    expect(items).toEqual([])
  })
})

describe('getVenueNearbyItems', () => {
  it('calls venue_nearby_items with the 5km default radius and maps rows', async () => {
    const cap: { name?: string; params?: unknown } = {}
    const items = await getVenueNearbyItems(
      makeRpcStub(cap, { data: [{ ...FEED_ROW, group_id: 'grp-other' }] }),
      { locationId: 'loc-1', owningGroupId: 'grp-owning' },
    )
    expect(cap.name).toBe('venue_nearby_items')
    expect(cap.params).toEqual({
      p_location_id: 'loc-1',
      p_owning_group_id: 'grp-owning',
      p_radius_m: 5000,
    })
    expect(items[0].groupId).toBe('grp-other')
  })

  it('passes a null owning group through (minimal-page nearby still works)', async () => {
    const cap: { params?: { p_owning_group_id?: unknown } } = {}
    await getVenueNearbyItems(makeRpcStub(cap, { data: [] }), {
      locationId: 'loc-1',
      owningGroupId: null,
    })
    expect(cap.params?.p_owning_group_id).toBeNull()
  })

  it('returns [] on RPC error rather than throwing', async () => {
    const items = await getVenueNearbyItems(
      makeRpcStub({}, { data: null, error: { message: 'boom' } }),
      { locationId: 'loc-1', owningGroupId: null },
    )
    expect(items).toEqual([])
  })
})
