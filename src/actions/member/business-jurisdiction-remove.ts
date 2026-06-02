// T075 — member.business_jurisdiction.remove handler
// Source: development/tickets/T075-* § Action handlers
// Spec:   product/systems/business-jurisdiction.md § Action handlers / § Soft delete
//
// Soft-deletes the active jurisdiction row for the (acting Member, business
// Group) pair. The Group's "local" claim drops if this was the only qualifying
// jurisdiction across its owners. Historical rows preserve the audit chain.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { AuthorizationError, NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const memberBusinessJurisdictionRemoveInput = z.object({
  groupId: z.string().uuid(),
})

export type MemberBusinessJurisdictionRemoveInput = z.infer<
  typeof memberBusinessJurisdictionRemoveInput
>

export interface MemberBusinessJurisdictionRemoveResult {
  memberId: string
  groupId: string
  removedZip: string
}

export const memberBusinessJurisdictionRemove = defineHandler(
  'member.business_jurisdiction.remove',
  memberBusinessJurisdictionRemoveInput,
  async (
    ctx: ActionContext,
    input: MemberBusinessJurisdictionRemoveInput,
  ): Promise<MemberBusinessJurisdictionRemoveResult> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error(
        'member.business_jurisdiction.remove: actingMemberId must be resolved before invocation',
      )
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      // Owner-role gate (authorization precedes existence).
      const ownerRes = await client.query<{ role: string }>(
        `select gm.role
           from public.group_memberships gm
           join public.groups g on g.id = gm.group_id
          where gm.group_id = $1
            and gm.member_id = $2
            and gm.left_at is null
            and gm.role = 'owner'
            and g.kind = 'business'`,
        [input.groupId, memberId],
      )
      if (ownerRes.rowCount === 0) {
        throw new AuthorizationError(
          `member.business_jurisdiction.remove: member ${memberId} is not an active owner of business group ${input.groupId}`,
        )
      }

      const removedRes = await client.query<{ zip: string }>(
        `update public.member_business_jurisdictions
            set removed_at = now(), updated_at = now()
          where member_id = $1
            and group_id = $2
            and removed_at is null
          returning zip`,
        [memberId, input.groupId],
      )
      if (removedRes.rowCount === 0) {
        throw new NotFoundError(
          `member.business_jurisdiction.remove: no active jurisdiction for member ${memberId} on group ${input.groupId}`,
        )
      }

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.business_jurisdiction_removed',
        payload: {
          group_id: input.groupId,
          zip: removedRes.rows[0].zip,
        },
      })

      return {
        memberId,
        groupId: input.groupId,
        removedZip: removedRes.rows[0].zip,
      }
    })
  },
)
