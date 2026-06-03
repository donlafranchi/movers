import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  memberFollow,
  memberUnfollow,
  memberFollowInput,
} from '../src/actions/member'
import { getHandler, listHandlers, ValidationError, makeContext } from '../src/actions'
import type { PoolClient } from 'pg'

// T091 — file-shape + zod + registry + pre-transaction guard assertions for
// member.follow / member.unfollow. DB behaviour (row upsert + member.followed /
// member.unfollowed event) is verified by the F032 Playwright eval — same split
// as T077 / T086.

const ACTIONS = resolve(__dirname, '..', 'src', 'actions', 'member')

// A PoolClient that explodes if any handler reaches the DB. The self-follow and
// sentinel guards run BEFORE withTransaction, so these tests never touch it.
const explodingDb = new Proxy({} as PoolClient, {
  get() {
    throw new Error('handler reached the DB before its pre-transaction guard')
  },
})

function ctxFor(actingMemberId: string) {
  return makeContext({ actingMemberId, db: explodingDb })
}

describe('T091 — follow handler files exist', () => {
  it('exists: src/actions/member/follow.ts', () => {
    expect(existsSync(resolve(ACTIONS, 'follow.ts'))).toBe(true)
  })

  it('barrel re-exports both handlers', () => {
    const barrel = readFileSync(resolve(ACTIONS, 'index.ts'), 'utf8')
    expect(barrel).toMatch(/from\s+['"]\.\/follow['"]/)
    expect(barrel).toMatch(/memberFollow/)
    expect(barrel).toMatch(/memberUnfollow/)
  })
})

describe('T091 — registry surfaces follow handlers', () => {
  it('resolves member.follow / member.unfollow', () => {
    expect(getHandler('member.follow')).not.toBeNull()
    expect(getHandler('member.unfollow')).not.toBeNull()
  })

  it('listHandlers includes them', () => {
    const names = listHandlers()
    expect(names).toContain('member.follow')
    expect(names).toContain('member.unfollow')
  })

  it('handlers carry their registered names', () => {
    expect(memberFollow.name).toBe('member.follow')
    expect(memberUnfollow.name).toBe('member.unfollow')
  })
})

describe('T091 — memberFollowInput zod', () => {
  const target = '00000000-0000-0000-0000-000000000abc'

  it('accepts a valid followedMemberId', () => {
    expect(memberFollowInput.safeParse({ followedMemberId: target }).success).toBe(true)
  })

  it('rejects a non-UUID followedMemberId', () => {
    expect(memberFollowInput.safeParse({ followedMemberId: 'nope' }).success).toBe(false)
  })
})

describe('T091 — pre-transaction guards (no DB)', () => {
  const me = '11111111-1111-1111-1111-111111111111'

  it('memberFollow rejects following yourself with ValidationError', async () => {
    await expect(
      memberFollow(ctxFor(me), { followedMemberId: me }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('memberUnfollow rejects unfollowing yourself with ValidationError', async () => {
    await expect(
      memberUnfollow(ctxFor(me), { followedMemberId: me }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('memberFollow rejects the self-bootstrap sentinel', async () => {
    await expect(
      memberFollow(ctxFor('self-bootstrap'), {
        followedMemberId: '22222222-2222-2222-2222-222222222222',
      }),
    ).rejects.toThrow(/actingMemberId/)
  })
})

describe('T091 — handler source uses the right event kinds', () => {
  const src = readFileSync(resolve(ACTIONS, 'follow.ts'), 'utf8')
  it('emits member.followed and member.unfollowed', () => {
    expect(src).toContain('member.followed')
    expect(src).toContain('member.unfollowed')
  })
  it('soft-unfollow sets unfollowed_at (not a delete)', () => {
    expect(src).toMatch(/unfollowed_at/)
    expect(src).not.toMatch(/delete\s+from\s+public\.member_follows/i)
  })
})
