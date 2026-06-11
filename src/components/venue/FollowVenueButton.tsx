'use client'

// T102 — "Follow this venue" CTA (S-saved-search surface enablement, F033 / F042).
//
// Creates a saved-search row scoped to a Location (the notification primitive).
// Three viewer states, mirroring FollowMemberButton (T092):
//   - anon  → link to /auth/login?next=<current path> (return URL)
//   - auth'd → toggle Follow ⇄ Following, optimistic with revert on error
// No self-exclusion: you can follow your own venue. The parent page (F033)
// server-renders existingSavedSearchId so there is no client fetch on mount.

import { useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { followVenueAction, unfollowVenueAction } from '@/app/_actions/saved-search-actions'

interface Props {
  loggedIn: boolean
  locationId: string
  venueName: string
  existingSavedSearchId: string | null
}

export function FollowVenueButton({
  loggedIn,
  locationId,
  venueName,
  existingSavedSearchId,
}: Props) {
  const pathname = usePathname()
  const [following, setFollowing] = useState(existingSavedSearchId !== null)
  const [savedSearchId, setSavedSearchId] = useState<string | null>(existingSavedSearchId)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!loggedIn) {
    return (
      <a
        data-testid="follow-venue-signin"
        href={`/auth/login?next=${pathname ?? '/'}`}
        className="btn-primary"
      >
        Follow this venue
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
          const res = await followVenueAction({ locationId, venueName })
          setSavedSearchId(res.savedSearchId)
        } else {
          if (savedSearchId) await unfollowVenueAction({ savedSearchId })
          setSavedSearchId(null)
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
        data-testid={following ? 'following-venue' : 'follow-venue'}
        className={following ? 'btn-secondary' : 'btn-primary'}
        aria-pressed={following}
        disabled={pending}
        onClick={toggle}
      >
        {following ? 'Following' : 'Follow this venue'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
