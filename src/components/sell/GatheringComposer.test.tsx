// T081 — Unit tests for <GatheringComposer>.
// Trace: each test maps to a Then-clause in F034 or a T081 acceptance checkbox.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { GatheringComposer, weeklyRrule, combineDateTime } from './GatheringComposer'

afterEach(() => cleanup())

function setup(overrides: Partial<Parameters<typeof GatheringComposer>[0]> = {}) {
  const createGathering = vi.fn(async (_input: Record<string, unknown>) => {
    void _input
    return { itemId: 'item-1', destinationUrl: '/m/sam/e/thursday-run-club-deadbeef' }
  })
  const redirect = vi.fn()
  const showToast = vi.fn()
  const onAbandon = vi.fn()

  render(
    <GatheringComposer
      createGathering={createGathering}
      redirect={redirect}
      showToast={showToast}
      defaultLocationId="loc-1"
      defaultLocationLabel="Drake's"
      onAbandon={onAbandon}
      {...overrides}
    />,
  )
  return { createGathering, redirect, showToast, onAbandon }
}

const cont = () => fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }))

describe('weeklyRrule', () => {
  it('derives a weekly BYDAY rule from a date', () => {
    // 2099-06-04. Assert the shape; the weekday letters are 2 uppercase chars.
    expect(weeklyRrule('2099-06-04')).toMatch(/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/)
    // 2020-01-02 is a Thursday.
    expect(weeklyRrule('2020-01-02')).toBe('FREQ=WEEKLY;BYDAY=TH')
  })
})

describe('combineDateTime', () => {
  it('joins date + time into an ISO-ish local datetime string', () => {
    expect(combineDateTime('2099-06-04', '18:00')).toBe('2099-06-04T18:00:00')
  })
})

describe('T081 — GatheringComposer step 1 (kind picker)', () => {
  it('renders the three user-language kind options (not a four-kind picker)', () => {
    setup()
    expect(screen.getByTestId('gathering-kind-option-one_time')).toBeInTheDocument()
    expect(screen.getByTestId('gathering-kind-option-recurring')).toBeInTheDocument()
    expect(screen.getByTestId('gathering-kind-option-open_meetup')).toBeInTheDocument()
  })

  it('blocks Continue until a kind is picked', () => {
    setup()
    cont()
    expect(screen.getByTestId('field-error-kind')).toBeInTheDocument()
    // Still on step 1.
    expect(screen.getByTestId('gathering-kind-option-recurring')).toBeInTheDocument()
  })
})

describe('T081 — recurring gathering happy path', () => {
  async function fillToSchedule() {
    fireEvent.click(screen.getByTestId('gathering-kind-option-recurring'))
    cont() // → details
    await waitFor(() =>
      expect(screen.getByTestId('gathering-title-input')).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByTestId('gathering-title-input'), {
      target: { value: 'Thursday Run Club' },
    })
    fireEvent.change(screen.getByTestId('gathering-description-input'), {
      target: { value: 'Easy 5k, all paces.' },
    })
    cont() // → schedule
    await waitFor(() =>
      expect(screen.getByTestId('gathering-date-input')).toBeInTheDocument(),
    )
  }

  it('derives a recurrence preview once a date is chosen', async () => {
    setup()
    await fillToSchedule()
    fireEvent.change(screen.getByTestId('gathering-date-input'), {
      target: { value: '2099-06-04' },
    })
    await waitFor(() =>
      expect(screen.getByTestId('gathering-recurrence-preview')).toHaveTextContent(
        /Every \w+/,
      ),
    )
  })

  it('blocks Continue when the first occurrence is in the past', async () => {
    setup()
    await fillToSchedule()
    fireEvent.change(screen.getByTestId('gathering-date-input'), {
      target: { value: '2020-01-02' },
    })
    fireEvent.change(screen.getByTestId('gathering-time-input'), {
      target: { value: '18:00' },
    })
    cont()
    expect(screen.getByTestId('field-error-schedule')).toBeInTheDocument()
  })

  it('publishes with kind, recurrenceRule, startsAt, location; blank cost → costCents null', async () => {
    const { createGathering, redirect } = setup()
    await fillToSchedule()
    fireEvent.change(screen.getByTestId('gathering-date-input'), {
      target: { value: '2099-06-04' },
    })
    fireEvent.change(screen.getByTestId('gathering-time-input'), {
      target: { value: '18:00' },
    })
    fireEvent.change(screen.getByTestId('gathering-capacity-input'), {
      target: { value: '30' },
    })
    fireEvent.change(screen.getByTestId('gathering-what-to-bring-input'), {
      target: { value: 'Water + shoes' },
    })
    cont() // → review
    await waitFor(() =>
      expect(screen.getByTestId('gathering-review-list')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Publish gathering/i }))
    await waitFor(() => expect(createGathering).toHaveBeenCalledTimes(1))
    const arg = createGathering.mock.calls[0][0] as Record<string, unknown>
    expect(arg.gatheringKind).toBe('recurring')
    expect(arg.title).toBe('Thursday Run Club')
    expect(arg.recurrenceRule).toMatch(/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/)
    expect(arg.startsAt).toBe('2099-06-04T18:00:00')
    expect(arg.capacity).toBe(30)
    expect(arg.costCents).toBeNull()
    expect(arg.whatToBring).toBe('Water + shoes')
    expect(arg.locationId).toBe('loc-1')
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining('/e/'))
  })
})

describe('T081 — open meetup needs no fixed time', () => {
  it('reaches publish without a date and submits ongoing (no startsAt)', async () => {
    const { createGathering } = setup()
    fireEvent.click(screen.getByTestId('gathering-kind-option-open_meetup'))
    cont() // → details
    await waitFor(() =>
      expect(screen.getByTestId('gathering-title-input')).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByTestId('gathering-title-input'), {
      target: { value: 'Open Board Games' },
    })
    fireEvent.change(screen.getByTestId('gathering-description-input'), {
      target: { value: 'Drop in any evening.' },
    })
    cont() // → schedule (no time required for open meetup)
    await waitFor(() =>
      expect(screen.getByTestId('gathering-open-meetup-note')).toBeInTheDocument(),
    )
    cont() // → review
    await waitFor(() =>
      expect(screen.getByTestId('gathering-review-list')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: /Publish gathering/i }))
    await waitFor(() => expect(createGathering).toHaveBeenCalledTimes(1))
    const arg = createGathering.mock.calls[0][0] as Record<string, unknown>
    expect(arg.gatheringKind).toBe('open_meetup')
    expect(arg.startsAt).toBeUndefined()
    expect(arg.recurrenceRule).toBeUndefined()
  })
})
