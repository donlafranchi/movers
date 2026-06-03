// T094 — Unit tests for the Item ownership check (F041).
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isItemOwner } from './is-item-owner'

function chainable(result: { data: unknown }) {
  const p: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'limit']) p[m] = () => p
  p.maybeSingle = () => Promise.resolve(result)
  return p
}

function makeSupabase(result: { data: unknown }) {
  return { from: () => chainable(result) } as unknown as SupabaseClient
}

const ITEM = 'deadbeef-1111-2222-3333-444455556666'
const USER = '00000000-0000-0000-0000-000000000001'

describe('isItemOwner', () => {
  it('is false for an anonymous viewer (no userId)', async () => {
    const supabase = makeSupabase({ data: { id: ITEM } })
    expect(await isItemOwner(supabase, ITEM, null)).toBe(false)
  })

  it('is true when a row matches (id + member_id)', async () => {
    const supabase = makeSupabase({ data: { id: ITEM } })
    expect(await isItemOwner(supabase, ITEM, USER)).toBe(true)
  })

  it('is false when no row matches (non-owner)', async () => {
    const supabase = makeSupabase({ data: null })
    expect(await isItemOwner(supabase, ITEM, USER)).toBe(false)
  })
})
