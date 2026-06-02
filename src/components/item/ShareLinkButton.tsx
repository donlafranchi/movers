'use client'

// T082 — Share-link affordance for the gathering Item page (F034).
// Copies the canonical URL to the clipboard, or invokes the native share sheet
// when available (mobile). The single shareable URL is the whole point of the
// scenario — "text it, chalk it on a board, drop it in a group chat."

import { useState, useCallback } from 'react'
import { Share2 } from 'lucide-react'

export function ShareLinkButton({ url, label = 'Share link' }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  const onShare = useCallback(async () => {
    const absolute =
      typeof window !== 'undefined' && url.startsWith('/')
        ? `${window.location.origin}${url}`
        : url
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ url: absolute })
        return
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(absolute)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // User dismissed the share sheet, or clipboard was blocked — no-op.
    }
  }, [url])

  return (
    <button
      type="button"
      data-testid="gathering-share-link"
      onClick={onShare}
      className="btn-secondary inline-flex items-center gap-1.5 text-sm"
      aria-label={label}
    >
      <Share2 size={16} aria-hidden="true" />
      {copied ? 'Copied!' : label}
    </button>
  )
}
