'use client'

// T074 — Follow CTA for the public Shop page (F035 beats 4 & 5).
//
// FORWARD-DEP: group-follow persistence does not exist at b1. `member_follows`
// (T048) is member→member only — there is no group-follow substrate; the
// scenario assigns it to F042. This component renders the affordance with the
// correct copy for each viewer state and defers the write. When F042 lands a
// group-follow handler, replace the click handler with the server action and
// flip the button to "Following" on success.

import { useState } from 'react'

interface Props {
  loggedIn: boolean
  shopName: string
}

export function FollowShopButton({ loggedIn, shopName }: Props) {
  const [status, setStatus] = useState<string | null>(null)

  if (!loggedIn) {
    return (
      <a
        data-testid="follow-shop-signup"
        href="/auth/signup"
        className="btn-primary"
      >
        Sign up to follow
      </a>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="follow-shop"
        className="btn-primary"
        onClick={() => setStatus(`Following ${shopName} is coming soon.`)}
      >
        Follow {shopName}
      </button>
      {status && (
        <p role="status" className="text-sm text-gray-600">
          {status}
        </p>
      )}
    </div>
  )
}
