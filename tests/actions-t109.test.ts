import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import {
  groupMemberLeave,
  groupMemberLeaveInput,
  groupMemberJoin,
  groupMemberJoinInput,
} from '../src/actions/group'
import {
  memberSavedSearchRestore,
  memberSavedSearchRestoreInput,
} from '../src/actions/member'
import { getHandler, listHandlers } from '../src/actions'
import { ValidationError } from '../src/actions/_lib/errors'

// T109 — file-shape + zod + registry + source-shape assertions for the three
// F042 management-page write handlers. DB-touching behavior (soft-delete column,
// event row, idempotency, owner collapse) is verified by the F042 Playwright
// eval against running Supabase — same split as T077/T093.

const ACTIONS_DIR = resolve(__dirname, '..', 'src', 'actions')
const GROUP = '00000000-0000-0000-0000-000000000010'
const SS = '00000000-0000-0000-0000-000000000020'
const MEMBER = '00000000-0000-0000-0000-000000000001'

describe('T109 — handler files exist', () => {
  it('group/member-leave.ts, group/member-join.ts, member/saved-search-restore.ts', () => {
    expect(existsSync(resolve(ACTIONS_DIR, 'group', 'member-leave.ts'))).toBe(true)
    expect(existsSync(resolve(ACTIONS_DIR, 'group', 'member-join.ts'))).toBe(true)
    expect(existsSync(resolve(ACTIONS_DIR, 'member', 'saved-search-restore.ts'))).toBe(true)
  })
})

describe('T109 — registry surfaces the new handlers', () => {
  it('lists group.member_leave / group.member_join / member.saved_search.restore', () => {
    const names = listHandlers()
    expect(names).toContain('group.member_leave')
    expect(names).toContain('group.member_join')
    expect(names).toContain('member.saved_search.restore')
  })

  it('getHandler resolves each by name', () => {
    expect(getHandler('group.member_leave')).toBe(groupMemberLeave as unknown)
    expect(getHandler('group.member_join')).toBe(groupMemberJoin as unknown)
    expect(getHandler('member.saved_search.restore')).toBe(memberSavedSearchRestore as unknown)
  })
})

describe('T109 — input validation', () => {
  it('group.member_leave / join require a uuid groupId', () => {
    expect(groupMemberLeaveInput.safeParse({ groupId: GROUP }).success).toBe(true)
    expect(groupMemberLeaveInput.safeParse({ groupId: 'nope' }).success).toBe(false)
    expect(groupMemberJoinInput.safeParse({ groupId: GROUP }).success).toBe(true)
    expect(groupMemberJoinInput.safeParse({ groupId: 'nope' }).success).toBe(false)
  })

  it('member.saved_search.restore requires a uuid id', () => {
    expect(memberSavedSearchRestoreInput.safeParse({ id: SS }).success).toBe(true)
    expect(memberSavedSearchRestoreInput.safeParse({ id: 'nope' }).success).toBe(false)
  })

  it('handler wrappers raise ValidationError on bad input', async () => {
    const ctx = {
      db: {} as never,
      actingMemberId: MEMBER,
      viaDelegationId: null,
      traceId: 't',
      now: () => new Date(),
    } as never
    const call = (h: unknown, i: unknown) =>
      (h as (c: unknown, i: unknown) => Promise<unknown>)(ctx, i)
    await expect(call(groupMemberLeave, { groupId: 'nope' })).rejects.toBeInstanceOf(ValidationError)
    await expect(call(groupMemberJoin, { groupId: 'nope' })).rejects.toBeInstanceOf(ValidationError)
    await expect(call(memberSavedSearchRestore, { id: 'nope' })).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('T109 — handler source-shape sanity', () => {
  const leaveSrc = readFileSync(resolve(ACTIONS_DIR, 'group', 'member-leave.ts'), 'utf8')
  const joinSrc = readFileSync(resolve(ACTIONS_DIR, 'group', 'member-join.ts'), 'utf8')
  const restoreSrc = readFileSync(resolve(ACTIONS_DIR, 'member', 'saved-search-restore.ts'), 'utf8')

  it('member_leave soft-deletes left_at and emits group.member_left', () => {
    expect(leaveSrc).toMatch(/set left_at = now\(\)/)
    expect(leaveSrc).toMatch(/event_kind:\s*'group\.member_left'/)
  })

  it('member_join re-activates by clearing left_at on conflict and emits group.member_joined', () => {
    expect(joinSrc).toMatch(/on conflict[\s\S]*do update set left_at = null/)
    expect(joinSrc).toMatch(/source = 'explicit'|'explicit'/)
    expect(joinSrc).toMatch(/event_kind:\s*'group\.member_joined'/)
  })

  it('saved_search.restore clears removed_at and collapses not-owner to NotFoundError', () => {
    expect(restoreSrc).toMatch(/set removed_at = null/)
    expect(restoreSrc).toMatch(/NotFoundError/)
  })
})
