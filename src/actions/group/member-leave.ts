// T109 — group.member_leave handler (F042 management page).
//
// The Member leaves their OWN explicit membership in a Group. Soft-delete: sets
// left_at rather than deleting, so the membership history survives and Undo
// (group.member_join) can re-activate the same row. Idempotent — leaving an
// already-left (or nonexistent) membership is a no-op and emits no event,
// mirroring member.unfollow.
//
// Self-only: the acting Member can only leave on their own behalf. Removing
// ANOTHER member (owner roster management) is group.member_remove — out of scope
// here and deliberately not modeled by this handler.
//
// Spec: product/systems/groups.md § Membership · ADR-7 · ADR-10.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const groupMemberLeaveInput = z.object({
  groupId: z.string().uuid(),
})

export type GroupMemberLeaveInput = z.infer<typeof groupMemberLeaveInput>

export interface GroupMemberLeaveResult {
  groupId: string
  left: boolean
}

export const groupMemberLeave = defineHandler(
  'group.member_leave',
  groupMemberLeaveInput,
  async (ctx: ActionContext, input: GroupMemberLeaveInput): Promise<GroupMemberLeaveResult> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error('group.member_leave: actingMemberId must be resolved before invocation')
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      // Soft-leave the active membership. No active row → no-op (idempotent),
      // and we skip the event in that case.
      const res = await client.query(
        `update public.group_memberships
            set left_at = now()
          where group_id = $1
            and member_id = $2
            and left_at is null`,
        [input.groupId, memberId],
      )

      if (res.rowCount && res.rowCount > 0) {
        await appendEvent(txCtx, 'group_events', {
          group_id: input.groupId,
          event_kind: 'group.member_left',
          payload: { member_id: memberId },
        })
      }

      return { groupId: input.groupId, left: true }
    })
  },
)
