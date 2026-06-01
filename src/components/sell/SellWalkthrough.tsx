'use client'

// T073 — <SellWalkthrough> — the Sell-side surface for F036.
// Spec:   planning/now/scenario-F036-member-creates-business-group-via-sell-walkthrough.md
// Ticket: development/tickets/T073-sell-walkthrough-and-you-sell-cta.md
// DLS:    product/ui/design-language.md § Component recipes → Multi-step composer
//
// Composes <MultiStepComposer> with five steps:
//   1. Brand name              → group.create on Continue (writes draft Group)
//   2. Anchor Location         → group.update_draft + AddEntityDrawer sub-flow for "+ Add a new"
//   3. About (optional)        → group.update_draft on Continue
//   4. Locality (Tier 0)       → UI-only at b1 (substrate ships with F037; see DEVIATIONS)
//   5. Review & done           → group.activate → redirect to /p/[...place]/g/[slug]
//
// The composer is presentational + control-flow only (per T071) — this file
// supplies steps, persistence callbacks, and the redirect. Server-action
// thunks (createDraft / updateDraft / activate / createLocation) are passed
// in by the parent so the component is testable in isolation.

import { useState, useCallback } from 'react'
import {
  MultiStepComposer,
  type StepDef,
} from '@/components/composer/MultiStepComposer'
import { AddEntityDrawer } from '@/components/composer/AddEntityDrawer'

export interface AnchorLocationOption {
  id: string
  label: string
  /** Optional secondary line (e.g., "Sacramento, CA"). */
  sublabel?: string
}

export interface SellWalkthroughState {
  /** Set after the brand-name step writes the draft. Steps 2+ patch it via group.update_draft. */
  draftGroupId: string | null
  brand: string
  anchorLocationId: string | null
  /** Local-only label for the picker UI; not persisted. */
  anchorLocationLabel: string | null
  about: string
  /** Tier 0 ZIP. UI-only at b1 (no member_business_jurisdictions table yet — F037). */
  localityZip: string
}

export interface SellWalkthroughHandlers {
  /** Called on step-1 Continue. Returns the new draft Group id. */
  createDraft: (input: { brand: string }) => Promise<{ groupId: string }>
  /** Called on steps 2–4 Continue with the diff for that step. */
  updateDraft: (input: {
    groupId: string
    anchorLocationId?: string
    about?: string
    /** Brand re-edit from Back navigation. Not normally sent. */
    brand?: string
  }) => Promise<void>
  /** Called on final-step "Create my shop". Returns the place-scoped Group URL. */
  activate: (input: { groupId: string }) => Promise<{ destinationUrl: string }>
  /** Sub-flow: inline-add a new Location. Returns the new Location's id + label. */
  createLocation: (input: {
    label: string
  }) => Promise<{ id: string; label: string }>
  /** Available saved Locations for the anchor picker. */
  availableLocations: AnchorLocationOption[]
  /** Caller's redirect mechanism (router.push in production, a spy in tests). */
  redirect: (url: string) => void
  /** Caller's toast mechanism. */
  showToast: (msg: string) => void
}

export interface SellWalkthroughProps extends SellWalkthroughHandlers {
  /** Optional draft state on mount (resume path). */
  resume?: {
    groupId: string
    brand: string
    anchorLocationId: string | null
    anchorLocationLabel: string | null
    about: string
    /** 0-indexed step the composer should resume on. */
    resumeFromStep: number
  }
  onAbandon: () => void
}

const TOAST_SUCCESS = 'Your shop is live.'

function emptyState(): SellWalkthroughState {
  return {
    draftGroupId: null,
    brand: '',
    anchorLocationId: null,
    anchorLocationLabel: null,
    about: '',
    localityZip: '',
  }
}

