import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  memberInterestsAdd,
  memberInterestsAddInput,
} from '../src/actions/member'
import { getHandler, listHandlers } from '../src/actions'

// T086 — file-shape + zod + registry + source-shape assertions for the
// member.interests.add handler and the onboarding handler registrations.
// DB behaviour (row insert + member.interest_added event) is verified by the
// F030 Playwright eval — same split as T077.

const ACTIONS_DIR = resolve(__dirname, '..', 'src', 'actions')

describe('T086 — interests-add handler file', () => {
  it('exists: src/actions/member/interests-add.ts', () => {
    expect(existsSync(resolve(ACTIONS_DIR, 'member', 'interests-add.ts'))).toBe(true)
  })
})

describe('T086 — registry surfaces onboarding write handlers', () => {
  it('resolves the three handlers onboarding invokes', () => {
    expect(getHandler('member.interests.add')).not.toBeNull()
    expect(getHandler('member.place_interest.add')).not.toBeNull()
    expect(getHandler('member.place_interest.remove')).not.toBeNull()
  })

  it('listHandlers includes them', () => {
    const names = listHandlers()
    expect(names).toContain('member.interests.add')
    expect(names).toContain('member.place_interest.add')
    expect(names).toContain('member.place_interest.remove')
  })

  it('handler carries its registered name', () => {
    expect(memberInterestsAdd.name).toBe('member.interests.add')
  })
})

describe('T086 — memberInterestsAddInput zod', () => {
  it('accepts a single valid tag', () => {
    expect(memberInterestsAddInput.safeParse({ tags: ['live-music'] }).success).toBe(true)
  })

  it('accepts multiple valid tags', () => {
    expect(
      memberInterestsAddInput.safeParse({ tags: ['baking', 'farmers-market', 'jazz'] }).success,
    ).toBe(true)
  })

  it('rejects an empty array', () => {
    expect(memberInterestsAddInput.safeParse({ tags: [] }).success).toBe(false)
  })

  it('rejects uppercase, spaces, and overlong tags', () => {
    expect(memberInterestsAddInput.safeParse({ tags: ['LiveMusic'] }).success).toBe(false)
    expect(memberInterestsAddInput.safeParse({ tags: ['live music'] }).success).toBe(false)
    expect(memberInterestsAddInput.safeParse({ tags: ['a'.repeat(61)] }).success).toBe(false)
  })

  it('rejects more than 20 tags', () => {
    const many = Array.from({ length: 21 }, (_, i) => `tag-${i}`)
    expect(memberInterestsAddInput.safeParse({ tags: many }).success).toBe(false)
  })
})

describe('T086 — handler source shape', () => {
  const src = readFileSync(resolve(ACTIONS_DIR, 'member', 'interests-add.ts'), 'utf8')

  it('inserts idempotently (on conflict do nothing)', () => {
    expect(src).toMatch(/on conflict[\s\S]*do nothing/i)
  })

  it('emits member.interest_added', () => {
    expect(src).toContain('member.interest_added')
  })
})
