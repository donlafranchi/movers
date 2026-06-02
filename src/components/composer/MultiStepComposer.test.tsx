import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MultiStepComposer, type StepDef } from './MultiStepComposer'
import React from 'react'

// T071 — Unit tests for the canonical multi-step composer.
// Source: development/tickets/T071-multistep-composer-base.md
// Spec:   product/ui/design-language.md § Component recipes → Multi-step composer

type State = { brand: string; locationId: string | null; about: string }

const initialState: State = { brand: '', locationId: null, about: '' }

function makeSteps(): StepDef<State>[] {
  return [
    {
      id: 'brand',
      title: 'Brand name',
      helper: 'What should your shop be called?',
      render: (state, setState) => (
        <input
          aria-label="Brand name input"
          value={state.brand}
          onChange={(e) => setState({ ...state, brand: e.target.value })}
        />
      ),
      validate: (state) =>
        state.brand.trim().length > 0
          ? { ok: true }
          : { ok: false, errors: { brand: 'Brand name is required' } },
    },
    {
      id: 'anchor',
      title: 'Anchor Location',
      render: (state, setState) => (
        <button
          type="button"
          onClick={() => setState({ ...state, locationId: 'loc-1' })}
        >
          Pick Maya&apos;s Kitchen
        </button>
      ),
      validate: (state) =>
        state.locationId
          ? { ok: true }
          : { ok: false, errors: { locationId: 'Pick a Location' } },
    },
    {
      id: 'about',
      title: 'About (optional)',
      isOptional: true,
      render: (state, setState) => (
        <textarea
          aria-label="About"
          value={state.about}
          onChange={(e) => setState({ ...state, about: e.target.value })}
        />
      ),
      validate: () => ({ ok: true }),
    },
    {
      id: 'review',
      title: 'Review and create',
      render: (state) => <div>Brand: {state.brand}</div>,
      validate: () => ({ ok: true }),
      finalLabel: 'Create my shop',
    },
  ]
}

