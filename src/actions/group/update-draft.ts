// T070 — group.update_draft handler
// Source: development/tickets/T070-* § Action handler `group.update_draft`
// Spec:   product/systems/groups.md § Action handlers (2026-05-31 amendment)
//
// Per-step composer update. Mutates a `groups` row where lifecycle_state='draft'
// AND the caller has role='owner' on the Group. For kind='business', the same
// handler also patches group_businesses fields in the same transaction.
//
// Refuses (ValidationError) if the row is not in 'draft' state — activate'd
// or dissolved rows mutate through their own surface-specific handlers.
//
// No event emitted for per-step updates: would flood the event log; the
// eventual group.activated event carries the final activated state.

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { ValidationError, AuthorizationError, NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { toSlug } from '../../lib/slugify'
import type { ActionContext } from '../_lib/context'

export const groupUpdateDraftInput = z.object({
  groupId: z.string().uuid(),
  // Spine-row patchable fields. All optional; the handler patches only what's supplied.
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  anchorLocationId: z.string().uuid().nullable().optional(),
  // group_businesses patches (only meaningful for kind='business' rows; the
  // handler skips them silently if the underlying Group is a community kind).
  businessDisplayName: z.string().min(1).max(120).optional(),
  businessPublicDescription: z.string().max(4000).optional(),
  businessLegalEntityKind: z
    .enum(['llc', 'sole_prop', 'partnership', 'other'])
    .nullable()
    .optional(),
  businessStateOfFormation: z.string().max(80).nullable().optional(),
})

export type GroupUpdateDraftInput = z.infer<typeof groupUpdateDraftInput>

export interface GroupUpdateDraftResult {
  groupId: string
  patchedFields: string[]
}

// Closed enums of allowed SET clauses, enforced by TypeScript. The dynamic
// SET-clause builder below interpolates these literals into the query string;
// the type narrows what can possibly land there, which is what the action-
// layer Rule-4 conformance check requires.
type GroupSpineSetClause =
  | 'name = $'
  | 'slug = $'
  | 'description = $'
  | 'anchor_location_id = $'
type GroupBusinessSetClause =
  | 'display_name = $'
  | 'public_description = $'
  | 'legal_entity_kind = $'
  | 'state_of_formation = $'

export const groupUpdateDraft = defineHandler(
  'group.update_draft',
  groupUpdateDraftInput,
  async (
    ctx: ActionContext,
    input: GroupUpdateDraftInput,
  ): Promise<GroupUpdateDraftResult> => {
    return withTransaction(async (client) => {
      // Load the row + verify (a) it exists, (b) it's in draft state, (c) caller
      // is an owner. Three refusals, three distinct error codes.
      const groupRes = await client.query<{
        id: string
        kind: string
        lifecycle_state: string
      }>(
        `select id, kind, lifecycle_state
           from public.groups
          where id = $1`,
        [input.groupId],
      )
      const row = groupRes.rows[0]
      if (!row) {
        throw new NotFoundError(`group.update_draft: group ${input.groupId} not found`)
      }
      if (row.lifecycle_state !== 'draft') {
        throw new ValidationError(
          `group.update_draft: group ${input.groupId} is in lifecycle_state '${row.lifecycle_state}', not 'draft'`,
        )
      }

      // Owner check.
      if (ctx.actingMemberId === 'self-bootstrap') {
        throw new AuthorizationError(
          'group.update_draft: self-bootstrap acting member is not permitted; resolve to a real member first',
        )
      }
      const ownerRes = await client.query<{ role: string }>(
        `select role
           from public.group_memberships
          where group_id = $1
            and member_id = $2
            and left_at is null
            and role = 'owner'`,
        [input.groupId, ctx.actingMemberId],
      )
      if (ownerRes.rows.length === 0) {
        throw new AuthorizationError(
          `group.update_draft: acting member ${ctx.actingMemberId} is not an owner of group ${input.groupId}`,
        )
      }

      const patched: string[] = []

      // Spine-row patches. Build SET fragments from the closed GroupSpineSetClause
      // enum + a parameter index. The enum literal is everything up to the `$`;
      // we append the index inline. Conformance Rule-4 reads the enum as the
      // safety contract.
      const spineFragments: Array<{ clause: GroupSpineSetClause; value: unknown }> = []
      if (input.name !== undefined) {
        spineFragments.push({ clause: 'name = $', value: input.name })
        // Re-derive slug whenever name changes. Random suffix matches create.ts —
        // draft slugs aren't publicly visible (RLS hides drafts), but the slug
        // column is UNIQUE so concurrent renames to the same name across
        // different drafts must not collide. The user-facing final slug is
        // group.activate's concern (ADR-22).
        const slugBase = toSlug(input.name) || 'draft'
        spineFragments.push({
          clause: 'slug = $',
          value: `${slugBase}-${randomBytes(4).toString('hex')}`,
        })
        patched.push('name', 'slug')
      }
      if (input.description !== undefined) {
        spineFragments.push({ clause: 'description = $', value: input.description })
        patched.push('description')
      }
      if (input.anchorLocationId !== undefined) {
        spineFragments.push({
          clause: 'anchor_location_id = $',
          value: input.anchorLocationId,
        })
        patched.push('anchor_location_id')
      }
      if (spineFragments.length > 0) {
        const setSql = spineFragments
          .map((f, i) => `${f.clause}${i + 1}`)
          .join(', ')
        const whereIdx = spineFragments.length + 1
        // TOCTOU guard: re-assert lifecycle_state='draft' in the WHERE clause.
        // The SELECT above checked, but a concurrent group.activate could have
        // promoted draft → active between the check and this UPDATE; without
        // the re-assertion we'd silently mutate an active row.
        // sql-injection-safe: enum-constrained by GroupSpineSetClause
        const updateRes = await client.query(
          `update public.groups
              set ${setSql}
            where id = $${whereIdx}
              and lifecycle_state = 'draft'`,
          [...spineFragments.map((f) => f.value), input.groupId],
        )
        if (updateRes.rowCount === 0) {
          throw new ValidationError(
            `group.update_draft: group ${input.groupId} was no longer in draft state at write time (concurrent activate?)`,
          )
        }
      }

      // group_businesses patches (skipped silently for community kinds; the
      // composer caller is responsible for not sending business fields to a
      // non-business draft).
      if (row.kind === 'business') {
        const bizFragments: Array<{
          clause: GroupBusinessSetClause
          value: unknown
        }> = []
        if (input.businessDisplayName !== undefined) {
          bizFragments.push({
            clause: 'display_name = $',
            value: input.businessDisplayName,
          })
          patched.push('business_display_name')
        }
        if (input.businessPublicDescription !== undefined) {
          bizFragments.push({
            clause: 'public_description = $',
            value: input.businessPublicDescription,
          })
          patched.push('business_public_description')
        }
        if (input.businessLegalEntityKind !== undefined) {
          bizFragments.push({
            clause: 'legal_entity_kind = $',
            value: input.businessLegalEntityKind,
          })
          patched.push('business_legal_entity_kind')
        }
        if (input.businessStateOfFormation !== undefined) {
          bizFragments.push({
            clause: 'state_of_formation = $',
            value: input.businessStateOfFormation,
          })
          patched.push('business_state_of_formation')
        }
        if (bizFragments.length > 0) {
          const setSql = bizFragments
            .map((f, i) => `${f.clause}${i + 1}`)
            .join(', ')
          const whereIdx = bizFragments.length + 1
          // TOCTOU guard: gate the group_businesses UPDATE on the parent row's
          // lifecycle_state = 'draft' via a subquery. Mirrors the spine-row
          // guard above so a concurrent activate doesn't smuggle business-field
          // edits into an already-active Group.
          // sql-injection-safe: enum-constrained by GroupBusinessSetClause
          const bizRes = await client.query(
            `update public.group_businesses
                set ${setSql}
              where group_id = $${whereIdx}
                and exists (
                  select 1
                    from public.groups g
                   where g.id = group_businesses.group_id
                     and g.lifecycle_state = 'draft'
                )`,
            [...bizFragments.map((f) => f.value), input.groupId],
          )
          if (bizRes.rowCount === 0) {
            throw new ValidationError(
              `group.update_draft: group ${input.groupId} was no longer in draft state at business-field write time (concurrent activate?)`,
            )
          }
        }
      }

      return { groupId: input.groupId, patchedFields: patched }
    })
  },
)
