'use client'

// T082 — <ServiceComposer> — the service-listing surface for F040.
// Spec:   planning/now/scenario-F040-producer-lists-service.md
// Ticket: development/tickets/T082-service-composer-surface.md
// DLS:    product/ui/design-language.md § Component recipes → Multi-step composer
//
// Composes <MultiStepComposer> with three steps:
//   1. Details       → title, description
//   2. Pricing       → rate model (hourly/flat/quote/membership) + Free toggle + rate
//   3. Service area  → center Location picker (+ AddEntityDrawer) + radius (miles)
//   4. Review        → createService(publish) → redirect to the Item URL
//
// There is NO "Where is this made?" step — services are excluded from the
// Locally Made provenance flow (F040 § No Locally Made step on services).
//
// Presentational + control-flow only (per T071). The parent passes the
// server-action thunks so the component is testable in isolation.

import { useState, useCallback } from 'react'
import {
  MultiStepComposer,
  type StepDef,
} from '@/components/composer/MultiStepComposer'
import { AddEntityDrawer } from '@/components/composer/AddEntityDrawer'
import { dollarsToCents, type PickupLocationOption } from './ProductComposer'

export type { PickupLocationOption }

export type RateModel = 'hourly' | 'flat' | 'quote' | 'membership'

const RATE_MODEL_OPTIONS: { value: RateModel; label: string }[] = [
  { value: 'hourly', label: 'Per hour' },
  { value: 'flat', label: 'Flat rate' },
  { value: 'quote', label: 'Request a quote' },
  { value: 'membership', label: 'Membership' },
]

const METERS_PER_MILE = 1609.34

/** Convert a mile radius to meters for the PostGIS service-area circle. */
export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE
}

