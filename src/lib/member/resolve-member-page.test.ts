// T092 — Unit tests for the public Member-page resolver (F032).
// Trace: planning/now/scenario-F032-viewer-finds-member-page-and-follows.md

import { describe, it, expect } from 'vitest'
import { resolveMemberPage } from './resolve-member-page'
import type { SupabaseClient } from '@supabase/supabase-js'

// Per-table stub: a chainable builder that is also awaitable (resolves to
// { data: listRows }) for the .order()-terminated list reads, and whose
// .maybeSingle() resolves the single row. from(table) dispatches by name.
// RLS + the projection views are exercised by the Playwright eval, not here.
function tableStub(opts: { list?: unknown[]; single?: unknown }) {
  const result = { data: opts.list ?? null, error: null }
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  chain.select = passthrough
  chain.eq = passthrough
  chain.is = passthrough
  chain.limit = passthrough
  chain.order = passthrough
  chain.maybeSingle = () => Promise.resolve({ data: opts.single ?? null, error: null })
  // Awaitable for list reads that terminate on .order(...).
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return chain
}

function makeClient(tables: Record<string, ReturnType<typeof tableStub>>) {
  return {
    from: (name: string) => tables[name] ?? tableStub({}),
  } as unknown as SupabaseClient
}

const MEMBER = {
  id: 'mem-1',
  handle: 'maya',
  display_name: 'Maya Rivera',
  bio: 'Baker of bread.',
  pronouns: 'she/her',
  avatar_url: 'https://x/a.png',
}

describe('resolveMemberPage', () => {
  it('returns null when no member matches the handle (deleted / nonexistent → 404)', async () => {
    const client = makeClient({ members: tableStub({ single: null }) })
    expect(await resolveMemberPage(client, { handle: 'ghost' })).toBeNull()
  })

  it('maps the member header, published items (with hrefs), and listed groups', async () => {
    const client = makeClient({
      members: tableStub({ single: MEMBER }),
      items: tableStub({
        list: [{ id: 'item-abcdef12', kind: 'product', title: 'Sourdough Loaf', brand_label: 'Oak Park Sourdough' }],
      }),
      member_public_group_memberships: tableStub({
        list: [{ slug: 'oak-park-bakers', name: 'Oak Park Bakers', kind: 'interest' }],
      }),
      member_has_standing_presence: tableStub({ single: { member_id: 'mem-1' } }),
    })

    const page = await resolveMemberPage(client, { handle: 'maya' })
    expect(page).not.toBeNull()
    expect(page!.displayName).toBe('Maya Rivera')
    expect(page!.handle).toBe('maya')
    expect(page!.bio).toBe('Baker of bread.')
    expect(page!.hasStandingPresence).toBe(true)
    expect(page!.items).toEqual([
      {
        itemId: 'item-abcdef12',
        kind: 'product',
        title: 'Sourdough Loaf',
        brandLabel: 'Oak Park Sourdough',
        href: '/m/maya/p/sourdough-loaf-item-abc',
      },
    ])
    expect(page!.groups).toEqual([{ slug: 'oak-park-bakers', name: 'Oak Park Bakers', kind: 'interest' }])
  })

  it('empty items + groups render as empty arrays, no standing badge', async () => {
    const client = makeClient({
      members: tableStub({ single: MEMBER }),
      member_has_standing_presence: tableStub({ single: null }),
    })
    const page = await resolveMemberPage(client, { handle: 'maya' })
    expect(page!.items).toEqual([])
    expect(page!.groups).toEqual([])
    expect(page!.hasStandingPresence).toBe(false)
  })

  it('isSelf true when the viewer is the member; follow state not queried', async () => {
    const client = makeClient({
      members: tableStub({ single: MEMBER }),
      member_has_standing_presence: tableStub({ single: null }),
    })
    const page = await resolveMemberPage(client, { handle: 'maya', viewerId: 'mem-1' })
    expect(page!.isSelf).toBe(true)
    expect(page!.isFollowing).toBe(false)
  })

  it('isFollowing true when an active follow row exists for a non-self viewer', async () => {
    const client = makeClient({
      members: tableStub({ single: MEMBER }),
      member_has_standing_presence: tableStub({ single: null }),
      member_follows: tableStub({ single: { follower_member_id: 'viewer-9' } }),
    })
    const page = await resolveMemberPage(client, { handle: 'maya', viewerId: 'viewer-9' })
    expect(page!.isSelf).toBe(false)
    expect(page!.isFollowing).toBe(true)
  })

  it('anon viewer is never following', async () => {
    const client = makeClient({
      members: tableStub({ single: MEMBER }),
      member_has_standing_presence: tableStub({ single: null }),
    })
    const page = await resolveMemberPage(client, { handle: 'maya', viewerId: null })
    expect(page!.isFollowing).toBe(false)
  })
})
