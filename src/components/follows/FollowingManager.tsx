'use client'

// T109 — /you/following management list (F042, Loop 8).
//
// Partitions the unified follows union (T108 getMemberFollows) into three flat
// sections — People / Groups / Venues — each row carrying a substrate-accurate
// affordance: "Unfollow" for People + Venues (asymmetric subscriptions), "Leave"
// for Groups (named memberships). All affordances are destructive-secondary text
// links (not primary buttons), consistent with F032/F033.
//
// Remove is optimistic with an Undo window: the row flips to a "removed · Undo"
// state and the soft-delete handler fires immediately; Undo calls the REVERSE
// handler, which re-activates the same soft-deleted row (clears unfollowed_at /
// left_at / removed_at) rather than inserting a duplicate. After the window the
// row finalizes (disappears). The Member never leaves /you/following.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { FollowEntry, FollowKind } from '@/lib/follows/get-member-follows'
import { followMemberAction, unfollowMemberAction } from '@/app/m/[handle]/actions'
import { joinGroupAction, leaveGroupAction } from '@/app/_actions/group-membership-actions'
import { restoreVenueAction, unfollowVenueAction } from '@/app/_actions/saved-search-actions'

const UNDO_WINDOW_MS = 6000

const AFFORDANCE_LABEL: Record<FollowKind, string> = {
  person: 'Unfollow',
  group: 'Leave',
  venue: 'Unfollow',
}

const SECTIONS: { kind: FollowKind; testid: string; heading: string }[] = [
  { kind: 'person', testid: 'section-people', heading: 'People' },
  { kind: 'group', testid: 'section-groups', heading: 'Groups' },
  { kind: 'venue', testid: 'section-venues', heading: 'Venues' },
]

async function removeFollow(entry: FollowEntry): Promise<void> {
  if (entry.kind === 'person') await unfollowMemberAction({ followedMemberId: entry.entityId })
  else if (entry.kind === 'group') await leaveGroupAction({ groupId: entry.entityId })
  else await unfollowVenueAction({ savedSearchId: entry.entityId })
}

async function restoreFollow(entry: FollowEntry): Promise<void> {
  if (entry.kind === 'person') await followMemberAction({ followedMemberId: entry.entityId })
  else if (entry.kind === 'group') await joinGroupAction({ groupId: entry.entityId })
  else await restoreVenueAction({ savedSearchId: entry.entityId })
}

type RowState = 'active' | 'removed' | 'gone'

function FollowRow({
  entry,
  count,
}: {
  entry: FollowEntry
  count?: number
}) {
  const [state, setState] = useState<RowState>('active')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const onRemove = async () => {
    setError(null)
    setState('removed') // optimistic
    timer.current = setTimeout(() => setState('gone'), UNDO_WINDOW_MS)
    try {
      await removeFollow(entry)
    } catch (err) {
      if (timer.current) clearTimeout(timer.current)
      setState('active')
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  const onUndo = async () => {
    if (timer.current) clearTimeout(timer.current)
    setError(null)
    setState('active') // optimistic
    try {
      await restoreFollow(entry)
    } catch (err) {
      setState('removed')
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (state === 'gone') return null

  const initial = entry.displayName.trim().charAt(0).toUpperCase() || '?'

  return (
    <li
      data-testid="follow-row"
      data-kind={entry.kind}
      className="flex items-center gap-3 border-b border-neutral-100 py-3"
    >
      {entry.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.thumbnailUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-500"
        >
          {initial}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {entry.href === '#' ? (
          <span className="block truncate text-sm font-medium text-neutral-800">{entry.displayName}</span>
        ) : (
          <Link href={entry.href} className="block truncate text-sm font-medium text-neutral-800 hover:underline">
            {entry.displayName}
          </Link>
        )}
        {entry.kind === 'group' && (
          <span data-testid={`group-count-${entry.entityId}`} className="text-xs text-neutral-500">
            {count ?? 0} {(count ?? 0) === 1 ? 'member' : 'members'}
          </span>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      {state === 'removed' ? (
        <button
          type="button"
          data-testid={`undo-${entry.kind}-${entry.entityId}`}
          aria-label={`Undo — keep following ${entry.displayName}`}
          className="shrink-0 text-sm font-medium text-[--color-accent] hover:underline"
          onClick={onUndo}
        >
          Undo
        </button>
      ) : (
        <button
          type="button"
          data-testid={`affordance-${entry.kind}-${entry.entityId}`}
          aria-label={`${AFFORDANCE_LABEL[entry.kind]} ${entry.displayName}`}
          className="shrink-0 text-sm font-medium text-red-700 hover:underline"
          onClick={onRemove}
        >
          {AFFORDANCE_LABEL[entry.kind]}
        </button>
      )}
    </li>
  )
}

export function FollowingManager({
  entries,
  groupCounts,
}: {
  entries: FollowEntry[]
  groupCounts: Record<string, number>
}) {
  if (entries.length === 0) {
    return (
      <div
        data-testid="following-empty"
        className="rounded-xl border border-dashed border-neutral-300 px-6 py-10 text-center"
      >
        <p className="text-sm text-neutral-600">Nothing followed yet — start exploring.</p>
        <Link
          href="/explore"
          className="mt-4 inline-flex items-center justify-center rounded-full bg-[--color-accent] px-4 py-2 text-sm font-medium text-white"
        >
          Explore →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {SECTIONS.map(({ kind, testid, heading }) => {
        const rows = entries.filter((e) => e.kind === kind)
        if (rows.length === 0) return null
        return (
          <section key={kind} data-testid={testid}>
            <h2 className="text-sm font-semibold text-neutral-700">{heading}</h2>
            <ul className="mt-2">
              {rows.map((entry) => (
                <FollowRow
                  key={`${entry.kind}:${entry.entityId}`}
                  entry={entry}
                  count={kind === 'group' ? groupCounts[entry.entityId] : undefined}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
