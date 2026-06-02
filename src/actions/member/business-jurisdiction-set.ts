// T075 — member.business_jurisdiction.set handler (Tier 0, self-attested)
// Source: development/tickets/T075-* § Action handlers
// Spec:   product/systems/business-jurisdiction.md § Action handlers /
//         § Data model implications · action-layer.md § same-transaction row+event invariant
//
// Sets (first-set OR update via soft-replace) the active jurisdiction row for
// the (acting Member, business Group) pair. Update folds into set: the prior
// active row is soft-deleted and a fresh self_attested row is inserted, so the
// audit chain survives in the historical row (per spec § Soft delete). A
// separate .update handler would duplicate this validation + transaction shape.
//
// Encodes ratified absolutes:
//   - business-jurisdiction.md:109 (Ratified 2026-05-23) — Tier 1 is
//     community-attestation; this handler only ever writes 'self_attested'.
//   - ADR-21 — member_business_jurisdictions is the first locality signal at b1.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { AuthorizationError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const memberBusinessJurisdictionSetInput = z.object({
  groupId: z.string().uuid(),
  zip: z.string().regex(/^[0-9]{5}$/),
  state: z.string().regex(/^[A-Z]{2}$/).optional(),
  legalEntityName: z.string().min(1).max(200).optional(),
})

export type MemberBusinessJurisdictionSetInput = z.infer<
  typeof memberBusinessJurisdictionSetInput
>

export interface MemberBusinessJurisdictionSetResult {
  memberId: string
  groupId: string
  zip: string
  verificationSource: 'self_attested'
  replacedPriorZip: string | null
}

export const memberBusinessJurisdictionSet = defineHandler(
  'member.business_jurisdiction.set',
  memberBusinessJurisdictionSetInput,
  async (
    ctx: ActionContext,
    input: MemberBusinessJurisdictionSetInput,
  ): Promise<MemberBusinessJurisdictionSetResult> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error(
        'member.business_jurisdiction.set: actingMemberId must be resolved before invocation',
      )
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      // Caller must be an active owner-role member of a kind='business' Group.
      // group_memberships soft-delete column is left_at (per 014_groups.sql).
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
          `member.business_jurisdiction.set: member ${memberId} is not an active owner of business group ${input.groupId}`,
        )
      }

      // Soft-replace: retire the prior active row (capture its diff fields),
      // then insert a fresh self_attested row. The active-row partial unique
      // index guarantees at most one active row per (member, group).
      const priorRes = await client.query<{ zip: string; verification_source: string }>(
        `update public.member_business_jurisdictions
            set removed_at = now(), updated_at = now()
          where member_id = $1
            and group_id = $2
            and removed_at is null
          returning zip, verification_source`,
        [memberId, input.groupId],
      )
      const oldZip = priorRes.rows[0]?.zip ?? null
      const oldSource = priorRes.rows[0]?.verification_source ?? null

      await client.query(
        `insert into public.member_business_jurisdictions
           (member_id, group_id, zip, state, legal_entity_name, verification_source, verified_at)
         values ($1, $2, $3, $4, $5, 'self_attested', null)`,
        [
          memberId,
          input.groupId,
          input.zip,
          input.state ?? null,
          input.legalEntityName ?? null,
        ],
      )

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.business_jurisdiction_set',
        payload: {
          group_id: input.groupId,
          old_zip: oldZip,
          new_zip: input.zip,
          old_source: oldSource,
          new_source: 'self_attested',
        },
      })

      return {
        memberId,
        groupId: input.groupId,
        zip: input.zip,
        verificationSource: 'self_attested',
        replacedPriorZip: oldZip,
      }
    })
  },
)
