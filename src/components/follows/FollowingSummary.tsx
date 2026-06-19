'use client'

// T108 — `/you` "Following" summary section (F042, Loop 8).
//
// Thin client wrapper over getMemberFollows: a horizontal, snap-scrolling card
// strip of everything the Member follows (mixed kinds, most recent first — the
// reader orders it), capped by a "More" link to the full /you/following page.
// Omitted entirely when the Member follows nothing (the empty-state with the
// explore CTA lives on /you/following, per T109).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { getMemberFollows, type FollowEntry } from '@/lib/follows/get-member-follows'
import { FollowCard } from './FollowCard'

export function FollowingSummary({ memberId }: { memberId: string }) {
  const [entries, setEntries] = useState<FollowEntry[] | null>(null)

  useEffect(() => {
    let active = true
    getMemberFollows(createClient(), memberId)
      .then((rows) => {
        if (active) setEntries(rows)
      })
      .catch(() => {
        if (active) setEntries([])
      })
    return () => {
      active = false
    }
  }, [memberId])

  // Loading or zero follows → render nothing (section omitted from /you).
  if (!entries || entries.length === 0) return null

  return (
    <section className="mt-6" data-testid="following-summary">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">Following</h2>
        <Link
          href="/you/following"
          data-testid="following-more"
          className="text-sm font-medium text-[--color-accent] hover:underline"
        >
          More
        </Link>
      </div>
      <div
        className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
        data-testid="following-scroll"
      >
        {entries.map((entry) => (
          <FollowCard key={`${entry.kind}:${entry.entityId}`} entry={entry} />
        ))}
      </div>
    </section>
  )
}
