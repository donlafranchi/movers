'use client'

// T071 — <MultiStepComposer> canonical multi-step composer base.
// Source: development/tickets/T071-multistep-composer-base.md
// Spec:   product/ui/design-language.md § Component recipes → Multi-step composer
//
// Generic, kind-agnostic, presentational + control-flow only. Consumers
// (SellWalkthrough T073, gathering composer F034, product composer F038,
// service composer F040) supply: (a) step definitions, (b) an onAdvance
// callback fired on each Continue, (c) an onComplete callback fired on
// final-step submit. The composer does not persist; the consumer does.
//
// Container per ADR-2 / Principle #6: bottom-anchored drawer on mobile,
// modal on desktop. Tap-outside-to-dismiss is OFF — the composer's state
// is half-built-thing edit mode, so "lose your changes" framing is wrong.

import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { X, Loader2 } from 'lucide-react'

export interface Validation {
  ok: boolean
  errors?: Record<string, string>
}

export interface StepDef<S> {
  /** Stable id; passed to onAdvance to identify which step just submitted. */
  id: string
  /** Heading rendered at the top of the step body (22px / 600 slot). */
  title: string
  /** Optional one-sentence helper (14px / 400 / muted) under the title. */
  helper?: string
  /** When true, the navigation row renders a [Skip this step] link. */
  isOptional?: boolean
  /** Step body. Receives current state + setState; returns the input UI. */
  render: (state: S, setState: (next: S) => void) => ReactNode
  /** Step-level validation called on Continue tap. Inline errors render
   *  beside the step body — this composer does not render a top-of-form summary. */
  validate: (state: S) => Validation
  /** Optional override for the primary CTA label on the final step.
   *  E.g. "Create my shop". Per DLS § Multi-step composer, final-step
   *  CTAs read the destination verb — never "Submit" or "Done". */
  finalLabel?: string
}

export interface MultiStepComposerProps<S> {
  steps: StepDef<S>[]
  initialState: S
  onAdvance: (stepId: string, state: S) => Promise<void>
  onComplete: (state: S) => Promise<{ destinationUrl: string }>
  onAbandon: () => void
  /** Caller passes the last-completed-step index + 1 if a draft exists; the
   *  composer mounts on that step with prior fields populated. */
  resumeFromStep?: number
  /** Accessible name for the dialog. Defaults to a stable generic label so
   *  the dialog's accessible name doesn't collide with the *current step's*
   *  input label. Consumers should pass the composer's purpose ("Set up
   *  your shop", "Host a gathering", etc.). T073b fix-forward: without
   *  this, getByLabel matches both the dialog and any input whose label
   *  happens to match the step title — strict-mode violation. */
  dialogLabel?: string
}

/**
 * Canonical multi-step composer. One shape; many consumers. Per DLS § no-fork rule.
 */
