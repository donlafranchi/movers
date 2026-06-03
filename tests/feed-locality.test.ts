import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  normalizeTags,
  clampLimit,
  getLocalityFeed,
  widenLocality,
} from '../src/lib/feed/locality-feed'

// T087 — pure-logic + fake-client coverage for the locality feed helper, plus
// source-shape of the SQL function. Live PostGIS behaviour is the F030 eval.

describe('T087 — normalizeTags', () => {
  it('lowercases, dedupes, drops invalid', () => {
    expect(normalizeTags(['Live-Music', 'live-music', 'bad tag', 'jazz'])).toEqual([
      'live-music',
      'jazz',
    ])
  })
  it('returns null for empty/all-invalid/undefined', () => {
    expect(normalizeTags([])).toBeNull()
    expect(normalizeTags(['  ', 'Bad Tag'])).toBeNull()
    expect(normalizeTags(undefined)).toBeNull()
    expect(normalizeTags(null)).toBeNull()
  })
})

describe('T087 — clampLimit', () => {
  it('clamps to 1..100, default 50', () => {
    expect(clampLimit(undefined)).toBe(50)
    expect(clampLimit(null)).toBe(50)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(250)).toBe(100)
    expect(clampLimit(12)).toBe(12)
  })
})

describe('T087 — getLocalityFeed', () => {
  const row = {
    item_id: 'i1',
    member_handle: 'maya',
    member_display_name: 'Maya',
    item_kind: 'gathering',
    title: 'Pottery night',
    category: 'crafts',
    brand_label: null,
    group_id: null,
    nearest_location_label: 'Drake’s',
    response_count: '3',
    primary_tag: 'crafts',
    published_at: '2026-06-01T00:00:00Z',
  }

  it('passes normalized args and maps rows', async () => {
    let captured: unknown
    const fake = {
      rpc: async (_name: string, args: unknown) => {
        captured = args
        return { data: [row], error: null }
      },
    }
    const feed = await getLocalityFeed(fake as never, {
      placeId: 'p1',
      interestTags: ['Crafts', 'crafts'],
      limit: 9,
    })
    expect(captured).toEqual({ p_place_id: 'p1', p_tags: ['crafts'], p_limit: 9 })
    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({
      itemId: 'i1',
      kind: 'gathering',
      ownerHandle: 'maya',
      responseCount: 3,
      nearestLocationLabel: 'Drake’s',
    })
  })

  it('returns [] when data is null', async () => {
    const fake = { rpc: async () => ({ data: null, error: null }) }
    expect(await getLocalityFeed(fake as never, { placeId: 'p1' })).toEqual([])
  })

  it('throws on rpc error', async () => {
    const fake = { rpc: async () => ({ data: null, error: new Error('boom') }) }
    await expect(getLocalityFeed(fake as never, { placeId: 'p1' })).rejects.toThrow('boom')
  })
})

describe('T087 — widenLocality', () => {
  function fakeFrom(responses: Record<string, unknown>) {
    return {
      from(_table: string) {
        const builder: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'is']) builder[m] = () => builder
        builder.maybeSingle = async () => responses[builder._key as string] ?? { data: null, error: null }
        // first call resolves current, second resolves parent — disambiguate by id
        builder.eq = (col: string, val: string) => {
          if (col === 'id') builder._key = val
          return builder
        }
        return builder
      },
    }
  }

  it('returns the parent place', async () => {
    const client = fakeFrom({
      child: { data: { parent_id: 'parent' }, error: null },
      parent: { data: { id: 'parent', display_name: 'Sacramento', slug: 'sacramento' }, error: null },
    })
    const out = await widenLocality(client as never, 'child')
    expect(out).toEqual({ placeId: 'parent', displayName: 'Sacramento', slug: 'sacramento' })
  })

  it('returns null at the root (no parent)', async () => {
    const client = fakeFrom({ root: { data: { parent_id: null }, error: null } })
    expect(await widenLocality(client as never, 'root')).toBeNull()
  })
})

describe('T087 — migration source shape', () => {
  const sql = readFileSync(
    resolve(__dirname, '..', 'supabase', 'migrations', '027_locality_feed.sql'),
    'utf8',
  )
  it('intersects against the place polygon, orders by recency, grants anon', () => {
    expect(sql).toMatch(/st_intersects/i)
    expect(sql).toMatch(/order by/i)
    expect(sql).toMatch(/grant execute/i)
    expect(sql).toMatch(/to anon/i)
  })
})
