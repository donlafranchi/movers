// T109 — Unit tests for the listed-member-count reader (F042).
// Trace: T109 "Counts respect privacy"; scenario-F042 § "Counts respect privacy gates".
//
// Per-Group follower counts on /you/following must reflect LISTED memberships
// only — the same member_public_group_memberships projection (T095) the public
// Group page counts from. Never raw group_memberships (which would leak
// unlisted/private members).

import { describe, it, expect } from 'vitest'
import { getListedMemberCounts } from './get-listed-member-counts'
import type { SupabaseClient } from '@supabase/supabase-js'

type Call = [string, unknown[]]

function makeClient(rows: { group_id: string }[]) {
  const calls: Record<string, Call[]> = {}
  const from = (name: string) => {
    const rec = (calls[name] = calls[name] ?? [])
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'in']) {
      builder[m] = (...args: unknown[]) => {
        rec.push([m, args])
        return builder
      }
    }
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
    return builder
  }
  return { client: { from } as unknown as SupabaseClient, calls }
}

describe('getListedMemberCounts', () => {
  it('counts listed memberships per group from the public projection', async () => {
    const { client, calls } = makeClient([
      { group_id: 'g1' },
      { group_id: 'g1' },
      { group_id: 'g2' },
    ])
    const counts = await getListedMemberCounts(client, ['g1', 'g2'])
    expect(counts).toEqual({ g1: 2, g2: 1 })
    // Reads the privacy-preserving projection — never raw group_memberships.
    expect(calls.member_public_group_memberships).toBeDefined()
    expect(calls.group_memberships).toBeUndefined()
  })

  it('returns an empty map for no group ids (no query)', async () => {
    const { client, calls } = makeClient([])
    expect(await getListedMemberCounts(client, [])).toEqual({})
    expect(calls.member_public_group_memberships).toBeUndefined()
  })

  it('reports zero implicitly (group with no listed rows is simply absent)', async () => {
    const { client } = makeClient([{ group_id: 'g1' }])
    const counts = await getListedMemberCounts(client, ['g1', 'g2'])
    expect(counts.g1).toBe(1)
    expect(counts.g2 ?? 0).toBe(0)
  })
})
