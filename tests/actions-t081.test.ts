import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { itemCreateInput } from '../src/actions/item'

// T081 — item.create service arm: write item_services.service_area_geography
// (PostGIS circle from center + radius). Input-validation + source-shape
// assertions; DB atomicity stays with the F040 eval (same split as T077/T080).

const ACTIONS_DIR = resolve(__dirname, '..', 'src', 'actions')
const MEMBER = '00000000-0000-0000-0000-000000000001'
const GROUP = '00000000-0000-0000-0000-000000000010'

describe('T081 — itemCreate accepts service-area inputs', () => {
  it('accepts a service with center + radius', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'service',
      groupId: GROUP,
      title: 'Piano lessons',
      rateModel: 'flat',
      rateCents: 4000,
      serviceAreaCenterLat: 38.5816,
      serviceAreaCenterLon: -121.4944,
      serviceAreaRadiusMeters: 8046.72,
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a service with no service area (all three omitted)', () => {
    expect(
      itemCreateInput.safeParse({
        memberId: MEMBER,
        kind: 'service',
        title: 'Quote-only handywork',
        rateModel: 'quote',
      }).success,
    ).toBe(true)
  })

  it('rejects an out-of-range latitude', () => {
    expect(
      itemCreateInput.safeParse({
        memberId: MEMBER,
        kind: 'service',
        title: 'X',
        serviceAreaCenterLat: 200,
        serviceAreaCenterLon: 0,
        serviceAreaRadiusMeters: 100,
      }).success,
    ).toBe(false)
  })

  it('rejects an out-of-range longitude', () => {
    expect(
      itemCreateInput.safeParse({
        memberId: MEMBER,
        kind: 'service',
        title: 'X',
        serviceAreaCenterLat: 0,
        serviceAreaCenterLon: 999,
        serviceAreaRadiusMeters: 100,
      }).success,
    ).toBe(false)
  })

  it('rejects a non-positive radius', () => {
    expect(
      itemCreateInput.safeParse({
        memberId: MEMBER,
        kind: 'service',
        title: 'X',
        serviceAreaCenterLat: 0,
        serviceAreaCenterLon: 0,
        serviceAreaRadiusMeters: 0,
      }).success,
    ).toBe(false)
  })
})

describe('T081 — create.ts service arm writes the PostGIS circle', () => {
  const src = readFileSync(resolve(ACTIONS_DIR, 'item', 'create.ts'), 'utf8')

  it('computes the service area via st_buffer + st_makepoint', () => {
    expect(src).toMatch(/st_buffer/i)
    expect(src).toMatch(/st_makepoint/i)
    expect(src).toMatch(/service_area_geography/)
  })

  it('still inserts item_services when no service area is given', () => {
    // Both branches insert the child row.
    const inserts = src.match(/insert into public\.item_services/g) ?? []
    expect(inserts.length).toBeGreaterThanOrEqual(2)
  })
})
