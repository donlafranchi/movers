'use client'

// T094 — "Get a QR card" affordance for the owner of an Item (F041).
// Spec:   planning/now/scenario-F041-producer-generates-qr-card.md § Surfaces.
//
// Owner-only (the page gates rendering). On click, calls the server action,
// which generates a print-quality PNG server-side, then triggers a browser
// download via a data-URI anchor. The chalk-on-a-board / tape-to-a-booth
// artifact that lands a visitor on the Item without typing a URL.

import { useState, useCallback } from 'react'
import { QrCode } from 'lucide-react'
import { requestQrCardAction } from '@/app/m/[handle]/qr-actions'

export function QrCardButton({
  itemId,
  label = 'Get a QR card',
}: {
  itemId: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onClick = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { pngBase64, filename } = await requestQrCardAction({ itemId })
      const a = document.createElement('a')
      a.href = `data:image/png;base64,${pngBase64}`
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the QR card.')
    } finally {
      setBusy(false)
    }
  }, [itemId])

  return (
    <div>
      <button
        type="button"
        data-testid="qr-card-button"
        onClick={onClick}
        disabled={busy}
        aria-label={label}
        className="btn-secondary inline-flex items-center gap-1.5 text-sm disabled:opacity-60"
      >
        <QrCode size={16} aria-hidden="true" />
        {busy ? 'Generating…' : label}
      </button>
      {error ? (
        <p data-testid="qr-card-error" role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
