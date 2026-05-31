'use client'

// T072 — <AddEntityDrawer> secondary-drawer sub-flow.
// Source: development/tickets/T072-add-entity-drawer-sub-flow.md
// Spec:   product/ui/design-language.md § Surface patterns →
//         Add new entity inside a composer
//
// The shape for "I need to pick a Location from a list, but the Location I
// need doesn't exist yet" — and any analogous case where a composer step
// references an entity the Member hasn't created. Single-form sub-flow that
// stacks over the parent composer; on Save returns to the parent with the
// new entity pre-selected.
//
// The parent composer (T071 <MultiStepComposer>) stays mounted; this drawer
// renders on top with stop-propagation on the overlay. Never nests deeper —
// React context-based refusal is enforced via `AddEntityDrawerNestingContext`.

import {
  useState,
  useCallback,
  useContext,
  useEffect,
  useRef,
  createContext,
  type ReactNode,
} from 'react'
import { X, Loader2 } from 'lucide-react'

export interface Validation {
  ok: boolean
  errors?: Record<string, string>
}

export interface AddEntityDrawerProps<S> {
  /** e.g. "Add a Location". Rendered in the 22px slot at the top. */
  title: string
  /** Initial state for the form body. */
  initialState: S
  /** Single-form render. Receives current state + setState. */
  render: (state: S, setState: (next: S) => void) => ReactNode
  /** Synchronous step-level validation called on Save tap. */
  validate: (state: S) => Validation
  /** Consumer wires this to the entity's create handler. Returns new id. */
  onSave: (state: S) => Promise<{ id: string }>
  /** Fires on Cancel / ESC / X tap. Parent decides what to do (typically: unmount). */
  onCancel: () => void
  /** Fires after onSave resolves. Parent uses the id to pre-select. */
  onSaved: (newEntityId: string) => void
  /** Optional adjacent content (rare). Anything that itself mounts an
   *  AddEntityDrawer here will trigger the nesting refusal. */
  children?: ReactNode
}

const AddEntityDrawerNestingContext = createContext(false)

/**
 * Secondary-drawer sub-flow. Stacks over the parent composer. Single decision:
 * Add and select, or Cancel.
 */
export function AddEntityDrawer<S>({
  title,
  initialState,
  render,
  validate,
  onSave,
  onCancel,
  onSaved,
  children,
}: AddEntityDrawerProps<S>) {
  // Nesting refusal — per DLS spec: "Never nest deeper." A nested instance
  // signals that the entity model needs simplification (or the sub-entity
  // should be defaulted at creation); surfacing the violation at runtime
  // catches accidental nesting in code review.
  const alreadyMounted = useContext(AddEntityDrawerNestingContext)
  if (alreadyMounted) {
    throw new Error(
      'Cannot nest AddEntityDrawer. Stacked drawers beyond two deep are the smell the design pattern explicitly refuses; escalate the entity model instead per design-language.md § Add new entity inside a composer.',
    )
  }

  const [state, setState] = useState<S>(initialState)
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Focus management — snapshot the opener on mount, restore on unmount.
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    restoreFocusRef.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
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
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleSave = useCallback(async () => {
    if (submitting) return
    setSubmitError(null)
    const v = validate(state)
    if (!v.ok) {
      setStepErrors(v.errors ?? {})
      return
    }
    setStepErrors({})
    setSubmitting(true)
    try {
      const result = await onSave(state)
      onSaved(result.id)
      // Parent is expected to unmount after onSaved. We do not call onCancel
      // here — onCancel is the user-abandon path, not the success path.
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }, [submitting, validate, state, onSave, onSaved])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Tap-outside-to-dismiss is intentionally OFF.
      e.stopPropagation()
    },
    [],
  )

  return (
    <AddEntityDrawerNestingContext.Provider value={true}>
      <div
        data-testid="add-entity-drawer-overlay"
        className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4"
        onClick={handleOverlayClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-entity-drawer-title"
      >
        <div
          ref={dialogRef}
          tabIndex={-1}
          className="bg-white w-full md:max-w-md max-h-[90vh] flex flex-col rounded-t-2xl md:rounded-2xl shadow-lg relative outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h3
              id="add-entity-drawer-title"
              className="text-[22px] font-semibold leading-tight"
            >
              {title}
            </h3>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="p-1 text-neutral-500 hover:text-neutral-900"
            >
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 overflow-y-auto flex-1">
            <div className="mt-2">
              {render(state, (next) => {
                setStepErrors({})
                setSubmitError(null)
                setState(next)
              })}
            </div>
            {Object.entries(stepErrors).map(([field, msg]) => (
              <p
                key={field}
                data-testid={`add-entity-field-error-${field}`}
                className="mt-2 text-sm text-red-600"
              >
                {msg}
              </p>
            ))}
            {children}
          </div>

          {/* Submit-error row — aria-live=assertive so screen readers
              announce the failure without polite-queue delay. */}
          {submitError && (
            <p
              data-testid="add-entity-submit-error"
              role="alert"
              aria-live="assertive"
              className="px-5 py-2 text-sm text-red-600 border-t border-neutral-200"
            >
              {submitError}
            </p>
          )}

          {/* Navigation row */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-200">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="text-sm text-[--color-fg] hover:underline disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="btn-primary inline-flex items-center gap-2 disabled:opacity-75 disabled:cursor-not-allowed"
            >
              {submitting && (
                <Loader2
                  size={16}
                  data-testid="add-entity-spinner"
                  className="animate-spin"
                />
              )}
              <span>Add and select</span>
            </button>
          </div>
        </div>
      </div>
    </AddEntityDrawerNestingContext.Provider>
  )
}