export function SellWalkthrough({
  resume,
  createDraft,
  updateDraft,
  activate,
  createLocation,
  availableLocations,
  redirect,
  showToast,
  onAbandon,
}: SellWalkthroughProps) {
  // The composer is uncontrolled (owns its own `state` via initialState).
  // We use a top-level shadow state only for the AddEntityDrawer mount + the
  // initialState seed; the composer's setState drives the per-step inputs.
  const initialState: SellWalkthroughState = resume
    ? {
        draftGroupId: resume.groupId,
        brand: resume.brand,
        anchorLocationId: resume.anchorLocationId,
        anchorLocationLabel: resume.anchorLocationLabel,
        about: resume.about,
        localityZip: '',
      }
    : emptyState()

  // Step definitions — kept inline so the captures (handlers above) bind
  // cleanly. The composer is generic over S; we instantiate with our state.
  const steps: StepDef<SellWalkthroughState>[] = [
    // 1. Brand name
    {
      id: 'brand',
      title: 'Brand name',
      helper: "What should your shop be called?",
      render: (state, setState) => (
        <label className="block">
          <span className="text-sm font-medium text-[--color-fg]">Brand name</span>
          <input
            data-testid="sell-brand-input"
            aria-label="Brand name"
            className="input mt-1 w-full"
            placeholder="Oak Park Sourdough"
            value={state.brand}
            onChange={(e) => setState({ ...state, brand: e.target.value })}
          />
        </label>
      ),
      validate: (state) =>
        state.brand.trim().length > 0
          ? { ok: true }
          : { ok: false, errors: { brand: 'Brand name is required' } },
    },

    // 2. Anchor Location
    {
      id: 'anchor',
      title: 'Anchor Location',
      helper: 'Where is your shop primarily based?',
      render: (state, setState) => (
        <AnchorLocationStep
          state={state}
          setState={setState}
          available={availableLocations}
          createLocation={createLocation}
        />
      ),
      validate: (state) =>
        state.anchorLocationId
          ? { ok: true }
          : { ok: false, errors: { anchor: 'Pick or add an anchor Location' } },
    },

    // 3. About (optional)
    {
      id: 'about',
      title: 'About',
      helper: 'A short public description visitors will see (optional).',
      isOptional: true,
      render: (state, setState) => (
        <label className="block">
          <span className="text-sm font-medium text-[--color-fg]">About</span>
          <textarea
            data-testid="sell-about-input"
            aria-label="Public description"
            className="input mt-1 w-full min-h-[6rem]"
            placeholder="I bake sourdough from a home kitchen and sell at the Sunday market."
            value={state.about}
            onChange={(e) => setState({ ...state, about: e.target.value })}
          />
        </label>
      ),
      validate: () => ({ ok: true }),
    },

    // 4. Locality claim (Tier 0) — UI-only at b1 (no substrate).
    {
      id: 'locality',
      title: 'Are you locally owned?',
      helper:
        'Add your ZIP to claim Locally Owned status (Tier 0 — self-attested). You can do this later from Shop settings.',
      isOptional: true,
      render: (state, setState) => (
        <label className="block">
          <span className="text-sm font-medium text-[--color-fg]">ZIP code</span>
          <input
            data-testid="sell-locality-zip-input"
            aria-label="ZIP code"
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={10}
            className="input mt-1 w-full"
            placeholder="95817"
            value={state.localityZip}
            onChange={(e) =>
              setState({ ...state, localityZip: e.target.value })
            }
          />
          <p className="mt-1 text-xs text-[--color-fg-muted]">
            Tier 0 is self-attested — the badge reads <em>Claimed</em>. Upgrade
            to <em>Verified</em> or <em>Documented</em> later if you choose.
          </p>
        </label>
      ),
      validate: (state) => {
        // Optional, but if the user typed something it must be 5 digits.
        const v = state.localityZip.trim()
        if (v.length === 0) return { ok: true }
        return /^\d{5}$/.test(v)
          ? { ok: true }
          : { ok: false, errors: { zip: 'Use a 5-digit ZIP, or skip this step.' } }
      },
    },

    // 5. Review & done
    {
      id: 'review',
      title: 'Review',
      helper: 'Confirm the details below, then create your shop.',
      finalLabel: 'Create my shop',
      render: (state) => (
        <ul data-testid="sell-review-list" className="text-sm space-y-2">
          <li>
            <strong>Brand:</strong> {state.brand}
          </li>
          <li>
            <strong>Anchor Location:</strong>{' '}
            {state.anchorLocationLabel ?? '(set)'}
          </li>
          <li>
            <strong>About:</strong>{' '}
            {state.about ? (
              state.about
            ) : (
              <em className="text-[--color-fg-muted]">(none)</em>
            )}
          </li>
          <li>
            <strong>Locally owned ZIP:</strong>{' '}
            {state.localityZip ? (
              state.localityZip
            ) : (
              <em className="text-[--color-fg-muted]">(skipped)</em>
            )}
          </li>
        </ul>
      ),
      validate: () => ({ ok: true }),
    },
  ]

  // Per-step persistence. The composer fires onAdvance(stepId, state) on
  // each Continue (except the final step, which fires onComplete).
  //
  // We keep an in-component shadow of draftGroupId so step 2+ can patch the
  // right row even though the composer's state is the source of truth for
  // visible fields. The composer carries draftGroupId in state too, so a
  // resume re-mount restores it cleanly.
  const [shadowDraftId, setShadowDraftId] = useState<string | null>(
    resume?.groupId ?? null,
  )

  const onAdvance = useCallback(
    async (stepId: string, state: SellWalkthroughState) => {
      if (stepId === 'brand') {
        // Step 1 — group.create. Writes the spine + group_businesses +
        // founder membership + group.created event + group.member_joined
        // event in one transaction (per groups.md and T070 handler).
        // M2 fix-now: also consult shadowDraftId — the composer's `state`
        // never receives the new draftGroupId (createDraft can't reach
        // the composer's setState from onAdvance), so a Back-then-Continue
        // re-edit of brand would re-fire createDraft and create a second
        // draft Group without this guard.
        const existingId = state.draftGroupId ?? shadowDraftId
        if (existingId) {
          await updateDraft({
            groupId: existingId,
            brand: state.brand,
          })
          return
        }
        const { groupId } = await createDraft({ brand: state.brand })
        // Mutate the composer's state via the next render — we can't reach
        // back into the composer's setState from here. The composer will
        // call onAdvance with the still-incomplete state; we surface
        // draftGroupId by stashing it for subsequent calls.
        setShadowDraftId(groupId)
        // The composer's internal state is the source of truth for visible
        // fields; for draftGroupId we keep it in component-scoped state
        // (shadowDraftId). Steps 2–4 use shadowDraftId via the closures
        // below — see resolveDraftId.
        return
      }

      const draftGroupId = resolveDraftId(state, shadowDraftId)
      if (!draftGroupId) {
        // Defensive — shouldn't happen if step 1 succeeded.
        throw new Error(
          'SellWalkthrough.onAdvance: draftGroupId missing on step ' + stepId,
        )
      }

      if (stepId === 'anchor') {
        await updateDraft({
          groupId: draftGroupId,
          anchorLocationId: state.anchorLocationId ?? undefined,
        })
        return
      }
      if (stepId === 'about') {
        await updateDraft({
          groupId: draftGroupId,
          about: state.about,
        })
        return
      }
      if (stepId === 'locality') {
        // No substrate at b1 — see DEVIATIONS. Step is UI-only; collected
        // ZIP discarded on submit. F037 will retro-fit the persistence path.
        return
      }
    },
    [createDraft, updateDraft, shadowDraftId],
  )

  const onComplete = useCallback(
    async (state: SellWalkthroughState) => {
      const draftGroupId = resolveDraftId(state, shadowDraftId)
      if (!draftGroupId) {
        throw new Error('SellWalkthrough.onComplete: draftGroupId missing')
      }
      const { destinationUrl } = await activate({ groupId: draftGroupId })
      // Composer is presentational — it does not navigate. We do.
      redirect(destinationUrl)
      showToast(TOAST_SUCCESS)
      return { destinationUrl }
    },
    [activate, redirect, showToast, shadowDraftId],
  )

  return (
    <MultiStepComposer<SellWalkthroughState>
      steps={steps}
      initialState={initialState}
      resumeFromStep={resume?.resumeFromStep ?? 0}
      onAdvance={onAdvance}
      onComplete={onComplete}
      onAbandon={onAbandon}
    />
  )
}

