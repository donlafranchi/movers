// T079 — Unit tests for <ProductPublicPage>.
// T095 — Updated: attribution model (Group vs Member + conditional link).
// Trace: F038 § Item page shows attribution; § Skip-provenance path.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ProductPublicPage } from './ProductPublicPage'
import type { ResolvedProduct } from '@/lib/items/resolve-product'

afterEach(() => cleanup())

function product(overrides: Partial<ResolvedProduct> = {}): ResolvedProduct {
  return {
    itemId: 'deadbeef-1111',
    title: 'Country Sourdough Loaf',
    description: 'Naturally leavened.',
    priceCents: 900,
    priceUnit: 'loaf',
    photoUrls: [],
    brandLabel: 'Oak Park Sourdough',
    attribution: { kind: 'group', name: 'Oak Park Sourdough' },
    pickup: { label: "Maya's Kitchen" },
    madeAtPlaceId: null,
    ...overrides,
  }
}

describe('T079/T095 — ProductPublicPage', () => {
  it('Group-attributed: "Sold by [Group]" links to the Shop page', () => {
    render(
      <ProductPublicPage
        product={product()}
        groupHref="/p/ca/sacramento/oak-park/g/oak-park-sourdough-a1"
      />,
    )
    expect(screen.getByTestId('product-title')).toHaveTextContent('Country Sourdough Loaf')
    expect(screen.getByTestId('product-price')).toHaveTextContent('$9.00 / loaf')
    expect(screen.getByTestId('product-pickup')).toHaveTextContent("Maya's Kitchen")

    const attribution = screen.getByTestId('product-attribution')
    expect(attribution).toHaveTextContent('Sold by Oak Park Sourdough')
    const link = screen.getByTestId('product-attribution-link')
    expect(link).toHaveAttribute('href', '/p/ca/sacramento/oak-park/g/oak-park-sourdough-a1')
  })

  it('Member-attributed, discoverable: "Sold by [Member]" links to /m/<handle>', () => {
    render(
      <ProductPublicPage
        product={product({
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
    const attribution = screen.getByTestId('product-attribution')
    expect(attribution).toHaveTextContent('Sold by Maya Chen')
    const link = screen.getByTestId('product-attribution-link')
    expect(link).toHaveAttribute('href', '/m/maya')
  })

  it('Member-attributed, non-discoverable: "Sold by [Member]" renders as plain text (no link)', () => {
    render(
      <ProductPublicPage
        product={product({
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
    const attribution = screen.getByTestId('product-attribution')
    expect(attribution).toHaveTextContent('Sold by Maya Chen')
    expect(screen.queryByTestId('product-attribution-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('product-attribution-text')).toHaveTextContent('Maya Chen')
  })

  it('renders "Free" when priceCents is null', () => {
    render(<ProductPublicPage product={product({ priceCents: null, priceUnit: null })} groupHref={null} />)
    expect(screen.getByTestId('product-price')).toHaveTextContent('Free')
  })

  it('omits the Locally Made badge when madeAtPlaceId is null (skip-path)', () => {
    render(<ProductPublicPage product={product({ madeAtPlaceId: null })} groupHref={null} />)
    expect(screen.queryByTestId('product-made-badge')).not.toBeInTheDocument()
  })

  it('renders the Locally Made badge when madeAtPlaceId is set', () => {
    render(
      <ProductPublicPage
        product={product({ madeAtPlaceId: 'place-1' })}
        groupHref={null}
      />,
    )
    expect(screen.getByTestId('product-made-badge')).toBeInTheDocument()
  })
})
