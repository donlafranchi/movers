'use client'

// T081 — <GatheringComposer> — the gathering-hosting surface for F034.
// Spec:   planning/now/scenario-F034-member-hosts-recurring-gathering.md
// Ticket: development/tickets/T081-gathering-composer-surface.md
// DLS:    product/ui/design-language.md § Component recipes → Multi-step composer
//
// Composes <MultiStepComposer> with four steps:
//   1. Kind     → one-time event / recurring gathering / open meetup (user
//                 language, NOT a four-kind Product/Service/Gathering/Wonder
//                 picker — F034 § "Composer asks what kind in user language").
//   2. Details  → title, description
//   3. Schedule → day + time (one-time/recurring; future-only) + optional
//                 capacity, cost, what-to-bring. Recurring derives a weekly
//                 RRULE; open meetup needs no fixed time.
//   4. Review   → createGathering(publish) → redirect to the Item URL
//
// Presentational + control-flow only (per T071). The parent passes the
// server-action thunk so the component is testable in isolation. Location is
// pre-attached from a prop (the venue/anchor) — no picker step at b1.

import { useCallback } from 'react'
import {
  MultiStepComposer,
  type StepDef,
} from '@/components/composer/MultiStepComposer'
import { dollarsToCents } from './ProductComposer'

export type GatheringKind = 'one_time' | 'recurring' | 'open_meetup'

export interface GatheringComposerState {
  gatheringKind: GatheringKind | null
  title: string
  description: string
  /** 'YYYY-MM-DD'. */
  startDate: string
  /** 'HH:MM'. */
  startTime: string
  /** Integer string; blank = unlimited. */
  capacity: string
  /** Dollars; blank = free. */
  costDollars: string
  whatToBring: string
  locationId: string | null
  locationLabel: string | null
}

export interface GatheringComposerHandlers {
  createGathering: (input: {
    title: string
    description: string
    gatheringKind: GatheringKind
    startsAt?: string
    recurrenceRule?: string
    capacity?: number
    costCents?: number | null
    whatToBring?: string
    locationId?: string
  }) => Promise<{ itemId: string; destinationUrl: string }>
  redirect: (url: string) => void
  showToast: (msg: string) => void
}

export interface GatheringComposerProps extends GatheringComposerHandlers {
  /** Pre-attached Location (the venue, or the Group's anchor). */
  defaultLocationId?: string | null
  defaultLocationLabel?: string | null
  onAbandon: () => void
}

const TOAST_SUCCESS = 'Your gathering is live.'

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** Weekly RRULE from a 'YYYY-MM-DD' date. UTC-parsed so the weekday is stable
 *  regardless of the runner's timezone. */
export function weeklyRrule(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return `FREQ=WEEKLY;BYDAY=${RRULE_DAYS[d.getUTCDay()]}`
}

function weekdayName(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return WEEKDAY_NAMES[d.getUTCDay()]
}

/** 'YYYY-MM-DD' + 'HH:MM' → 'YYYY-MM-DDTHH:MM:00' (local, no zone suffix). */
export function combineDateTime(dateStr: string, timeStr: string): string {
  return `${dateStr}T${timeStr}:00`
}

const TITLE: Record<GatheringKind, string> = {
  one_time: 'One-time event',
  recurring: 'Recurring gathering',
  open_meetup: 'Open meetup',
}

const KIND_OPTIONS: { kind: GatheringKind; label: string; sub: string }[] = [
  { kind: 'one_time', label: 'One-time event', sub: 'Happens once, on a set date.' },
  {
    kind: 'recurring',
    label: 'Recurring gathering',
    sub: 'Repeats every week, ongoing.',
  },
  {
    kind: 'open_meetup',
    label: 'Open meetup',
    sub: 'Drop in anytime — no fixed schedule.',
  },
]

