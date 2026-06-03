import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { OnboardingFlow, type OnboardingActions } from './OnboardingFlow'

// T089 — onboarding flow integration against injected actions. Real DB writes
// are the F030 eval's job.

afterEach(() => cleanup())

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const LOCALITIES = [
  { placeId: 'oak', displayName: 'Oak Park' },
  { placeId: 'sac', displayName: 'Sacramento' },
]

function makeActions(over: Partial<OnboardingActions> = {}): OnboardingActions {
  return {
    saveProfile: vi.fn(async () => ({ ok: true as const })),
    setHomeLocality: vi.fn(async () => ({ ok: true as const })),
    addInterests: vi.fn(async () => ({ ok: true as const, addedTags: [] })),
    ...over,
  }
}

function continueBtn() {
  return screen.getByRole('button', { name: /Continue/i })
}

describe('T089 — OnboardingFlow', () => {
  it('starts on the profile step', () => {
    render(<OnboardingFlow localityOptions={LOCALITIES} actions={makeActions()} onNavigate={vi.fn()} />)
    expect(screen.getByText('Tell us who you are')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-name')).toBeInTheDocument()
  })

  it('writes the profile on Continue and advances to locality', async () => {
    const actions = makeActions()
    render(<OnboardingFlow localityOptions={LOCALITIES} actions={actions} onNavigate={vi.fn()} />)
    fireEvent.change(screen.getByTestId('onboarding-name'), { target: { value: 'Maya' } })
    fireEvent.change(screen.getByTestId('onboarding-handle'), { target: { value: 'maya' } })
    fireEvent.click(continueBtn())
    await waitFor(() => expect(actions.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Maya', handle: 'maya' }),
    ))
    await waitFor(() => expect(screen.getByText('Where’s home?')).toBeInTheDocument())
  })

  it('locality step is required (no Skip) and writes on Continue', async () => {
    const actions = makeActions()
    render(<OnboardingFlow localityOptions={LOCALITIES} actions={actions} onNavigate={vi.fn()} />)
    // advance past profile
    fireEvent.change(screen.getByTestId('onboarding-name'), { target: { value: 'Maya' } })
    fireEvent.change(screen.getByTestId('onboarding-handle'), { target: { value: 'maya' } })
    fireEvent.click(continueBtn())
    await waitFor(() => expect(screen.getByTestId('onboarding-locality')).toBeInTheDocument())
    // no Skip link on the required locality step
    expect(screen.queryByRole('link', { name: /Skip this step/i })).toBeNull()
    // cannot advance without a place
    fireEvent.click(continueBtn())
    await waitFor(() => expect(screen.getByTestId('field-error-place')).toBeInTheDocument())
    expect(actions.setHomeLocality).not.toHaveBeenCalled()
    // pick a place, advance
    fireEvent.change(screen.getByTestId('onboarding-locality'), { target: { value: 'oak' } })
    fireEvent.click(continueBtn())
    await waitFor(() => expect(actions.setHomeLocality).toHaveBeenCalledWith({ placeId: 'oak' }))
  })

  it('interests step is skippable and completion writes interests + navigates', async () => {
    const actions = makeActions()
    const onNavigate = vi.fn()
    render(<OnboardingFlow localityOptions={LOCALITIES} actions={actions} onNavigate={onNavigate} />)
    fireEvent.change(screen.getByTestId('onboarding-name'), { target: { value: 'Maya' } })
    fireEvent.change(screen.getByTestId('onboarding-handle'), { target: { value: 'maya' } })
    fireEvent.click(continueBtn())
    await waitFor(() => screen.getByTestId('onboarding-locality'))
    fireEvent.change(screen.getByTestId('onboarding-locality'), { target: { value: 'oak' } })
    fireEvent.click(continueBtn())
    await waitFor(() => screen.getByTestId('onboarding-interests'))
    // interests step is optional → Skip link present
    expect(screen.getByRole('link', { name: /Skip this step/i })).toBeInTheDocument()
    // select two interests then finish
    fireEvent.click(screen.getByRole('button', { name: 'Live music' }))
    fireEvent.click(screen.getByRole('button', { name: 'Crafts & makers' }))
    fireEvent.click(screen.getByRole('button', { name: /Show me my feed/i }))
    await waitFor(() =>
      expect(actions.addInterests).toHaveBeenCalledWith({ tags: ['live-music', 'crafts'] }),
    )
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/'))
  })

  it('surfaces handle-collision suggestions and blocks advancement', async () => {
    const actions = makeActions({
      saveProfile: vi.fn(async () => ({
        ok: false as const,
        field: 'handle' as const,
        message: 'That handle is taken.',
        suggestions: ['maya-2', 'maya-3'],
      })),
    })
    render(<OnboardingFlow localityOptions={LOCALITIES} actions={actions} onNavigate={vi.fn()} />)
    fireEvent.change(screen.getByTestId('onboarding-name'), { target: { value: 'Maya' } })
    fireEvent.change(screen.getByTestId('onboarding-handle'), { target: { value: 'maya' } })
    fireEvent.click(continueBtn())
    await waitFor(() => expect(screen.getByTestId('composer-submit-error')).toHaveTextContent('taken'))
    await waitFor(() => expect(screen.getByTestId('handle-suggestions')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'maya-2' })).toBeInTheDocument()
    // still on profile — did not advance
    expect(screen.getByText('Tell us who you are')).toBeInTheDocument()
  })
})
