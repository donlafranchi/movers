import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  groupCreate,
  groupCreateInput,
  groupUpdateDraft,
  groupUpdateDraftInput,
  groupActivate,
  groupActivateInput,
} from '../src/actions/group'
import { getHandler, listHandlers } from '../src/actions'
import { ValidationError } from '../src/actions/_lib/errors'

// T070 — file-shape + pure-logic + registry assertions for the three group
// handlers. DB-touching behavior is verified by the migration + RLS suites
// and the F036 Playwright eval against running Supabase.

const ACTIONS_DIR = resolve(__dirname, '..', 'src', 'actions')

describe('T070 — action layer: group handler files exist', () => {
  for (const f of [
    'group/index.ts',
    'group/create.ts',
    'group/update-draft.ts',
    'group/activate.ts',
  ]) {
    it(`exists: src/actions/${f}`, () => {
      expect(existsSync(resolve(ACTIONS_DIR, f))).toBe(true)
    })
  }
})

describe('T070 — registry surfaces the three group handlers', () => {
  it('lists group.create / group.update_draft / group.activate', () => {
    const names = listHandlers()
    expect(names).toContain('group.create')
    expect(names).toContain('group.update_draft')
    expect(names).toContain('group.activate')
  })

  it('getHandler resolves each handler by name', () => {
    expect(getHandler('group.create')).toBe(groupCreate as unknown)
    expect(getHandler('group.update_draft')).toBe(groupUpdateDraft as unknown)
    expect(getHandler('group.activate')).toBe(groupActivate as unknown)
  })
})

