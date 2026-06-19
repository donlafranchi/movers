// T108 — Unit tests for the `/you` "Following" summary section (F042).
// Trace: scenario-F042 § "Following summary on /you"; T108 acceptance.
//
// The summary is a thin client wrapper over getMemberFollows: it renders a
// horizontal card scroll (already recency-ordered by the reader) with a "More"
// link to /you/following, and omits itself entirely when the Member follows
// nothing. We mock the reader + the browser supabase client so the test stays a
// pure render test.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { FollowEntry } from '@/lib/follows/get-member-follows'
import { FollowingSummary } from './FollowingSummary'

const getMemberFollows = vi.fn()
vi.mock('@/lib/follows/get-member-follows', () => ({
  getMemberFollows: (...a: unknown[]) => getMemberFollows(...a),
}))
vi.mock('@/lib/supabase', () => ({ createClient: () => ({}) }))

const ENTRIES: FollowEntry[] = [
  { kind: 'group', entityId: 'g1', displayName: 'Run Club', thumbnailUrl: null, createdAt: '2026-06-15T00:00:00Z', href: '/p/g/run-club', isTombstone: false },
  { kind: 'venue', entityId: 'ss1', displayName: 'Blue Bottle', thumbnailUrl: null, createdAt: '2026-06-12T00:00:00Z', href: '/p/l/blue-bottle', isTombstone: false },
  { kind: 'person', entityId: 'p1', displayName: 'Alice', thumbnailUrl: 'a.png', createdAt: '2026-06-10T00:00:00Z', href: '/m/alice', isTombstone: false },
]

afterEach(() => {
  cleanup()
  getMemberFollows.mockReset()
})

describe('FollowingSummary', () => {
  it('renders a card per follow in reader order, each linking to its entity', async () => {
    getMemberFollows.mockResolvedValue(ENTRIES)
    render(<FollowingSummary memberId="me" />)

    await waitFor(() => expect(screen.getByTestId('following-summary')).toBeInTheDocument())
    const cards = screen.getAllByTestId('following-card')
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveTextContent('Run Club')
    expect(cards[1]).toHaveTextContent('Blue Bottle')
    expect(cards[2]).toHaveTextContent('Alice')
    expect(cards[0]).toHaveAttribute('href', '/p/g/run-club')
    expect(cards[2]).toHaveAttribute('href', '/m/alice')
  })

  it('renders a "More" link to /you/following', async () => {
    getMemberFollows.mockResolvedValue(ENTRIES)
    render(<FollowingSummary memberId="me" />)
    await waitFor(() => expect(screen.getByTestId('following-more')).toBeInTheDocument())
    expect(screen.getByTestId('following-more')).toHaveAttribute('href', '/you/following')
  })

  it('omits the section entirely when the Member follows nothing', async () => {
    getMemberFollows.mockResolvedValue([])
    render(<FollowingSummary memberId="me" />)
    // Give the effect a tick to resolve, then confirm nothing rendered.
    await waitFor(() => expect(getMemberFollows).toHaveBeenCalled())
    expect(screen.queryByTestId('following-summary')).not.toBeInTheDocument()
  })
})
