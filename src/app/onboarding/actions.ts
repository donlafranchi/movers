'use server'

// T089 — Onboarding server actions (F030).
//
// Three writes, one per step, fired on each Continue so a back-out leaves a
// partial (not aborted) record:
//   - saveProfileAction   → members row (owner-update RLS; profile edits are
//                           not declarations, so no event — see DEVIATIONS).
//   - setHomeLocalityAction → member.place_interest.add (action layer; emits).
//   - addInterestsAction  → member.interests.add (action layer; emits).
//
// Locality + interests go through the action layer (resolveActionContext →
// invoke) exactly like createProductAction (T078).

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import { memberPlaceInterestAdd, memberInterestsAdd, ActionError } from '@/actions'
import { suggestHandles, validateHandle } from '@/lib/onboarding/handles'

async function requireMemberId(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('You must be signed in.')
  return data.user.id
}

export interface SaveProfileInput {
  displayName: string
  handle: string
  bio?: string
  pronouns?: string
  avatarUrl?: string
}

export type SaveProfileResult =
  | { ok: true }
  | { ok: false; field: 'handle' | 'displayName'; message: string; suggestions?: string[] }

export async function saveProfileAction(input: SaveProfileInput): Promise<SaveProfileResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) throw new Error('You must be signed in.')

  const displayName = input.displayName?.trim() ?? ''
  if (displayName.length < 1 || displayName.length > 60) {
    return { ok: false, field: 'displayName', message: 'Add a name (1–60 characters).' }
  }
  const handle = input.handle?.trim().toLowerCase() ?? ''
  if (!validateHandle(handle)) {
    return {
      ok: false,
      field: 'handle',
      message: 'Handles are 4–30 characters: lowercase letters, numbers, hyphens.',
    }
  }

  const { error } = await supabase
    .from('members')
    .update({
      display_name: displayName,
      handle,
      bio: input.bio?.trim() || null,
      pronouns: input.pronouns?.trim() || null,
      avatar_url: input.avatarUrl?.trim() || null,
    })
    .eq('id', user.id)

  if (error) {
    // 23505 = unique_violation on members.handle.
    if (error.code === '23505') {
      return {
        ok: false,
        field: 'handle',
        message: 'That handle is taken.',
        suggestions: suggestHandles(handle),
      }
    }
    throw error
  }
  return { ok: true }
}

export async function setHomeLocalityAction(input: {
  placeId: string
}): Promise<{ ok: true }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await memberPlaceInterestAdd(ctx, { placeId: input.placeId, scopeKind: 'primary_home' })
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
  return { ok: true }
}

export async function addInterestsAction(input: {
  tags: string[]
}): Promise<{ ok: true; addedTags: string[] }> {
  // Skipping interests is valid (the feed leans on locality).
  if (!input.tags || input.tags.length === 0) return { ok: true, addedTags: [] }
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    const result = await memberInterestsAdd(ctx, { tags: input.tags })
    return { ok: true, addedTags: result.addedTags }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}
