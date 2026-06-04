// T097 — Unit tests for <LocallyOwnedClaim> (F037 owner widget).
// Trace: planning/now/scenario-F037-maya-claims-locally-owned.md beats 1–6.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { LocallyOwnedClaim } from './LocallyOwnedClaim'
import type { OwnerClaim } from '@/lib/groups/resolve-shop'

const refreshSpy = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshSpy, push: vi.fn(), replace: vi.fn() }),
}))

afterEach(cleanup)

let onSet: ReturnType<typeof vi.fn<(input: { groupId: string; zip: string }) => Promise<void>>>
let onRemove: ReturnType<typeof vi.fn<(input: { groupId: string }) => Promise<void>>>

beforeEach(() => {
  refreshSpy.mockClear()
  onSet = vi.fn<(input: { groupId: string; zip: string }) => Promise<void>>().mockResolvedValue(undefined)
  onRemove = vi.fn<(input: { groupId: string }) => Promise<void>>().mockResolvedValue(undefined)
})

function renderWidget(claim: OwnerClaim) {
  return render(
    <LocallyOwnedClaim groupId="grp-1" claim={claim} onSet={onSet} onRemove={onRemove} />,
  )
}

describe('LocallyOwnedClaim — empty state (beat 2 entry)', () => {
  it('shows the unclaimed copy + an "Add ZIP" CTA, no edit/remove', () => {
    renderWidget({ zip: null, isProximal: false })
    expect(screen.getByTestId('claim-add')).toBeInTheDocument()
    expect(screen.queryByTestId('claim-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('claim-remove')).not.toBeInTheDocument()
    expect(screen.getByText(/haven't claimed Locally Owned yet/i)).toBeInTheDocument()
  })

  it('reveals a single ZIP field when Add ZIP is tapped', () => {
    renderWidget({ zip: null, isProximal: false })
    fireEvent.click(screen.getByTestId('claim-add'))
    expect(screen.getByTestId('claim-zip-input')).toBeInTheDocument()
    expect(screen.getByTestId('claim-submit')).toBeInTheDocument()
  })
})

describe('LocallyOwnedClaim — inline validation (edge)', () => {
  it('rejects a non-5-digit ZIP inline without calling the action', async () => {
    renderWidget({ zip: null, isProximal: false })
    fireEvent.click(screen.getByTestId('claim-add'))
    fireEvent.change(screen.getByTestId('claim-zip-input'), { target: { value: '999' } })
    fireEvent.click(screen.getByTestId('claim-submit'))
    expect(await screen.findByTestId('claim-zip-error')).toBeInTheDocument()
    expect(onSet).not.toHaveBeenCalled()
  })
})

describe('LocallyOwnedClaim — add (beat 2)', () => {
  it('submits a valid ZIP to onSet and refreshes the page', async () => {
    renderWidget({ zip: null, isProximal: false })
    fireEvent.click(screen.getByTestId('claim-add'))
    fireEvent.change(screen.getByTestId('claim-zip-input'), { target: { value: '95817' } })
    fireEvent.click(screen.getByTestId('claim-submit'))
    await waitFor(() => {
      expect(onSet).toHaveBeenCalledWith({ groupId: 'grp-1', zip: '95817' })
    })
    await waitFor(() => expect(refreshSpy).toHaveBeenCalled())
  })
})

describe('LocallyOwnedClaim — claimed + proximal (beat 2/3 result)', () => {
  it('shows the ZIP on file with Edit + Remove, no non-proximal warning', () => {
    renderWidget({ zip: '95817', isProximal: true })
    expect(screen.getByText(/ZIP on file: 95817/i)).toBeInTheDocument()
    expect(screen.getByTestId('claim-edit')).toBeInTheDocument()
    expect(screen.getByTestId('claim-remove')).toBeInTheDocument()
    expect(screen.queryByTestId('claim-not-proximal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('claim-add')).not.toBeInTheDocument()
  })

  it('prefills the current ZIP when editing and submits the new value', async () => {
    renderWidget({ zip: '95817', isProximal: true })
    fireEvent.click(screen.getByTestId('claim-edit'))
    const input = screen.getByTestId('claim-zip-input') as HTMLInputElement
    expect(input.value).toBe('95817')
    fireEvent.change(input, { target: { value: '95816' } })
    fireEvent.click(screen.getByTestId('claim-submit'))
    await waitFor(() => {
      expect(onSet).toHaveBeenCalledWith({ groupId: 'grp-1', zip: '95816' })
    })
  })
})

describe('LocallyOwnedClaim — claimed + non-proximal (beat 5)', () => {
  it('shows the honest "isn\'t in proximity" message + the ZIP, still editable', () => {
    renderWidget({ zip: '90210', isProximal: false })
    const warn = screen.getByTestId('claim-not-proximal')
    expect(warn).toHaveTextContent(/isn't in proximity/i)
    expect(screen.getByText(/ZIP on file: 90210/i)).toBeInTheDocument()
    expect(screen.getByTestId('claim-edit')).toBeInTheDocument()
    expect(screen.getByTestId('claim-remove')).toBeInTheDocument()
  })
})

describe('LocallyOwnedClaim — remove (beat 4)', () => {
  it('confirms then calls onRemove and refreshes', async () => {
    renderWidget({ zip: '95817', isProximal: true })
    fireEvent.click(screen.getByTestId('claim-remove'))
    fireEvent.click(screen.getByTestId('claim-remove-confirm'))
    await waitFor(() => {
      expect(onRemove).toHaveBeenCalledWith({ groupId: 'grp-1' })
    })
    await waitFor(() => expect(refreshSpy).toHaveBeenCalled())
  })
})
