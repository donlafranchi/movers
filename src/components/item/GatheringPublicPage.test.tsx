// T082 — Unit tests for <GatheringPublicPage>.
// Trace: F034 § Item page shows next occurrence + Share-link.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { GatheringPublicPage } from './GatheringPublicPage'
import type { ResolvedGathering } from '@/lib/items/resolve-gathering'

afterEach(() => cleanup())

function gathering(overrides: Partial<ResolvedGathering> = {}): ResolvedGathering {
  return {
    itemId: 'deadbeef-1111',
    title: 'Thursday Run Club',
    description: 'Easy 5k, all paces.',
    startsAt: '2099-06-04T18:00:00+00:00',
    endsAt: null,
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH',
    capacity: 30,
    costCents: null,
    whatToBring: 'Water + shoes',
    brandLabel: null,
    owner: { handle: 'sam', displayName: 'Sam Rivera' },
    location: { label: "Drake's" },
    ...overrides,
  }
}

describe('T082 — GatheringPublicPage', () => {
  it('renders title, recurrence, next occurrence, location, owner, and share link', () => {
    render(
      <GatheringPublicPage
        gathering={gathering()}
        groupHref={null}
        nextOccurrenceLabel="Thursday, June 4, 2099"
        shareUrl="/m/sam/e/thursday-run-club-deadbeef"
      />,
    )
    expect(screen.getByTestId('gathering-title')).toHaveTextContent('Thursday Run Club')
    expect(screen.getByTestId('gathering-recurrence')).toHaveTextContent('Every Thursday')
    expect(screen.getByTestId('gathering-next-occurrence')).toHaveTextContent(
      'Thursday, June 4, 2099',
    )
    expect(screen.getByTestId('gathering-location')).toHaveTextContent("Drake's")
    expect(screen.getByTestId('gathering-what-to-bring')).toHaveTextContent('Water + shoes')
    expect(screen.getByTestId('gathering-share-link')).toBeInTheDocument()

    const owner = screen.getByTestId('gathering-owner-link')
    expect(owner).toHaveTextContent('Sam Rivera')
    expect(owner).toHaveAttribute('href', '/m/sam')
  })

  it('renders "Free" when costCents is null', () => {
    render(
      <GatheringPublicPage
        gathering={gathering({ costCents: null })}
        groupHref={null}
        nextOccurrenceLabel="Thursday, June 4, 2099"
        shareUrl="/x"
      />,
    )
    expect(screen.getByTestId('gathering-cost')).toHaveTextContent('Free')
  })

  it('renders a dollar cost when costCents is set', () => {
    render(
      <GatheringPublicPage
        gathering={gathering({ costCents: 500 })}
        groupHref={null}
        nextOccurrenceLabel="Thursday, June 4, 2099"
        shareUrl="/x"
      />,
    )
    expect(screen.getByTestId('gathering-cost')).toHaveTextContent('$5.00')
  })

  it('omits the recurrence line for a one-time gathering', () => {
    render(
      <GatheringPublicPage
        gathering={gathering({ recurrenceRule: null })}
        groupHref={null}
        nextOccurrenceLabel="Thursday, June 4, 2099"
        shareUrl="/x"
      />,
    )
    expect(screen.queryByTestId('gathering-recurrence')).not.toBeInTheDocument()
  })

  it('links the brand to the Group page when filed under a Group', () => {
    render(
      <GatheringPublicPage
        gathering={gathering({ brandLabel: "Drake's" })}
        groupHref="/p/ca/sacramento/oak-park/g/drakes-a1"
        nextOccurrenceLabel="Thursday, June 4, 2099"
        shareUrl="/x"
      />,
    )
    const brand = screen.getByTestId('gathering-brand-link')
    expect(brand).toHaveTextContent("Drake's")
    expect(brand).toHaveAttribute('href', '/p/ca/sacramento/oak-park/g/drakes-a1')
  })
})
