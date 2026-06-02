import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  itemCreate,
  itemCreateInput,
  itemPublish,
  itemPublishInput,
  itemAttachLocation,
  itemAttachLocationInput,
} from '../src/actions/item'
import { getHandler, listHandlers } from '../src/actions'
import { ValidationError } from '../src/actions/_lib/errors'

// T077 — file-shape + zod + registry + source-shape assertions for the three
// item handlers. DB-touching behavior (transaction atomicity, RLS, event rows)
// is verified by the F038 Playwright eval against running Supabase — same split
// as T070's group handlers.

const ACTIONS_DIR = resolve(__dirname, '..', 'src', 'actions')
const MEMBER = '00000000-0000-0000-0000-000000000001'
const GROUP = '00000000-0000-0000-0000-000000000010'
const LOCATION = '00000000-0000-0000-0000-000000000020'
const ITEM = '00000000-0000-0000-0000-000000000030'

describe('T077 — item handler files exist', () => {
  for (const f of [
    'item/index.ts',
    'item/create.ts',
    'item/publish.ts',
    'item/attach-location.ts',
  ]) {
    it(`exists: src/actions/${f}`, () => {
      expect(existsSync(resolve(ACTIONS_DIR, f))).toBe(true)
    })
  }
})

describe('T077 — registry surfaces the three item handlers', () => {
  it('lists item.create / item.publish / item.attach_location', () => {
    const names = listHandlers()
    expect(names).toContain('item.create')
    expect(names).toContain('item.publish')
    expect(names).toContain('item.attach_location')
  })

  it('getHandler resolves each handler by name', () => {
    expect(getHandler('item.create')).toBe(itemCreate as unknown)
    expect(getHandler('item.publish')).toBe(itemPublish as unknown)
    expect(getHandler('item.attach_location')).toBe(itemAttachLocation as unknown)
  })
})

describe('T077 — itemCreate input validation', () => {
  it('accepts a minimal valid product input', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'product',
      title: 'Country Sourdough Loaf',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts a full product input with group, price, location, publish', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'product',
      groupId: GROUP,
      title: 'Country Sourdough Loaf',
      description: 'Naturally leavened.',
      priceCents: 900,
      priceUnit: 'loaf',
      photoUrls: ['https://example.com/a.jpg'],
      locationId: LOCATION,
      scheduleKind: 'ongoing',
      publish: true,
    })
    expect(parsed.success).toBe(true)
  })

  it('treats null priceCents as a free product', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'product',
      title: 'Free starter',
      priceCents: null,
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a kind outside the multi-kind enum (T080 widened to product/service/gathering)', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'wonder',
      title: 'Idle thought',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects non-uuid memberId', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: 'nope',
      kind: 'product',
      title: 'X',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects negative priceCents', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'product',
      title: 'X',
      priceCents: -1,
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects empty + over-long title', () => {
    expect(
      itemCreateInput.safeParse({ memberId: MEMBER, kind: 'product', title: '' })
        .success,
    ).toBe(false)
    expect(
      itemCreateInput.safeParse({
        memberId: MEMBER,
        kind: 'product',
        title: 'a'.repeat(201),
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown scheduleKind', () => {
    const parsed = itemCreateInput.safeParse({
      memberId: MEMBER,
      kind: 'product',
      title: 'X',
      locationId: LOCATION,
      scheduleKind: 'permanent',
    })
    expect(parsed.success).toBe(false)
  })

  it('handler wrapper raises ValidationError on bad input', async () => {
    const ctx = {
      db: {} as never,
      actingMemberId: MEMBER,
      viaDelegationId: null,
      traceId: 't',
      now: () => new Date(),
    } as never
    await expect(
      (itemCreate as unknown as (c: unknown, i: unknown) => Promise<unknown>)(ctx, {
        kind: 'nope',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('T077 — itemPublish + itemAttachLocation input validation', () => {
  it('itemPublish accepts a uuid itemId; rejects non-uuid', () => {
    expect(itemPublishInput.safeParse({ itemId: ITEM }).success).toBe(true)
    expect(itemPublishInput.safeParse({ itemId: 'x' }).success).toBe(false)
  })

  it('itemAttachLocation requires uuid itemId + locationId', () => {
    expect(
      itemAttachLocationInput.safeParse({ itemId: ITEM, locationId: LOCATION })
        .success,
    ).toBe(true)
    expect(
      itemAttachLocationInput.safeParse({ itemId: 'x', locationId: LOCATION })
        .success,
    ).toBe(false)
  })

  it('itemAttachLocation rejects an unknown scheduleKind', () => {
    expect(
      itemAttachLocationInput.safeParse({
        itemId: ITEM,
        locationId: LOCATION,
        scheduleKind: 'permanent',
      }).success,
    ).toBe(false)
  })
})

describe('T077 — handler source-shape sanity checks', () => {
  const createSrc = readFileSync(resolve(ACTIONS_DIR, 'item', 'create.ts'), 'utf8')
  const publishSrc = readFileSync(resolve(ACTIONS_DIR, 'item', 'publish.ts'), 'utf8')
  const attachSrc = readFileSync(
    resolve(ACTIONS_DIR, 'item', 'attach-location.ts'),
    'utf8',
  )
  const eventLogSrc = readFileSync(
    resolve(ACTIONS_DIR, '_lib', 'event-log.ts'),
    'utf8',
  )

  it('item.create inserts items + item_products', () => {
    expect(createSrc).toMatch(/insert into public\.items/)
    expect(createSrc).toMatch(/insert into public\.item_products/)
  })

  it('item.create emits item.created and conditionally item.published', () => {
    expect(createSrc).toMatch(/event_kind:\s*'item\.created'/)
    expect(createSrc).toMatch(/event_kind:\s*'item\.published'/)
  })

  it('item.create derives brand_label from group_businesses + owner-checks the group', () => {
    expect(createSrc).toMatch(/group_businesses/)
    expect(createSrc).toMatch(/brand_label/)
    expect(createSrc).toMatch(/AuthorizationError/)
  })

  it('item.publish emits item.published with an idempotent state guard', () => {
    expect(publishSrc).toMatch(/event_kind:\s*'item\.published'/)
    expect(publishSrc).toMatch(/state\s*=\s*'published'/)
    expect(publishSrc).toMatch(/AuthorizationError/)
  })

  it('item.attach_location inserts item_locations + emits item.location_attached', () => {
    expect(attachSrc).toMatch(/insert into public\.item_locations/)
    expect(attachSrc).toMatch(/event_kind:\s*'item\.location_attached'/)
    expect(attachSrc).toMatch(/AuthorizationError/)
  })

  it('event-log.ts carries item_events + location_events tables', () => {
    expect(eventLogSrc).toMatch(/'item_events'/)
    expect(eventLogSrc).toMatch(/'location_events'/)
  })
})
