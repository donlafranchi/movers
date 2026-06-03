// T092/T095 — Unit tests for the public Member-page resolver (F032).
// Trace: planning/now/scenario-F032-viewer-finds-member-page-and-follows.md
//        product/systems/member.md § Privacy controls (T095 discoverability gate)
//
// The render/tombstone/404 verdict comes from the resolve_member_page_visibility
// RPC (migration 030); these tests stub it directly. The RPC's own SQL gating
// (anon vs signed-in vs self × visibility × discoverability) is exercised against
// a live DB by the Playwright eval — here we verify the resolver maps each
// verdict to the right MemberPageView and only reads page data on `render`.

import { describe, it, expect } from 'vitest'
import { resolveMemberPage } from './resolve-member-page'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return chain
}

// rpc('resolve_member_page_visibility', ...) → { data: [row], error }.
type VerdictRow = {
  member_id: string | null
  verdict: 'render' | 'tombstone' | 'notfound'
  is_discoverable: boolean | null
  profile_visibility: string | null
}

function makeClient(opts: {
  verdict?: VerdictRow | null
  verdictError?: boolean
  tables?: Record<string, ReturnType<typeof tableStub>>
}) {
  const tables = opts.tables ?? {}
  return {
    rpc: (_name: string) =>
      Promise.resolve({
        data: opts.verdict ? [opts.verdict] : opts.verdict === null ? [] : null,
        error: opts.verdictError ? { message: 'boom' } : null,
      }),
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

const RENDER_TABLES = {
  members: tableStub({ single: MEMBER }),
  member_has_standing_presence: tableStub({ single: null }),
}

describe('resolveMemberPage — visibility verdict', () => {
  it('notfound verdict → { kind: notfound } (anon hits non-discoverable default)', async () => {
    const client = makeClient({
      verdict: { member_id: null, verdict: 'notfound', is_discoverable: null, profile_visibility: null },
    })
    expect(await resolveMemberPage(client, { handle: 'maya', viewerId: null })).toEqual({ kind: 'notfound' })
  })

  it('no row from the RPC (handle does not exist) → notfound', async () => {
    const client = makeClient({ verdict: null })
    expect(await resolveMemberPage(client, { handle: 'ghost' })).toEqual({ kind: 'notfound' })
  })

  it('RPC error → notfound (fail closed)', async () => {
    const client = makeClient({ verdictError: true })
    expect(await resolveMemberPage(client, { handle: 'maya' })).toEqual({ kind: 'notfound' })
  })

  it('tombstone verdict (signed-in viewer, private member) → { kind: tombstone }', async () => {
    const client = makeClient({
      verdict: { member_id: 'mem-1', verdict: 'tombstone', is_discoverable: false, profile_visibility: 'private' },
    })
    expect(await resolveMemberPage(client, { handle: 'maya', viewerId: 'viewer-9' })).toEqual({
      kind: 'tombstone',
      handle: 'maya',
    })
  })

  it('render verdict + discoverable + public → render, indexable true', async () => {
    const client = makeClient({
      verdict: { member_id: 'mem-1', verdict: 'render', is_discoverable: true, profile_visibility: 'public' },
      tables: RENDER_TABLES,
    })
    const view = await resolveMemberPage(client, { handle: 'maya', viewerId: null })
    expect(view.kind).toBe('render')
    if (view.kind !== 'render') throw new Error('unreachable')
    expect(view.indexable).toBe(true)
    expect(view.page.displayName).toBe('Maya Rivera')
  })

  it('render verdict + members_only (signed-in, direct URL) → render, indexable false', async () => {
    const client = makeClient({
      verdict: { member_id: 'mem-1', verdict: 'render', is_discoverable: false, profile_visibility: 'members_only' },
      tables: RENDER_TABLES,
    })
    const view = await resolveMemberPage(client, { handle: 'maya', viewerId: 'viewer-9' })
    expect(view.kind).toBe('render')
    if (view.kind !== 'render') throw new Error('unreachable')
    expect(view.indexable).toBe(false)
  })

  it('render verdict + public but NOT discoverable → render, indexable false (noindex)', async () => {
    const client = makeClient({
      verdict: { member_id: 'mem-1', verdict: 'render', is_discoverable: false, profile_visibility: 'public' },
      tables: RENDER_TABLES,
    })
    const view = await resolveMemberPage(client, { handle: 'maya' })
    if (view.kind !== 'render') throw new Error('unreachable')
    expect(view.indexable).toBe(false)
  })
})

describe('resolveMemberPage — render payload (verdict already render)', () => {
  const renderVerdict: VerdictRow = {
    member_id: 'mem-1',
    verdict: 'render',
    is_discoverable: true,
    profile_visibility: 'public',
  }

  it('maps the member header, published items (with hrefs), and listed groups', async () => {
    const client = makeClient({
      verdict: renderVerdict,
      tables: {
        members: tableStub({ single: MEMBER }),
        items: tableStub({
          list: [{ id: 'item-abcdef12', kind: 'product', title: 'Sourdough Loaf', brand_label: 'Oak Park Sourdough' }],
        }),
        member_public_group_memberships: tableStub({
          list: [{ slug: 'oak-park-bakers', name: 'Oak Park Bakers', kind: 'interest' }],
        }),
        member_has_standing_presence: tableStub({ single: { member_id: 'mem-1' } }),
      },
    })

    const view = await resolveMemberPage(client, { handle: 'maya' })
    if (view.kind !== 'render') throw new Error('unreachable')
    const page = view.page
    expect(page.displayName).toBe('Maya Rivera')
    expect(page.handle).toBe('maya')
    expect(page.bio).toBe('Baker of bread.')
    expect(page.hasStandingPresence).toBe(true)
    expect(page.items).toEqual([
      {
        itemId: 'item-abcdef12',
        kind: 'product',
        title: 'Sourdough Loaf',
        brandLabel: 'Oak Park Sourdough',
        href: '/m/maya/p/sourdough-loaf-item-abc',
      },
    ])
    expect(page.groups).toEqual([{ slug: 'oak-park-bakers', name: 'Oak Park Bakers', kind: 'interest' }])
  })

  it('empty items + groups render as empty arrays, no standing badge', async () => {
    const client = makeClient({ verdict: renderVerdict, tables: RENDER_TABLES })
    const view = await resolveMemberPage(client, { handle: 'maya' })
    if (view.kind !== 'render') throw new Error('unreachable')
    expect(view.page.items).toEqual([])
    expect(view.page.groups).toEqual([])
    expect(view.page.hasStandingPresence).toBe(false)
  })

  it('isSelf true when the viewer is the member; follow state not queried', async () => {
    const client = makeClient({ verdict: renderVerdict, tables: RENDER_TABLES })
    const view = await resolveMemberPage(client, { handle: 'maya', viewerId: 'mem-1' })
    if (view.kind !== 'render') throw new Error('unreachable')
    expect(view.page.isSelf).toBe(true)
    expect(view.page.isFollowing).toBe(false)
  })

  it('isFollowing true when an active follow row exists for a non-self viewer', async () => {
    const client = makeClient({
      verdict: renderVerdict,
      tables: {
        members: tableStub({ single: MEMBER }),
        member_has_standing_presence: tableStub({ single: null }),
        member_follows: tableStub({ single: { follower_member_id: 'viewer-9' } }),
      },
    })
    const view = await resolveMemberPage(client, { handle: 'maya', viewerId: 'viewer-9' })
    if (view.kind !== 'render') throw new Error('unreachable')
    expect(view.page.isSelf).toBe(false)
    expect(view.page.isFollowing).toBe(true)
  })

  it('anon viewer is never following', async () => {
    const client = makeClient({ verdict: renderVerdict, tables: RENDER_TABLES })
    const view = await resolveMemberPage(client, { handle: 'maya', viewerId: null })
    if (view.kind !== 'render') throw new Error('unreachable')
    expect(view.page.isFollowing).toBe(false)
  })
})
