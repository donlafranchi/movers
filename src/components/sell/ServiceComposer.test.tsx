// T082 — Unit tests for <ServiceComposer>.
// Trace: each test maps to a Then-clause in F040 or a T082 acceptance checkbox.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import {
  ServiceComposer,
  milesToMeters,
  type PickupLocationOption,
} from './ServiceComposer'

afterEach(() => cleanup())

function setup(overrides: Partial<Parameters<typeof ServiceComposer>[0]> = {}) {
  const createService = vi.fn(async (_input: Record<string, unknown>) => {
    void _input
    return {
      itemId: 'item-1',
      destinationUrl: '/p/ca/sacramento/oak-park/g/maya-music-a1/s/piano-lessons-deadbeef',
    }
  })
  const createLocation = vi.fn(async ({ label }: { label: string }) => ({
    id: 'loc-new',
    label,
  }))
  const redirect = vi.fn()
  const showToast = vi.fn()
  const onAbandon = vi.fn()
  const availableLocations: PickupLocationOption[] = [
    { id: 'loc-1', label: 'Studio', sublabel: 'Oak Park' },
  ]

  const utils = render(
    <ServiceComposer
      createService={createService}
      createLocation={createLocation}
      availableLocations={availableLocations}
      defaultCenterLocationId="loc-1"
      defaultCenterLocationLabel="Studio"
      redirect={redirect}
      showToast={showToast}
      onAbandon={onAbandon}
      {...overrides}
    />,
  )
  return { createService, createLocation, redirect, showToast, onAbandon, utils }
}

const cont = () => fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))

describe('milesToMeters', () => {
  it('converts miles to meters', () => {
    expect(milesToMeters(1)).toBeCloseTo(1609.34, 1)
    expect(milesToMeters(5)).toBeCloseTo(8046.7, 0)
  })
})

describe('T082 — ServiceComposer step 1 (details)', () => {
  it('renders title + description inputs', () => {
    setup()
    expect(screen.getByTestId('service-title-input')).toBeInTheDocument()
    expect(screen.getByTestId('service-description-input')).toBeInTheDocument()
  })

  it('blocks Continue with inline errors when title + description empty', () => {
    setup()
    cont()
    expect(screen.getByTestId('field-error-title')).toBeInTheDocument()
    expect(screen.getByTestId('field-error-description')).toBeInTheDocument()
  })

  it('never renders a "Where is this made?" step (services excluded)', () => {
    setup()
    expect(screen.queryByTestId('product-made-step')).not.toBeInTheDocument()
    expect(screen.queryByText(/Where is this made/i)).not.toBeInTheDocument()
  })
})

async function fillDetails() {
  fireEvent.change(screen.getByTestId('service-title-input'), {
    target: { value: 'Piano lessons' },
  })
  fireEvent.change(screen.getByTestId('service-description-input'), {
    target: { value: 'In-home, 30 minutes.' },
  })
  cont() // → pricing
  await waitFor(() =>
    expect(screen.getByTestId('service-rate-model-select')).toBeInTheDocument(),
  )
}

describe('T082 — pricing step', () => {
  it('hides the rate input when Free is toggled', async () => {
    setup()
    await fillDetails()
    fireEvent.click(screen.getByTestId('service-free-toggle'))
    expect(screen.queryByTestId('service-rate-input')).not.toBeInTheDocument()
  })

  it('hides the rate input when rate model is quote', async () => {
    setup()
    await fillDetails()
    fireEvent.change(screen.getByTestId('service-rate-model-select'), {
      target: { value: 'quote' },
    })
    expect(screen.queryByTestId('service-rate-input')).not.toBeInTheDocument()
  })
})

describe('T082 — service area + publish', () => {
  async function fillToServiceArea() {
    setup()
    await fillDetails()
    fireEvent.change(screen.getByTestId('service-rate-model-select'), {
      target: { value: 'hourly' },
    })
    fireEvent.change(screen.getByTestId('service-rate-input'), {
      target: { value: '95' },
    })
    cont() // → service area
    await waitFor(() =>
      expect(screen.getByTestId('service-center-options')).toBeInTheDocument(),
    )
  }

  it('requires a radius before publishing', async () => {
    await fillToServiceArea()
    // center pre-selected via default; radius empty → blocked
    cont()
    expect(screen.getByTestId('field-error-radius')).toBeInTheDocument()
  })

  it('submits rateModel/rateCents/center/radius (miles→meters) and redirects', async () => {
    const { createService, redirect } = setup()
    await fillDetails()
    fireEvent.change(screen.getByTestId('service-rate-model-select'), {
      target: { value: 'hourly' },
    })
    fireEvent.change(screen.getByTestId('service-rate-input'), {
      target: { value: '95' },
    })
    cont() // → service area
    await waitFor(() =>
      expect(screen.getByTestId('service-center-options')).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByTestId('service-radius-input'), {
      target: { value: '5' },
    })
    cont() // → review
    await waitFor(() =>
      expect(screen.getByTestId('service-review-list')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Publish service/i }))
    await waitFor(() => expect(createService).toHaveBeenCalledTimes(1))
    const arg = createService.mock.calls[0][0] as Record<string, unknown>
    expect(arg.title).toBe('Piano lessons')
    expect(arg.rateModel).toBe('hourly')
    expect(arg.rateCents).toBe(9500)
    expect(arg.centerLocationId).toBe('loc-1')
    expect(arg.radiusMeters).toBeCloseTo(8046.7, 0)
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining('/s/piano-lessons-'))
  })

  it('free service submits rateCents null', async () => {
    const { createService } = setup()
    await fillDetails()
    fireEvent.click(screen.getByTestId('service-free-toggle'))
    cont() // → service area
    await waitFor(() =>
      expect(screen.getByTestId('service-center-options')).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByTestId('service-radius-input'), {
      target: { value: '3' },
    })
    cont() // → review
    await waitFor(() =>
      expect(screen.getByTestId('service-review-list')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Publish service/i }))
    await waitFor(() => expect(createService).toHaveBeenCalledTimes(1))
    expect((createService.mock.calls[0][0] as Record<string, unknown>).rateCents).toBeNull()
  })

  it('quote service submits rateCents null', async () => {
    const { createService } = setup()
    await fillDetails()
    fireEvent.change(screen.getByTestId('service-rate-model-select'), {
      target: { value: 'quote' },
    })
    cont() // → service area
    await waitFor(() =>
      expect(screen.getByTestId('service-center-options')).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByTestId('service-radius-input'), {
      target: { value: '10' },
    })
    cont() // → review
    await waitFor(() =>
      expect(screen.getByTestId('service-review-list')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Publish service/i }))
    await waitFor(() => expect(createService).toHaveBeenCalledTimes(1))
    const arg = createService.mock.calls[0][0] as Record<string, unknown>
    expect(arg.rateModel).toBe('quote')
    expect(arg.rateCents).toBeNull()
  })
})