export function GatheringComposer({
  createGathering,
  redirect,
  showToast,
  defaultLocationId = null,
  defaultLocationLabel = null,
  onAbandon,
}: GatheringComposerProps) {
  const initialState: GatheringComposerState = {
    gatheringKind: null,
    title: '',
    description: '',
    startDate: '',
    startTime: '',
    capacity: '',
    costDollars: '',
    whatToBring: '',
    locationId: defaultLocationId,
    locationLabel: defaultLocationLabel,
  }

  const steps: StepDef<GatheringComposerState>[] = [
    // 1. Kind — user language.
    {
      id: 'kind',
      title: 'Host a gathering',
      helper: 'What kind of thing are you hosting?',
      render: (state, setState) => (
        <ul className="space-y-2" data-testid="gathering-kind-options">
          {KIND_OPTIONS.map((opt) => {
            const selected = state.gatheringKind === opt.kind
            return (
              <li key={opt.kind}>
                <button
                  type="button"
                  data-testid={`gathering-kind-option-${opt.kind}`}
                  aria-pressed={selected}
                  onClick={() => setState({ ...state, gatheringKind: opt.kind })}
                  className={`w-full text-left rounded-lg border px-4 py-3 text-sm ${
                    selected
                      ? 'border-[--color-accent] bg-[--color-accent-tint]'
                      : 'border-neutral-200 hover:bg-neutral-50'
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs text-[--color-fg-muted]">{opt.sub}</div>
                </button>
              </li>
            )
          })}
        </ul>
      ),
      validate: (state) =>
        state.gatheringKind
          ? { ok: true }
          : { ok: false, errors: { kind: 'Pick what kind of thing this is' } },
    },

    // 2. Details.
    {
      id: 'details',
      title: 'Details',
      helper: 'What are you calling it?',
      render: (state, setState) => (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">Title</span>
            <input
              data-testid="gathering-title-input"
              className="input mt-1 w-full"
              placeholder="Thursday Run Club"
              value={state.title}
              onChange={(e) => setState({ ...state, title: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">Description</span>
            <textarea
              data-testid="gathering-description-input"
              aria-label="Description"
              className="input mt-1 w-full min-h-[5rem]"
              placeholder="Easy 5k from the brewery patio, all paces welcome."
              value={state.description}
              onChange={(e) => setState({ ...state, description: e.target.value })}
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

    // 3. Schedule.
    {
      id: 'schedule',
      title: 'When',
      helper: 'Set the time and any optional details.',
      render: (state, setState) => (
        <div className="space-y-4">
          {state.gatheringKind === 'open_meetup' ? (
            <p
              data-testid="gathering-open-meetup-note"
              className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-[--color-fg-muted]"
            >
              Open meetups have no fixed schedule — people drop in whenever.
              You can add specific times later from the gathering page.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="text-sm font-medium text-[--color-fg]">Date</span>
                  <input
                    type="date"
                    data-testid="gathering-date-input"
                    aria-label="Date"
                    className="input mt-1 w-full"
                    value={state.startDate}
                    onChange={(e) =>
                      setState({ ...state, startDate: e.target.value })
                    }
                  />
                </label>
                <label className="block flex-1">
                  <span className="text-sm font-medium text-[--color-fg]">Time</span>
                  <input
                    type="time"
                    data-testid="gathering-time-input"
                    aria-label="Time"
                    className="input mt-1 w-full"
                    value={state.startTime}
                    onChange={(e) =>
                      setState({ ...state, startTime: e.target.value })
                    }
                  />
                </label>
              </div>
              {state.gatheringKind === 'recurring' && state.startDate && (
                <p
                  data-testid="gathering-recurrence-preview"
                  className="text-sm text-[--color-accent]"
                >
                  Every {weekdayName(state.startDate)}
                </p>
              )}
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">
              Capacity (optional)
            </span>
            <input
              data-testid="gathering-capacity-input"
              aria-label="Capacity"
              inputMode="numeric"
              className="input mt-1 w-full"
              placeholder="No limit"
              value={state.capacity}
              onChange={(e) => setState({ ...state, capacity: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">
              Cost (optional — leave blank if free)
            </span>
            <input
              data-testid="gathering-cost-input"
              aria-label="Cost"
              inputMode="decimal"
              className="input mt-1 w-full"
              placeholder="Free"
              value={state.costDollars}
              onChange={(e) => setState({ ...state, costDollars: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[--color-fg]">
              What to bring (optional)
            </span>
            <input
              data-testid="gathering-what-to-bring-input"
              aria-label="What to bring"
              className="input mt-1 w-full"
              placeholder="Water, good shoes"
              value={state.whatToBring}
              onChange={(e) => setState({ ...state, whatToBring: e.target.value })}
            />
          </label>
        </div>
      ),
      validate: (state) => {
        if (state.gatheringKind === 'open_meetup') return { ok: true }
        if (!state.startDate || !state.startTime) {
          return { ok: false, errors: { schedule: 'Pick a date and time' } }
        }
        const when = new Date(combineDateTime(state.startDate, state.startTime))
        if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
          return { ok: false, errors: { schedule: 'The first occurrence must be in the future' } }
        }
        return { ok: true }
      },
    },

    // 4. Review & publish.
    {
      id: 'review',
      title: 'Review',
      helper: 'Confirm the details below, then publish.',
      finalLabel: 'Publish gathering',
      render: (state) => (
        <ul data-testid="gathering-review-list" className="text-sm space-y-2">
          <li>
            <strong>Kind:</strong>{' '}
            {state.gatheringKind ? TITLE[state.gatheringKind] : ''}
          </li>
          <li>
            <strong>Title:</strong> {state.title}
          </li>
          {state.gatheringKind !== 'open_meetup' && (
            <li>
              <strong>When:</strong> {state.startDate} {state.startTime}
              {state.gatheringKind === 'recurring' && state.startDate
                ? ` (every ${weekdayName(state.startDate)})`
                : ''}
            </li>
          )}
          <li>
            <strong>Cost:</strong>{' '}
            {state.costDollars.trim() ? `$${state.costDollars.trim()}` : 'Free'}
          </li>
          <li>
            <strong>Where:</strong> {state.locationLabel ?? '(no venue)'}
          </li>
        </ul>
      ),
      validate: () => ({ ok: true }),
    },
  ]

  const onAdvance = useCallback(async () => {
    // No per-step persistence — written atomically at publish (F034 § one
    // transaction). Steps only collect state.
  }, [])

  const onComplete = useCallback(
    async (state: GatheringComposerState) => {
      const kind = state.gatheringKind as GatheringKind
      const isScheduled = kind !== 'open_meetup'
      const capacityNum = state.capacity.trim()
        ? Number.parseInt(state.capacity.trim(), 10)
        : undefined
      const { destinationUrl } = await createGathering({
        title: state.title.trim(),
        description: state.description.trim(),
        gatheringKind: kind,
        startsAt:
          isScheduled && state.startDate && state.startTime
            ? combineDateTime(state.startDate, state.startTime)
            : undefined,
        recurrenceRule:
          kind === 'recurring' && state.startDate
            ? weeklyRrule(state.startDate)
            : undefined,
        capacity:
          capacityNum !== undefined && Number.isFinite(capacityNum)
            ? capacityNum
            : undefined,
        costCents: state.costDollars.trim()
          ? dollarsToCents(state.costDollars)
          : null,
        whatToBring: state.whatToBring.trim() || undefined,
        locationId: state.locationId ?? undefined,
      })
      redirect(destinationUrl)
      showToast(TOAST_SUCCESS)
      return { destinationUrl }
    },
    [createGathering, redirect, showToast],
  )

  return (
    <MultiStepComposer<GatheringComposerState>
      steps={steps}
      initialState={initialState}
      onAdvance={onAdvance}
      onComplete={onComplete}
      onAbandon={onAbandon}
      dialogLabel="Host a gathering"
    />
  )
}
