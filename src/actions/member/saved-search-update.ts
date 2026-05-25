// T063 — member.saved_search.update handler
//
// Owner-check + at-least-one-filter invariant re-asserted against the
// merged final state (in case the patch nulls the last filter).

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { NotFoundError, ValidationError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const memberSavedSearchUpdateInput = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(80).optional(),
  placeId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  interestTags: z.array(z.string().min(1).max(60)).max(20).optional(),
  itemKinds: z
    .array(z.enum(['product', 'service', 'gathering', 'wonder', 'offer', 'ask', 'initiative']))
    .max(7)
    .optional(),
})

export type MemberSavedSearchUpdateInput = z.infer<typeof memberSavedSearchUpdateInput>

export const memberSavedSearchUpdate = defineHandler(
  'member.saved_search.update',
  memberSavedSearchUpdateInput,
  async (ctx: ActionContext, input: MemberSavedSearchUpdateInput): Promise<{ id: string }> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error(
        'member.saved_search.update: actingMemberId must be resolved before invocation',
      )
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      const cur = await client.query<{
        member_id: string
        label: string
        place_id: string | null
        location_id: string | null
        interest_tags: string[]
        item_kinds: string[]
        removed_at: string | null
      }>(
        `select member_id, label, place_id, location_id, interest_tags, item_kinds, removed_at
           from public.member_saved_searches
          where id = $1`,
        [input.id],
      )

      if (cur.rowCount === 0) {
        throw new NotFoundError(`member.saved_search.update: ${input.id} not found`)
      }

      const row = cur.rows[0]!
      if (row.member_id !== memberId || row.removed_at) {
        // Collapse not-owner + already-removed into NotFoundError so an
        // attacker cannot distinguish "exists but you can't touch it" from
        // "doesn't exist." Privacy posture per ADR-9 + sibling
        // place-interest-remove pattern.
        throw new NotFoundError(`member.saved_search.update: ${input.id} not found`)
      }

      // Merged final state (so we can validate at-least-one-filter against
      // what the row will actually look like after the patch lands).
      const next = {
        label: input.label ?? row.label,
        place_id: input.placeId !== undefined ? input.placeId : row.place_id,
        location_id: input.locationId !== undefined ? input.locationId : row.location_id,
        interest_tags: input.interestTags ?? row.interest_tags,
        item_kinds: input.itemKinds ?? row.item_kinds,
      }

      const hasFilter =
        Boolean(next.place_id) ||
        Boolean(next.location_id) ||
        (next.interest_tags && next.interest_tags.length > 0)
      if (!hasFilter) {
        throw new ValidationError(
          'member.saved_search.update: at least one of place_id, location_id, or non-empty interest_tags is required',
        )
      }

      await client.query(
        `update public.member_saved_searches
            set label = $2,
                place_id = $3,
                location_id = $4,
                interest_tags = $5,
                item_kinds = $6
          where id = $1`,
        [input.id, next.label, next.place_id, next.location_id, next.interest_tags, next.item_kinds],
      )

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.saved_search.updated',
        payload: { saved_search_id: input.id },
      })

      return { id: input.id }
    })
  },
)
