// T092 — Public Member page presentational component (F032 read surface).
// Spec: planning/now/scenario-F032-viewer-finds-member-page-and-follows.md.
//
// Presentational + server-renderable. Data fetching lives in the route
// (src/app/m/[handle]/page.tsx); this renders the resolved shape so it stays
// unit-testable. The only client island is <FollowMemberButton>. No
// place-interest surface is rendered anywhere (privacy commitment).

import type { ResolvedMemberPage } from '@/lib/member/resolve-member-page'
import { kindLabel } from '@/lib/feed/item-url'
import { FollowMemberButton } from './FollowMemberButton'

interface Props {
  member: ResolvedMemberPage
  loggedIn: boolean
}

export function MemberPublicPage({ member, loggedIn }: Props) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6" data-testid="member-page">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          {member.avatarUrl && (
            // Decorative: the adjacent name labels the page.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={member.avatarUrl}
              alt=""
              className="h-14 w-14 rounded-full object-cover"
            />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 data-testid="member-name" className="text-2xl font-semibold">
                {member.displayName}
              </h1>
              {member.hasStandingPresence && (
                <span
                  data-testid="member-standing-badge"
                  className="chip chip-selected whitespace-nowrap text-xs"
                >
                  Active in the community
                </span>
              )}
            </div>
            <p data-testid="member-handle" className="text-sm text-gray-500">
              @{member.handle}
              {member.pronouns && (
                <span className="ml-2 text-gray-400">· {member.pronouns}</span>
              )}
            </p>
          </div>
        </div>

        {member.bio && (
          <p data-testid="member-bio" className="text-sm text-gray-600">
            {member.bio}
          </p>
        )}

        <div className="mt-2">
          {member.isSelf ? (
            <a data-testid="member-edit-profile" href="/you" className="btn-secondary">
              Edit profile
            </a>
          ) : (
            <FollowMemberButton
              loggedIn={loggedIn}
              isSelf={member.isSelf}
              isFollowing={member.isFollowing}
              followedMemberId={member.memberId}
              handle={member.handle}
            />
          )}
        </div>
      </header>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Posts</h2>
        {member.items.length === 0 ? (
          <div
            data-testid="member-items-empty"
            className="mt-3 rounded border border-dashed border-gray-300 p-6 text-sm text-gray-500"
          >
            Nothing posted yet.
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {member.items.map((item) => (
              <li key={item.itemId} data-testid="member-item" className="card p-3 text-sm">
                <a href={item.href} className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium text-gray-900">{item.title}</span>
                  <span className="shrink-0 text-xs text-gray-400">{kindLabel(item.kind)}</span>
                </a>
                {item.brandLabel && (
                  <p className="mt-1 text-xs text-gray-500">{item.brandLabel}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {member.groups.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-medium">Groups</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {member.groups.map((g) => (
              <li key={g.slug} data-testid="member-group">
                <span className="chip text-sm">{g.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
