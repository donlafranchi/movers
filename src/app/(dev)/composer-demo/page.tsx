'use client'

// T071 — Developer demo page for <MultiStepComposer>.
// Exists to verify the composer recipe in isolation, separate from any
// production surface. Open at /composer-demo while running `npm run dev`.

import { useState } from 'react'
import {
  MultiStepComposer,
  type StepDef,
} from '@/components/composer/MultiStepComposer'

type DemoState = {
  brand: string
  city: string
  about: string
}

const initialState: DemoState = { brand: '', city: '', about: '' }

const STEPS: StepDef<DemoState>[] = [
  {
    id: 'brand',
    title: 'Brand name',
    helper: 'What should your shop be called?',
    render: (state, setState) => (
      <label className="block">
        <span className="text-sm font-medium text-[--color-fg]">Name</span>
        <input
          className="input mt-1 w-full"
          value={state.brand}
          onChange={(e) => setState({ ...state, brand: e.target.value })}
          placeholder="Oak Park Sourdough"
        />
      </label>
    ),
    validate: (state) =>
      state.brand.trim().length > 0
        ? { ok: true }
        : { ok: false, errors: { brand: 'Brand name is required' } },
  },
  {
    id: 'city',
    title: 'Anchor city',
    helper: 'Where are you primarily based?',
    render: (state, setState) => (
      <label className="block">
        <span className="text-sm font-medium text-[--color-fg]">City</span>
        <input
          className="input mt-1 w-full"
          value={state.city}
          onChange={(e) => setState({ ...state, city: e.target.value })}
          placeholder="Sacramento"
        />
      </label>
    ),
    validate: (state) =>
      state.city.trim().length > 0
        ? { ok: true }
        : { ok: false, errors: { city: 'City is required' } },
  },
  {
    id: 'about',
    title: 'About (optional)',
    helper: 'A short description visitors will see.',
    isOptional: true,
    render: (state, setState) => (
      <label className="block">
        <span className="text-sm font-medium text-[--color-fg]">About</span>
        <textarea
          className="input mt-1 w-full min-h-[6rem]"
          value={state.about}
          onChange={(e) => setState({ ...state, about: e.target.value })}
        />
      </label>
    ),
    validate: () => ({ ok: true }),
  },
  {
    id: 'review',
    title: 'Review and create',
    helper: 'Confirm the details below.',
    render: (state) => (
      <ul className="text-sm space-y-1">
        <li><b>Brand:</b> {state.brand}</li>
        <li><b>City:</b> {state.city}</li>
        <li><b>About:</b> {state.about || <em className="text-[--color-fg-muted]">(skipped)</em>}</li>
      </ul>
    ),
    validate: () => ({ ok: true }),
    finalLabel: 'Create demo shop',
  },
]

export default function ComposerDemoPage() {
  const [open, setOpen] = useState(false)
  const [lastResult, setLastResult] = useState<DemoState | null>(null)

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold mb-4">MultiStepComposer demo</h1>
      <p className="text-sm text-[--color-fg-muted] mb-6">
        Dev surface for verifying the composer recipe in isolation. Per
        T071 acceptance — not for production use.
      </p>
      <button
        type="button"
        onClick={() => {
          setLastResult(null)
          setOpen(true)
        }}
        className="btn-primary"
      >
        Open composer
      </button>
      {lastResult && (
        <pre className="mt-6 p-4 rounded bg-neutral-100 text-xs overflow-auto">
          {JSON.stringify(lastResult, null, 2)}
        </pre>
      )}
      {open && (
        <MultiStepComposer
          steps={STEPS}
          initialState={initialState}
          onAdvance={async (stepId, state) => {
            // Simulate a brief network round trip for the spinner.
            await new Promise((r) => setTimeout(r, 250))
            void stepId
            void state
          }}
          onComplete={async (state) => {
            await new Promise((r) => setTimeout(r, 400))
            setLastResult(state)
            setOpen(false)
            return { destinationUrl: '/composer-demo' }
          }}
          onAbandon={() => setOpen(false)}
        />
      )}
    </main>
  )
}
