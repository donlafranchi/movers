import { describe, it, expect } from 'vitest'
import { resolvePlacePath } from '../src/lib/places/resolve-path'

// T060 — unit tests for the path resolver.
//
// URL convention per ADR-0022:
//   - State slug = 2-letter USPS code (`ca`).
//   - Counties are URL-skippable: `/p/ca/sacramento` resolves the CITY
//     Sacramento (preferred), not the county; the county is reachable
//     only when no city of the same slug exists under the state.
//
// DB-touching tests live in evals/phase-1/place-routing.spec.ts.

interface MockRow {
  id: string
  parent_id: string | null
  ancestor_state_id: string | null
  slug: string
  display_name: string
  kind: 'region' | 'state' | 'county' | 'city' | 'neighborhood'
  // Resolver adds .is('deleted_at', null) — must be present so the mock
  // null-filter matches.
  deleted_at: null
}

/**
 * Mock SupabaseClient. The `.from('places').select(...)` chain is followed
 * by an arbitrary sequence of `.eq()`, `.is()`, `.neq()`, then `.limit()`
 * and `.maybeSingle()`. Returns the first row matching all filters.
 */
function makeMockSupabase(rows: MockRow[]) {
  return {
    from(_table: string) {
      const eqFilters: Partial<Record<keyof MockRow, unknown>> = {}
      const neqFilters: Partial<Record<keyof MockRow, unknown>> = {}
      const nullCols = new Set<string>()
      const chain = {
        select() {
          return chain
        },
        eq(col: keyof MockRow, val: unknown) {
          eqFilters[col] = val
          return chain
        },
        neq(col: keyof MockRow, val: unknown) {
          neqFilters[col] = val
          return chain
        },
        is(col: string, val: unknown) {
          if (val === null) nullCols.add(col)
          return chain
        },
        limit(_n: number) {
          return chain
        },
        async maybeSingle() {
          const match = rows.find((r) => {
            for (const [k, v] of Object.entries(eqFilters)) {
              if (r[k as keyof MockRow] !== v) return false
            }
            for (const [k, v] of Object.entries(neqFilters)) {
              if (r[k as keyof MockRow] === v) return false
            }
            for (const col of nullCols) {
              if ((r as unknown as Record<string, unknown>)[col] !== null) return false
            }
            return true
          })
          return { data: match ?? null, error: null }
        },
      }
      return chain
    },
  } as never
}

const CA: MockRow = {
  id: 'ca',
  parent_id: null,
  ancestor_state_id: null,
  slug: 'ca',
  display_name: 'California',
  kind: 'state',
  deleted_at: null,
}
const SAC_COUNTY: MockRow = {
  id: 'sac-county',
  parent_id: 'ca',
  ancestor_state_id: 'ca',
  slug: 'sacramento',
  display_name: 'Sacramento',
  kind: 'county',
  deleted_at: null,
}
const YOLO_COUNTY: MockRow = {
  id: 'yolo-county',
  parent_id: 'ca',
  ancestor_state_id: 'ca',
  slug: 'yolo',
  display_name: 'Yolo',
  kind: 'county',
  deleted_at: null,
}
const SAC_CITY: MockRow = {
  id: 'sac-city',
  parent_id: 'sac-county',
  ancestor_state_id: 'ca',
  slug: 'sacramento',
  display_name: 'Sacramento',
  kind: 'city',
  deleted_at: null,
}
const WEST_SAC: MockRow = {
  id: 'west-sac',
  parent_id: 'yolo-county',
  ancestor_state_id: 'ca',
  slug: 'west-sacramento',
  display_name: 'West Sacramento',
  kind: 'city',
  deleted_at: null,
}
const OAK: MockRow = {
  id: 'oak',
  parent_id: 'sac-city',
  ancestor_state_id: 'ca',
  slug: 'oak-park',
  display_name: 'Oak Park',
  kind: 'neighborhood',
  deleted_at: null,
}

const SEED = [CA, SAC_COUNTY, YOLO_COUNTY, SAC_CITY, WEST_SAC, OAK]

describe('T060 — resolvePlacePath state root', () => {
  it("resolves /p/ca to California (state with 2-letter USPS slug)", async () => {
    const supabase = makeMockSupabase(SEED)
    const res = await resolvePlacePath(supabase, ['ca'])
    expect(res?.place.slug).toBe('ca')
    expect(res?.place.kind).toBe('state')
    expect(res?.ancestors.length).toBe(0)
  })

  it('returns null for a non-existent root slug', async () => {
    const supabase = makeMockSupabase(SEED)
    expect(await resolvePlacePath(supabase, ['atlantis'])).toBeNull()
  })

  it('returns null on empty segments', async () => {
    const supabase = makeMockSupabase(SEED)
    expect(await resolvePlacePath(supabase, [])).toBeNull()
  })
})

