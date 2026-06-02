import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  memberBusinessJurisdictionSet,
  memberBusinessJurisdictionSetInput,
  memberBusinessJurisdictionRemove,
  memberBusinessJurisdictionRemoveInput,
} from '../src/actions/member'
import { getHandler, listHandlers } from '../src/actions'
import { ValidationError } from '../src/actions/_lib/errors'

// T075 — file-shape + pure-logic + registry + source-shape assertions for the
// two business-jurisdiction handlers. DB-touching behavior is verified by the
// SQL test (zip_is_proximal_to_location.sql) and the F037 Playwright eval
// against running Supabase — the repo has no live-DB vitest infra for handlers
// (mirrors the T070 actions test convention).

const ACTIONS_DIR = resolve(__dirname, '..', 'src', 'actions')

describe('T075 — handler files exist', () => {
  for (const f of [
    'member/business-jurisdiction-set.ts',
    'member/business-jurisdiction-remove.ts',
  ]) {
    it(`exists: src/actions/${f}`, () => {
      expect(existsSync(resolve(ACTIONS_DIR, f))).toBe(true)
    })
  }
})

describe('T075 — registry surfaces both handlers', () => {
  it('lists member.business_jurisdiction.set / .remove', () => {
    const names = listHandlers()
    expect(names).toContain('member.business_jurisdiction.set')
    expect(names).toContain('member.business_jurisdiction.remove')
  })

  it('getHandler resolves each by name', () => {
    expect(getHandler('member.business_jurisdiction.set')).toBe(
      memberBusinessJurisdictionSet as unknown,
    )
    expect(getHandler('member.business_jurisdiction.remove')).toBe(
      memberBusinessJurisdictionRemove as unknown,
    )
  })
})

describe('T075 — set input validation', () => {
  it('accepts a valid minimal input', () => {
    const parsed = memberBusinessJurisdictionSetInput.safeParse({
      groupId: '00000000-0000-0000-0000-000000000001',
      zip: '95818',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts optional state + legalEntityName', () => {
    const parsed = memberBusinessJurisdictionSetInput.safeParse({
      groupId: '00000000-0000-0000-0000-000000000001',
      zip: '95818',
      state: 'CA',
      legalEntityName: 'Oak Park Sourdough LLC',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a 4-digit zip', () => {
    expect(
      memberBusinessJurisdictionSetInput.safeParse({
        groupId: '00000000-0000-0000-0000-000000000001',
        zip: '9999',
      }).success,
    ).toBe(false)
  })

  it('rejects an alpha zip', () => {
    expect(
      memberBusinessJurisdictionSetInput.safeParse({
        groupId: '00000000-0000-0000-0000-000000000001',
        zip: 'abcde',
      }).success,
    ).toBe(false)
  })

  it('rejects a lowercase / 3-letter state', () => {
    expect(
      memberBusinessJurisdictionSetInput.safeParse({
        groupId: '00000000-0000-0000-0000-000000000001',
        zip: '95818',
        state: 'ca',
      }).success,
    ).toBe(false)
    expect(
      memberBusinessJurisdictionSetInput.safeParse({
        groupId: '00000000-0000-0000-0000-000000000001',
        zip: '95818',
        state: 'CAL',
      }).success,
    ).toBe(false)
  })

  it('rejects non-uuid groupId', () => {
    expect(
      memberBusinessJurisdictionSetInput.safeParse({
        groupId: 'not-a-uuid',
        zip: '95818',
      }).success,
    ).toBe(false)
  })

  it('handler wrapper raises ValidationError on bad input', async () => {
    const ctx = {
      db: {} as never,
      actingMemberId: '00000000-0000-0000-0000-000000000001' as const,
      viaDelegationId: null,
      traceId: 'test-trace',
      now: () => new Date(),
    } as never
    await expect(
      (memberBusinessJurisdictionSet as unknown as (c: unknown, i: unknown) => Promise<unknown>)(
        ctx,
        { groupId: 'x', zip: 'x' },
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('T075 — remove input validation', () => {
  it('accepts a valid uuid groupId', () => {
    expect(
      memberBusinessJurisdictionRemoveInput.safeParse({
        groupId: '00000000-0000-0000-0000-000000000001',
      }).success,
    ).toBe(true)
  })

  it('rejects missing / non-uuid groupId', () => {
    expect(memberBusinessJurisdictionRemoveInput.safeParse({}).success).toBe(false)
    expect(
      memberBusinessJurisdictionRemoveInput.safeParse({ groupId: 'short' }).success,
    ).toBe(false)
  })
})

describe('T075 — set handler source-shape', () => {
  const src = readFileSync(
    resolve(ACTIONS_DIR, 'member', 'business-jurisdiction-set.ts'),
    'utf8',
  )

  it('validates active owner-role membership in a kind=business group', () => {
    expect(src).toMatch(/group_memberships/)
    expect(src).toMatch(/role\s*=\s*'owner'/)
    expect(src).toMatch(/left_at\s+is\s+null/)
    expect(src).toMatch(/kind\s*=\s*'business'/)
    expect(src).toMatch(/AuthorizationError/)
  })

  it('soft-replaces the prior active row before inserting a fresh one', () => {
    expect(src).toMatch(/set\s+removed_at\s*=\s*now\(\)[\s\S]*?where[\s\S]*?removed_at\s+is\s+null/i)
    expect(src).toMatch(/insert into\s+public\.member_business_jurisdictions/)
    expect(src).toMatch(/'self_attested'/)
  })

  it('emits member.business_jurisdiction_set with an old->new zip diff', () => {
    expect(src).toMatch(/event_kind:\s*'member\.business_jurisdiction_set'/)
    expect(src).toMatch(/old_zip/)
    expect(src).toMatch(/new_zip/)
  })

  it('runs inside withTransaction (same-transaction row+event invariant)', () => {
    expect(src).toMatch(/withTransaction/)
    expect(src).toMatch(/appendEvent/)
  })
})

describe('T075 — remove handler source-shape', () => {
  const src = readFileSync(
    resolve(ACTIONS_DIR, 'member', 'business-jurisdiction-remove.ts'),
    'utf8',
  )

  it('validates active owner-role and raises NotFoundError on no active row', () => {
    expect(src).toMatch(/role\s*=\s*'owner'/)
    expect(src).toMatch(/AuthorizationError/)
    expect(src).toMatch(/NotFoundError/)
  })

  it('soft-deletes the active row and emits member.business_jurisdiction_removed', () => {
    expect(src).toMatch(/set\s+removed_at\s*=\s*now\(\)/i)
    expect(src).toMatch(/event_kind:\s*'member\.business_jurisdiction_removed'/)
  })
})