// Resolve the right draftGroupId for steps 2+. Prefer composer state (a
// resume mount populated it from props); fall back to the shadow (set by
// step 1's createDraft response). Both must agree once step 1 has run.
function resolveDraftId(
  state: SellWalkthroughState,
  shadow: string | null,
): string | null {
  return state.draftGroupId ?? shadow
}

/** Step-2 picker. List of saved Locations + a "+ Add a new Location" row that
 *  opens the AddEntityDrawer sub-flow. On Save, the new Location auto-selects
 *  and the user stays paused on the anchor step (per DLS § Add new entity
 *  inside a composer — parent composer does NOT auto-advance). */
function AnchorLocationStep({
  state,
  setState,
  available,
  createLocation,
}: {
  state: SellWalkthroughState
  setState: (next: SellWalkthroughState) => void
  available: AnchorLocationOption[]
  createLocation: (input: { label: string }) => Promise<{ id: string; label: string }>
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div>
      <ul
        role="listbox"
        aria-label="Anchor Location options"
        data-testid="sell-anchor-options"
        className="space-y-2"
      >
        {available.map((loc) => {
          const selected = state.anchorLocationId === loc.id
          return (
            <li key={loc.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={`sell-anchor-option-${loc.id}`}
                onClick={() =>
                  setState({
                    ...state,
                    anchorLocationId: loc.id,
                    anchorLocationLabel: loc.label,
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
            data-testid="sell-anchor-add-new"
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
                data-testid="sell-add-location-input"
                aria-label="Location name"
                className="input mt-1 w-full"
                placeholder="Maya's Kitchen"
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
            return { id: created.id }
          }}
          onCancel={() => setDrawerOpen(false)}
          onSaved={(newId) => {
            // Per DLS: parent stays paused at the picker step; the new entity
            // auto-selects so the user can just tap Continue.
            const created = available.find((l) => l.id === newId)
            const label =
              created?.label ??
              // The new Location's label isn't in availableLocations yet
              // (the picker's options come from the parent's snapshot).
              // We optimistically set the label from the local form input;
              // the production caller (/you Sell flow) refreshes the
              // options list after onSaved by re-fetching.
              ''
            setState({
              ...state,
              anchorLocationId: newId,
              anchorLocationLabel: label || state.anchorLocationLabel,
            })
            setDrawerOpen(false)
          }}
        />
      )}
    </div>
  )
}