export function MultiStepComposer<S>({
  steps,
  initialState,
  onAdvance,
  onComplete,
  onAbandon,
  resumeFromStep = 0,
  dialogLabel = 'Multi-step composer',
}: MultiStepComposerProps<S>) {
  const [state, setState] = useState<S>(initialState)
  const [stepIdx, setStepIdx] = useState<number>(
    // Clamp the resume index into [0, steps.length - 1].
    Math.min(Math.max(resumeFromStep, 0), steps.length - 1),
  )
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const total = steps.length
  const step = steps[stepIdx]
  const isFinal = stepIdx === total - 1
  const isFirst = stepIdx === 0

  // Focus restore — remember the element that had focus when the composer
  // mounted; restore on unmount. Per ADR-2 / a11y baseline: modals must not
  // strand keyboard focus on a now-hidden element.
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    restoreFocusRef.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    // Move focus into the dialog on mount.
    dialogRef.current?.focus()
    return () => {
      restoreFocusRef.current?.focus?.()
    }
  }, [])

  // ESC dismisses — standard modal a11y.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onAbandon()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onAbandon])

  const handleContinue = useCallback(async () => {
    if (submitting) return
    setSubmitError(null)
    const v = step.validate(state)
    if (!v.ok) {
      setStepErrors(v.errors ?? {})
      return
    }
    setStepErrors({})
    setSubmitting(true)
    try {
      if (isFinal) {
        await onComplete(state)
        // Composer hands control back to the caller; the caller redirects.
        // We do not navigate here — keeps the component framework-agnostic.
      } else {
        await onAdvance(step.id, state)
        setStepIdx((i) => Math.min(i + 1, total - 1))
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, step, state, isFinal, onAdvance, onComplete, total])

  const handleBack = useCallback(() => {
    if (submitting) return
    setStepErrors({})
    setSubmitError(null)
    setStepIdx((i) => Math.max(i - 1, 0))
  }, [submitting])

  const handleSkip = useCallback(async () => {
    if (submitting) return
    if (!step.isOptional) return
    setStepErrors({})
    setSubmitError(null)
    // Skipping an optional step does NOT call onAdvance — there's no diff to persist.
    setStepIdx((i) => Math.min(i + 1, total - 1))
  }, [submitting, step.isOptional, total])

  // Tap-outside-to-dismiss is intentionally OFF. The overlay swallows clicks.
  // X-button is the only abandon affordance.
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Stop propagation only; never invoke onAbandon here.
      e.stopPropagation()
    },
    [],
  )

  const finalCtaLabel = step.finalLabel ?? 'Done'

  return (
    <div
      data-testid="multistep-composer-overlay"
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="bg-white w-full md:max-w-lg max-h-[90vh] flex flex-col rounded-t-2xl md:rounded-2xl shadow-lg relative outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar: step indicator + close button */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <StepIndicator current={stepIdx + 1} total={total} />
          <button
            type="button"
            onClick={onAbandon}
            aria-label="Close"
            className="p-1 text-neutral-500 hover:text-neutral-900"
          >
            <X size={20} />
          </button>
        </div>

        {/* Step body — scrollable */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <h3
            id="multistep-composer-step-title"
            className="text-[22px] font-semibold leading-tight"
          >
            {step.title}
          </h3>
          {step.helper && (
            <p className="mt-1 text-sm text-[--color-fg-muted]">{step.helper}</p>
          )}
          <div className="mt-5">
            {step.render(state, (next) => {
              setStepErrors({})
              setSubmitError(null)
              setState(next)
            })}
          </div>
          {Object.entries(stepErrors).map(([field, msg]) => (
            <p
              key={field}
              data-testid={`field-error-${field}`}
              className="mt-2 text-sm text-red-600"
            >
              {msg}
            </p>
          ))}
        </div>

        {/* Submit-error row */}
        {submitError && (
          <p
            data-testid="composer-submit-error"
            className="px-5 py-2 text-sm text-red-600 border-t border-neutral-200"
          >
            {submitError}
          </p>
        )}

        {/* Navigation row */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200">
          <div className="min-w-[5rem]">
            {!isFirst && (
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="text-sm text-[--color-fg] hover:underline disabled:opacity-50"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="min-w-[6rem] text-center">
            {step.isOptional && (
              // T073b: per DLS § Multi-step composer the Skip affordance is
              // a "text link" — semantically role=link, mechanically a button
              // that fires onClick without navigation. role="link" lets
              // getByRole('link', { name: /Skip this step/i }) resolve while
              // the focusable <button> element keeps keyboard semantics.
              <button
                type="button"
                role="link"
                onClick={handleSkip}
                disabled={submitting}
                className="text-sm text-[--color-fg-muted] hover:underline disabled:opacity-50"
              >
                Skip this step
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleContinue}
            disabled={submitting}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-75 disabled:cursor-not-allowed"
          >
            {submitting && (
              <Loader2
                size={16}
                data-testid="continue-spinner"
                className="animate-spin"
              />
            )}
            <span>{isFinal ? finalCtaLabel : 'Continue'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Horizontal dots + "Step k of N" counter. Completed dots are filled; the
 * current dot is filled; upcoming dots are hollow. The completed/current
 * pair is clickable (jump-back via the parent's setStepIdx) — but at this
 * tier we only render visual + counter; back-jumping uses the Back link.
 *
 * ARIA: a role="progressbar" with aria-valuenow/valuemax so screen readers
 * announce the step ordinal.
 */
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuenow={current}
      aria-valuemax={total}
      aria-label={`Step ${current} of ${total}`}
      className="flex items-center gap-2"
    >
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
          const filled = n <= current
          return (
            <span
              key={n}
              data-testid={`step-dot-${n}${filled ? '-filled' : ''}`}
              className={`block w-2 h-2 rounded-full ${
                filled ? 'bg-[--color-fg]' : 'border border-[--color-border]'
              }`}
            />
          )
        })}
      </div>
      <span className="text-xs text-[--color-fg-muted] font-medium">
        Step {current} of {total}
      </span>
    </div>
  )
}
