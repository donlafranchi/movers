// T077 — item.attach_location handler
// Source: development/tickets/T077-item-action-handlers.md § item.attach_location
// Spec:   product/systems/item.md § item_locations; ADR-10
//
// Attaches a Location to an Item (pickup point, service area, gathering venue).
// Standalone path for the edit flow (the composer's one-shot path attaches
// inside item.create). Item-owner-only. Emits item.location_attached.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import { AuthorizationError, NotFoundError } from '../_lib/errors'
import type { ActionContext } from '../_lib/context'

const SCHEDULE_KINDS = ['one_time', 'recurring', 'ongoing', 'by_appointment'] as const

export const itemAttachLocationInput = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid(),
  // Defaults to 'ongoing' in the body.
  scheduleKind: z.enum(SCHEDULE_KINDS).optional(),
})

export type ItemAttachLocationInput = z.infer<typeof itemAttachLocationInput>

export interface ItemAttachLocationResult {
  itemLocationId: string
}

export const itemAttachLocation = defineHandler(
  'item.attach_location',
  itemAttachLocationInput,
  async (
    ctx: ActionContext,
    input: ItemAttachLocationInput,
  ): Promise<ItemAttachLocationResult> => {
    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      const itemRes = await client.query<{ member_id: string }>(
        `select member_id from public.items
          where id = $1 and deleted_at is null`,
        [input.itemId],
      )
      const item = itemRes.rows[0]
      if (!item) {
        throw new NotFoundError(
          `item.attach_location: item ${input.itemId} not found`,
        )
      }
      if (item.member_id !== ctx.actingMemberId) {
        throw new AuthorizationError(
          `item.attach_location: acting member ${ctx.actingMemberId} does not own item ${input.itemId}`,
        )
      }

      const scheduleKind = input.scheduleKind ?? 'ongoing'
      const res = await client.query<{ id: string }>(
        `insert into public.item_locations (item_id, location_id, schedule_kind, status)
         values ($1, $2, $3, 'approved')
         returning id`,
        [input.itemId, input.locationId, scheduleKind],
      )
      const itemLocationId = res.rows[0]?.id
      if (!itemLocationId) {
        throw new Error('item.attach_location: insert returned no row')
      }

      await appendEvent(txCtx, 'item_events', {
        item_id: input.itemId,
        event_kind: 'item.location_attached',
        payload: {
          location_id: input.locationId,
          schedule_kind: scheduleKind,
        },
      })

      return { itemLocationId }
    })
  },
)
