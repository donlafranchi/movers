import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { itemCreateInput } from '../src/actions/item'

// T080 — generalize item.create for multi-kind support. Input-validation +
// branch-shape assertions. DB-touching atomicity stays with the F038 eval and
// the future F040/F034 evals — same split as T077.

const ACTIONS_DIR = resolve(__dirname, '..', 'src', 'actions')
const APP_DIR = resolve(__dirname, '..', 'src', 'app')
const MEMBER = '00000000-0000-0000-0000-000000000001'
const GROUP = '00000000-0000-0000-0000-000000000010'

describe('T080 — itemCreate accepts the three b1.3 kinds', () => {
  it('still accepts a minimal product', () => {
    expect(
      itemCreateInput.safeParse({ memberId: MEMBER, kind: 'product', title: 'Loaf' })
        .success,
    ).toBe(true)
  })

  it('accepts a service with rateModel + rateCents', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'service',
      groupId: GROUP,
      title: 'Weekend plumbing',
      rateModel: 'hourly',
      rateCents: 9500,
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a gathering with starts_at + capacity + cost', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'gathering',
      title: 'Tuesday run club',
      startsAt: '2026-07-01T18:00:00Z',
      endsAt: '2026-07-01T19:00:00Z',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
      capacity: 20,
      costCents: 0,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a kind outside the b1.3 enum (wonder)', () => {
    expect(
      itemCreateInput.safeParse({ memberId: MEMBER, kind: 'wonder', title: 'X' })
        .success,
    ).toBe(false)
  })

  it('rejects an unknown rateModel', () => {
    expect(
      itemCreateInput.safeParse({
        memberId: MEMBER,
        kind: 'service',
        title: 'X',
        rateModel: 'subscription',
      }).success,
    ).toBe(false)
  })

  it('rejects a non-positive gathering capacity', () => {
    expect(
      itemCreateInput.safeParse({
        memberId: MEMBER,
        kind: 'gathering',
        title: 'X',
        capacity: 0,
      }).success,
    ).toBe(false)
  })
})

describe('T080 — create.ts branches the child insert on kind', () => {
  const src = readFileSync(resolve(ACTIONS_DIR, 'item', 'create.ts'), 'utf8')

  it('widens kind to the three-kind enum', () => {
    expect(src).toMatch(/z\.enum\(\s*\[\s*'product',\s*'service',\s*'gathering'\s*\]/)
    expect(src).not.toMatch(/z\.literal\(\s*'product'\s*\)/)
  })

  it('inserts each per-kind child table', () => {
    expect(src).toMatch(/insert into public\.item_products/)
    expect(src).toMatch(/insert into public\.item_services/)
    expect(src).toMatch(/insert into public\.item_gatherings/)
  })

  it('writes input.kind to the spine and the created event', () => {
    expect(src).toMatch(/kind:\s*input\.kind/)
    // spine insert no longer hard-codes the product literal in values
    expect(src).not.toMatch(/values\s*\(\$1,\s*'product'/)
  })
})

describe('T080 — /you/sell row is data-driven', () => {
  const src = readFileSync(resolve(APP_DIR, 'you', 'sell', 'page.tsx'), 'utf8')

  it('drops the upcoming-bundles placeholder paragraph', () => {
    expect(src).not.toMatch(/land in upcoming bundles/)
  })

  it('keeps the product composer entry', () => {
    expect(src).toMatch(/AddProductButton/)
  })
})
