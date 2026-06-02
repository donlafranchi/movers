// T079 — Unit tests for the product resolver.
// Trace: F038 § Item URL pattern + § Item page shows brand + owner + skip-path.

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
    item_products: { price_cents: 900, price_unit: 'loaf', photo_urls: [] },
    owner: { handle: 'maya', display_name: 'Maya Chen' },
    item_locations: [{ removed_at: null, locations: { label: "Maya's Kitchen" } }],
    ...overrides,
  }
}

describe('resolveProduct — group path', () => {
  it('maps the matching row to the result shape', async () => {
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
    expect(result!.owner).toEqual({ handle: 'maya', displayName: 'Maya Chen' })
    expect(result!.pickup).toEqual({ label: "Maya's Kitchen" })
    expect(result!.madeAtPlaceId).toBeNull()
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

describe('resolveProduct — individual path', () => {
  it('resolves a free product sold as individual (no brand)', async () => {
    const supabase = makeSupabase({
      members: { data: { id: 'm1' } },
      items: {
        data: [
          productRow({
            brand_label: null,
            item_products: { price_cents: null, price_unit: null, photo_urls: [] },
          }),
        ],
      },
    })
    const result = await resolveProduct(supabase, {
      handle: 'maya',
      itemSlug: 'country-sourdough-loaf-deadbeef',
    })
    expect(result).not.toBeNull()
    expect(result!.brandLabel).toBeNull()
    expect(result!.priceCents).toBeNull()
  })
})
