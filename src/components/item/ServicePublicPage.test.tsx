// T083 — Unit tests for <ServicePublicPage>.
// Trace: F040 § Item page shows brand + service area + pricing; § No Locally Made step.

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
    owner: { handle: 'maya', displayName: 'Maya Chen' },
    anchor: { label: 'Studio' },
    ...overrides,
  }
}

describe('T083 — ServicePublicPage', () => {
  it('renders title, hourly rate, brand link, owner link, and service area', () => {
    render(
      <ServicePublicPage
        service={service()}
        groupHref="/p/ca/sacramento/oak-park/g/maya-music-a1"
      />,
    )
    expect(screen.getByTestId('service-title')).toHaveTextContent('Piano lessons')
    expect(screen.getByTestId('service-rate')).toHaveTextContent('$95.00 / hr')
    expect(screen.getByTestId('service-area')).toBeInTheDocument()

    const brand = screen.getByTestId('service-brand-link')
    expect(brand).toHaveTextContent('Maya Music')
    expect(brand).toHaveAttribute('href', '/p/ca/sacramento/oak-park/g/maya-music-a1')

    const owner = screen.getByTestId('service-owner-link')
    expect(owner).toHaveTextContent('Maya Chen')
    expect(owner).toHaveAttribute('href', '/m/maya')
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

  it('renders the brand as plain text (no link) when no groupHref', () => {
    render(<ServicePublicPage service={service()} groupHref={null} />)
    expect(screen.queryByTestId('service-brand-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('service-brand')).toHaveTextContent('Maya Music')
  })
})
