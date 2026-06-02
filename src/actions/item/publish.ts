// T077 — item.publish handler
// Source: development/tickets/T077-item-action-handlers.md § item.publish
// Spec:   product/systems/item.md § Key event semantics — item.published; ADR-10
//
// Promotes an Item to state='published'. Standalone path for Items created as
// draft (the composer's one-shot path publishes inside item.create). Idempotent:
// a no-op (no event) when the Item is already published. Item-owner-only.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import { AuthorizationError, NotFoundError } from '../_lib/errors'
import type { ActionContext } from '../_lib/context'

export const itemPublishInput = z.object({
  itemId: z.string().uuid(),
})

export type ItemPublishInput = z.infer<typeof itemPublishInput>

export interface ItemPublishResult {
  itemId: string
  state: 'published'
  alreadyPublished: boolean
}

export const itemPublish = defineHandler(
  'item.publish',
  itemPublishInput,
  async (ctx: ActionContext, input: ItemPublishInput): Promise<ItemPublishResult> => {
    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      const itemRes = await client.query<{ member_id: string; state: string }>(
        `select member_id, state from public.items
          where id = $1 and deleted_at is null`,
        [input.itemId],
      )
      const item = itemRes.rows[0]
      if (!item) {
        throw new NotFoundError(`item.publish: item ${input.itemId} not found`)
      }
      if (item.member_id !== ctx.actingMemberId) {
        throw new AuthorizationError(
          `item.publish: acting member ${ctx.actingMemberId} does not own item ${input.itemId}`,
        )
      }

      // Idempotent: already published → no state change, no event.
      if (item.state === 'published') {
        return { itemId: input.itemId, state: 'published', alreadyPublished: true }
      }

      await client.query(
        `update public.items set state = 'published'
          where id = $1 and state <> 'published'`,
        [input.itemId],
      )
      await appendEvent(txCtx, 'item_events', {
        item_id: input.itemId,
        event_kind: 'item.published',
        payload: { from_state: item.state },
      })

      return { itemId: input.itemId, state: 'published', alreadyPublished: false }
    })
  },
)
