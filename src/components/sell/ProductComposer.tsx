'use client'

// T078 — <ProductComposer> — the product-listing surface for F038.
// Spec:   planning/now/scenario-F038-producer-lists-product.md
// Ticket: development/tickets/T078-product-composer-surface.md
// DLS:    product/ui/design-language.md § Component recipes → Multi-step composer
//
// Composes <MultiStepComposer> with four steps:
//   1. Details            → title, description, price (or Free), unit
//   2. Pickup point       → anchor-Location picker + AddEntityDrawer sub-flow
//   3. Where is this made? (OPTIONAL — F038 tests the SKIP path; F039 lands
//                           the real Place picker + Locally Made claim)
//   4. Review & publish   → createProduct(publish) → redirect to the Item URL
//
// Presentational + control-flow only (per T071). The parent passes the
// server-action thunks so the component is testable in isolation.

import { useState, useCallback } from 'react'
import {
  MultiStepComposer,
  type StepDef,
} from '@/components/composer/MultiStepComposer'
import { AddEntityDrawer } from '@/components/composer/AddEntityDrawer'

export interface PickupLocationOption {
  id: string
  label: string
  sublabel?: string
}

export interface ProductComposerState {
  title: string
  description: string
  /** Free toggle. When true, price is null on submit. */
  isFree: boolean
  /** User types dollars (e.g. "9" or "9.50"); converted to cents on submit. */
  priceDollars: string
  /** e.g. "loaf", "dozen", "lb". */
  priceUnit: string
  pickupLocationId: string | null
  pickupLocationLabel: string | null
  /** F039 territory. F038 skip-path leaves this null. */
  madeAtPlaceId: string | null
}

export interface ProductComposerHandlers {
  /** Final-step submit. Creates + publishes the product in one transaction;
   *  returns the canonical Item URL the caller redirects to. */
  createProduct: (input: {
    title: string
    description: string
    priceCents: number | null
    priceUnit?: string
    locationId?: string
    madeAtPlaceId?: string
  }) => Promise<{ itemId: string; destinationUrl: string }>
  /** Sub-flow: inline-add a pickup Location. */
  createLocation: (input: { label: string }) => Promise<{ id: string; label: string }>
  availableLocations: PickupLocationOption[]
  redirect: (url: string) => void
  showToast: (msg: string) => void
}

export interface ProductComposerProps extends ProductComposerHandlers {
  /** Pre-selected pickup Location (the Group's anchor, when entered from a Shop). */
  defaultPickupLocationId?: string | null
  defaultPickupLocationLabel?: string | null
  onAbandon: () => void
}

const TOAST_SUCCESS = 'Your product is live.'

/** Parse a dollars string into integer cents. Returns null when blank or
 *  unparseable (the caller treats null as "free" only when isFree is set —
 *  an unparseable non-free price is blocked by step validation first). */
