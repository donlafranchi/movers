import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  memberPlaceInterestAddInput,
  memberPlaceInterestRemoveInput,
  SECONDARY_LIMIT,
} from '../src/actions/member'

// T062 — action handler structure + Zod schema + barrel export.
// DB-touching assertions live in the Phase 1 evals (Playwright).

const ACTIONS = resolve(__dirname, '..', 'src', 'actions', 'member')

describe('T062 — place-interest action handler files exist', () => {
  for (const f of ['place-interest-add.ts', 'place-interest-remove.ts']) {
    it(`exists: src/actions/member/${f}`, () => {
      expect(existsSync(resolve(ACTIONS, f))).toBe(true)
    })
  }

  it('barrel re-exports both handlers', () => {
    const barrel = readFileSync(resolve(ACTIONS, 'index.ts'), 'utf8')
    expect(barrel).toMatch(/from\s+['"]\.\/place-interest-add['"]/)
    expect(barrel).toMatch(/from\s+['"]\.\/place-interest-remove['"]/)
    expect(barrel).toMatch(/memberPlaceInterestAdd/)
    expect(barrel).toMatch(/memberPlaceInterestRemove/)
  })
})

describe('T062 — Zod schemas', () => {
  it('add schema accepts a valid input', () => {
    const result = memberPlaceInterestAddInput.safeParse({
      placeId: '00000000-0000-0000-0000-000000000001',
      scopeKind: 'primary_home',
    })
    expect(result.success).toBe(true)
  })

  it('add schema rejects an invalid scopeKind', () => {
    const result = memberPlaceInterestAddInput.safeParse({
      placeId: '00000000-0000-0000-0000-000000000001',
      scopeKind: 'tertiary',
    })
    expect(result.success).toBe(false)
  })

  it('add schema rejects a non-UUID placeId', () => {
    const result = memberPlaceInterestAddInput.safeParse({
      placeId: 'not-a-uuid',
      scopeKind: 'secondary',
    })
    expect(result.success).toBe(false)
  })

  it('remove schema accepts a valid input', () => {
    const result = memberPlaceInterestRemoveInput.safeParse({
      placeId: '00000000-0000-0000-0000-000000000001',
      scopeKind: 'secondary',
    })
    expect(result.success).toBe(true)
  })
})

describe('T062 — secondary-cap constant', () => {
  it('SECONDARY_LIMIT is exported as 5 (member.md § Place-interest scope)', () => {
    expect(SECONDARY_LIMIT).toBe(5)
  })
})

describe('T062 — handler source encodes Gate-B-relevant absolutes', () => {
  const addSrc = readFileSync(resolve(ACTIONS, 'place-interest-add.ts'), 'utf8')

  it('atomic-swap path cites the load-bearing ordering rule', () => {
    expect(addSrc).toMatch(/atomic swap|order matters|DEFERRABLE/i)
  })

  it('event-kind use covers added / promoted / demoted', () => {
    expect(addSrc).toContain('member.place_interest_added')
    expect(addSrc).toContain('member.place_interest_promoted')
    expect(addSrc).toContain('member.place_interest_demoted')
  })

  it('throws ConflictError with secondary_limit_exceeded code', () => {
    expect(addSrc).toMatch(/member\.place_interest\.secondary_limit_exceeded/)
  })
})