describe('T071 — <MultiStepComposer> base', () => {
  let onAdvance: (stepId: string, state: State) => Promise<void>
  let onComplete: (state: State) => Promise<{ destinationUrl: string }>
  let onAbandon: () => void
  let advanceCalls: Array<[string, State]>
  let completeCalls: number

  beforeEach(() => {
    advanceCalls = []
    completeCalls = 0
    onAdvance = async (stepId, state) => { advanceCalls.push([stepId, state]) }
    onComplete = async () => { completeCalls += 1; return { destinationUrl: '/p/oakpark/g/oak-park-sourdough' } }
    onAbandon = vi.fn() as unknown as () => void
  })

  afterEach(() => {
    cleanup()
  })

  it('renders step 1 with title + helper and no Back link', () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={initialState}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    expect(screen.getByText('Brand name')).toBeInTheDocument()
    expect(screen.getByText('What should your shop be called?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^← Back$/i })).not.toBeInTheDocument()
  })

  it('renders step indicator with role=progressbar and aria-valuenow/valuemax', () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={initialState}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    const progressbar = screen.getByRole('progressbar')
    expect(progressbar).toHaveAttribute('aria-valuenow', '1')
    expect(progressbar).toHaveAttribute('aria-valuemax', '4')
  })

  it('advances to step 2 when Continue is tapped on a valid step 1', async () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={initialState}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    fireEvent.change(screen.getByLabelText('Brand name input'), {
      target: { value: 'Oak Park Sourdough' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    await waitFor(() => {
      expect(screen.getByText('Anchor Location')).toBeInTheDocument()
    })
    expect(advanceCalls).toHaveLength(1)
    expect(advanceCalls[0][0]).toBe('brand')
    expect(advanceCalls[0][1]).toMatchObject({ brand: 'Oak Park Sourdough' })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')
  })

  it('blocks advance + surfaces inline error when validate fails (no top-of-form summary)', async () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={initialState}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    // Click Continue with empty brand
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    await waitFor(() => {
      expect(screen.getByText('Brand name is required')).toBeInTheDocument()
    })
    expect(advanceCalls).toHaveLength(0)
    // Still on step 1
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  it('renders Back link from step 2 onward and goes back when tapped', async () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={{ ...initialState, brand: 'Oak Park Sourdough' }}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    // Advance brand → anchor
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    await waitFor(() => {
      expect(screen.getByText('Anchor Location')).toBeInTheDocument()
    })
    // Back link visible
    const back = screen.getByRole('button', { name: /Back/i })
    fireEvent.click(back)
    await waitFor(() => {
      expect(screen.getByText('Brand name')).toBeInTheDocument()
    })
  })

  it('shows Skip link only on optional steps; skip advances without validation', async () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={{
          ...initialState,
          brand: 'Oak Park Sourdough',
          locationId: 'loc-1',
        }}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    // Step 1 (brand) — no Skip
    expect(screen.queryByRole('link', { name: /Skip this step/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    await waitFor(() => expect(screen.getByText('Anchor Location')).toBeInTheDocument())
    // Step 2 (anchor, required) — no Skip
    expect(screen.queryByRole('link', { name: /Skip this step/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    await waitFor(() => expect(screen.getByText('About (optional)')).toBeInTheDocument())
    // Step 3 (about, optional) — Skip visible
    const skip = screen.getByRole('link', { name: /Skip this step/i })
    fireEvent.click(skip)
    await waitFor(() => expect(screen.getByText('Review and create')).toBeInTheDocument())
  })

  it('jumps to resumeFromStep on mount with initialState hydrated', () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={{ brand: 'Oak Park Sourdough', locationId: 'loc-1', about: '' }}
        resumeFromStep={2}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    expect(screen.getByText('About (optional)')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
  })

  it('final-step CTA reads the step-supplied finalLabel and fires onComplete', async () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={{ brand: 'Oak Park Sourdough', locationId: 'loc-1', about: '' }}
        resumeFromStep={3}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    expect(screen.getByText('Review and create')).toBeInTheDocument()
    const finalCta = screen.getByRole('button', { name: /Create my shop/i })
    expect(finalCta).toBeInTheDocument()
    fireEvent.click(finalCta)
    await waitFor(() => expect(completeCalls).toBe(1))
  })

  it('X button fires onAbandon (and tap-outside does NOT)', () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={initialState}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    const overlay = screen.getByTestId('multistep-composer-overlay')
    fireEvent.click(overlay)
    expect((onAbandon as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
    const closeBtn = screen.getByRole('button', { name: /Close/i })
    fireEvent.click(closeBtn)
    expect((onAbandon as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })

  it('disables Continue + shows spinner during onAdvance await', async () => {
    let resolveAdvance: () => void = () => {}
    const slowAdvance: (stepId: string, state: State) => Promise<void> = () =>
      new Promise<void>((resolve) => { resolveAdvance = resolve })
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={{ ...initialState, brand: 'Oak' }}
        onAdvance={slowAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    await waitFor(() => {
      expect(screen.getByTestId('continue-spinner')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled()
    act(() => { resolveAdvance() })
    await waitFor(() => {
      expect(screen.queryByTestId('continue-spinner')).not.toBeInTheDocument()
    })
  })

  it('ESC fires onAbandon', () => {
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={initialState}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect((onAbandon as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })

  it('restores focus to the originating element on unmount', () => {
    const opener = document.createElement('button')
    opener.id = 'opener'
    opener.textContent = 'Open'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { unmount } = render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={initialState}
        onAdvance={onAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    // While mounted, focus should NOT be on the opener.
    expect(document.activeElement).not.toBe(opener)
    unmount()
    // After unmount, focus restores to the opener.
    expect(document.activeElement).toBe(opener)
    document.body.removeChild(opener)
  })

  it('surfaces onAdvance rejection inline; Continue re-enables; state preserved', async () => {
    const failingAdvance: (stepId: string, state: State) => Promise<void> = async () => {
      throw new Error('Network down')
    }
    render(
      <MultiStepComposer
        steps={makeSteps()}
        initialState={{ ...initialState, brand: 'Oak' }}
        onAdvance={failingAdvance}
        onComplete={onComplete}
        onAbandon={onAbandon}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    await waitFor(() => {
      expect(screen.getByTestId('composer-submit-error')).toHaveTextContent(/Network down/)
    })
    expect(screen.getByRole('button', { name: /Continue/i })).not.toBeDisabled()
    // Still on step 1 (state preserved on submit error)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })
})
