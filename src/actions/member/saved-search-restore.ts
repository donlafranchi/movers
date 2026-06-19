// T109 — member.saved_search.restore handler (F042 management-page Undo).
//
// Re-activates a soft-removed saved search by clearing removed_at on the SAME
// row, rather than inserting a duplicate (scenario edge case: "Re-follow after
// unfollow → re-activate, not duplicate"). The venue-follow Undo path calls this
// instead of member.saved_search.create.
//
// Owner-only: not-owner / missing collapse to NotFoundError (same privacy
// posture as member.saved_search.remove). Idempotent on an already-active row.
//
// Event: emits member.saved_search.updated — clearing removed_at IS an update to
// the row, and the event-kind CHECK (migration 019) has no dedicated
// '.restored' kind; a new kind would need a migration this surface deliberately
// avoids. The payload notes action='restored' for audit legibility.
//
// Spec: product/systems/member.md § Saved searches · ADR-21 · ADR-7 · ADR-10.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const memberSavedSearchRestoreInput = z.object({
  id: z.string().uuid(),
})

export type MemberSavedSearchRestoreInput = z.infer<typeof memberSavedSearchRestoreInput>

export const memberSavedSearchRestore = defineHandler(
  'member.saved_search.restore',
  memberSavedSearchRestoreInput,
  async (
    ctx: ActionContext,
    input: MemberSavedSearchRestoreInput,
  ): Promise<{ id: string; restored: boolean }> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error('member.saved_search.restore: actingMemberId must be resolved before invocation')
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      const cur = await client.query<{ member_id: string; removed_at: string | null }>(
        `select member_id, removed_at from public.member_saved_searches where id = $1`,
        [input.id],
      )
      if (cur.rowCount === 0) {
        throw new NotFoundError(`member.saved_search.restore: ${input.id} not found`)
      }
      const row = cur.rows[0]!
      if (row.member_id !== memberId) {
        // Collapse not-owner into NotFoundError — same posture as .remove.
        throw new NotFoundError(`member.saved_search.restore: ${input.id} not found`)
      }
      if (!row.removed_at) {
        // Already active — idempotent no-op.
        return { id: input.id, restored: false }
      }

      await client.query(
        `update public.member_saved_searches set removed_at = null where id = $1`,
        [input.id],
      )

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.saved_search.updated',
        payload: { saved_search_id: input.id, action: 'restored' },
      })

      return { id: input.id, restored: true }
    })
  },
)
