// T082 — Unit tests for <GatheringPublicPage>.
// T095 — Updated: attribution model (Group vs Member + conditional link).
// Trace: F034 § Item page shows attribution + next occurrence + Share-link.

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
    attribution: {
      kind: 'member',
      handle: 'sam',
      displayName: 'Sam Rivera',
      isDiscoverable: true,
    },
    location: { label: "Drake's" },
    ...overrides,
  }
}

describe('T082/T095 — GatheringPublicPage', () => {
  it('Member-attributed, discoverable: "Hosted by [Member]" links to /m/<handle>', () => {
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

    const attribution = screen.getByTestId('gathering-attribution')
    expect(attribution).toHaveTextContent('Hosted by Sam Rivera')
    const link = screen.getByTestId('gathering-attribution-link')
    expect(link).toHaveAttribute('href', '/m/sam')
  })

  it('Member-attributed, non-discoverable: "Hosted by [Member]" renders as plain text', () => {
    render(
      <GatheringPublicPage
        gathering={gathering({
          attribution: {
            kind: 'member',
            handle: 'sam',
            displayName: 'Sam Rivera',
            isDiscoverable: false,
          },
        })}
        groupHref={null}
        nextOccurrenceLabel="Thursday, June 4, 2099"
        shareUrl="/x"
      />,
    )
    expect(screen.queryByTestId('gathering-attribution-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('gathering-attribution-text')).toHaveTextContent('Sam Rivera')
  })

  it('Group-attributed: "Hosted by [Group]" links to the Group page', () => {
    render(
      <GatheringPublicPage
        gathering={gathering({
          brandLabel: "Drake's Brews and Bites",
          attribution: { kind: 'group', name: "Drake's Brews and Bites" },
        })}
        groupHref="/p/ca/sacramento/oak-park/g/drakes-a1"
        nextOccurrenceLabel="Thursday, June 4, 2099"
        shareUrl="/x"
      />,
    )
    const link = screen.getByTestId('gathering-attribution-link')
    expect(link).toHaveTextContent("Drake's Brews and Bites")
    expect(link).toHaveAttribute('href', '/p/ca/sacramento/oak-park/g/drakes-a1')
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
})