/** Parse a positive mile radius. Returns null when blank or unparseable. */
function parseRadiusMiles(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export interface ServiceComposerState {
  title: string
  description: string
  rateModel: RateModel
  /** Free toggle. When true, rate is null on submit. */
  isFree: boolean
  /** User types dollars; converted to cents on submit (unless free/quote). */
  rateDollars: string
  centerLocationId: string | null
  centerLocationLabel: string | null
  /** Service-area radius in miles; converted to meters on submit. */
  radiusMiles: string
}

export interface ServiceComposerHandlers {
  /** Final-step submit. Creates + publishes the service in one transaction;
   *  returns the canonical Item URL the caller redirects to. */
  createService: (input: {
    title: string
    description: string
    rateModel: RateModel
    rateCents: number | null
    centerLocationId?: string
    radiusMeters?: number
  }) => Promise<{ itemId: string; destinationUrl: string }>
  /** Sub-flow: inline-add a center Location. */
  createLocation: (input: { label: string }) => Promise<{ id: string; label: string }>
  availableLocations: PickupLocationOption[]
  redirect: (url: string) => void
  showToast: (msg: string) => void
}

export interface ServiceComposerProps extends ServiceComposerHandlers {
  /** Pre-selected center Location (the Group's anchor, when entered from a Shop). */
  defaultCenterLocationId?: string | null
  defaultCenterLocationLabel?: string | null
  onAbandon: () => void
}

const TOAST_SUCCESS = 'Your service is live.'

export function ServiceComposer({
  createService,
  createLocation,
  availableLocations,
  redirect,
  showToast,
  defaultCenterLocationId = null,
  defaultCenterLocationLabel = null,
  onAbandon,
}: ServiceComposerProps) {
  const initialState: ServiceComposerState = {
    title: '',
    description: '',
    rateModel: 'hourly',
    isFree: false,
    rateDollars: '',
    centerLocationId: defaultCenterLocationId,
    centerLocationLabel: defaultCenterLocationLabel,
    radiusMiles: '',
  }

  const steps: StepDef<ServiceComposerState>[] = [
    // 1. Details
    {
      id: 'details',
      title: 'Add a service',
      helper: 'What do you offer?',
      render: (state, setState) => (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">Title</span>
            <input
              data-testid="service-title-input"
              className="input mt-1 w-full"
              placeholder="Piano lessons — 30 min"
              value={state.title}
              onChange={(e) => setState({ ...state, title: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">
              Description
            </span>
            <textarea
              data-testid="service-description-input"
              aria-label="Description"
              className="input mt-1 w-full min-h-[5rem]"
              placeholder="In-home lessons for all ages, beginner to intermediate."
              value={state.description}
              onChange={(e) =>
                setState({ ...state, description: e.target.value })
              }
            />
          </label>
        </div>
      ),
      validate: (state) => {
        const errors: Record<string, string> = {}
        if (state.title.trim().length === 0) errors.title = 'Title is required'
        if (state.description.trim().length === 0)
          errors.description = 'Description is required'
        return Object.keys(errors).length === 0
          ? { ok: true }
          : { ok: false, errors }
      },
    },

    // 2. Pricing
    {
      id: 'pricing',
      title: 'Pricing',
      helper: 'How do you charge?',
      render: (state, setState) => {
        const showRate = !state.isFree && state.rateModel !== 'quote'
        return (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-[--color-fg]">
                Pricing model
              </span>
              <select
                data-testid="service-rate-model-select"
                aria-label="Pricing model"
                className="input mt-1 w-full"
                value={state.rateModel}
                onChange={(e) =>
                  setState({ ...state, rateModel: e.target.value as RateModel })
                }
              >
                {RATE_MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  data-testid="service-free-toggle"
                  checked={state.isFree}
                  onChange={(e) =>
                    setState({ ...state, isFree: e.target.checked })
                  }
                />
                <span>This is free</span>
              </label>
            </div>
            {showRate && (
              <label className="block">
                <span className="text-sm font-medium text-[--color-fg]">
                  Rate
                </span>
                <input
                  data-testid="service-rate-input"
                  aria-label="Rate"
                  inputMode="decimal"
                  className="input mt-1 w-full"
                  placeholder="95.00"
                  value={state.rateDollars}
                  onChange={(e) =>
                    setState({ ...state, rateDollars: e.target.value })
                  }
                />
              </label>
            )}
          </div>
        )
      },
      validate: (state) => {
        // Free and quote carry no rate; everything else needs a parseable rate.
        if (state.isFree || state.rateModel === 'quote') return { ok: true }
        return dollarsToCents(state.rateDollars) === null
          ? { ok: false, errors: { rate: 'Enter a rate, or mark it free' } }
          : { ok: true }
      },
    },

    // 3. Service area
    {
      id: 'area',
      title: 'Service area',
      helper: 'Where do you offer this? Pick a center point and how far you travel.',
      render: (state, setState) => (
        <CenterLocationStep
          state={state}
          setState={setState}
          available={availableLocations}
          createLocation={createLocation}
        />
      ),
      validate: (state) => {
        const errors: Record<string, string> = {}
        if (!state.centerLocationId)
          errors.center = 'Pick or add a center point'
        if (parseRadiusMiles(state.radiusMiles) === null)
          errors.radius = 'Enter how far you travel (miles)'
        return Object.keys(errors).length === 0
          ? { ok: true }
          : { ok: false, errors }
      },
    },

    // 4. Review & publish
    {
      id: 'review',
      title: 'Review',
      helper: 'Confirm the details below, then publish.',
      finalLabel: 'Publish service',
      render: (state) => {
        const modelLabel =
          RATE_MODEL_OPTIONS.find((o) => o.value === state.rateModel)?.label ??
          state.rateModel
        return (
          <ul data-testid="service-review-list" className="text-sm space-y-2">
            <li>
              <strong>Title:</strong> {state.title}
            </li>
            <li>
              <strong>Pricing:</strong>{' '}
              {state.isFree
                ? 'Free'
                : state.rateModel === 'quote'
                  ? 'Request a quote'
                  : `${modelLabel} — ${state.rateDollars || '(set)'}`}
            </li>
            <li>
              <strong>Center:</strong> {state.centerLocationLabel ?? '(set)'}
            </li>
            <li>
              <strong>Travels:</strong>{' '}
              {state.radiusMiles ? `${state.radiusMiles} mi` : '(set)'}
            </li>
          </ul>
        )
      },
      validate: () => ({ ok: true }),
    },
  ]

  const onAdvance = useCallback(async () => {
    // No per-step persistence — the service is written atomically at publish
    // (the F040 "one transaction" Then-clause). Steps only collect state.
  }, [])

  const onComplete = useCallback(
    async (state: ServiceComposerState) => {
      const rateCents =
        state.isFree || state.rateModel === 'quote'
          ? null
          : dollarsToCents(state.rateDollars)
      const miles = parseRadiusMiles(state.radiusMiles)
      const { destinationUrl } = await createService({
        title: state.title.trim(),
        description: state.description.trim(),
        rateModel: state.rateModel,
        rateCents,
        centerLocationId: state.centerLocationId ?? undefined,
        radiusMeters: miles != null ? milesToMeters(miles) : undefined,
      })
      redirect(destinationUrl)
      showToast(TOAST_SUCCESS)
      return { destinationUrl }
    },
    [createService, redirect, showToast],
  )

  return (
    <MultiStepComposer<ServiceComposerState>
      steps={steps}
      initialState={initialState}
      onAdvance={onAdvance}
      onComplete={onComplete}
      onAbandon={onAbandon}
      dialogLabel="Add a service"
    />
  )
}

/** Step-3 picker — saved Locations + a "+ Add a new" row opening AddEntityDrawer,
 *  plus a radius (miles) input. Mirrors ProductComposer's PickupLocationStep;
 *  the chosen Location is the service-area center (and the anchor). */
function CenterLocationStep({
  state,
  setState,
  available,
  createLocation,
}: {
  state: ServiceComposerState
  setState: (next: ServiceComposerState) => void
  available: PickupLocationOption[]
  createLocation: (input: { label: string }) => Promise<{ id: string; label: string }>
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addedLocations, setAddedLocations] = useState<PickupLocationOption[]>([])
  const allOptions: PickupLocationOption[] = [...available, ...addedLocations]

  return (
    <div className="space-y-5">
      <ul
        role="listbox"
        aria-label="Center Location options"
        data-testid="service-center-options"
        className="space-y-2"
      >
        {allOptions.map((loc) => {
          const selected = state.centerLocationId === loc.id
          return (
            <li key={loc.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`service-center-option-${loc.id}`}
                onClick={() =>
                  setState({
                    ...state,
                    centerLocationId: loc.id,
                    centerLocationLabel: loc.label,
                  })
                }
                className={`w-full text-left rounded-lg border px-4 py-3 text-sm ${
                  selected
                    ? 'border-[--color-accent] bg-[--color-accent-tint]'
                    : 'border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                <div className="font-medium">{loc.label}</div>
                {loc.sublabel && (
                  <div className="text-xs text-[--color-fg-muted]">
                    {loc.sublabel}
                  </div>
                )}
              </button>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            data-testid="service-center-add-new"
            onClick={() => setDrawerOpen(true)}
            className="w-full text-left rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-sm text-[--color-accent] hover:bg-neutral-50"
          >
            + Add a new Location
          </button>
        </li>
      </ul>

      <label className="block">
        <span className="text-sm font-medium text-[--color-fg]">
          How far do you travel? (miles)
        </span>
        <input
          data-testid="service-radius-input"
          aria-label="Service radius in miles"
          inputMode="decimal"
          className="input mt-1 w-full"
          placeholder="5"
          value={state.radiusMiles}
          onChange={(e) => setState({ ...state, radiusMiles: e.target.value })}
        />
      </label>

      {drawerOpen && (
        <AddEntityDrawer<{ label: string }>
          title="Add a Location"
          initialState={{ label: '' }}
          render={(s, set) => (
            <label className="block">
              <span className="text-sm font-medium text-[--color-fg]">
                Location name
              </span>
              <input
                data-testid="service-add-location-input"
                aria-label="Location name"
                className="input mt-1 w-full"
                placeholder="My studio"
                value={s.label}
                onChange={(e) => set({ label: e.target.value })}
              />
            </label>
          )}
          validate={(s) =>
            s.label.trim().length > 0
              ? { ok: true }
              : { ok: false, errors: { label: 'Name is required' } }
          }
          onSave={async (s) => {
            const created = await createLocation({ label: s.label.trim() })
            setAddedLocations((prev) =>
              prev.some((l) => l.id === created.id)
                ? prev
                : [...prev, { id: created.id, label: created.label }],
            )
            setState({
              ...state,
              centerLocationId: created.id,
              centerLocationLabel: created.label,
            })
            return { id: created.id }
          }}
          onCancel={() => setDrawerOpen(false)}
          onSaved={() => setDrawerOpen(false)}
        />
      )}
    </div>
  )
}
