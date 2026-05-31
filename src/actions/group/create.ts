// T070 — group.create handler
// Source: development/tickets/T070-* § Action handler `group.create`
// Spec:   product/systems/groups.md § Action handlers (2026-05-31 amendment);
//         product/ui/design-language.md § Multi-step composer (the draft-state contract)
//
// Creates a `groups` row with lifecycle_state='draft' + a founder
// group_memberships row with role='owner', source='explicit', + a
// group.created event — all in one transaction (ADR-10 same-transaction
// invariant; groups.md § 365 ratified source='explicit').
//
// For kind='business', also creates the companion group_businesses row
// with display_name (or an empty placeholder if the composer hasn't reached
// that step yet) in the same transaction. update_draft can mutate
// display_name + other group_businesses fields step-by-step.

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import { toSlug } from '../../lib/slugify'
import type { ActionContext } from '../_lib/context'
import { GROUP_KINDS, DRAFT_NAME_PLACEHOLDER } from './constants'

export const groupCreateInput = z.object({
  kind: z.enum(GROUP_KINDS),
  founderMemberId: z.string().uuid(),
  // `name` is required at draft time only when kind != 'business' (community
  // kinds carry name on the spine). For kind='business', the name shadows the
  // group_businesses.display_name, which the composer fills at step 1; we
  // accept a placeholder here and rely on update_draft to populate it.
  name: z.string().min(1).max(120).optional(),
  // For business kind, the composer's step-1 brand-name flow may pre-populate.
  businessDisplayName: z.string().min(1).max(120).optional(),
  // Optional at draft creation; update_draft can patch these later.
  anchorLocationId: z.string().uuid().optional(),
  description: z.string().max(2000).optional(),
})

export type GroupCreateInput = z.infer<typeof groupCreateInput>

export interface GroupCreateResult {
  groupId: string
  slug: string
  lifecycleState: 'draft'
}

export const groupCreate = defineHandler(
  'group.create',
  groupCreateInput,
  async (ctx: ActionContext, input: GroupCreateInput): Promise<GroupCreateResult> => {
    // For business kind, prefer the composer's step-1 brand name; fall back to
    // `name` if supplied; fall back to a placeholder otherwise. update_draft
    // overrides on subsequent step submits.
    const effectiveName =
      input.kind === 'business'
        ? input.businessDisplayName ?? input.name ?? DRAFT_NAME_PLACEHOLDER
        : input.name ?? DRAFT_NAME_PLACEHOLDER

    // Slug is derived at create time so the draft row satisfies the NOT NULL
    // + UNIQUE constraint. Draft slugs are not publicly addressable (RLS hides
    // drafts), so the user-visible slug shape is irrelevant here — what matters
    // is collision avoidance. Two Members opening the Sell walkthrough with
    // the same brand name simultaneously must not deadlock or 23505 each other.
    // We append a short random hex suffix at draft time; update_draft re-derives
    // (also with suffix) on rename. The "clean" final slug per ADR-22 is the
    // ticket-writer concern for group.activate (a future patch) — not this
    // handler's responsibility.
    const slugBase = toSlug(effectiveName) || 'draft'
    const baseSlug = `${slugBase}-${randomBytes(4).toString('hex')}`

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      // Insert the spine row. lifecycle_state='draft' explicitly (default is
      // 'active', which would skip the composer's curation step).
      const groupRes = await client.query<{ id: string; slug: string }>(
        `insert into public.groups
           (kind, founder_member_id, name, slug, description, lifecycle_state)
         values ($1, $2, $3, $4, $5, 'draft')
         returning id, slug`,
        [
          input.kind,
          input.founderMemberId,
          effectiveName,
          baseSlug,
          input.description ?? '',
        ],
      )
      const row = groupRes.rows[0]
      if (!row) {
        throw new Error('group.create: insert returned no row')
      }
      const groupId = row.id
      const insertedSlug = row.slug

      // For kind='business', mirror display_name into group_businesses so the
      // discovery + brand-resolve-up paths work the moment the row activates.
      if (input.kind === 'business') {
        await client.query(
          `insert into public.group_businesses (group_id, display_name)
           values ($1, $2)`,
          [groupId, effectiveName],
        )
      }

      // Optional anchor at create time (composer step 2 normally writes via
      // update_draft, but pre-population is supported for callers that have
      // the Location ready).
      if (input.anchorLocationId) {
        await client.query(
          `update public.groups
              set anchor_location_id = $1
            where id = $2`,
          [input.anchorLocationId, groupId],
        )
      }

      // Founder membership: role='owner', source='explicit' per groups.md:365
      // (Intent Ratified 2026-05-31 — Member opted in by invoking the
      // composer; source='explicit' is the schema-level firewall against
      // Nextdoor-style auto-enrollment).
      await client.query(
        `insert into public.group_memberships
           (group_id, member_id, role, source)
         values ($1, $2, 'owner', 'explicit')`,
        [groupId, input.founderMemberId],
      )

      // Event: group.created. Per groups.md 2026-05-31 amendment, this fires
      // on draft creation; group.activated fires later on draft → active
      // promotion. The two events together let consumers reconstruct
      // "Group was set up over the course of N minutes / hours" timing.
      await appendEvent(txCtx, 'group_events', {
        group_id: groupId,
        event_kind: 'group.created',
        payload: {
          kind: input.kind,
          founder_member_id: input.founderMemberId,
          lifecycle_state: 'draft',
        },
      })

      // Event: group.member_joined for the founder's owner-role membership.
      // Same transaction as the membership insert; satisfies the scenario's
      // "in one transaction" Then-clause for F036 Beat 2.
      await appendEvent(txCtx, 'group_events', {
        group_id: groupId,
        event_kind: 'group.member_joined',
        payload: {
          member_id: input.founderMemberId,
          role: 'owner',
          source: 'explicit',
        },
      })

      return { groupId, slug: insertedSlug, lifecycleState: 'draft' }
    })
  },
)
