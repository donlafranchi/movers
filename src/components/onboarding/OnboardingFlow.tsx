// T089 — Newcomer onboarding (F030). Three steps on MultiStepComposer:
// profile · home locality (required) · interest tags (skippable). Each step's
// row writes on its Continue so a back-out leaves a partial record.
'use client'

import { useRouter } from 'next/navigation'
import { MultiStepComposer, type StepDef } from '@/components/composer/MultiStepComposer'
import {
  saveProfileAction,
  setHomeLocalityAction,
  addInterestsAction,
  type SaveProfileInput,
} from '@/app/onboarding/actions'
import { INTEREST_VOCAB, INTEREST_MIN, INTEREST_MAX } from '@/lib/onboarding/interest-vocab'

export interface LocalityOption {
  placeId: string
  displayName: string
}

interface OnboardingState {
  displayName: string
  handle: string
  bio: string
  pronouns: string
  placeId: string
  tags: string[]
  handleSuggestions: string[]
}

export interface OnboardingActions {
  saveProfile: (input: SaveProfileInput) => Promise<
    | { ok: true }
    | { ok: false; field: 'handle' | 'displayName'; message: string; suggestions?: string[] }
  >
  setHomeLocality: (input: { placeId: string }) => Promise<{ ok: true }>
  addInterests: (input: { tags: string[] }) => Promise<{ ok: true; addedTags: string[] }>
}

const DEFAULT_ACTIONS: OnboardingActions = {
  saveProfile: saveProfileAction,
  setHomeLocality: setHomeLocalityAction,
  addInterests: addInterestsAction,
}

export function OnboardingFlow({
  initialDisplayName = '',
  initialHandle = '',
  localityOptions,
  actions = DEFAULT_ACTIONS,
  onNavigate,
}: {
  initialDisplayName?: string
  initialHandle?: string
  localityOptions: LocalityOption[]
  actions?: OnboardingActions
  onNavigate?: (url: string) => void
}) {
  const router = useRouter()
  const navigate = onNavigate ?? ((url: string) => router.push(url))

  const initialState: OnboardingState = {
    displayName: initialDisplayName,
    handle: initialHandle,
    bio: '',
    pronouns: '',
    placeId: '',
    tags: [],
    handleSuggestions: [],
  }

  const steps: StepDef<OnboardingState>[] = [
    {
      id: 'profile',
      title: 'Tell us who you are',
      helper: 'Your name and handle are public. The rest is optional.',
      validate: (s) => {
        const errors: Record<string, string> = {}
        if (!s.displayName.trim()) errors.name = 'Add your name.'
        const h = s.handle.trim().toLowerCase()
        if (!(h.length >= 4 && h.length <= 30 && /^[a-z0-9-]+$/.test(h)))
          errors.handle = 'Handles are 4–30 lowercase letters, numbers, or hyphens.'
        return Object.keys(errors).length ? { ok: false, errors } : { ok: true }
      },
      render: (s, set) => (
        <div className="space-y-3">
          <input
            data-testid="onboarding-name"
            className="card w-full p-2 text-sm"
            placeholder="Your name"
            value={s.displayName}
            onChange={(e) => set({ ...s, displayName: e.target.value })}
          />
          <input
            data-testid="onboarding-handle"
            className="card w-full p-2 text-sm"
            placeholder="handle"
            value={s.handle}
            onChange={(e) => set({ ...s, handle: e.target.value, handleSuggestions: [] })}
          />
          <input
            data-testid="onboarding-bio"
            className="card w-full p-2 text-sm"
            placeholder="A line about you (optional)"
            value={s.bio}
            onChange={(e) => set({ ...s, bio: e.target.value })}
          />
          <input
            data-testid="onboarding-pronouns"
            className="card w-full p-2 text-sm"
            placeholder="Pronouns (optional)"
            value={s.pronouns}
            onChange={(e) => set({ ...s, pronouns: e.target.value })}
          />
          {s.handleSuggestions.length > 0 && (
            <div data-testid="handle-suggestions" className="flex flex-wrap gap-2">
              {s.handleSuggestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  className="chip"
                  onClick={() => set({ ...s, handle: sug, handleSuggestions: [] })}
                >
                  {sug}
                </button>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'locality',
      title: 'Where’s home?',
      helper: 'We’ll show you what’s happening nearby. You can change this later.',
      // NOT optional — the feed needs a locality.
      validate: (s) => (s.placeId ? { ok: true } : { ok: false, errors: { place: 'Pick your home locality.' } }),
      render: (s, set) => (
        <select
          data-testid="onboarding-locality"
          aria-label="Home locality"
          className="card w-full p-2 text-sm"
          value={s.placeId}
          onChange={(e) => set({ ...s, placeId: e.target.value })}
        >
          <option value="">Choose a locality…</option>
          {localityOptions.map((o) => (
            <option key={o.placeId} value={o.placeId}>
              {o.displayName}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: 'interests',
      title: 'What are you into?',
      helper: `Pick ${INTEREST_MIN}–${INTEREST_MAX}, or skip — your feed leans on your locality either way.`,
      isOptional: true,
      finalLabel: 'Show me my feed',
      validate: (s) => {
        if (s.tags.length === 0) return { ok: true }
        if (s.tags.length < INTEREST_MIN || s.tags.length > INTEREST_MAX)
          return { ok: false, errors: { tags: `Pick ${INTEREST_MIN}–${INTEREST_MAX} interests, or none.` } }
        return { ok: true }
      },
      render: (s, set) => (
        <div data-testid="onboarding-interests" className="flex flex-wrap gap-2">
          {INTEREST_VOCAB.map((t) => {
            const selected = s.tags.includes(t.tag)
            return (
              <button
                key={t.tag}
                type="button"
                aria-pressed={selected}
                className={selected ? 'chip-selected' : 'chip'}
                onClick={() =>
                  set({
                    ...s,
                    tags: selected ? s.tags.filter((x) => x !== t.tag) : [...s.tags, t.tag],
                  })
                }
              >
                {t.label}
              </button>
            )
          })}
        </div>
      ),
    },
  ]

  return (
    <MultiStepComposer<OnboardingState>
      dialogLabel="Set up your account"
      steps={steps}
      initialState={initialState}
      onAdvance={async (stepId, state) => {
        if (stepId === 'profile') {
          const res = await actions.saveProfile({
            displayName: state.displayName,
            handle: state.handle.trim().toLowerCase(),
            bio: state.bio,
            pronouns: state.pronouns,
          })
          if (!res.ok) {
            if (res.field === 'handle' && res.suggestions) state.handleSuggestions = res.suggestions
            throw new Error(res.message)
          }
        } else if (stepId === 'locality') {
          await actions.setHomeLocality({ placeId: state.placeId })
        }
      }}
      onComplete={async (state) => {
        await actions.addInterests({ tags: state.tags })
        navigate('/')
        return { destinationUrl: '/' }
      }}
      onAbandon={() => navigate('/')}
    />
  )
}
