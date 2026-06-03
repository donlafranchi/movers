'use client'

// T092 — Follow CTA for the public Member page (F032).
//
// member→member follow is real at b1 (T091 handlers). Three viewer states:
//   - anon            → link to /auth/login?next=/m/<handle> (return URL)
//   - auth'd non-self → toggle Follow ⇄ Following via the server actions,
//                       optimistic with revert on error
//   - self            → render nothing (the page shows Edit-profile instead)

import { useState, useTransition } from 'react'
import { followMemberAction, unfollowMemberAction } from '@/app/m/[handle]/actions'

interface Props {
  loggedIn: boolean
  isSelf: boolean
  isFollowing: boolean
  followedMemberId: string
  handle: string
}

export function FollowMemberButton({
  loggedIn,
  isSelf,
  isFollowing,
  followedMemberId,
  handle,
}: Props) {
  const [following, setFollowing] = useState(isFollowing)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (isSelf) return null

  if (!loggedIn) {
    return (
      <a
        data-testid="follow-member-signin"
        href={`/auth/login?next=/m/${handle}`}
        className="btn-primary"
      >
        Follow
      </a>
    )
  }

  const toggle = () => {
    const next = !following
    setFollowing(next) // optimistic
    setError(null)
    startTransition(async () => {
      try {
        if (next) {
          await followMemberAction({ followedMemberId })
        } else {
          await unfollowMemberAction({ followedMemberId })
        }
      } catch (err) {
        setFollowing(!next) // revert
        setError(err instanceof Error ? err.message : 'Something went wrong.')
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-testid={following ? 'following-member' : 'follow-member'}
        className={following ? 'btn-secondary' : 'btn-primary'}
        aria-pressed={following}
        disabled={pending}
        onClick={toggle}
      >
        {following ? 'Following' : 'Follow'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
