// T074 — Unit tests for the public Shop resolver (F035 read surface).
// Trace: planning/now/scenario-F035-rosa-finds-mayas-shop.md
//        development/tickets/T074-shop-public-page.md

import { describe, it, expect } from 'vitest'
import {
  splitGroupSlug,
  resolveShop,
  resolveLocalOwnerBadge,
} from './resolve-shop'

describe('splitGroupSlug', () => {
  it('returns null when there is no /g/ marker (bare place path)', () => {
    expect(splitGroupSlug(['ca', 'sacramento', 'oak-park'])).toBeNull()
  })

  it('splits a place path and the group slug at the /g/ marker', () => {
    expect(
      splitGroupSlug(['ca', 'sacramento', 'oak-park', 'g', 'oak-park-sourdough']),
    ).toEqual({
      placeSegments: ['ca', 'sacramento', 'oak-park'],
      groupSlug: 'oak-park-sourdough',
    })
  })

  it('returns null when /g/ is present but no slug follows it', () => {
    expect(splitGroupSlug(['ca', 'sacramento', 'g'])).toBeNull()
  })

  it('handles a group directly under a top-level place', () => {
    expect(splitGroupSlug(['ca', 'g', 'statewide-shop'])).toEqual({
      placeSegments: ['ca'],
      groupSlug: 'statewide-shop',
    })
  })
})

// Supabase client stub: switches the chainable builder by table name so we can
// stub two queries (groups + member_public_discoverability) in one test.
// T095 — added discoverability route.
function makeSupabaseStub(routes: {
  group?: unknown
  groupError?: unknown
  discoverability?: unknown
}) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const passthrough = () => chain
      chain.select = passthrough
      chain.eq = passthrough
      chain.is = passthrough
      chain.limit = passthrough
      if (table === 'member_public_discoverability') {
        chain.maybeSingle = () =>
          Promise.resolve({ data: routes.discoverability ?? null, error: null })
      } else {
        chain.maybeSingle = () =>
          Promise.resolve({ data: routes.group ?? null, error: routes.groupError ?? null })
      }
      return chain
    },
  } as unknown as Parameters<typeof resolveShop>[0]
}

const ACTIVE_ROW = {
  id: 'grp-1',
  slug: 'oak-park-sourdough',
  kind: 'business',
  lifecycle_state: 'active',
  anchor_location_id: 'loc-1',
  group_businesses: [
    { display_name: 'Oak Park Sourdough', public_description: 'Real bread, baked local.' },
  ],
  founder: [{ id: 'mem-maya', handle: 'maya', display_name: 'Maya Rivera', avatar_url: 'https://x/a.png' }],
}

describe('resolveShop', () => {
  it('returns null when RLS yields no row (draft-to-non-owner, dissolved, nonexistent)', async () => {
    const shop = await resolveShop(makeSupabaseStub({ group: null }), 'whatever')
    expect(shop).toBeNull()
  })

  it('returns null on a query error rather than throwing', async () => {
    const shop = await resolveShop(
      makeSupabaseStub({ group: null, groupError: { message: 'boom' } }),
      'x',
    )
    expect(shop).toBeNull()
  })

  it('maps an active business Group with founder, defaulting isDiscoverable=false when no privacy row', async () => {
    const shop = await resolveShop(
      makeSupabaseStub({ group: ACTIVE_ROW, discoverability: null }),
      'oak-park-sourdough',
    )
    expect(shop).toEqual({
      groupId: 'grp-1',
      slug: 'oak-park-sourdough',
      displayName: 'Oak Park Sourdough',
      publicDescription: 'Real bread, baked local.',
      lifecycleState: 'active',
      anchorLocationId: 'loc-1',
      founder: {
        handle: 'maya',
        displayName: 'Maya Rivera',
        avatarUrl: 'https://x/a.png',
        isDiscoverable: false,
      },
    })
  })

  it('surfaces founder isDiscoverable=true when the projection view returns it', async () => {
    const shop = await resolveShop(
      makeSupabaseStub({ group: ACTIVE_ROW, discoverability: { is_discoverable: true } }),
      'oak-park-sourdough',
    )
    expect(shop?.founder?.isDiscoverable).toBe(true)
  })

  it('flags a draft row so the page can render the owner preview', async () => {
    const shop = await resolveShop(
      makeSupabaseStub({
        group: { ...ACTIVE_ROW, lifecycle_state: 'draft' },
        discoverability: null,
      }),
      'oak-park-sourdough',
    )
    expect(shop?.lifecycleState).toBe('draft')
  })

  it('tolerates PostgREST returning the embeds as single objects', async () => {
    const shop = await resolveShop(
      makeSupabaseStub({
        group: {
          ...ACTIVE_ROW,
          group_businesses: { display_name: 'Solo Object Shop', public_description: '' },
          founder: { id: 'mem-maya', handle: 'maya', display_name: 'Maya Rivera', avatar_url: null },
        },
        discoverability: { is_discoverable: false },
      }),
      'oak-park-sourdough',
    )
    expect(shop?.displayName).toBe('Solo Object Shop')
    expect(shop?.founder?.avatarUrl).toBeNull()
    expect(shop?.founder?.isDiscoverable).toBe(false)
  })

  it('returns a null founder gracefully when the embed is absent', async () => {
    const shop = await resolveShop(
      makeSupabaseStub({ group: { ...ACTIVE_ROW, founder: null }, discoverability: null }),
      'oak-park-sourdough',
    )
    expect(shop?.founder).toBeNull()
  })
})

describe('resolveLocalOwnerBadge', () => {
  it('returns null until the S-jurisdictions substrate ships (F037 forward-dep)', async () => {
    const badge = await resolveLocalOwnerBadge(makeSupabaseStub({ group: null }), {
      groupId: 'grp-1',
      anchorLocationId: 'loc-1',
    })
    expect(badge).toBeNull()
  })
})
