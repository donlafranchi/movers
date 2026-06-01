// T073 — Unit tests for getDraftGroup resume detector.
// Tests trace back to T073 § Acceptance Criteria — /you Sell CTA wiring.
// Routing logic with 3 branches.

import { describe, it, expect, vi } from 'vitest'
import {
  getDraftGroup,
  resumeStepFor,
  SELL_DRAFT_NAME_PLACEHOLDER,
} from './getDraftGroup'
import { DRAFT_NAME_PLACEHOLDER } from '@/actions/group/constants'
import type { SupabaseClient } from '@supabase/supabase-js'

// Builds a chainable thenable Supabase query stub. The eq/.is/.order/.limit
// calls return `this`; the terminal await returns { data, error }.
function makeSupabaseStub(responses: {
  group_memberships?: { data: unknown; error: { message: string } | null }
  groups?: { data: unknown; error: { message: string } | null }
}): SupabaseClient {
  const builder = (table: 'group_memberships' | 'groups') => {
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    chain.select = passthrough
    chain.eq = passthrough
    chain.is = passthrough
    chain.order = passthrough
    chain.limit = passthrough
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(responses[table] ?? { data: [], error: null }).then(onFulfilled)
    return chain
  }
  return {
    from: vi.fn((table: string) =>
      builder(table as 'group_memberships' | 'groups'),
    ),
  } as unknown as SupabaseClient
}

describe('SELL_DRAFT_NAME_PLACEHOLDER', () => {
  it('matches the action-handler constant (drift guard)', () => {
    // Drift here would flip "no brand yet" → "has brand" on resume,
    // skipping the user past step 1 with no value.
    expect(SELL_DRAFT_NAME_PLACEHOLDER).toBe(DRAFT_NAME_PLACEHOLDER)
  })
})

describe('resumeStepFor', () => {
  it('returns 0 when brand name is missing', () => {
    expect(resumeStepFor({ brandName: null, anchorLocationId: null })).toBe(0)
  })

  it('returns 0 when brand name is the draft placeholder', () => {
    expect(
      resumeStepFor({
        brandName: DRAFT_NAME_PLACEHOLDER,
        anchorLocationId: 'loc-1',
      }),
    ).toBe(0)
  })

  it('returns 1 when brand is set but anchor Location missing', () => {
    expect(
      resumeStepFor({ brandName: 'Oak Park Sourdough', anchorLocationId: null }),
    ).toBe(1)
  })

  it('returns 2 (About) when brand + anchor are both set', () => {
    expect(
      resumeStepFor({
        brandName: 'Oak Park Sourdough',
        anchorLocationId: 'loc-1',
      }),
    ).toBe(2)
  })
})

describe('getDraftGroup', () => {
  const MEMBER = '00000000-0000-0000-0000-000000000001'

  it('returns hasActiveBusinessGroup=true when caller owns an active Shop', async () => {
    const sb = makeSupabaseStub({
      group_memberships: {
        data: [
          {
            group_id: 'g-active',
            groups: { kind: 'business', lifecycle_state: 'active' },
          },
        ],
        error: null,
      },
    })
    const result = await getDraftGroup(sb, MEMBER)
    expect(result.hasActiveBusinessGroup).toBe(true)
    expect(result.draftGroup).toBeNull()
  })

  it('returns no draft and no active when first-time Seller', async () => {
    const sb = makeSupabaseStub({
      group_memberships: { data: [], error: null },
      groups: { data: [], error: null },
    })
    const result = await getDraftGroup(sb, MEMBER)
    expect(result.hasActiveBusinessGroup).toBe(false)
    expect(result.draftGroup).toBeNull()
  })

  it('returns the in-flight draft when one exists', async () => {
    const sb = makeSupabaseStub({
      group_memberships: { data: [], error: null },
      groups: {
        data: [
          {
            id: 'g-draft',
            name: 'Oak Park Sourdough',
            anchor_location_id: 'loc-1',
            group_businesses: [
              { display_name: 'Oak Park Sourdough', public_description: 'bread' },
            ],
          },
        ],
        error: null,
      },
    })
    const result = await getDraftGroup(sb, MEMBER)
    expect(result.hasActiveBusinessGroup).toBe(false)
    expect(result.draftGroup).toEqual({
      groupId: 'g-draft',
      brandName: 'Oak Park Sourdough',
      anchorLocationId: 'loc-1',
      publicDescription: 'bread',
      resumeFromStep: 2, // brand + anchor set → resume at About
    })
  })

  it('treats DRAFT_NAME_PLACEHOLDER as no brand (resume at step 0)', async () => {
    const sb = makeSupabaseStub({
      group_memberships: { data: [], error: null },
      groups: {
        data: [
          {
            id: 'g-draft',
            name: DRAFT_NAME_PLACEHOLDER,
            anchor_location_id: null,
            group_businesses: [
              { display_name: DRAFT_NAME_PLACEHOLDER, public_description: null },
            ],
          },
        ],
        error: null,
      },
    })
    const result = await getDraftGroup(sb, MEMBER)
    expect(result.draftGroup?.brandName).toBeNull()
    expect(result.draftGroup?.resumeFromStep).toBe(0)
  })

  it('throws when active-membership query fails (do not silently fall through)', async () => {
    const sb = makeSupabaseStub({
      group_memberships: { data: null, error: { message: 'rls denied' } },
    })
    await expect(getDraftGroup(sb, MEMBER)).rejects.toThrow(/active memberships/)
  })

  it('throws when draft query fails', async () => {
    const sb = makeSupabaseStub({
      group_memberships: { data: [], error: null },
      groups: { data: null, error: { message: 'timeout' } },
    })
    await expect(getDraftGroup(sb, MEMBER)).rejects.toThrow(/drafts/)
  })

  it('skips the draft query entirely when an active Shop is owned', async () => {
    const sb = makeSupabaseStub({
      group_memberships: {
        data: [{ group_id: 'g', groups: { kind: 'business', lifecycle_state: 'active' } }],
        error: null,
      },
    })
    await getDraftGroup(sb, MEMBER)
    // `from('groups')` is never called — the active branch returns first.
    const calls = (sb.from as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(calls).toContain('group_memberships')
    expect(calls).not.toContain('groups')
  })
})
