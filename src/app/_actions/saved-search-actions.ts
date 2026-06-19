'use server'

// T102 — Saved-search server actions (F033 venue page + F042 unified following).
//
// Thin wrappers over T063's shipped handlers (member.saved_search.create /
// .remove), same shape as m/[handle]/actions.ts (T092): createClient → getUser
// → resolveActionContext → handler → catch ActionError. Anon callers throw; the
// component handles the auth gate. Shared (not route-scoped) because two routes
// consume them. The b1 CTA only creates and removes — the edit-filters composer
// (member.saved_search.update) is a b2 surface and is deliberately not wrapped.

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import {
  memberSavedSearchCreate,
  memberSavedSearchRemove,
  memberSavedSearchRestore,
  ActionError,
} from '@/actions'
import { buildVenueFollowLabel } from '@/lib/saved-search/venue-follow-label'

async function requireMemberId(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('You must be signed in.')
  return data.user.id
}

export async function followVenueAction(input: {
  locationId: string
  venueName: string
}): Promise<{ ok: true; savedSearchId: string }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    const result = await memberSavedSearchCreate(ctx, {
      label: buildVenueFollowLabel(input.venueName),
      locationId: input.locationId,
    })
    return { ok: true, savedSearchId: result.savedSearchId }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}

export async function unfollowVenueAction(input: {
  savedSearchId: string
}): Promise<{ ok: true }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await memberSavedSearchRemove(ctx, { id: input.savedSearchId })
    return { ok: true }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}

// T109 — F042 venue-follow Undo: re-activate the soft-removed saved-search row
// rather than creating a duplicate.
export async function restoreVenueAction(input: {
  savedSearchId: string
}): Promise<{ ok: true }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await memberSavedSearchRestore(ctx, { id: input.savedSearchId })
    return { ok: true }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}
