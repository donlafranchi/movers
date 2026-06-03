import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ItemFeedCard } from './ItemFeedCard'
import { FeedEmptyState } from './FeedEmptyState'
import { MakeThisYoursBanner } from './MakeThisYoursBanner'
import type { FeedItem } from '@/lib/feed/locality-feed'

afterEach(() => cleanup())

const baseItem: FeedItem = {
  itemId: 'abcdef1234567890',
  kind: 'gathering',
  title: 'Pottery Night',
  category: 'crafts',
  brandLabel: null,
  groupId: null,
  ownerHandle: 'maya',
  ownerDisplayName: 'Maya',
  nearestLocationLabel: 'Drake’s',
  responseCount: 2,
  primaryTag: 'crafts',
  publishedAt: '2026-06-01T00:00:00Z',
}

describe('T088 — ItemFeedCard', () => {
  it('renders title, kind label, owner, and location', () => {
    render(<ItemFeedCard item={baseItem} />)
    expect(screen.getByText('Pottery Night')).toBeTruthy()
    expect(screen.getByTestId('feed-item-kind').textContent).toBe('Event')
    expect(screen.getByText('Maya')).toBeTruthy()
    expect(screen.getByText('Drake’s')).toBeTruthy()
  })

  it('links to the member-scoped Item URL with kind segment + id8 fragment', () => {
    render(<ItemFeedCard item={baseItem} />)
    const link = screen.getByTestId('feed-item-card') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/m/maya/e/pottery-night-abcdef12')
  })

  it('prefers the brand label over the owner name when present', () => {
    render(<ItemFeedCard item={{ ...baseItem, brandLabel: 'Oak Park Pottery' }} />)
    expect(screen.getByText('Oak Park Pottery')).toBeTruthy()
  })

  it('uses the product segment for a product', () => {
    render(<ItemFeedCard item={{ ...baseItem, kind: 'product', title: 'Sourdough' }} />)
    const link = screen.getByTestId('feed-item-card') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/m/maya/p/sourdough-abcdef12')
  })
})

describe('T088 — FeedEmptyState', () => {
  it('widens to the parent Place when one exists', () => {
    render(<FeedEmptyState parent={{ displayName: 'Sacramento', slug: 'sacramento' }} />)
    const widen = screen.getByTestId('widen-locality') as HTMLAnchorElement
    expect(widen.textContent).toContain('Sacramento')
    expect(widen.getAttribute('href')).toBe('/?place=sacramento')
  })

  it('falls back to state copy at the root', () => {
    render(<FeedEmptyState parent={null} />)
    expect(screen.getByTestId('widen-locality').textContent).toContain('state')
  })
})

describe('T088 — MakeThisYoursBanner', () => {
  it('shows the signup CTA when anonymous', () => {
    render(<MakeThisYoursBanner isAuthenticated={false} />)
    const cta = screen.getByTestId('signup-cta')
    const link = cta.querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/auth/signup?next=/onboarding')
  })

  it('hides when authenticated', () => {
    const { container } = render(<MakeThisYoursBanner isAuthenticated={true} />)
    expect(container.querySelector('[data-testid="signup-cta"]')).toBeNull()
  })
})
