// T063 — member.saved_search.create handler
//
// Spec: product/systems/member.md § Saved searches. ADR-21.
//
// Enforces the at_least_one_filter invariant at the action layer (fail-fast
// before the DB CHECK rejects it). The DB CHECK is the load-bearing copy;
// this is the fast-feedback copy.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const memberSavedSearchCreateInput = z
  .object({
    label: z.string().min(1).max(80),
    placeId: z.string().uuid().nullable().optional(),
    locationId: z.string().uuid().nullable().optional(),
    interestTags: z.array(z.string().min(1).max(60)).max(20).optional(),
    itemKinds: z
      .array(z.enum(['product', 'service', 'gathering', 'wonder', 'offer', 'ask', 'initiative']))
      .max(7)
      .optional(),
  })
  .refine(
    (v) =>
      Boolean(v.placeId) ||
      Boolean(v.locationId) ||
      (v.interestTags && v.interestTags.length > 0),
    {
      message:
        'member.saved_search.create: at least one of placeId, locationId, or non-empty interestTags is required',
      path: ['at_least_one_filter'],
    },
  )

export type MemberSavedSearchCreateInput = z.infer<typeof memberSavedSearchCreateInput>

export interface MemberSavedSearchCreateResult {
  savedSearchId: string
}

export const memberSavedSearchCreate = defineHandler(
  'member.saved_search.create',
  memberSavedSearchCreateInput,
  async (
    ctx: ActionContext,
    input: MemberSavedSearchCreateInput,
  ): Promise<MemberSavedSearchCreateResult> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error(
        'member.saved_search.create: actingMemberId must be resolved before invocation',
      )
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      const insertRes = await client.query<{ id: string }>(
        `insert into public.member_saved_searches
           (member_id, label, place_id, location_id, interest_tags, item_kinds)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          memberId,
          input.label,
          input.placeId ?? null,
          input.locationId ?? null,
          input.interestTags ?? [],
          input.itemKinds ?? [],
        ],
      )

      // RETURNING id guarantees a row; insertRes.rows[0]!.id is safe.
      const savedSearchId = insertRes.rows[0]!.id

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.saved_search.created',
        payload: { saved_search_id: savedSearchId, label: input.label },
      })

      return { savedSearchId }
    })
  },
)
