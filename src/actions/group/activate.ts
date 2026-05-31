// T070 — group.activate handler
// Source: development/tickets/T070-* § Action handler `group.activate`
// Spec:   product/systems/groups.md § Action handlers (2026-05-31 amendment);
//         product/ui/design-language.md § Multi-step composer (completion redirect)
//
// Promotes a draft Group to active. Final-step composer submit calls this.
//
// Validates kind-specific required fields before promotion (the per-step
// update_draft writes don't enforce full-Group invariants; the gate is at
// activation so partial progress can be saved mid-flow). For kind='business':
//   - group_businesses.display_name must be set (not the draft placeholder)
//   - groups.anchor_location_id must be set
//
// Emits group.activated event with acting_member_id = founder.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { ValidationError, AuthorizationError, NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'
import { DRAFT_NAME_PLACEHOLDER } from './constants'

export const groupActivateInput = z.object({
  groupId: z.string().uuid(),
})

export type GroupActivateInput = z.infer<typeof groupActivateInput>

export interface GroupActivateResult {
  groupId: string
  lifecycleState: 'active'
}

export const groupActivate = defineHandler(
  'group.activate',
  groupActivateInput,
  async (
    ctx: ActionContext,
    input: GroupActivateInput,
  ): Promise<GroupActivateResult> => {
    return withTransaction(async (client) => {
      // Resolve + verify the draft row, including founder identity.
      const groupRes = await client.query<{
        id: string
        kind: string
        lifecycle_state: string
        founder_member_id: string
        anchor_location_id: string | null
        name: string
      }>(
        `select id, kind, lifecycle_state, founder_member_id, anchor_location_id, name
           from public.groups
          where id = $1`,
        [input.groupId],
      )
      const row = groupRes.rows[0]
      if (!row) {
        throw new NotFoundError(`group.activate: group ${input.groupId} not found`)
      }
      if (row.lifecycle_state !== 'draft') {
        throw new ValidationError(
          `group.activate: group ${input.groupId} is in lifecycle_state '${row.lifecycle_state}', not 'draft'`,
        )
      }

      // Only the founder can activate a draft. Once active, ownership-management
      // is co-equal among owner-role members per groups.md:88-89; but draft
      // activation is a founder-only act because the draft is the founder's
      // half-built thing.
      if (ctx.actingMemberId === 'self-bootstrap') {
        throw new AuthorizationError(
          'group.activate: self-bootstrap acting member is not permitted',
        )
      }
      if (ctx.actingMemberId !== row.founder_member_id) {
        throw new AuthorizationError(
          `group.activate: acting member ${ctx.actingMemberId} is not the founder of group ${input.groupId}`,
        )
      }

      // Kind-specific required-field validation.
      if (row.kind === 'business') {
        if (!row.anchor_location_id) {
          throw new ValidationError(
            `group.activate: kind='business' draft ${input.groupId} requires anchor_location_id`,
          )
        }
        const bizRes = await client.query<{ display_name: string }>(
          `select display_name
             from public.group_businesses
            where group_id = $1`,
          [input.groupId],
        )
        const biz = bizRes.rows[0]
        if (!biz) {
          throw new ValidationError(
            `group.activate: kind='business' draft ${input.groupId} is missing its group_businesses row`,
          )
        }
        if (!biz.display_name || biz.display_name === DRAFT_NAME_PLACEHOLDER) {
          throw new ValidationError(
            `group.activate: kind='business' draft ${input.groupId} requires group_businesses.display_name`,
          )
        }
      } else {
        // Community kinds: name must be set (not the placeholder).
        if (!row.name || row.name === DRAFT_NAME_PLACEHOLDER) {
          throw new ValidationError(
            `group.activate: draft ${input.groupId} requires name`,
          )
        }
      }

      // Promote. The WHERE-clause re-asserts lifecycle_state='draft' to prevent
      // a TOCTOU race with a concurrent activate.
      const promoteRes = await client.query<{ id: string }>(
        `update public.groups
            set lifecycle_state = 'active'
          where id = $1
            and lifecycle_state = 'draft'
          returning id`,
        [input.groupId],
      )
      if (promoteRes.rows.length === 0) {
        throw new ValidationError(
          `group.activate: group ${input.groupId} was no longer in draft state at promotion time (concurrent activate?)`,
        )
      }

      // Event: group.activated. Same transaction as the UPDATE; per ADR-10.
      const txCtx: ActionContext = { ...ctx, db: client }
      await appendEvent(txCtx, 'group_events', {
        group_id: input.groupId,
        event_kind: 'group.activated',
        payload: {
          founder_member_id: row.founder_member_id,
          kind: row.kind,
        },
      })

      return { groupId: input.groupId, lifecycleState: 'active' }
    })
  },
)
