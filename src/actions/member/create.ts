// T043 — member.create handler (proof of pattern)
// Source: development/tickets/done/T043-*
//
// The first action-layer handler. Establishes the contract every future
// handler conforms to:
//   1. Zod input validation (in defineHandler).
//   2. Pure derivation (handle, display_name).
//   3. Transaction wrapper (withTransaction).
//   4. Insert primary row.
//   5. Resolve 'self-bootstrap' actingMemberId → newMember.id.
//   6. Append event row with audit fields injected.
//   7. Return concise result.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { ConflictError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import {
  deriveHandleFromEmail,
  deriveDisplayNameFromEmail,
  suffixedHandle,
  MAX_HANDLE_COLLISION_SUFFIX,
} from '../_lib/handle-derivation'
import type { ActionContext } from '../_lib/context'

export const memberCreateInput = z.object({
  authUserId: z.string().uuid(),
  email: z.string().email(),
  handleSuggestion: z
    .string()
    .min(4)
    .max(30)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  displayName: z.string().min(1).max(60).optional(),
})

export type MemberCreateInput = z.infer<typeof memberCreateInput>

export interface MemberCreateResult {
  memberId: string
  handle: string
}

export const memberCreate = defineHandler(
  'member.create',
  memberCreateInput,
  async (ctx: ActionContext, input: MemberCreateInput): Promise<MemberCreateResult> => {
    const baseHandle = input.handleSuggestion ?? deriveHandleFromEmail(input.email)
    const displayName = input.displayName ?? deriveDisplayNameFromEmail(input.email)

    return withTransaction(async (client) => {
      // The withTransaction wrapper opens a client + BEGIN. The caller's
      // body uses *that* client for all writes. We swap the ctx.db to the
      // transaction-bound client for downstream helpers (appendEvent).
      const txCtx: ActionContext = { ...ctx, db: client }

      // Resolve handle collision by trying base, base-2, base-3, ... up to
      // base-99. Each attempt is a single INSERT; the unique constraint on
      // members.handle raises 23505 on collision. We catch and retry.
      //
      // SAVEPOINT discipline (load-bearing — Postgres semantics):
      // A constraint failure inside the outer BEGIN aborts the transaction;
      // every subsequent statement then raises 25P02 ("current transaction is
      // aborted, commands ignored until end of transaction block"). To retry
      // inside the same transaction we wrap each INSERT attempt in a
      // SAVEPOINT — on 23505 we ROLLBACK TO SAVEPOINT and try the next
      // suffix; on success we RELEASE the SAVEPOINT and continue. Without
      // this, the retry loop dies on the second attempt regardless of which
      // suffix the catch block computed.
      let chosenHandle = baseHandle
      let attempt = 1
      let memberId: string | null = null
      // SAVEPOINT name is inlined as a literal — Postgres doesn't accept
      // parameterized identifiers, and template interpolation here would
      // trip T051 Rule 4 (parameterized-query check) even though the name
      // is a compile-time constant. Literal-only keeps the conformance
      // check quiet without an annotation.

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await client.query('savepoint member_create_handle_attempt')
        try {
          const insertRes = await client.query<{ id: string }>(
            `insert into public.members
               (id, handle, display_name)
             values ($1, $2, $3)
             returning id`,
            [input.authUserId, chosenHandle, displayName],
          )
          await client.query('release savepoint member_create_handle_attempt')
          memberId = insertRes.rows[0]?.id ?? null
          break
        } catch (err: unknown) {
          // Rewind to a clean point on every failure — the catch path below
          // decides whether to retry (collision) or rethrow (any other).
          await client.query('rollback to savepoint member_create_handle_attempt')
          const code = (err as { code?: string })?.code
          const constraint = (err as { constraint?: string })?.constraint
          // 23505 = unique_violation. If the handle is the collision, try a suffix.
          if (code === '23505' && constraint?.includes('handle')) {
            attempt += 1
            if (attempt > MAX_HANDLE_COLLISION_SUFFIX) {
              throw new ConflictError(
                `member.create: exhausted handle collision suffixes for base '${baseHandle}'`,
              )
            }
            chosenHandle = suffixedHandle(baseHandle, attempt)
            continue
          }
          // If the collision is on `id` (the auth user id), treat it as a
          // duplicate signup. Return ConflictError so the route can map to 409.
          if (code === '23505' && (constraint?.includes('pkey') || constraint === 'members_pkey')) {
            throw new ConflictError(
              `member.create: a Member already exists for auth user ${input.authUserId}`,
            )
          }
          throw err
        }
      }

      if (!memberId) {
        // Defensive — the insert path should always set memberId or throw.
        throw new Error('member.create: insert succeeded but returned no id')
      }

      // Resolve the self-bootstrap acting member to the new member id BEFORE
      // appendEvent. The injector throws if we leave it as the sentinel.
      const resolvedCtx: ActionContext = {
        ...txCtx,
        actingMemberId:
          txCtx.actingMemberId === 'self-bootstrap' ? memberId : txCtx.actingMemberId,
      }

      await appendEvent(resolvedCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.created',
        payload: {
          handle: chosenHandle,
          display_name: displayName,
          source: 'auth_signup',
        },
      })

      return { memberId, handle: chosenHandle }
    })
  },
)
