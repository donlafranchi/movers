// T063 — member.saved_search.remove handler
//
// Soft-remove. Idempotent on already-removed rows (no event re-emit).

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const memberSavedSearchRemoveInput = z.object({
  id: z.string().uuid(),
})

export type MemberSavedSearchRemoveInput = z.infer<typeof memberSavedSearchRemoveInput>

export const memberSavedSearchRemove = defineHandler(
  'member.saved_search.remove',
  memberSavedSearchRemoveInput,
  async (
    ctx: ActionContext,
    input: MemberSavedSearchRemoveInput,
  ): Promise<{ id: string; removed: boolean }> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error(
        'member.saved_search.remove: actingMemberId must be resolved before invocation',
      )
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      const cur = await client.query<{ member_id: string; removed_at: string | null }>(
        `select member_id, removed_at from public.member_saved_searches where id = $1`,
        [input.id],
      )
      if (cur.rowCount === 0) {
        throw new NotFoundError(`member.saved_search.remove: ${input.id} not found`)
      }
      const row = cur.rows[0]!
      if (row.member_id !== memberId) {
        // Collapse not-owner into NotFoundError so an attacker cannot
        // distinguish "exists but you can't touch it" from "doesn't exist."
        // Privacy posture per ADR-9 + sibling place-interest-remove pattern.
        throw new NotFoundError(`member.saved_search.remove: ${input.id} not found`)
      }
      if (row.removed_at) {
        // Idempotent — already-removed by the owner is a no-op, distinct
        // from not-owner / missing (which throw above).
        return { id: input.id, removed: false }
      }

      await client.query(
        `update public.member_saved_searches set removed_at = now() where id = $1`,
        [input.id],
      )

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.saved_search.removed',
        payload: { saved_search_id: input.id },
      })

      return { id: input.id, removed: true }
    })
  },
)
