// T109 — Unit tests for the /you/following management list (F042).
// Trace: scenario-F042 § "Full follows list" + "Unfollow / Leave" + Undo + empty
//        state + count privacy; T109 acceptance.
//
// Three flat sections (People / Groups / Venues), substrate-accurate affordances
// (Unfollow for People+Venues, Leave for Groups), optimistic remove with Undo
// that re-activates the soft-deleted row via the reverse handler.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { FollowEntry } from '@/lib/follows/get-member-follows'
import { FollowingManager } from './FollowingManager'

const unfollowMemberAction = vi.fn()
const followMemberAction = vi.fn()
const leaveGroupAction = vi.fn()
const joinGroupAction = vi.fn()
const unfollowVenueAction = vi.fn()
const restoreVenueAction = vi.fn()

vi.mock('@/app/m/[handle]/actions', () => ({
  unfollowMemberAction: (...a: unknown[]) => unfollowMemberAction(...a),
  followMemberAction: (...a: unknown[]) => followMemberAction(...a),
}))
vi.mock('@/app/_actions/group-membership-actions', () => ({
  leaveGroupAction: (...a: unknown[]) => leaveGroupAction(...a),
  joinGroupAction: (...a: unknown[]) => joinGroupAction(...a),
}))
vi.mock('@/app/_actions/saved-search-actions', () => ({
  unfollowVenueAction: (...a: unknown[]) => unfollowVenueAction(...a),
  restoreVenueAction: (...a: unknown[]) => restoreVenueAction(...a),
}))

const PERSON: FollowEntry = { kind: 'person', entityId: 'p1', displayName: 'Alice', thumbnailUrl: 'a.png', createdAt: '2026-06-10T00:00:00Z', href: '/m/alice', isTombstone: false }
const GROUP: FollowEntry = { kind: 'group', entityId: 'g1', displayName: 'Run Club', thumbnailUrl: null, createdAt: '2026-06-15T00:00:00Z', href: '/p/g/run-club', isTombstone: false }
const VENUE: FollowEntry = { kind: 'venue', entityId: 'ss1', displayName: 'Blue Bottle', thumbnailUrl: null, createdAt: '2026-06-12T00:00:00Z', href: '/p/l/blue-bottle', isTombstone: false }
const ALL = [GROUP, VENUE, PERSON]

afterEach(() => {
  cleanup()
  for (const m of [unfollowMemberAction, followMemberAction, leaveGroupAction, joinGroupAction, unfollowVenueAction, restoreVenueAction]) m.mockReset()
})

describe('FollowingManager — sections + labels', () => {
  it('renders People / Groups / Venues sections in order with substrate-accurate labels', () => {
    render(<FollowingManager entries={ALL} groupCounts={{ g1: 3 }} />)
    const sections = screen.getAllByTestId(/^section-/)
    expect(sections.map((s) => s.getAttribute('data-testid'))).toEqual([
      'section-people',
      'section-groups',
      'section-venues',
    ])
    // People + Venues say "Unfollow"; Groups say "Leave".
    expect(within(screen.getByTestId('section-people')).getByRole('button')).toHaveTextContent('Unfollow')
    expect(within(screen.getByTestId('section-groups')).getByRole('button')).toHaveTextContent('Leave')
    expect(within(screen.getByTestId('section-venues')).getByRole('button')).toHaveTextContent('Unfollow')
  })

  it('shows the listed-member count on a Group row', () => {
    render(<FollowingManager entries={[GROUP]} groupCounts={{ g1: 3 }} />)
    expect(screen.getByTestId('group-count-g1')).toHaveTextContent('3')
  })
})

describe('FollowingManager — affordance calls the correct handler per substrate', () => {
  it('Unfollow on a People row calls unfollowMemberAction with the member id', async () => {
    unfollowMemberAction.mockResolvedValue({ ok: true })
    render(<FollowingManager entries={[PERSON]} groupCounts={{}} />)
    fireEvent.click(screen.getByTestId('affordance-person-p1'))
    await waitFor(() => expect(unfollowMemberAction).toHaveBeenCalledWith({ followedMemberId: 'p1' }))
  })

  it('Leave on a Group row calls leaveGroupAction with the group id', async () => {
    leaveGroupAction.mockResolvedValue({ ok: true })
    render(<FollowingManager entries={[GROUP]} groupCounts={{ g1: 3 }} />)
    fireEvent.click(screen.getByTestId('affordance-group-g1'))
    await waitFor(() => expect(leaveGroupAction).toHaveBeenCalledWith({ groupId: 'g1' }))
  })

  it('Unfollow on a Venue row calls unfollowVenueAction with the saved-search id', async () => {
    unfollowVenueAction.mockResolvedValue({ ok: true })
    render(<FollowingManager entries={[VENUE]} groupCounts={{}} />)
    fireEvent.click(screen.getByTestId('affordance-venue-ss1'))
    await waitFor(() => expect(unfollowVenueAction).toHaveBeenCalledWith({ savedSearchId: 'ss1' }))
  })
})

describe('FollowingManager — Undo re-activates the soft-deleted row', () => {
  it('Undo after Leave calls joinGroupAction (re-activate, not a fresh insert)', async () => {
    leaveGroupAction.mockResolvedValue({ ok: true })
    joinGroupAction.mockResolvedValue({ ok: true })
    render(<FollowingManager entries={[GROUP]} groupCounts={{ g1: 3 }} />)

    fireEvent.click(screen.getByTestId('affordance-group-g1'))
    const undo = await screen.findByTestId('undo-group-g1')
    fireEvent.click(undo)
    await waitFor(() => expect(joinGroupAction).toHaveBeenCalledWith({ groupId: 'g1' }))
    // Row returns to active — the Leave affordance is back.
    await waitFor(() => expect(screen.getByTestId('affordance-group-g1')).toBeInTheDocument())
  })

  it('Undo after a venue Unfollow calls restoreVenueAction (not create)', async () => {
    unfollowVenueAction.mockResolvedValue({ ok: true })
    restoreVenueAction.mockResolvedValue({ ok: true })
    render(<FollowingManager entries={[VENUE]} groupCounts={{}} />)

    fireEvent.click(screen.getByTestId('affordance-venue-ss1'))
    fireEvent.click(await screen.findByTestId('undo-venue-ss1'))
    await waitFor(() => expect(restoreVenueAction).toHaveBeenCalledWith({ savedSearchId: 'ss1' }))
  })
})

describe('FollowingManager — empty state + tombstone', () => {
  it('renders the empty state with an explore CTA when there are no follows', () => {
    render(<FollowingManager entries={[]} groupCounts={{}} />)
    const empty = screen.getByTestId('following-empty')
    expect(empty).toHaveTextContent('Nothing followed yet')
    expect(within(empty).getByRole('link')).toHaveAttribute('href', '/explore')
  })

  it('a tombstoned People row still renders and its Unfollow still works', async () => {
    unfollowMemberAction.mockResolvedValue({ ok: true })
    const tomb: FollowEntry = { ...PERSON, displayName: 'A member', thumbnailUrl: null, href: '#', isTombstone: true }
    render(<FollowingManager entries={[tomb]} groupCounts={{}} />)
    expect(screen.getByText('A member')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('affordance-person-p1'))
    await waitFor(() => expect(unfollowMemberAction).toHaveBeenCalledWith({ followedMemberId: 'p1' }))
  })
})
