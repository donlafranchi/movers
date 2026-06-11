// T102 — Unit tests for <FollowVenueButton> (S-saved-search surface enablement).
// Trace: product/systems/member.md § Saved searches; ADR-21. Gates F033 + F042.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { FollowVenueButton } from './FollowVenueButton'

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/sf/ferry-building/l/blue-bottle',
}))

const followVenueAction = vi.fn()
const unfollowVenueAction = vi.fn()
vi.mock('@/app/_actions/saved-search-actions', () => ({
  followVenueAction: (...a: unknown[]) => followVenueAction(...a),
  unfollowVenueAction: (...a: unknown[]) => unfollowVenueAction(...a),
}))

afterEach(() => {
  cleanup()
  followVenueAction.mockReset()
  unfollowVenueAction.mockReset()
})

describe('FollowVenueButton', () => {
  it('anon → renders login link with the current path as return URL', () => {
    render(
      <FollowVenueButton
        loggedIn={false}
        locationId="loc-1"
        venueName="Blue Bottle"
        existingSavedSearchId={null}
      />,
    )
    const link = screen.getByTestId('follow-venue-signin')
    expect(link).toHaveAttribute('href', '/auth/login?next=/p/sf/ferry-building/l/blue-bottle')
    expect(link).toHaveTextContent('Follow this venue')
  })

  it("auth'd, not following → renders 'Follow this venue' button", () => {
    render(
      <FollowVenueButton
        loggedIn
        locationId="loc-1"
        venueName="Blue Bottle"
        existingSavedSearchId={null}
      />,
    )
    const btn = screen.getByTestId('follow-venue')
    expect(btn).toHaveTextContent('Follow this venue')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it("auth'd, already following → renders 'Following' with aria-pressed=true", () => {
    render(
      <FollowVenueButton
        loggedIn
        locationId="loc-1"
        venueName="Blue Bottle"
        existingSavedSearchId="ss-1"
      />,
    )
    const btn = screen.getByTestId('following-venue')
    expect(btn).toHaveTextContent('Following')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('follow click → optimistic flip + calls followVenueAction', async () => {
    followVenueAction.mockResolvedValue({ ok: true, savedSearchId: 'ss-9' })
    render(
      <FollowVenueButton
        loggedIn
        locationId="loc-1"
        venueName="Blue Bottle"
        existingSavedSearchId={null}
      />,
    )
    fireEvent.click(screen.getByTestId('follow-venue'))
    expect(screen.getByTestId('following-venue')).toBeInTheDocument()
    await waitFor(() =>
      expect(followVenueAction).toHaveBeenCalledWith({ locationId: 'loc-1', venueName: 'Blue Bottle' }),
    )
  })

  it('follow failure → reverts to not-following and shows an alert', async () => {
    followVenueAction.mockRejectedValue(new Error('nope'))
    render(
      <FollowVenueButton
        loggedIn
        locationId="loc-1"
        venueName="Blue Bottle"
        existingSavedSearchId={null}
      />,
    )
    fireEvent.click(screen.getByTestId('follow-venue'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nope'))
    expect(screen.getByTestId('follow-venue')).toBeInTheDocument()
  })
})
