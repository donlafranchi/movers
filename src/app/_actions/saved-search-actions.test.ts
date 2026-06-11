// T102 — Unit tests for the saved-search server-action wrappers (F033 / F042
// substrate enablement). Auth gate, default-label construction + truncation, and
// ActionError→Error wrapping are testable without a DB. Row-level behaviour
// (insert + soft-remove + events) is verified by the F033 Playwright eval against
// running Supabase — same split as T091 / T075 (no live-DB vitest infra).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActionError } from '@/actions/_lib/errors'

const { getUser, create, remove } = vi.hoisted(() => ({
  getUser: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}))

vi.mock('@/actions', async (importActual) => {
  const actual = await importActual<typeof import('@/actions')>()
  return { ...actual, memberSavedSearchCreate: create, memberSavedSearchRemove: remove }
})

import { followVenueAction, unfollowVenueAction, buildVenueFollowLabel } from './saved-search-actions'

const MEMBER = '11111111-1111-1111-1111-111111111111'
const LOC = '22222222-2222-2222-2222-222222222222'

function signedIn() {
  getUser.mockResolvedValue({ data: { user: { id: MEMBER } }, error: null })
}
function anon() {
  getUser.mockResolvedValue({ data: { user: null }, error: null })
}

beforeEach(() => {
  getUser.mockReset()
  create.mockReset()
  remove.mockReset()
})

describe('buildVenueFollowLabel', () => {
  it('prefixes "Following "', () => {
    expect(buildVenueFollowLabel('Blue Bottle')).toBe('Following Blue Bottle')
  })

  it('truncates to 80 chars (label CHECK ceiling)', () => {
    expect(buildVenueFollowLabel('X'.repeat(200))).toHaveLength(80)
  })
})

describe('followVenueAction', () => {
  it("auth'd, valid locationId → returns ok + savedSearchId, passes default label", async () => {
    signedIn()
    create.mockResolvedValue({ savedSearchId: 'ss-1' })
    const res = await followVenueAction({ locationId: LOC, venueName: 'Blue Bottle' })
    expect(res).toEqual({ ok: true, savedSearchId: 'ss-1' })
    expect(create).toHaveBeenCalledWith(expect.anything(), {
      label: 'Following Blue Bottle',
      locationId: LOC,
    })
  })

  it('truncates the label when the venue name pushes it past 80 chars', async () => {
    signedIn()
    create.mockResolvedValue({ savedSearchId: 'ss-2' })
    await followVenueAction({ locationId: LOC, venueName: 'Y'.repeat(200) })
    expect((create.mock.calls[0]![1] as { label: string }).label).toHaveLength(80)
  })

  it('anon caller → throws, never calls the handler', async () => {
    anon()
    await expect(followVenueAction({ locationId: LOC, venueName: 'X' })).rejects.toThrow(/signed in/)
    expect(create).not.toHaveBeenCalled()
  })

  it('wraps ActionError into a plain Error for the client boundary', async () => {
    signedIn()
    create.mockRejectedValue(new ActionError('validation_error', 'bad input'))
    await followVenueAction({ locationId: LOC, venueName: 'X' }).then(
      () => {
        throw new Error('expected rejection')
      },
      (err) => {
        expect(err).toBeInstanceOf(Error)
        expect(err).not.toBeInstanceOf(ActionError)
        expect(err.message).toBe('bad input')
      },
    )
  })
})

describe('unfollowVenueAction', () => {
  it('owner removes → returns ok', async () => {
    signedIn()
    remove.mockResolvedValue({ id: 'ss-1', removed: true })
    const res = await unfollowVenueAction({ savedSearchId: 'ss-1' })
    expect(res).toEqual({ ok: true })
    expect(remove).toHaveBeenCalledWith(expect.anything(), { id: 'ss-1' })
  })

  it('non-owner → throws (NotFoundError collapses to a plain Error)', async () => {
    signedIn()
    remove.mockRejectedValue(new ActionError('not_found_error', 'not found'))
    await expect(unfollowVenueAction({ savedSearchId: 'ss-x' })).rejects.toThrow('not found')
  })

  it('anon caller → throws, never calls the handler', async () => {
    anon()
    await expect(unfollowVenueAction({ savedSearchId: 'ss-1' })).rejects.toThrow(/signed in/)
    expect(remove).not.toHaveBeenCalled()
  })
})
