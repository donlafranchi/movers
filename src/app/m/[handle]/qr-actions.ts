'use server'

// T094 — Server action for the QR-card affordance (F041).
// Spec:   planning/now/scenario-F041-producer-generates-qr-card.md
// Ticket: development/tickets/T094-qr-card-surface.md
//
// Thin wrapper around item.qr_card.request (T093). Resolves the auth'd user,
// invokes the handler, and returns the base64 PNG + filename + canonical URL
// for the client to trigger a browser download. Owner-only is enforced inside
// the handler (AuthorizationError → surfaced as a plain Error).

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import { itemQrCardRequest, ActionError } from '@/actions'

export interface RequestQrCardResult {
  pngBase64: string
  filename: string
  url: string
}

export async function requestQrCardAction(input: {
  itemId: string
}): Promise<RequestQrCardResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('You must be signed in to generate a QR card.')
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'https://movers-makers-shakers.com'
  const ctx = resolveActionContext({ actingMemberId: data.user.id })
  try {
    const result = await itemQrCardRequest(ctx, { itemId: input.itemId, baseUrl })
    return {
      pngBase64: result.pngBase64,
      filename: result.filename,
      url: result.url,
    }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}
