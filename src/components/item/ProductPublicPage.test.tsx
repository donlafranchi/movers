// T079 — Unit tests for <ProductPublicPage>.
// Trace: F038 § Item page shows brand resolve-up + owner; § Skip-provenance path.

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
    owner: { handle: 'maya', displayName: 'Maya Chen' },
    pickup: { label: "Maya's Kitchen" },
    madeAtPlaceId: null,
    ...overrides,
  }
}

describe('T079 — ProductPublicPage', () => {
  it('renders title, price, pickup, brand link, and owner link', () => {
    render(
      <ProductPublicPage
        product={product()}
        groupHref="/p/ca/sacramento/oak-park/g/oak-park-sourdough-a1"
      />,
    )
    expect(screen.getByTestId('product-title')).toHaveTextContent('Country Sourdough Loaf')
    expect(screen.getByTestId('product-price')).toHaveTextContent('$9.00 / loaf')
    expect(screen.getByTestId('product-pickup')).toHaveTextContent("Maya's Kitchen")

    const brand = screen.getByTestId('product-brand-link')
    expect(brand).toHaveTextContent('Oak Park Sourdough')
    expect(brand).toHaveAttribute('href', '/p/ca/sacramento/oak-park/g/oak-park-sourdough-a1')

    const owner = screen.getByTestId('product-owner-link')
    expect(owner).toHaveTextContent('Maya Chen')
    expect(owner).toHaveAttribute('href', '/m/maya')
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

  it('renders the brand as plain text (no link) when no groupHref', () => {
    render(<ProductPublicPage product={product()} groupHref={null} />)
    expect(screen.queryByTestId('product-brand-link')).not.toBeInTheDocument()
    expect(screen.getByTestId('product-brand')).toHaveTextContent('Oak Park Sourdough')
  })
})