describe('T060 — county-skip resolution under a state (ADR-0022)', () => {
  it('/p/ca/sacramento resolves to Sacramento CITY (not county) — city wins when slugs collide', async () => {
    const supabase = makeMockSupabase(SEED)
    const res = await resolvePlacePath(supabase, ['ca', 'sacramento'])
    expect(res?.place.id).toBe('sac-city')
    expect(res?.place.kind).toBe('city')
    // Ancestor chain skips the county tier — only the state appears as
    // ancestor because the URL skipped the county.
    expect(res?.ancestors.map((a) => `${a.slug}:${a.kind}`)).toEqual(['ca:state'])
  })

  it('/p/ca/west-sacramento resolves to West Sacramento CITY (under Yolo County, county skipped in URL)', async () => {
    const supabase = makeMockSupabase(SEED)
    const res = await resolvePlacePath(supabase, ['ca', 'west-sacramento'])
    expect(res?.place.id).toBe('west-sac')
    expect(res?.place.kind).toBe('city')
    expect(res?.ancestors.map((a) => `${a.slug}:${a.kind}`)).toEqual(['ca:state'])
  })

  it('/p/ca/yolo resolves to Yolo COUNTY — no city of slug "yolo" exists, so URL falls through to county', async () => {
    const supabase = makeMockSupabase(SEED)
    const res = await resolvePlacePath(supabase, ['ca', 'yolo'])
    expect(res?.place.id).toBe('yolo-county')
    expect(res?.place.kind).toBe('county')
  })

  it('/p/ca/sacramento/oak-park resolves to Oak Park neighborhood under the Sacramento city (county skipped throughout)', async () => {
    const supabase = makeMockSupabase(SEED)
    const res = await resolvePlacePath(supabase, ['ca', 'sacramento', 'oak-park'])
    expect(res?.place.id).toBe('oak')
    expect(res?.place.kind).toBe('neighborhood')
    expect(res?.ancestors.map((a) => `${a.slug}:${a.kind}`)).toEqual([
      'ca:state',
      'sacramento:city',
    ])
  })
})

describe('T060 — failure modes', () => {
  it('returns null when a non-root slug is queried as segment 0', async () => {
    // 'oak-park' has parent_id='sac-city', not null. First segment must
    // be a NULL-parent root.
    const supabase = makeMockSupabase(SEED)
    expect(await resolvePlacePath(supabase, ['oak-park'])).toBeNull()
  })

  it('returns null when a mid-chain segment does not exist below the resolved parent', async () => {
    // /ca/sacramento/atlantis — segment 2 misses (no row with slug
    // 'atlantis' under sac-city).
    const supabase = makeMockSupabase(SEED)
    expect(await resolvePlacePath(supabase, ['ca', 'sacramento', 'atlantis'])).toBeNull()
  })

  it('returns null on a slug that fails the regex CHECK (defensive)', async () => {
    const supabase = makeMockSupabase(SEED)
    expect(await resolvePlacePath(supabase, ['Bad Slug'])).toBeNull()
    expect(await resolvePlacePath(supabase, ['-leading'])).toBeNull()
    expect(await resolvePlacePath(supabase, ['Capitalized'])).toBeNull()
  })

  it('returns null when a Supabase query errors', async () => {
    const supabase = {
      from() {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          neq() {
            return this
          },
          is() {
            return this
          },
          limit() {
            return this
          },
          async maybeSingle() {
            return { data: null, error: { message: 'boom' } }
          },
        }
      },
    } as never
    expect(await resolvePlacePath(supabase, ['ca'])).toBeNull()
  })
})

