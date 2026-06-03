// T093 — QR-card lib (F041).
// Spec:   planning/now/scenario-F041-producer-generates-qr-card.md
// Ticket: development/tickets/T093-qr-card-lib-and-handler.md
//
// Pure helpers for the QR-card feature: canonical-URL assembly (kind-aware,
// per CLAUDE.md § Naming conventions + ADR-20/22) and print-quality PNG
// generation. The handler (item.qr_card.request) and the surface (server
// action + button) build on these. DB-free, so fully unit-testable.

import QRCode from 'qrcode'
import { toSlug } from '@/lib/slugify'
import { KIND_SEGMENTS } from '@/lib/feed/item-url'

function segment(kind: string): string {
  return KIND_SEGMENTS[kind] ?? 'p'
}

/** Item slug = slugified title + '-' + first 8 chars of the item id (the
 *  "random suffix" per ADR-22). Mirrors the composer's mint (T078/T084). */
export function buildItemSlug(title: string, itemId: string): string {
  const base = toSlug(title) || 'item'
  return `${base}-${itemId.slice(0, 8)}`
}

/** Member-scoped canonical path: /m/<handle>/<seg>/<slug> (individual Items). */
export function memberScopedItemPath(args: {
  handle: string
  kind: string
  slug: string
}): string {
  return `/m/${args.handle}/${segment(args.kind)}/${args.slug}`
}

/** Group-scoped canonical path: /p/<placePath>/g/<groupSlug>/<seg>/<slug>. */
export function groupScopedItemPath(args: {
  placePath: string
  groupSlug: string
  kind: string
  slug: string
}): string {
  return `/p/${args.placePath}/g/${args.groupSlug}/${segment(args.kind)}/${args.slug}`
}

/** Suggested download filename for the generated card. */
export function qrCardFilename(_kind: string, slug: string): string {
  return `qr-${slug}.png`
}

/**
 * Compose the absolute URL a scanner opens. A printed QR must encode the
 * canonical production origin (not a request origin, which would be localhost
 * in dev). Falls back to the relative path when no base is given (tests).
 */
export function absoluteItemUrl(path: string, baseUrl?: string | null): string {
  if (!baseUrl) return path
  return new URL(path, baseUrl).toString()
}

export interface GenerateQrCardOptions {
  /** Raster width in px. Default 1200 = 4in printed at 300 DPI. */
  width?: number
}

/**
 * Generate a print-quality QR PNG encoding `url`.
 * 1200px wide ⇒ ≥300 DPI when printed at 4". `qrcode` writes no physical-DPI
 * PNG chunk; the pixel width is the print-quality guarantee.
 */
export async function generateQrCardPng(
  url: string,
  opts: GenerateQrCardOptions = {},
): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: opts.width ?? 1200,
    margin: 4,
    errorCorrectionLevel: 'M',
  })
}
