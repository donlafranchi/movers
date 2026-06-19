'use server'

// T109 — Group membership server actions (F042 management page + F035 Join).
//
// Thin wrappers over the action layer (group.member_leave / group.member_join),
// same shape as m/[handle]/actions.ts (T092) and saved-search-actions.ts (T102):
// createClient → getUser → resolveActionContext → handler → catch ActionError.
// Anon callers throw; the component handles the auth gate. Shared (not
// route-scoped) because both the /you/following page and the Group page consume
// the join/leave verbs.

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import { groupMemberLeave, groupMemberJoin, ActionError } from '@/actions'

async function requireMemberId(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('You must be signed in.')
  return data.user.id
}

export async function leaveGroupAction(input: { groupId: string }): Promise<{ ok: true }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await groupMemberLeave(ctx, { groupId: input.groupId })
    return { ok: true }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}

export async function joinGroupAction(input: { groupId: string }): Promise<{ ok: true }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await groupMemberJoin(ctx, { groupId: input.groupId })
    return { ok: true }
  } catch (err) {
    if (err instanceof ActionError) throw new Error(err.message)
    throw err
  }
}