describe('T060 — query shape', () => {
  it('issues the expected number of queries for a 3-segment deep path (with county-skip fallback chain)', async () => {
    // Segment 0: 1 query (root).
    // Segment 1 (under state 'ca'): city-by-state succeeds on first try → 1 query.
    // Segment 2 (under city): direct child match on first try → 1 query.
    // Total: 3.
    let queryCount = 0
    const supabase = {
      from() {
        const eqFilters: Partial<Record<string, unknown>> = {}
        const neqFilters: Partial<Record<string, unknown>> = {}
        const nullCols = new Set<string>()
        const chain = {
          select() {
            return chain
          },
          eq(col: string, val: unknown) {
            eqFilters[col] = val
            return chain
          },
          neq(col: string, val: unknown) {
            neqFilters[col] = val
            return chain
          },
          is(col: string, val: unknown) {
            if (val === null) nullCols.add(col)
            return chain
          },
          limit() {
            return chain
          },
          async maybeSingle() {
            queryCount += 1
            const match = SEED.find((r) => {
              for (const [k, v] of Object.entries(eqFilters)) {
                if ((r as unknown as Record<string, unknown>)[k] !== v) return false
              }
              for (const [k, v] of Object.entries(neqFilters)) {
                if ((r as unknown as Record<string, unknown>)[k] === v) return false
              }
              for (const col of nullCols) {
                if ((r as unknown as Record<string, unknown>)[col] !== null) return false
              }
              return true
            })
            return { data: match ?? null, error: null }
          },
        }
        return chain
      },
    } as never
    await resolvePlacePath(supabase, ['ca', 'sacramento', 'oak-park'])
    expect(queryCount).toBe(3)
  })

  it('short-circuits on the first miss (does not query past the failure)', async () => {
    let queryCount = 0
    const supabase = {
      from() {
        const eqFilters: Partial<Record<string, unknown>> = {}
        const neqFilters: Partial<Record<string, unknown>> = {}
        const nullCols = new Set<string>()
        const chain = {
          select() {
            return chain
          },
          eq(col: string, val: unknown) {
            eqFilters[col] = val
            return chain
          },
          neq(col: string, val: unknown) {
            neqFilters[col] = val
            return chain
          },
          is(col: string, val: unknown) {
            if (val === null) nullCols.add(col)
            return chain
          },
          limit() {
            return chain
          },
          async maybeSingle() {
            queryCount += 1
            const match = SEED.find((r) => {
              for (const [k, v] of Object.entries(eqFilters)) {
                if ((r as unknown as Record<string, unknown>)[k] !== v) return false
              }
              for (const [k, v] of Object.entries(neqFilters)) {
                if ((r as unknown as Record<string, unknown>)[k] === v) return false
              }
              for (const col of nullCols) {
                if ((r as unknown as Record<string, unknown>)[col] !== null) return false
              }
              return true
            })
            return { data: match ?? null, error: null }
          },
        }
        return chain
      },
    } as never

    // First segment 'atlantis' misses → halt before querying the next.
    await resolvePlacePath(supabase, ['atlantis', 'sacramento', 'oak-park'])
    expect(queryCount).toBe(1)
  })

  it('issues up to 3 fallback queries at a state-level segment when no city/non-county match exists', async () => {
    // /ca/yolo: segment 1 = 'yolo'. Resolver tries:
    //   1. city-by-state: no city with slug 'yolo' → miss (1 query)
    //   2. direct child excluding county: no region/etc named yolo → miss (1 query)
    //   3. county child: yolo county → hit (1 query)
    // Plus segment-0 query for 'ca' (1). Total 4.
    let queryCount = 0
    const supabase = {
      from() {
        const eqFilters: Partial<Record<string, unknown>> = {}
        const neqFilters: Partial<Record<string, unknown>> = {}
        const nullCols = new Set<string>()
        const chain = {
          select() {
            return chain
          },
          eq(col: string, val: unknown) {
            eqFilters[col] = val
            return chain
          },
          neq(col: string, val: unknown) {
            neqFilters[col] = val
            return chain
          },
          is(col: string, val: unknown) {
            if (val === null) nullCols.add(col)
            return chain
          },
          limit() {
            return chain
          },
          async maybeSingle() {
            queryCount += 1
            const match = SEED.find((r) => {
              for (const [k, v] of Object.entries(eqFilters)) {
                if ((r as unknown as Record<string, unknown>)[k] !== v) return false
              }
              for (const [k, v] of Object.entries(neqFilters)) {
                if ((r as unknown as Record<string, unknown>)[k] === v) return false
              }
              for (const col of nullCols) {
                if ((r as unknown as Record<string, unknown>)[col] !== null) return false
              }
              return true
            })
            return { data: match ?? null, error: null }
          },
        }
        return chain
      },
    } as never

    await resolvePlacePath(supabase, ['ca', 'yolo'])
    expect(queryCount).toBe(4)
  })
})
