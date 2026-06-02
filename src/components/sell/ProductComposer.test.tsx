// T078 — Unit tests for <ProductComposer>.
// Trace: each test maps to a Then-clause in F038 or a T078 acceptance checkbox.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
  ProductComposer,
  dollarsToCents,
  type PickupLocationOption,
} from './ProductComposer'

afterEach(() => cleanup())

function setup(overrides: Partial<Parameters<typeof ProductComposer>[0]> = {}) {
  const createProduct = vi.fn(async (_input: Record<string, unknown>) => {
    void _input
    return { itemId: 'item-1', destinationUrl: '/p/ca/sacramento/oak-park/g/oak-park-sourdough-a1/p/country-sourdough-loaf-deadbeef' }
  })
  const createLocation = vi.fn(async ({ label }: { label: string }) => ({
    id: 'loc-new',
    label,
  }))
  const redirect = vi.fn()
  const showToast = vi.fn()
  const onAbandon = vi.fn()
  const availableLocations: PickupLocationOption[] = [
    { id: 'loc-1', label: "Maya's Kitchen", sublabel: 'Oak Park' },
  ]

  const utils = render(
    <ProductComposer
      createProduct={createProduct}
      createLocation={createLocation}
      availableLocations={availableLocations}
      defaultPickupLocationId="loc-1"
      defaultPickupLocationLabel="Maya's Kitchen"
      redirect={redirect}
      showToast={showToast}
      onAbandon={onAbandon}
      {...overrides}
    />,
  )
  return { createProduct, createLocation, redirect, showToast, onAbandon, utils }
}

const cont = () => fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))

describe('dollarsToCents', () => {
  it('parses dollars to integer cents', () => {
    expect(dollarsToCents('9')).toBe(900)
    expect(dollarsToCents('9.50')).toBe(950)
    expect(dollarsToCents('$1,234.00')).toBe(123400)
  })
  it('returns null for blank or invalid', () => {
    expect(dollarsToCents('')).toBeNull()
    expect(dollarsToCents('abc')).toBeNull()
    expect(dollarsToCents('-5')).toBeNull()
  })
})

describe('T078 — ProductComposer step 1 (details)', () => {
  it('renders title, description, and price inputs', () => {
    setup()
    expect(screen.getByTestId('product-title-input')).toBeInTheDocument()
    expect(screen.getByTestId('product-description-input')).toBeInTheDocument()
    expect(screen.getByTestId('product-price-input')).toBeInTheDocument()
  })

  it('blocks Continue with inline errors when title + description are empty', () => {
    setup()
    cont()
    expect(screen.getByTestId('field-error-title')).toBeInTheDocument()
    expect(screen.getByTestId('field-error-description')).toBeInTheDocument()
    // Still on step 1.
    expect(screen.getByTestId('product-title-input')).toBeInTheDocument()
  })

  it('hides the price input and requires no price when Free is toggled', async () => {
    setup()
    fireEvent.change(screen.getByTestId('product-title-input'), {
      target: { value: 'Free starter' },
    })
    fireEvent.change(screen.getByTestId('product-description-input'), {
      target: { value: 'A gift.' },
    })
    fireEvent.click(screen.getByTestId('product-free-toggle'))
    expect(screen.queryByTestId('product-price-input')).not.toBeInTheDocument()
    cont()
    // Advanced to step 2 (pickup).
    await waitFor(() =>
      expect(screen.getByTestId('product-pickup-options')).toBeInTheDocument(),
    )
  })
})

describe('T078 — skip-provenance path + publish', () => {
  async function fillThroughToMadeStep() {
    setup()
    fireEvent.change(screen.getByTestId('product-title-input'), {
      target: { value: 'Country Sourdough Loaf' },
    })
    fireEvent.change(screen.getByTestId('product-description-input'), {
      target: { value: 'Naturally leavened.' },
    })
    fireEvent.change(screen.getByTestId('product-price-input'), {
      target: { value: '9' },
    })
    cont() // → step 2 (pickup; loc-1 pre-selected via default)
    await waitFor(() =>
      expect(screen.getByTestId('product-pickup-options')).toBeInTheDocument(),
    )
    cont() // → step 3 (made)
    await waitFor(() =>
      expect(screen.getByTestId('product-made-step')).toBeInTheDocument(),
    )
  }

  it('renders a Skip link on the optional made step', async () => {
    await fillThroughToMadeStep()
    expect(screen.getByRole('link', { name: /Skip this step/i })).toBeInTheDocument()
  })

  it('skipping made reaches publish and submits with madeAtPlaceId undefined + price in cents', async () => {
    const { createProduct, redirect } = setup()
    fireEvent.change(screen.getByTestId('product-title-input'), {
      target: { value: 'Country Sourdough Loaf' },
    })
    fireEvent.change(screen.getByTestId('product-description-input'), {
      target: { value: 'Naturally leavened.' },
    })
    fireEvent.change(screen.getByTestId('product-price-input'), {
      target: { value: '9' },
    })
    fireEvent.change(screen.getByTestId('product-price-unit-input'), {
      target: { value: 'loaf' },
    })
    cont() // → pickup
    await waitFor(() =>
      expect(screen.getByTestId('product-pickup-options')).toBeInTheDocument(),
    )
    cont() // → made
    await waitFor(() =>
      expect(screen.getByTestId('product-made-step')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('link', { name: /Skip this step/i })) // → review
    await waitFor(() =>
      expect(screen.getByTestId('product-review-list')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Publish product/i }))
    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1))
    const arg = createProduct.mock.calls[0][0] as Record<string, unknown>
    expect(arg.title).toBe('Country Sourdough Loaf')
    expect(arg.priceCents).toBe(900)
    expect(arg.priceUnit).toBe('loaf')
    expect(arg.locationId).toBe('loc-1')
    expect(arg.madeAtPlaceId).toBeUndefined()
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining('/p/country-sourdough-loaf-'))
  })

  it('free product submits priceCents null', async () => {
    const { createProduct } = setup()
    fireEvent.change(screen.getByTestId('product-title-input'), {
      target: { value: 'Free starter' },
    })
    fireEvent.change(screen.getByTestId('product-description-input'), {
      target: { value: 'A gift.' },
    })
    fireEvent.click(screen.getByTestId('product-free-toggle'))
    cont() // → pickup
    await waitFor(() =>
      expect(screen.getByTestId('product-pickup-options')).toBeInTheDocument(),
    )
    cont() // → made
    await waitFor(() =>
      expect(screen.getByTestId('product-made-step')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('link', { name: /Skip this step/i })) // → review
    await waitFor(() =>
      expect(screen.getByTestId('product-review-list')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Publish product/i }))
    await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1))
    expect((createProduct.mock.calls[0][0] as Record<string, unknown>).priceCents).toBeNull()
  })
})
