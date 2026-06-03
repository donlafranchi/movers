// T091 — member.follow / member.unfollow handlers (F032).
//
// The write side of Loop 8. member_follows is member→member, public-by-default
// (T048 / 010_member_interests_follows.sql). Unfollow is SOFT — sets
// unfollowed_at rather than deleting, so "you previously followed X" surfaces
// keep working. Re-follow revives the soft-unfollowed row (created_at preserved).
//
// Guards (self-follow, sentinel) run BEFORE withTransaction so they're
// unit-testable without a DB and fail cheaply. The DB CHECK
// (follower_member_id <> followed_member_id) is the backstop.
//
// Spec: product/systems/member.md § Follows substrate · ADR-7 · ADR-10.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { ValidationError, NotFoundError } from '../_lib/errors'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import type { ActionContext } from '../_lib/context'

export const memberFollowInput = z.object({
  followedMemberId: z.string().uuid(),
})

export type MemberFollowInput = z.infer<typeof memberFollowInput>

export interface MemberFollowResult {
  followerMemberId: string
  followedMemberId: string
  following: boolean
}

function assertResolved(ctx: ActionContext, name: string): string {
  const memberId = ctx.actingMemberId
  if (memberId === 'self-bootstrap') {
    throw new Error(`${name}: actingMemberId must be resolved before invocation`)
  }
  return memberId
}

async function assertTargetExists(
  client: { query: ActionContext['db']['query'] },
  followedMemberId: string,
  name: string,
): Promise<void> {
  // RLS does not apply on the action-layer pool client (it connects as the
  // service role), so filter soft-deleted explicitly.
  const res = await client.query<{ id: string }>(
    `select id from public.members
      where id = $1 and deleted_at is null`,
    [followedMemberId],
  )
  if (res.rowCount === 0) {
    throw new NotFoundError(`${name}: member ${followedMemberId} not found or deleted`)
  }
}

export const memberFollow = defineHandler(
  'member.follow',
  memberFollowInput,
  async (ctx: ActionContext, input: MemberFollowInput): Promise<MemberFollowResult> => {
    const memberId = assertResolved(ctx, 'member.follow')
    if (input.followedMemberId === memberId) {
      throw new ValidationError('member.follow: cannot follow yourself', {
        followedMemberId: ['self_follow_not_allowed'],
      })
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }
      await assertTargetExists(client, input.followedMemberId, 'member.follow')

      // Upsert: a fresh follow inserts; a re-follow revives the soft-unfollowed
      // row (clear unfollowed_at; keep the original created_at).
      await client.query(
        `insert into public.member_follows
           (follower_member_id, followed_member_id, created_at, unfollowed_at)
         values ($1, $2, now(), null)
         on conflict (follower_member_id, followed_member_id)
         do update set unfollowed_at = null`,
        [memberId, input.followedMemberId],
      )

      await appendEvent(txCtx, 'member_events', {
        member_id: memberId,
        event_kind: 'member.followed',
        payload: { followed_member_id: input.followedMemberId },
      })

      return {
        followerMemberId: memberId,
        followedMemberId: input.followedMemberId,
        following: true,
      }
    })
  },
)

export const memberUnfollow = defineHandler(
  'member.unfollow',
  memberFollowInput,
  async (ctx: ActionContext, input: MemberFollowInput): Promise<MemberFollowResult> => {
    const memberId = assertResolved(ctx, 'member.unfollow')
    if (input.followedMemberId === memberId) {
      throw new ValidationError('member.unfollow: cannot unfollow yourself', {
        followedMemberId: ['self_follow_not_allowed'],
      })
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      // Soft-unfollow: stamp unfollowed_at on the active row. No row / already
      // unfollowed → no-op (idempotent), and we skip the event in that case.
      const res = await client.query(
        `update public.member_follows
            set unfollowed_at = now()
          where follower_member_id = $1
            and followed_member_id = $2
            and unfollowed_at is null`,
        [memberId, input.followedMemberId],
      )

      if (res.rowCount && res.rowCount > 0) {
        await appendEvent(txCtx, 'member_events', {
          member_id: memberId,
          event_kind: 'member.unfollowed',
          payload: { followed_member_id: input.followedMemberId },
        })
      }

      return {
        followerMemberId: memberId,
        followedMemberId: input.followedMemberId,
        following: false,
      }
    })
  },
)
