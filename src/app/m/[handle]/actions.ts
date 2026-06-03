'use server'

// T091 — Member follow / unfollow server actions (F032).
//
// Thin wrappers over the action layer (resolveActionContext → invoke), same
// shape as onboarding/actions.ts. Auth-gated: anon callers throw. The page's
// FollowMemberButton calls these from the client.

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import { memberFollow, memberUnfollow, ActionError } from '@/actions'

async function requireMemberId(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('You must be signed in.')
  return data.user.id
}

export async function followMemberAction(input: {
  followedMemberId: string
}): Promise<{ ok: true; following: boolean }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    const result = await memberFollow(ctx, { followedMemberId: input.followedMemberId })
    return { ok: true, following: result.following }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}

export async function unfollowMemberAction(input: {
  followedMemberId: string
}): Promise<{ ok: true; following: boolean }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    const result = await memberUnfollow(ctx, { followedMemberId: input.followedMemberId })
    return { ok: true, following: result.following }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}