export function dollarsToCents(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  const n = Number(trimmed.replace(/[$,]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function ProductComposer({
  createProduct,
  createLocation,
  availableLocations,
  redirect,
  showToast,
  defaultPickupLocationId = null,
  defaultPickupLocationLabel = null,
  onAbandon,
}: ProductComposerProps) {
  const initialState: ProductComposerState = {
    title: '',
    description: '',
    isFree: false,
    priceDollars: '',
    priceUnit: '',
    pickupLocationId: defaultPickupLocationId,
    pickupLocationLabel: defaultPickupLocationLabel,
    madeAtPlaceId: null,
  }

  const steps: StepDef<ProductComposerState>[] = [
    // 1. Details
    {
      id: 'details',
      title: 'Add a product',
      helper: 'What are you selling?',
      render: (state, setState) => (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">Title</span>
            <input
              data-testid="product-title-input"
              className="input mt-1 w-full"
              placeholder="Country Sourdough Loaf"
              value={state.title}
              onChange={(e) => setState({ ...state, title: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">
              Description
            </span>
            <textarea
              data-testid="product-description-input"
              aria-label="Description"
              className="input mt-1 w-full min-h-[5rem]"
              placeholder="Naturally leavened, baked Saturday mornings."
              value={state.description}
              onChange={(e) =>
                setState({ ...state, description: e.target.value })
              }
            />
          </label>
          <div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="product-free-toggle"
                checked={state.isFree}
                onChange={(e) =>
                  setState({ ...state, isFree: e.target.checked })
                }
              />
              <span>This is free</span>
            </label>
          </div>
          {!state.isFree && (
            <div className="flex gap-3">
              <label className="block flex-1">
                <span className="text-sm font-medium text-[--color-fg]">
                  Price
                </span>
                <input
                  data-testid="product-price-input"
                  aria-label="Price"
                  inputMode="decimal"
                  className="input mt-1 w-full"
                  placeholder="9.00"
                  value={state.priceDollars}
                  onChange={(e) =>
                    setState({ ...state, priceDollars: e.target.value })
                  }
                />
              </label>
              <label className="block flex-1">
                <span className="text-sm font-medium text-[--color-fg]">
                  Per (optional)
                </span>
                <input
                  data-testid="product-price-unit-input"
                  aria-label="Price unit"
                  className="input mt-1 w-full"
                  placeholder="loaf"
                  value={state.priceUnit}
                  onChange={(e) =>
                    setState({ ...state, priceUnit: e.target.value })
                  }
                />
              </label>
            </div>
          )}
        </div>
      ),
      validate: (state) => {
        const errors: Record<string, string> = {}
        if (state.title.trim().length === 0) errors.title = 'Title is required'
        if (state.description.trim().length === 0)
          errors.description = 'Description is required'
        if (!state.isFree && dollarsToCents(state.priceDollars) === null)
          errors.price = 'Enter a price, or mark it free'
        return Object.keys(errors).length === 0
          ? { ok: true }
          : { ok: false, errors }
      },
    },

    // 2. Pickup point
    {
      id: 'pickup',
      title: 'Pickup point',
      helper: 'Where can people pick this up?',
      render: (state, setState) => (
        <PickupLocationStep
          state={state}
          setState={setState}
          available={availableLocations}
          createLocation={createLocation}
        />
      ),
      validate: (state) =>
        state.pickupLocationId
          ? { ok: true }
          : { ok: false, errors: { pickup: 'Pick or add a pickup point' } },
    },

    // 3. Where is this made? — OPTIONAL. F038 tests the SKIP path.
    {
      id: 'made',
      title: 'Where is this made?',
      helper:
        'Claim Locally Made provenance for this product. You can skip this and add it later from the product page.',
      isOptional: true,
      render: () => (
        <div
          data-testid="product-made-step"
          className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-[--color-fg-muted]"
        >
          <p>
            The Locally Made claim (a Place picker for where this product is
            made) ships with the provenance flow. Skip this step to publish
            without the badge — you can claim it later.
          </p>
        </div>
      ),
      validate: () => ({ ok: true }),
    },

    // 4. Review & publish
    {
      id: 'review',
      title: 'Review',
      helper: 'Confirm the details below, then publish.',
      finalLabel: 'Publish product',
      render: (state) => (
        <ul data-testid="product-review-list" className="text-sm space-y-2">
          <li>
            <strong>Title:</strong> {state.title}
          </li>
          <li>
            <strong>Price:</strong>{' '}
            {state.isFree ? (
              'Free'
            ) : (
              <>
                {state.priceDollars}
                {state.priceUnit ? ` / ${state.priceUnit}` : ''}
              </>
            )}
          </li>
          <li>
            <strong>Pickup:</strong> {state.pickupLocationLabel ?? '(set)'}
          </li>
          <li>
            <strong>Locally Made:</strong>{' '}
            <em className="text-[--color-fg-muted]">
              {state.madeAtPlaceId ? '(claimed)' : '(skipped)'}
            </em>
          </li>
        </ul>
      ),
      validate: () => ({ ok: true }),
    },
  ]

  const onAdvance = useCallback(async () => {
    // No per-step persistence — the product is written atomically at publish
    // (the F038 "one transaction" Then-clause). Steps only collect state.
  }, [])

  const onComplete = useCallback(
    async (state: ProductComposerState) => {
      const priceCents = state.isFree ? null : dollarsToCents(state.priceDollars)
      const { destinationUrl } = await createProduct({
        title: state.title.trim(),
        description: state.description.trim(),
        priceCents,
        priceUnit: state.priceUnit.trim() || undefined,
        locationId: state.pickupLocationId ?? undefined,
        madeAtPlaceId: state.madeAtPlaceId ?? undefined,
      })
      redirect(destinationUrl)
      showToast(TOAST_SUCCESS)
      return { destinationUrl }
    },
    [createProduct, redirect, showToast],
  )

  return (
    <MultiStepComposer<ProductComposerState>
      steps={steps}
      initialState={initialState}
      onAdvance={onAdvance}
      onComplete={onComplete}
      onAbandon={onAbandon}
      dialogLabel="Add a product"
    />
  )
}

/** Step-2 picker — saved Locations + a "+ Add a new" row opening AddEntityDrawer.
 *  Mirrors SellWalkthrough's AnchorLocationStep (T073). On save the new
 *  Location auto-selects and the composer stays paused at this step. */
function PickupLocationStep({
  state,
  setState,
  available,
  createLocation,
}: {
  state: ProductComposerState
  setState: (next: ProductComposerState) => void
  available: PickupLocationOption[]
  createLocation: (input: { label: string }) => Promise<{ id: string; label: string }>
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addedLocations, setAddedLocations] = useState<PickupLocationOption[]>([])
  const allOptions: PickupLocationOption[] = [...available, ...addedLocations]

  return (
    <div>
      <ul
        role="listbox"
        aria-label="Pickup Location options"
        data-testid="product-pickup-options"
        className="space-y-2"
      >
        {allOptions.map((loc) => {
          const selected = state.pickupLocationId === loc.id
          return (
            <li key={loc.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`product-pickup-option-${loc.id}`}
                onClick={() =>
                  setState({
                    ...state,
                    pickupLocationId: loc.id,
                    pickupLocationLabel: loc.label,
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
            data-testid="product-pickup-add-new"
            onClick={() => setDrawerOpen(true)}
            className="w-full text-left rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-sm text-[--color-accent] hover:bg-neutral-50"
          >
            + Add a new Location
          </button>
        </li>
      </ul>

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
                data-testid="product-add-location-input"
                aria-label="Location name"
                className="input mt-1 w-full"
                placeholder="Sunday Farmers Market"
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
              pickupLocationId: created.id,
              pickupLocationLabel: created.label,
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
