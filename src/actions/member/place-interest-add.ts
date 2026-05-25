// T062 — member.place_interest.add handler
//
// Adds a Member place-interest (primary_home or secondary). For primary_home,
// atomically demotes the prior active primary_home to secondary in the same
// transaction. For secondary, enforces the SECONDARY_LIMIT cap.
//
// Encodes ratified absolutes (ADR-21, recheck CLEAN 2026-05-23):
//   - at most one active primary_home per Member (enforced at DB via
//     uniq_primary_home_active partial unique index, and at handler via
//     the atomic swap order).
//   - secondary cap is tuneable (action-layer constant, not a DB CHECK)
//     so it can be raised without a migration.
//
// Spec: product/systems/member.md § Place-interest scope.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { ConflictError, NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const SECONDARY_LIMIT = 5

export const memberPlaceInterestAddInput = z.object({
  placeId: z.string().uuid(),
  scopeKind: z.enum(['primary_home', 'secondary']),
})

export type MemberPlaceInterestAddInput = z.infer<typeof memberPlaceInterestAddInput>

export interface MemberPlaceInterestAddResult {
  memberId: string
  placeId: string
  scopeKind: 'primary_home' | 'secondary'
  demotedPlaceId: string | null
}

export const memberPlaceInterestAdd = defineHandler(
  'member.place_interest.add',
  memberPlaceInterestAddInput,
  async (
    ctx: ActionContext,
    input: MemberPlaceInterestAddInput,
  ): Promise<MemberPlaceInterestAddResult> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error(
        'member.place_interest.add: actingMemberId must be resolved before invocation',
      )
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      // Verify the place exists and is not soft-deleted before any write.
      const placeRes = await client.query<{ id: string }>(
        `select id from public.places
         where id = $1 and deleted_at is null`,
        [input.placeId],
      )
      if (placeRes.rowCount === 0) {
        throw new NotFoundError(
          `member.place_interest.add: place ${input.placeId} not found or deleted`,
        )
      }

      let demotedPlaceId: string | null = null

      if (input.scopeKind === 'primary_home') {
        // Atomic swap: demote any existing active primary_home to secondary
        // BEFORE inserting the new one. Without DEFERRABLE on the partial
        // unique index, the order matters — Postgres validates row-by-row.
        const demoteRes = await client.query<{ place_id: string }>(
          `update public.member_place_interests
              set scope_kind = 'secondary'
            where member_id = $1
              and scope_kind = 'primary_home'
              and removed_at is null
            returning place_id`,
          [memberId],
        )
        if (demoteRes.rowCount && demoteRes.rowCount > 0) {
          demotedPlaceId = demoteRes.rows[0].place_id
        }
      } else {
        // Secondary cap. Soft-tuneable; raise SECONDARY_LIMIT without a
        // migration. Counts active secondaries only.
        const countRes = await client.query<{ n: string }>(
          `select count(*)::text as n from public.member_place_interests
            where member_id = $1
              and scope_kind = 'secondary'
              and removed_at is null`,
          [memberId],
        )
        const active = Number(countRes.rows[0]?.n ?? '0')
        if (active >= SECONDARY_LIMIT) {
          throw new ConflictError(
            'member.place_interest.secondary_limit_exceeded',
            { limit: SECONDARY_LIMIT, active },
          )
        }
      }

      // Insert (or revive — resurrect on re-add after soft-remove via
      // ON CONFLICT update, restoring created_at and clearing removed_at).
      await client.query(
        `insert into public.member_place_interests
           (member_id, place_id, scope_kind, created_at, removed_at)
         values ($1, $2, $3, now(), null)
         on conflict (member_id, place_id, scope_kind)
         do update set removed_at = null, created_at = now()`,
        [memberId, input.placeId, input.scopeKind],
      )

      if (demotedPlaceId) {
        await appendEvent(txCtx, 'member_events', {
          member_id: memberId,
          event_kind: 'member.place_interest_demoted',
          payload: { place_id: demotedPlaceId, from_scope: 'primary_home', to_scope: 'secondary' },
        })
      }

      const addedEventKind = demotedPlaceId
        ? 'member.place_interest_promoted'
        : 'member.place_interest_added'

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: addedEventKind,
        payload: { place_id: input.placeId, scope_kind: input.scopeKind },
      })

      return {
        memberId,
        placeId: input.placeId,
        scopeKind: input.scopeKind,
        demotedPlaceId,
      }
    })
  },
)
