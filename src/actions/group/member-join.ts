// T109 — group.member_join handler (F042 management-page Undo / re-join).
//
// The Member joins a Group on their own behalf with source='explicit' (the
// schema-level firewall against Nextdoor-style auto-enrollment, groups.md:393
// Ratified 2026-05-31). Upsert semantics mirror member.follow: a fresh join
// inserts role='member'; a re-join (Undo after Leave) revives the soft-left row
// by clearing left_at while PRESERVING the prior role — so an owner who left and
// undid does not get downgraded to member.
//
// Self-only: a Member joins themselves. Owners adding OTHER members is a separate
// roster verb (group.member_join with a target, future) — not modeled here.
//
// Spec: product/systems/groups.md § Membership · ADR-7 · ADR-10.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const groupMemberJoinInput = z.object({
  groupId: z.string().uuid(),
})

export type GroupMemberJoinInput = z.infer<typeof groupMemberJoinInput>

export interface GroupMemberJoinResult {
  groupId: string
  joined: boolean
}

export const groupMemberJoin = defineHandler(
  'group.member_join',
  groupMemberJoinInput,
  async (ctx: ActionContext, input: GroupMemberJoinInput): Promise<GroupMemberJoinResult> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error('group.member_join: actingMemberId must be resolved before invocation')
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      // Group must exist and not be dissolved — can't join a dead Group.
      const grp = await client.query<{ id: string }>(
        `select id from public.groups where id = $1 and dissolved_at is null`,
        [input.groupId],
      )
      if (grp.rowCount === 0) {
        throw new NotFoundError(`group.member_join: group ${input.groupId} not found or dissolved`)
      }

      // Upsert: fresh join inserts role='member'; re-join clears left_at and
      // keeps the existing role (do not reset on conflict).
      await client.query(
        `insert into public.group_memberships
           (group_id, member_id, role, source, joined_at, left_at)
         values ($1, $2, 'member', 'explicit', now(), null)
         on conflict (group_id, member_id)
         do update set left_at = null`,
        [input.groupId, memberId],
      )

      await appendEvent(txCtx, 'group_events', {
        group_id: input.groupId,
        event_kind: 'group.member_joined',
        payload: { member_id: memberId, source: 'explicit' },
      })

      return { groupId: input.groupId, joined: true }
    })
  },
)
