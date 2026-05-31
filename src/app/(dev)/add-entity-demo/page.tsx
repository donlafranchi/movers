'use client'

// T072 — Developer demo page for <AddEntityDrawer>.
// Open at /add-entity-demo while running `npm run dev`. The route group
// `(dev)` is gated to NODE_ENV='development' via the shared `(dev)/layout.tsx`
// (T071a), so this surface is never reachable in production.

import { useState } from 'react'
import { AddEntityDrawer, type Validation } from '@/components/composer/AddEntityDrawer'

type LocationDraft = { name: string }
const initialState: LocationDraft = { name: '' }

function locationRender(
  state: LocationDraft,
  setState: (next: LocationDraft) => void,
) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[--color-fg]">Location name</span>
      <input
        className="input mt-1 w-full"
        aria-label="Location name"
        value={state.name}
        onChange={(e) => setState({ ...state, name: e.target.value })}
        placeholder="Maya's Kitchen"
      />
    </label>
  )
}

function locationValidate(state: LocationDraft): Validation {
  return state.name.trim().length > 0
    ? { ok: true }
    : { ok: false, errors: { name: 'Location name is required' } }
}

export default function AddEntityDemoPage() {
  const [open, setOpen] = useState(false)
  const [lastAddedId, setLastAddedId] = useState<string | null>(null)

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold mb-4">AddEntityDrawer demo</h1>
      <p className="text-sm text-[--color-fg-muted] mb-6">
        Dev surface for verifying the secondary-drawer sub-flow recipe in
        isolation. Per T072 acceptance — not for production use.
      </p>
      <button
        type="button"
        onClick={() => {
          setLastAddedId(null)
          setOpen(true)
        }}
        className="btn-primary"
      >
        Add a Location
      </button>
      {lastAddedId && (
        <p className="mt-4 text-sm">
          Last added id:{' '}
          <code className="px-2 py-0.5 rounded bg-neutral-100">{lastAddedId}</code>
        </p>
      )}
      {open && (
        <AddEntityDrawer
          title="Add a Location"
          initialState={initialState}
          render={locationRender}
          validate={locationValidate}
          onSave={async (state) => {
            // Simulate a brief network round trip.
            await new Promise((r) => setTimeout(r, 300))
            void state
            // In production, this would call the location.create handler.
            return { id: `loc-${Math.floor(Math.random() * 10_000)}` }
          }}
          onSaved={(id) => {
            setLastAddedId(id)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </main>
  )
}
