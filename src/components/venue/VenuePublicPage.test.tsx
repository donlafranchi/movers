// T104 — Unit tests for <VenuePublicPage> (F033 venue page shell).
// Trace: planning/next/scenario-F033-viewer-finds-venue-page.md
//        product/ui/design-language.md § Venue page.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { VenuePublicPage } from './VenuePublicPage'
import type { ResolvedVenue } from '@/lib/locations/resolve-venue'

// FollowVenueButton uses next/navigation + a server action; stub the path.
vi.mock('next/navigation', () => ({ usePathname: () => '/p/ca/sacramento/l/drakes' }))

afterEach(cleanup)

const VENUE: ResolvedVenue = {
  locationId: 'loc-1',
  slug: 'drakes',
  label: "Drake's",
  kind: 'permanent',
  description: 'A neighborhood bar with a weekly trivia night.',
  heroImageUrl: null,
  streetAddress: '1400 16th St, Sacramento, CA',
  accessibilityNotes: 'Ramp at the side entrance; ADA restroom.',
}

function renderPage(overrides: Partial<Parameters<typeof VenuePublicPage>[0]> = {}) {
  return render(
    <VenuePublicPage
      venue={VENUE}
      loggedIn={true}
      existingSavedSearchId={null}
      distanceMeters={null}
      hostHref="/you/sell?compose=gathering&location=loc-1"
      {...overrides}
    />,
  )
}

describe('VenuePublicPage — header', () => {
  it('renders the venue name', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: "Drake's" })).toBeInTheDocument()
  })

  it('renders the street address', () => {
    renderPage()
    expect(screen.getByText(/1400 16th St/)).toBeInTheDocument()
  })

  it('shows distance in miles when distanceMeters is provided', () => {
    renderPage({ distanceMeters: 2413.7 }) // ~1.5 mi
    expect(screen.getByTestId('venue-distance')).toHaveTextContent(/1\.5 mi/)
  })

  it('omits the distance line for anon / no primary-home viewers', () => {
    renderPage({ distanceMeters: null })
    expect(screen.queryByTestId('venue-distance')).not.toBeInTheDocument()
  })

  it('collapses the hero entirely when there is no image (no empty container)', () => {
    renderPage()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders the hero image with venue-name alt text when an image exists', () => {
    renderPage({ venue: { ...VENUE, heroImageUrl: 'https://x/drakes.jpg' } })
    expect(screen.getByRole('img', { name: /Drake's/ })).toBeInTheDocument()
  })
})

describe('VenuePublicPage — CTAs', () => {
  it('renders "Follow this venue" as the primary CTA (accent-filled)', () => {
    renderPage()
    const follow = screen.getByTestId('follow-venue')
    expect(follow).toHaveTextContent('Follow this venue')
    expect(follow).toHaveClass('btn-primary')
  })

  it('renders "Host something here" as a secondary CTA linking to the composer', () => {
    renderPage()
    const host = screen.getByTestId('venue-host-cta')
    expect(host).toHaveTextContent('Host something here')
    expect(host).toHaveClass('btn-secondary')
    expect(host).toHaveAttribute('href', '/you/sell?compose=gathering&location=loc-1')
  })

  it('anon viewer: Follow routes to sign-in with a return URL', () => {
    renderPage({ loggedIn: false })
    expect(screen.getByTestId('follow-venue-signin')).toHaveAttribute(
      'href',
      expect.stringContaining('/auth/login?next='),
    )
  })
})

describe('VenuePublicPage — About', () => {
  it('renders the description and accessibility notes', () => {
    renderPage()
    expect(screen.getByText(/weekly trivia night/)).toBeInTheDocument()
    expect(screen.getByText(/Ramp at the side entrance/)).toBeInTheDocument()
  })

  it('renders the Location kind tag', () => {
    renderPage()
    expect(screen.getByTestId('venue-kind-tag')).toHaveTextContent(/Permanent/i)
  })

  it('renders About with the kind tag even when the description is empty', () => {
    renderPage({ venue: { ...VENUE, description: null, accessibilityNotes: null } })
    expect(screen.getByTestId('venue-about')).toBeInTheDocument()
    expect(screen.getByTestId('venue-kind-tag')).toBeInTheDocument()
  })

  it('maps recurring_temporary and area kinds to readable tags', () => {
    renderPage({ venue: { ...VENUE, kind: 'recurring_temporary' } })
    expect(screen.getByTestId('venue-kind-tag')).toHaveTextContent(/Recurring/i)
    cleanup()
    renderPage({ venue: { ...VENUE, kind: 'area' } })
    expect(screen.getByTestId('venue-kind-tag')).toHaveTextContent(/Area/i)
  })
})
