// T108 — Unit tests for the unified follows reader (F042).
// Trace: planning/next/scenario-F042-member-follows-producer-group-venue.md
//        development/tickets/T108-unified-follows-reader-and-you-summary.md
//
// The reader unions three substrates (member_follows / group_memberships /
// member_saved_searches) into one normalized, recency-ordered list. RLS does the
// owner-scoping (the Playwright eval exercises that against a live DB); here we
// verify the union shape, the recency ordering, the soft-delete/source filters
// are applied to each query, and the tombstone fallback for a non-discoverable
// or soft-deleted followed Person.

import { describe, it, expect } from 'vitest'
import { getMemberFollows } from './get-member-follows'
import type { SupabaseClient } from '@supabase/supabase-js'

type Call = [string, unknown[]]

function makeClient(tableData: Record<string, unknown[]>) {
  const calls: Record<string, Call[]> = {}
  const from = (name: string) => {
    const rec = (calls[name] = calls[name] ?? [])
    const data = tableData[name] ?? []
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'not', 'order']) {
      builder[m] = (...args: unknown[]) => {
        rec.push([m, args])
        return builder
      }
    }
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null })
    return builder
  }
  return { client: { from } as unknown as SupabaseClient, calls }
}

const PERSON_DATA = {
  member_follows: [{ followed_member_id: 'p1', created_at: '2026-06-10T00:00:00Z' }],
  members: [{ id: 'p1', handle: 'alice', display_name: 'Alice', avatar_url: 'a.png', deleted_at: null }],
  member_public_discoverability: [{ member_id: 'p1', is_discoverable: true }],
}
const GROUP_DATA = {
  group_memberships: [{ group_id: 'g1', joined_at: '2026-06-15T00:00:00Z' }],
  groups: [{ id: 'g1', slug: 'run-club', name: 'Run Club' }],
}
const VENUE_DATA = {
  member_saved_searches: [
    { id: 'ss1', label: 'Following Blue Bottle', location_id: 'l1', created_at: '2026-06-12T00:00:00Z' },
  ],
  locations: [{ id: 'l1', slug: 'blue-bottle', label: 'Blue Bottle' }],
}

describe('getMemberFollows — union + ordering', () => {
  it('unions all three substrates, ordered by createdAt DESC (mixed kinds interleave)', async () => {
    const { client } = makeClient({ ...PERSON_DATA, ...GROUP_DATA, ...VENUE_DATA })
    const result = await getMemberFollows(client, 'me')

    // Group (06-15) → Venue (06-12) → Person (06-10).
    expect(result.map((e) => e.entityId)).toEqual(['g1', 'ss1', 'p1'])
    expect(result.map((e) => e.kind)).toEqual(['group', 'venue', 'person'])
  })

  it('maps a followed Person to /m/[handle] with avatar thumbnail', async () => {
    const { client } = makeClient(PERSON_DATA)
    const [person] = await getMemberFollows(client, 'me')
    expect(person).toMatchObject({
      kind: 'person',
      entityId: 'p1',
      displayName: 'Alice',
      thumbnailUrl: 'a.png',
      href: '/m/alice',
      isTombstone: false,
    })
  })

  it('maps a Group to /p/g/[slug] with no thumbnail (groups have no image column)', async () => {
    const { client } = makeClient(GROUP_DATA)
    const [group] = await getMemberFollows(client, 'me')
    expect(group).toMatchObject({
      kind: 'group',
      entityId: 'g1',
      displayName: 'Run Club',
      thumbnailUrl: null,
      href: '/p/g/run-club',
      isTombstone: false,
    })
  })

  it('maps a Venue to /p/l/[slug], preferring the joined location label over the saved-search label', async () => {
    const { client } = makeClient(VENUE_DATA)
    const [venue] = await getMemberFollows(client, 'me')
    expect(venue).toMatchObject({
      kind: 'venue',
      entityId: 'ss1', // the saved-search id — what member.saved_search.remove needs
      displayName: 'Blue Bottle',
      thumbnailUrl: null,
      href: '/p/l/blue-bottle',
      isTombstone: false,
    })
  })

  it('falls back to the saved-search label when the joined location row is absent', async () => {
    const { client } = makeClient({
      member_saved_searches: VENUE_DATA.member_saved_searches,
      locations: [],
    })
    const [venue] = await getMemberFollows(client, 'me')
    expect(venue.displayName).toBe('Following Blue Bottle')
  })
})

describe('getMemberFollows — substrate filters', () => {
  it('applies the soft-delete + source filters to each substrate query', async () => {
    const { client, calls } = makeClient({ ...PERSON_DATA, ...GROUP_DATA, ...VENUE_DATA })
    await getMemberFollows(client, 'me')

    expect(calls.member_follows).toContainEqual(['is', ['unfollowed_at', null]])
    expect(calls.member_follows).toContainEqual(['eq', ['follower_member_id', 'me']])

    expect(calls.group_memberships).toContainEqual(['is', ['left_at', null]])
    expect(calls.group_memberships).toContainEqual(['eq', ['source', 'explicit']])
    expect(calls.group_memberships).toContainEqual(['eq', ['member_id', 'me']])

    expect(calls.member_saved_searches).toContainEqual(['is', ['removed_at', null]])
    expect(calls.member_saved_searches).toContainEqual(['not', ['location_id', 'is', null]])
    expect(calls.member_saved_searches).toContainEqual(['eq', ['member_id', 'me']])
  })
})

describe('getMemberFollows — tombstone', () => {
  it('renders a soft-deleted followed Person as a tombstone (no thumbnail, fallback name, no throw)', async () => {
    const { client } = makeClient({
      member_follows: [{ followed_member_id: 'p2', created_at: '2026-06-10T00:00:00Z' }],
      members: [{ id: 'p2', handle: 'bob', display_name: 'Bob', avatar_url: 'b.png', deleted_at: '2026-01-01T00:00:00Z' }],
      member_public_discoverability: [{ member_id: 'p2', is_discoverable: true }],
    })
    const [person] = await getMemberFollows(client, 'me')
    expect(person.isTombstone).toBe(true)
    expect(person.thumbnailUrl).toBeNull()
    expect(person.displayName).toBe('A member')
    expect(person.entityId).toBe('p2') // unfollow still targets the row
  })

  it('renders a non-discoverable followed Person as a tombstone', async () => {
    const { client } = makeClient({
      member_follows: [{ followed_member_id: 'p3', created_at: '2026-06-10T00:00:00Z' }],
      members: [{ id: 'p3', handle: 'carol', display_name: 'Carol', avatar_url: 'c.png', deleted_at: null }],
      member_public_discoverability: [{ member_id: 'p3', is_discoverable: false }],
    })
    const [person] = await getMemberFollows(client, 'me')
    expect(person.isTombstone).toBe(true)
    expect(person.thumbnailUrl).toBeNull()
  })

  it('returns an empty list when the member follows nothing', async () => {
    const { client } = makeClient({})
    expect(await getMemberFollows(client, 'me')).toEqual([])
  })
})
