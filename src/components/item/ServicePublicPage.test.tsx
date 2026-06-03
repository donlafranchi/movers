// T083 — Unit tests for <ServicePublicPage>.
// T095 — Updated: attribution model (Group vs Member + conditional link).
// Trace: F040 § Item page shows attribution + service area + pricing; § No Locally Made step.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ServicePublicPage } from './ServicePublicPage'
import type { ResolvedService } from '@/lib/items/resolve-service'

afterEach(() => cleanup())

function service(overrides: Partial<ResolvedService> = {}): ResolvedService {
  return {
    itemId: 'deadbeef-1111',
    title: 'Piano lessons',
    description: 'In-home, 30 minutes.',
    rateModel: 'hourly',
    rateCents: 9500,
    hasServiceArea: true,
    brandLabel: 'Maya Music',
    attribution: { kind: 'group', name: 'Maya Music' },
    anchor: { label: 'Studio' },
    ...overrides,
  }
}

describe('T083/T095 — ServicePublicPage', () => {
  it('Group-attributed: "Offered by [Group]" links to the Shop page', () => {
    render(
      <ServicePublicPage
        service={service()}
        groupHref="/p/ca/sacramento/oak-park/g/maya-music-a1"
      />,
    )
    expect(screen.getByTestId('service-title')).toHaveTextContent('Piano lessons')
    expect(screen.getByTestId('service-rate')).toHaveTextContent('$95.00 / hr')
    expect(screen.getByTestId('service-area')).toBeInTheDocument()

    const attribution = screen.getByTestId('service-attribution')
    expect(attribution).toHaveTextContent('Offered by Maya Music')
    const link = screen.getByTestId('service-attribution-link')
    expect(link).toHaveAttribute('href', '/p/ca/sacramento/oak-park/g/maya-music-a1')
  })

  it('Member-attributed, discoverable: "Offered by [Member]" links to /m/<handle>', () => {
    render(
      <ServicePublicPage
        service={service({
          brandLabel: null,
          attribution: {
            kind: 'member',
            handle: 'maya',
            displayName: 'Maya Chen',
            isDiscoverable: true,
          },
        })}
        groupHref={null}
      />,
    )
    const link = screen.getByTestId('service-attribution-link')
    expect(link).toHaveAttribute('href', '/m/maya')
    expect(link).toHaveTextContent('Maya Chen')
  })

  it('Member-attributed, non-discoverable: "Offered by [Member]" renders as plain text', () => {
    render(
      <ServicePublicPage
        service={service({
          brandLabel: null,
          attribution: {
            kind: 'member',
            handle: 'maya',
            displayName: 'Maya Chen',
            isDiscoverable: false,
          },
        })}
        groupHref={null}
      />,
    )
    expect(screen.queryByTestId('service-attribution-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('service-attribution-text')).toHaveTextContent('Maya Chen')
  })

  it('renders "Request a quote" for the quote model', () => {
    render(
      <ServicePublicPage
        service={service({ rateModel: 'quote', rateCents: null })}
        groupHref={null}
      />,
    )
    expect(screen.getByTestId('service-rate')).toHaveTextContent('Request a quote')
  })

  it('renders "Free" when a non-quote rate is null', () => {
    render(
      <ServicePublicPage
        service={service({ rateModel: 'flat', rateCents: null })}
        groupHref={null}
      />,
    )
    expect(screen.getByTestId('service-rate')).toHaveTextContent('Free')
  })

  it('renders a flat rate without a per-unit suffix', () => {
    render(
      <ServicePublicPage
        service={service({ rateModel: 'flat', rateCents: 5000 })}
        groupHref={null}
      />,
    )
    expect(screen.getByTestId('service-rate')).toHaveTextContent('$50.00')
    expect(screen.getByTestId('service-rate')).not.toHaveTextContent('/ hr')
  })

  it('renders a membership rate with a /mo suffix', () => {
    render(
      <ServicePublicPage
        service={service({ rateModel: 'membership', rateCents: 2000 })}
        groupHref={null}
      />,
    )
    expect(screen.getByTestId('service-rate')).toHaveTextContent('$20.00 / mo')
  })

  it('omits the service-area section when hasServiceArea is false', () => {
    render(
      <ServicePublicPage service={service({ hasServiceArea: false })} groupHref={null} />,
    )
    expect(screen.queryByTestId('service-area')).not.toBeInTheDocument()
  })

  it('never renders a Locally Made badge (services excluded)', () => {
    render(<ServicePublicPage service={service()} groupHref={null} />)
    expect(screen.queryByTestId('product-made-badge')).not.toBeInTheDocument()
    expect(screen.queryByText(/Locally Made/i)).not.toBeInTheDocument()
  })
})
