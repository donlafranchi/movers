// T086 — member.interests.add handler
//
// Adds controlled-vocabulary interest tags to a Member. Idempotent: tags the
// Member already holds are skipped (ON CONFLICT DO NOTHING) and produce no
// event. One member.interest_added event per newly inserted tag, in the same
// transaction as the row (ADR-7 row+event invariant).
//
// Vocabulary validation lives in the action handler, not the schema, mirroring
// member_interests.tag (migration 010). The zod shape enforces the same
// lowercase/hyphen/length CHECK the table carries.
//
// Spec: product/systems/member.md § Interests.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

const tag = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, 'tag must be lowercase alphanumeric or hyphen')

export const memberInterestsAddInput = z.object({
  tags: z.array(tag).min(1).max(20),
})

export type MemberInterestsAddInput = z.infer<typeof memberInterestsAddInput>

export interface MemberInterestsAddResult {
  memberId: string
  addedTags: string[]
}

export const memberInterestsAdd = defineHandler(
  'member.interests.add',
  memberInterestsAddInput,
  async (
    ctx: ActionContext,
    input: MemberInterestsAddInput,
  ): Promise<MemberInterestsAddResult> => {
    const memberId = ctx.actingMemberId
    if (memberId === 'self-bootstrap') {
      throw new Error(
        'member.interests.add: actingMemberId must be resolved before invocation',
      )
    }

    // De-dupe within the request so a repeated tag can't double-emit.
    const tags = Array.from(new Set(input.tags))

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }
      const addedTags: string[] = []

      for (const t of tags) {
        const res = await client.query<{ tag: string }>(
          `insert into public.member_interests (member_id, tag, created_at)
           values ($1, $2, now())
           on conflict (member_id, tag) do nothing
           returning tag`,
          [memberId, t],
        )
        if (res.rowCount && res.rowCount > 0) {
          addedTags.push(t)
          await appendEvent(txCtx, 'member_events', {
            member_id: memberId,
            event_kind: 'member.interest_added',
            payload: { tag: t },
          })
        }
      }

      return { memberId, addedTags }
    })
  },
)
