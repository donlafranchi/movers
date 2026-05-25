import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  memberSavedSearchCreateInput,
  memberSavedSearchUpdateInput,
  memberSavedSearchRemoveInput,
} from '../src/actions/member'

// T063 — saved-search handler structure + Zod schema + barrel export.
// DB-touching assertions live in Phase 1 evals.

const ACTIONS = resolve(__dirname, '..', 'src', 'actions', 'member')

describe('T063 — saved-search handler files exist', () => {
  for (const f of [
    'saved-search-create.ts',
    'saved-search-update.ts',
    'saved-search-remove.ts',
  ]) {
    it(`exists: src/actions/member/${f}`, () => {
      expect(existsSync(resolve(ACTIONS, f))).toBe(true)
    })
  }

  it('barrel re-exports all three handlers', () => {
    const barrel = readFileSync(resolve(ACTIONS, 'index.ts'), 'utf8')
    expect(barrel).toMatch(/memberSavedSearchCreate/)
    expect(barrel).toMatch(/memberSavedSearchUpdate/)
    expect(barrel).toMatch(/memberSavedSearchRemove/)
  })
})

describe('T063 — create schema: at-least-one-filter invariant', () => {
  const validUuid = '00000000-0000-0000-0000-000000000001'

  it('accepts a placeId-only search', () => {
    const r = memberSavedSearchCreateInput.safeParse({ label: 'Near Sacramento', placeId: validUuid })
    expect(r.success).toBe(true)
  })

  it('accepts a locationId-only search', () => {
    const r = memberSavedSearchCreateInput.safeParse({ label: 'At Drake\'s', locationId: validUuid })
    expect(r.success).toBe(true)
  })

  it('accepts an interest-tags-only search', () => {
    const r = memberSavedSearchCreateInput.safeParse({ label: 'Organic', interestTags: ['organic'] })
    expect(r.success).toBe(true)
  })

  it('rejects a no-filter search (label alone is not enough)', () => {
    const r = memberSavedSearchCreateInput.safeParse({ label: 'Nothing' })
    expect(r.success).toBe(false)
  })

  it('rejects a search with empty interestTags as the only filter', () => {
    const r = memberSavedSearchCreateInput.safeParse({ label: 'Empty', interestTags: [] })
    expect(r.success).toBe(false)
  })

  it('rejects an over-long label (>80 chars)', () => {
    const r = memberSavedSearchCreateInput.safeParse({
      label: 'x'.repeat(81),
      placeId: validUuid,
    })
    expect(r.success).toBe(false)
  })

  it('rejects an item_kinds value outside the kind enum', () => {
    const r = memberSavedSearchCreateInput.safeParse({
      label: 'Bad kind',
      placeId: validUuid,
      itemKinds: ['cooperative_cohort'],
    })
    expect(r.success).toBe(false)
  })
})

describe('T063 — update + remove schemas', () => {
  const validUuid = '00000000-0000-0000-0000-000000000001'

  it('update requires a UUID id', () => {
    const ok = memberSavedSearchUpdateInput.safeParse({ id: validUuid, label: 'Renamed' })
    expect(ok.success).toBe(true)
    const bad = memberSavedSearchUpdateInput.safeParse({ id: 'not-uuid' })
    expect(bad.success).toBe(false)
  })

  it('remove requires a UUID id and only an id', () => {
    const ok = memberSavedSearchRemoveInput.safeParse({ id: validUuid })
    expect(ok.success).toBe(true)
  })
})

describe('T063 — handler source emits the three event kinds', () => {
  const create = readFileSync(resolve(ACTIONS, 'saved-search-create.ts'), 'utf8')
  const update = readFileSync(resolve(ACTIONS, 'saved-search-update.ts'), 'utf8')
  const remove = readFileSync(resolve(ACTIONS, 'saved-search-remove.ts'), 'utf8')

  it('create emits member.saved_search.created', () => {
    expect(create).toContain('member.saved_search.created')
  })

  it('update emits member.saved_search.updated', () => {
    expect(update).toContain('member.saved_search.updated')
  })

  it('remove emits member.saved_search.removed', () => {
    expect(remove).toContain('member.saved_search.removed')
  })
})
