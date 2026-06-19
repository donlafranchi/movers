// T108 — Single follow card for the `/you` horizontal scroll (F042).
//
// Presentational. Renders one FollowEntry as a fixed-width card: thumbnail (or a
// kind-appropriate initial placeholder for groups/venues/tombstones) + name.
// Links to the entity's href.

import Link from 'next/link'
import type { FollowEntry } from '@/lib/follows/get-member-follows'

const KIND_LABEL: Record<FollowEntry['kind'], string> = {
  person: 'Person',
  group: 'Group',
  venue: 'Venue',
}

export function FollowCard({ entry }: { entry: FollowEntry }) {
  const initial = entry.displayName.trim().charAt(0).toUpperCase() || '?'
  return (
    <Link
      href={entry.href}
      data-testid="following-card"
      className="card-hover flex w-28 shrink-0 snap-start flex-col items-center gap-2 p-3 text-center"
      aria-label={`${entry.displayName} (${KIND_LABEL[entry.kind]})`}
    >
      {entry.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.thumbnailUrl}
          alt=""
          className="h-16 w-16 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-lg font-semibold text-neutral-500"
        >
          {initial}
        </span>
      )}
      <span className="line-clamp-2 text-xs font-medium text-neutral-800">
        {entry.displayName}
      </span>
    </Link>
  )
}
