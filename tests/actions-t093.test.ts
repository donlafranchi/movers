import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  itemQrCardRequest,
  itemQrCardRequestInput,
} from '../src/actions/item'
import { getHandler, listHandlers } from '../src/actions'
import { ValidationError } from '../src/actions/_lib/errors'

// T093 — file-shape + zod + registry + source-shape assertions for the
// item.qr_card.request handler. DB-touching behavior (ownership, state guard,
// event row, canonical-URL resolution) is verified by the F041 Playwright eval
// against running Supabase — same split as T077's item handlers.

const ACTIONS_DIR = resolve(__dirname, '..', 'src', 'actions')
const ITEM = '00000000-0000-0000-0000-000000000030'
const MEMBER = '00000000-0000-0000-0000-000000000001'

describe('T093 — handler file exists', () => {
  it('exists: src/actions/item/qr-card.ts', () => {
    expect(existsSync(resolve(ACTIONS_DIR, 'item', 'qr-card.ts'))).toBe(true)
  })
})

describe('T093 — registry surfaces item.qr_card.request', () => {
  it('lists item.qr_card.request', () => {
    expect(listHandlers()).toContain('item.qr_card.request')
  })

  it('getHandler resolves the handler by name', () => {
    expect(getHandler('item.qr_card.request')).toBe(itemQrCardRequest as unknown)
  })
})

describe('T093 — itemQrCardRequest input validation', () => {
  it('accepts a uuid itemId', () => {
    expect(itemQrCardRequestInput.safeParse({ itemId: ITEM }).success).toBe(true)
  })

  it('rejects a non-uuid itemId', () => {
    expect(itemQrCardRequestInput.safeParse({ itemId: 'nope' }).success).toBe(false)
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
      (itemQrCardRequest as unknown as (c: unknown, i: unknown) => Promise<unknown>)(ctx, {
        itemId: 'nope',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('T093 — handler source-shape sanity checks', () => {
  const src = readFileSync(resolve(ACTIONS_DIR, 'item', 'qr-card.ts'), 'utf8')

  it('is owner-only (AuthorizationError) and refuses non-published (ConflictError)', () => {
    expect(src).toMatch(/AuthorizationError/)
    expect(src).toMatch(/ConflictError/)
  })

  it('emits item.qr_card_requested', () => {
    expect(src).toMatch(/event_kind:\s*'item\.qr_card_requested'/)
  })

  it('generates the PNG via the qr-card lib', () => {
    expect(src).toMatch(/generateQrCardPng/)
  })

  it('rejects the self-bootstrap sentinel', () => {
    expect(src).toMatch(/self-bootstrap/)
  })
})
