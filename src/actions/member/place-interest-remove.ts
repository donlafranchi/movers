// T062 — member.place_interest.remove handler
//
// Soft-removes a Member place-interest. Idempotent on already-removed rows
// (no event emitted on the no-op path).
//
// Spec: product/systems/member.md § Place-interest scope.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const memberPlaceInterestRemoveInput = z.object({
  placeId: z.string().uuid(),
  scopeKind: z.enum(['primary_home', 'secondary']),
})

export type MemberPlaceInterestRemoveInput = z.infer<typeof memberPlaceInterestRemoveInput>

export interface MemberPlaceInterestRemoveResult {
  memberId: string
  placeId: string
  scopeKind: 'primary_home' | 'secondary'
  removed: boolean // false if it was already removed (no event emitted)
}

export const memberPlaceInterestRemove = defineHandler(
  'member.place_interest.remove',
  memberPlaceInterestRemoveInput,
  async (
    ctx: ActionContext,
    input: MemberPlaceInterestRemoveInput,
  ): Promise<MemberPlaceInterestRemoveResult> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error(
        'member.place_interest.remove: actingMemberId must be resolved before invocation',
      )
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      const updateRes = await client.query<{ removed_at: string | null }>(
        `update public.member_place_interests
            set removed_at = now()
          where member_id = $1
            and place_id = $2
            and scope_kind = $3
            and removed_at is null
          returning removed_at`,
        [memberId, input.placeId, input.scopeKind],
      )

      if (updateRes.rowCount === 0) {
        // Row doesn't exist at all, OR already removed. Distinguish so we
        // don't 404 on idempotent re-remove.
        const existsRes = await client.query<{ removed_at: string | null }>(
          `select removed_at from public.member_place_interests
            where member_id = $1 and place_id = $2 and scope_kind = $3`,
          [memberId, input.placeId, input.scopeKind],
        )
        if (existsRes.rowCount === 0) {
          throw new NotFoundError(
            'member.place_interest.remove: no such place-interest',
          )
        }
        // Already removed — idempotent no-op, no event.
        return {
          memberId,
          placeId: input.placeId,
          scopeKind: input.scopeKind,
          removed: false,
        }
      }

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.place_interest_removed',
        payload: { place_id: input.placeId, scope_kind: input.scopeKind },
      })

      return {
        memberId,
        placeId: input.placeId,
        scopeKind: input.scopeKind,
        removed: true,
      }
    })
  },
)