describe('T070 — groupCreate input validation', () => {
  it('accepts a valid kind=business minimal input', () => {
    const parsed = groupCreateInput.safeParse({
      kind: 'business',
      founderMemberId: '00000000-0000-0000-0000-000000000001',
      businessDisplayName: 'Oak Park Sourdough',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects unknown kind values', () => {
    const parsed = groupCreateInput.safeParse({
      kind: 'corporation',
      founderMemberId: '00000000-0000-0000-0000-000000000001',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects non-uuid founderMemberId', () => {
    const parsed = groupCreateInput.safeParse({
      kind: 'business',
      founderMemberId: 'not-a-uuid',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects empty businessDisplayName when supplied', () => {
    const parsed = groupCreateInput.safeParse({
      kind: 'business',
      founderMemberId: '00000000-0000-0000-0000-000000000001',
      businessDisplayName: '',
    })
    expect(parsed.success).toBe(false)
  })

  it('caps businessDisplayName at 120 characters', () => {
    const parsed = groupCreateInput.safeParse({
      kind: 'business',
      founderMemberId: '00000000-0000-0000-0000-000000000001',
      businessDisplayName: 'a'.repeat(121),
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts all six group kinds', () => {
    for (const kind of [
      'place',
      'interest',
      'practice',
      'event_anchored',
      'family',
      'business',
    ]) {
      const parsed = groupCreateInput.safeParse({
        kind,
        founderMemberId: '00000000-0000-0000-0000-000000000001',
        name: 'Test',
      })
      expect(parsed.success, `kind=${kind} should validate`).toBe(true)
    }
  })

  it('handler wrapper raises ValidationError on bad input', async () => {
    const ctx = {
      db: {} as never,
      actingMemberId: '00000000-0000-0000-0000-000000000001' as const,
      traceId: 'test-trace',
      now: () => new Date(),
    } as never
    await expect(
      (groupCreate as unknown as (c: unknown, i: unknown) => Promise<unknown>)(
        ctx,
        { kind: 'not-a-kind' },
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('T070 — groupUpdateDraft input validation', () => {
  it('accepts a patch with only a groupId (no-op patch is permitted)', () => {
    const parsed = groupUpdateDraftInput.safeParse({
      groupId: '00000000-0000-0000-0000-000000000010',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts business-only fields alongside spine fields', () => {
    const parsed = groupUpdateDraftInput.safeParse({
      groupId: '00000000-0000-0000-0000-000000000010',
      name: 'Oak Park Sourdough',
      businessDisplayName: 'Oak Park Sourdough',
      businessPublicDescription: 'Sourdough baked in Oak Park.',
      anchorLocationId: '00000000-0000-0000-0000-000000000020',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts nulling out anchorLocationId', () => {
    const parsed = groupUpdateDraftInput.safeParse({
      groupId: '00000000-0000-0000-0000-000000000010',
      anchorLocationId: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects unknown businessLegalEntityKind values', () => {
    const parsed = groupUpdateDraftInput.safeParse({
      groupId: '00000000-0000-0000-0000-000000000010',
      businessLegalEntityKind: 'b-corp',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects non-uuid groupId', () => {
    const parsed = groupUpdateDraftInput.safeParse({ groupId: 'not-uuid' })
    expect(parsed.success).toBe(false)
  })
})

describe('T070 — groupActivate input validation', () => {
  it('accepts a valid uuid groupId', () => {
    const parsed = groupActivateInput.safeParse({
      groupId: '00000000-0000-0000-0000-000000000010',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects missing groupId', () => {
    const parsed = groupActivateInput.safeParse({})
    expect(parsed.success).toBe(false)
  })

  it('rejects non-uuid groupId', () => {
    const parsed = groupActivateInput.safeParse({ groupId: 'short' })
    expect(parsed.success).toBe(false)
  })
})

describe('T070 — handler source-shape sanity checks', () => {
  const createSrc = readFileSync(
    resolve(ACTIONS_DIR, 'group', 'create.ts'),
    'utf8',
  )
  const updateSrc = readFileSync(
    resolve(ACTIONS_DIR, 'group', 'update-draft.ts'),
    'utf8',
  )
  const activateSrc = readFileSync(
    resolve(ACTIONS_DIR, 'group', 'activate.ts'),
    'utf8',
  )

  it('group.create writes lifecycle_state=\'draft\' literally', () => {
    expect(createSrc).toMatch(/lifecycle_state\)[\s\S]*?values[\s\S]*?'draft'/)
  })

  it('group.create writes role=\'owner\' + source=\'explicit\' for founder membership', () => {
    expect(createSrc).toMatch(/'owner'/)
    expect(createSrc).toMatch(/'explicit'/)
  })

  it('group.create emits group.created + group.member_joined events', () => {
    expect(createSrc).toMatch(/event_kind:\s*'group\.created'/)
    expect(createSrc).toMatch(/event_kind:\s*'group\.member_joined'/)
  })

  it('group.update_draft refuses on non-draft rows', () => {
    expect(updateSrc).toMatch(/lifecycle_state\s*!==\s*'draft'/)
    expect(updateSrc).toMatch(/ValidationError/)
  })

  it('group.update_draft requires caller to be a role=\'owner\' member', () => {
    expect(updateSrc).toMatch(/role\s*=\s*'owner'/)
    expect(updateSrc).toMatch(/AuthorizationError/)
  })

  it('group.update_draft emits NO events (per-step writes don\'t flood the log)', () => {
    expect(updateSrc).not.toMatch(/appendEvent/)
  })

  it('group.activate promotes draft -> active and emits group.activated', () => {
    expect(activateSrc).toMatch(
      /set\s+lifecycle_state\s*=\s*'active'[\s\S]*?lifecycle_state\s*=\s*'draft'/,
    )
    expect(activateSrc).toMatch(/event_kind:\s*'group\.activated'/)
  })

  it('group.activate validates kind=\'business\' required fields before promotion', () => {
    expect(activateSrc).toMatch(/anchor_location_id/)
    expect(activateSrc).toMatch(/display_name/)
  })

  it('group.activate is founder-only', () => {
    expect(activateSrc).toMatch(/founder_member_id/)
    expect(activateSrc).toMatch(/AuthorizationError/)
  })
})
