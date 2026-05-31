import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AddEntityDrawer, type Validation } from './AddEntityDrawer'
import React from 'react'

// T072 — Unit tests for the secondary-drawer sub-flow.
// Source: development/tickets/T072-add-entity-drawer-sub-flow.md
// Spec:   product/ui/design-language.md § Surface patterns → Add new entity inside a composer

type LocationState = { name: string }
const initialState: LocationState = { name: '' }

function locationRender(
  state: LocationState,
  setState: (next: LocationState) => void,
) {
  return (
    <label className="block">
      <span>Location name</span>
      <input
        aria-label="Location name"
        value={state.name}
        onChange={(e) => setState({ ...state, name: e.target.value })}
      />
    </label>
  )
}

function locationValidate(state: LocationState): Validation {
  return state.name.trim().length > 0
    ? { ok: true }
    : { ok: false, errors: { name: 'Location name is required' } }
}

describe('T072 — <AddEntityDrawer> secondary-drawer sub-flow', () => {
  let onSave: (state: LocationState) => Promise<{ id: string }>
  let onCancel: () => void
  let onSaved: (id: string) => void
  let saveCalls: LocationState[]
  let savedIds: string[]

  beforeEach(() => {
    saveCalls = []
    savedIds = []
    onSave = async (state) => {
      saveCalls.push(state)
      return { id: 'loc-99' }
    }
    onCancel = vi.fn() as unknown as () => void
    onSaved = (id) => { savedIds.push(id) }
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the title in the 22px slot and a single-form body (no step indicator)', () => {
    render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={initialState}
        render={locationRender}
        validate={locationValidate}
        onSave={onSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Add a Location' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('navigation row shows Cancel + Add and select; no Skip; no Continue', () => {
    render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={initialState}
        render={locationRender}
        validate={locationValidate}
        onSave={onSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add and select/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continue/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Skip/i })).not.toBeInTheDocument()
  })

  it('Save validates, calls onSave, then onSaved with the new id, then unmounts via parent', async () => {
    const { rerender } = render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={initialState}
        render={locationRender}
        validate={locationValidate}
        onSave={onSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    fireEvent.change(screen.getByLabelText('Location name'), {
      target: { value: "Maya's Kitchen" },
    })
    fireEvent.click(screen.getByRole('button', { name: /Add and select/i }))
    await waitFor(() => {
      expect(saveCalls).toHaveLength(1)
    })
    expect(saveCalls[0].name).toBe("Maya's Kitchen")
    expect(savedIds).toEqual(['loc-99'])
    // Parent is responsible for unmounting after onSaved fires; we simulate by
    // rerendering with the drawer absent.
    rerender(<div />)
    expect(screen.queryByRole('heading', { name: 'Add a Location' })).not.toBeInTheDocument()
  })

  it('Save blocks + surfaces inline error when validate fails (no top-of-form summary)', async () => {
    render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={initialState}
        render={locationRender}
        validate={locationValidate}
        onSave={onSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Add and select/i }))
    await waitFor(() => {
      expect(screen.getByText('Location name is required')).toBeInTheDocument()
    })
    expect(saveCalls).toHaveLength(0)
    expect(savedIds).toHaveLength(0)
  })

  it('Cancel fires onCancel and does NOT call onSave / onSaved', () => {
    render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={initialState}
        render={locationRender}
        validate={locationValidate}
        onSave={onSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    fireEvent.change(screen.getByLabelText('Location name'), {
      target: { value: "Maya's Kitchen" },
    })
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    expect((onCancel as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
    expect(saveCalls).toHaveLength(0)
    expect(savedIds).toHaveLength(0)
  })

  it('ESC fires onCancel', () => {
    render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={initialState}
        render={locationRender}
        validate={locationValidate}
        onSave={onSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect((onCancel as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
  })

  it('restores focus to the originating element on unmount', () => {
    const opener = document.createElement('button')
    opener.id = 'opener'
    opener.textContent = 'Add a new Location'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { unmount } = render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={initialState}
        render={locationRender}
        validate={locationValidate}
        onSave={onSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    expect(document.activeElement).not.toBe(opener)
    unmount()
    expect(document.activeElement).toBe(opener)
    document.body.removeChild(opener)
  })

  it('tap-outside-to-dismiss is OFF; only Cancel/ESC/X dismiss', () => {
    render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={initialState}
        render={locationRender}
        validate={locationValidate}
        onSave={onSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    const overlay = screen.getByTestId('add-entity-drawer-overlay')
    fireEvent.click(overlay)
    expect((onCancel as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
  })

  it('throws a dev-time error when nested inside another <AddEntityDrawer>', () => {
    // Silence React error-boundary noise.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(
        <AddEntityDrawer
          title="Outer"
          initialState={initialState}
          render={locationRender}
          validate={locationValidate}
          onSave={onSave}
          onCancel={onCancel}
          onSaved={onSaved}
        >
          <AddEntityDrawer
            title="Inner"
            initialState={initialState}
            render={locationRender}
            validate={locationValidate}
            onSave={onSave}
            onCancel={onCancel}
            onSaved={onSaved}
          />
        </AddEntityDrawer>,
      ),
    ).toThrow(/Cannot nest AddEntityDrawer/)
    errSpy.mockRestore()
  })

  it('disables Save during onSave; surfaces submit error inline on rejection; state preserved', async () => {
    let resolveSave: (v: { id: string }) => void = () => {}
    const slowSave: (state: LocationState) => Promise<{ id: string }> = () =>
      new Promise<{ id: string }>((resolve) => {
        resolveSave = resolve
      })
    const { rerender } = render(
      <AddEntityDrawer
        title="Add a Location"
        initialState={{ name: "Maya's Kitchen" }}
        render={locationRender}
        validate={locationValidate}
        onSave={slowSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Add and select/i }))
    await waitFor(() => {
      expect(screen.getByTestId('add-entity-spinner')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Add and select/i })).toBeDisabled()
    act(() => { resolveSave({ id: 'loc-1' }) })
    await waitFor(() => {
      expect(screen.queryByTestId('add-entity-spinner')).not.toBeInTheDocument()
    })

    const failingSave: (state: LocationState) => Promise<{ id: string }> = async () => {
      throw new Error('Network down')
    }
    rerender(
      <AddEntityDrawer
        title="Add a Location"
        initialState={{ name: "Maya's Kitchen" }}
        render={locationRender}
        validate={locationValidate}
        onSave={failingSave}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Add and select/i }))
    await waitFor(() => {
      expect(screen.getByTestId('add-entity-submit-error')).toHaveTextContent(/Network down/)
    })
    expect(screen.getByRole('button', { name: /Add and select/i })).not.toBeDisabled()
    // Form state preserved (name still in the input).
    expect(screen.getByLabelText('Location name')).toHaveValue("Maya's Kitchen")
  })
})
