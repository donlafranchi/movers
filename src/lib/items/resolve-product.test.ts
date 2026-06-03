// T079 — Unit tests for the product resolver.
// T095 — Updated: attribution model (Group vs Member + conditional link).
// Trace: F038 § Item URL pattern + § Item page shows attribution + skip-path.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  splitItemSlug,
  parseIdFragment,
  resolveProduct,
} from './resolve-product'

describe('splitItemSlug', () => {
  it('returns the item split for …/g/<group>/p/<item>', () => {
    expect(
      splitItemSlug(['ca', 'sacramento', 'oak-park', 'g', 'oak-park-sourdough-a1', 'p', 'loaf-deadbeef']),
    ).toEqual({
      placeSegments: ['ca', 'sacramento', 'oak-park'],
      groupSlug: 'oak-park-sourdough-a1',
      itemSlug: 'loaf-deadbeef',
    })
  })

  it('returns null for a bare …/g/<group> (that stays the Shop page)', () => {
    expect(splitItemSlug(['ca', 'sacramento', 'g', 'oak-park-sourdough-a1'])).toBeNull()
  })

  it('returns null for a bare place path', () => {
    expect(splitItemSlug(['ca', 'sacramento', 'oak-park'])).toBeNull()
  })

  it('returns null when the marker after the group slug is not "p"', () => {
    expect(splitItemSlug(['ca', 'g', 'shop-a1', 'l', 'venue'])).toBeNull()
  })
})

describe('parseIdFragment', () => {
  it('returns the trailing hyphen segment', () => {
    expect(parseIdFragment('country-sourdough-loaf-deadbeef')).toBe('deadbeef')
    expect(parseIdFragment('loaf-a1b2c3d4')).toBe('a1b2c3d4')
  })
  it('returns empty for a hyphenless slug', () => {
    expect(parseIdFragment('loaf')).toBe('')
  })
})

// Chainable Supabase stub: every builder method returns the same object; the
// object is awaitable (resolves to {data,error}) and exposes maybeSingle().
function chainable(result: { data: unknown; error?: unknown }) {
  const p: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'limit', 'in', 'order']) {
    p[m] = () => p
  }
  p.maybeSingle = () => Promise.resolve(result)
  p.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej)
  return p
}

function makeSupabase(routes: Record<string, { data: unknown; error?: unknown }>) {
  return {
    from: (table: string) => chainable(routes[table] ?? { data: null }),
  } as unknown as SupabaseClient
}

const ITEM_ID = 'deadbeef-1111-2222-3333-444455556666'

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    title: 'Country Sourdough Loaf',
    description: 'Naturally leavened.',
    brand_label: 'Oak Park Sourdough',
    made_at_place_id: null,
    member_id: 'mem-maya',
    item_products: { price_cents: 900, price_unit: 'loaf', photo_urls: [] },
    owner: { handle: 'maya', display_name: 'Maya Chen' },
    item_locations: [{ removed_at: null, locations: { label: "Maya's Kitchen" } }],
    ...overrides,
  }
}

describe('resolveProduct — group path (T095 Group-attribution)', () => {
  it('attributes to the Group (kind=group, name=brand_label); members embed is not consulted', async () => {
    const supabase = makeSupabase({
      groups: { data: { id: 'g1' } },
      items: { data: [productRow()] },
    })
    const result = await resolveProduct(supabase, {
      groupSlug: 'oak-park-sourdough-a1',
      itemSlug: 'country-sourdough-loaf-deadbeef',
    })
    expect(result).not.toBeNull()
    expect(result!.itemId).toBe(ITEM_ID)
    expect(result!.priceCents).toBe(900)
    expect(result!.priceUnit).toBe('loaf')
    expect(result!.brandLabel).toBe('Oak Park Sourdough')
    expect(result!.attribution).toEqual({ kind: 'group', name: 'Oak Park Sourdough' })
    expect(result!.pickup).toEqual({ label: "Maya's Kitchen" })
    expect(result!.madeAtPlaceId).toBeNull()
  })

  it('returns null when a Group-filed item has no brand_label (Group attribution requires it)', async () => {
    const supabase = makeSupabase({
      groups: { data: { id: 'g1' } },
      items: { data: [productRow({ brand_label: null })] },
    })
    const result = await resolveProduct(supabase, {
      groupSlug: 'oak-park-sourdough-a1',
      itemSlug: 'country-sourdough-loaf-deadbeef',
    })
    expect(result).toBeNull()
  })

  it('returns null when no row id matches the slug fragment', async () => {
    const supabase = makeSupabase({
      groups: { data: { id: 'g1' } },
      items: { data: [productRow()] },
    })
    const result = await resolveProduct(supabase, {
      groupSlug: 'oak-park-sourdough-a1',
      itemSlug: 'country-sourdough-loaf-00000000',
    })
    expect(result).toBeNull()
  })

  it('returns null when the group is not found', async () => {
    const supabase = makeSupabase({ groups: { data: null }, items: { data: [] } })
    const result = await resolveProduct(supabase, {
      groupSlug: 'nope',
      itemSlug: 'loaf-deadbeef',
    })
    expect(result).toBeNull()
  })
})

describe('resolveProduct — individual path (T095 Member-attribution + conditional link)', () => {
  it('attributes to the Member with isDiscoverable=true when the discoverability row says so', async () => {
    const supabase = makeSupabase({
      members: { data: { id: 'mem-maya' } },
      items: {
        data: [
          productRow({
            brand_label: null,
            item_products: { price_cents: null, price_unit: null, photo_urls: [] },
          }),
        ],
      },
      member_public_discoverability: { data: { is_discoverable: true } },
    })
    const result = await resolveProduct(supabase, {
      handle: 'maya',
      itemSlug: 'country-sourdough-loaf-deadbeef',
    })
    expect(result).not.toBeNull()
    expect(result!.brandLabel).toBeNull()
    expect(result!.priceCents).toBeNull()
    expect(result!.attribution).toEqual({
      kind: 'member',
      handle: 'maya',
      displayName: 'Maya Chen',
      isDiscoverable: true,
    })
  })

  it('attributes to the Member with isDiscoverable=false (plain-text fallback)', async () => {
    const supabase = makeSupabase({
      members: { data: { id: 'mem-maya' } },
      items: { data: [productRow({ brand_label: null })] },
      member_public_discoverability: { data: { is_discoverable: false } },
    })
    const result = await resolveProduct(supabase, {
      handle: 'maya',
      itemSlug: 'country-sourdough-loaf-deadbeef',
    })
    expect(result!.attribution).toEqual({
      kind: 'member',
      handle: 'maya',
      displayName: 'Maya Chen',
      isDiscoverable: false,
    })
  })

  it('falls back to isDiscoverable=false when the discoverability row is missing', async () => {
    const supabase = makeSupabase({
      members: { data: { id: 'mem-maya' } },
      items: { data: [productRow({ brand_label: null })] },
      member_public_discoverability: { data: null },
    })
    const result = await resolveProduct(supabase, {
      handle: 'maya',
      itemSlug: 'country-sourdough-loaf-deadbeef',
    })
    expect((result!.attribution as { isDiscoverable: boolean }).isDiscoverable).toBe(false)
  })
})
