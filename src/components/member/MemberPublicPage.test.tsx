// T092 — Unit tests for <MemberPublicPage> (F032 read surface).
// Trace: planning/now/scenario-F032-viewer-finds-member-page-and-follows.md

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemberPublicPage } from './MemberPublicPage'
import type { ResolvedMemberPage } from '@/lib/member/resolve-member-page'

// FollowMemberButton imports the 'use server' actions module; stub it so the
// component renders in jsdom without pulling server-only code.
vi.mock('@/app/m/[handle]/actions', () => ({
  followMemberAction: vi.fn(),
  unfollowMemberAction: vi.fn(),
}))

afterEach(() => cleanup())

function member(overrides: Partial<ResolvedMemberPage> = {}): ResolvedMemberPage {
  return {
    memberId: 'mem-1',
    handle: 'maya',
    displayName: 'Maya Rivera',
    bio: 'Baker of bread.',
    pronouns: 'she/her',
    avatarUrl: null,
    hasStandingPresence: false,
    items: [],
    groups: [],
    isSelf: false,
    isFollowing: false,
    ...overrides,
  }
}

describe('T092 — MemberPublicPage', () => {
  it('renders name, handle, pronouns, and bio', () => {
    render(<MemberPublicPage member={member()} loggedIn={false} />)
    expect(screen.getByTestId('member-name')).toHaveTextContent('Maya Rivera')
    expect(screen.getByTestId('member-handle')).toHaveTextContent('@maya')
    expect(screen.getByTestId('member-handle')).toHaveTextContent('she/her')
    expect(screen.getByTestId('member-bio')).toHaveTextContent('Baker of bread.')
  })

  it('shows the standing badge only when hasStandingPresence', () => {
    const { rerender } = render(<MemberPublicPage member={member()} loggedIn={false} />)
    expect(screen.queryByTestId('member-standing-badge')).not.toBeInTheDocument()
    rerender(<MemberPublicPage member={member({ hasStandingPresence: true })} loggedIn={false} />)
    expect(screen.getByTestId('member-standing-badge')).toBeInTheDocument()
  })

  it('self-view renders Edit profile, not a Follow button', () => {
    render(<MemberPublicPage member={member({ isSelf: true })} loggedIn={true} />)
    expect(screen.getByTestId('member-edit-profile')).toHaveAttribute('href', '/you')
    expect(screen.queryByTestId('follow-member')).not.toBeInTheDocument()
    expect(screen.queryByTestId('follow-member-signin')).not.toBeInTheDocument()
  })

  it('anon viewer sees a sign-in Follow CTA with a return URL', () => {
    render(<MemberPublicPage member={member()} loggedIn={false} />)
    expect(screen.getByTestId('follow-member-signin')).toHaveAttribute(
      'href',
      '/auth/login?next=/m/maya',
    )
  })

  it('auth’d viewer not following sees a Follow button', () => {
    render(<MemberPublicPage member={member()} loggedIn={true} />)
    expect(screen.getByTestId('follow-member')).toBeInTheDocument()
  })

  it('auth’d viewer already following sees a Following button', () => {
    render(<MemberPublicPage member={member({ isFollowing: true })} loggedIn={true} />)
    expect(screen.getByTestId('following-member')).toBeInTheDocument()
  })

  it('empty items render the empty-state; groups section omitted when none', () => {
    render(<MemberPublicPage member={member()} loggedIn={false} />)
    expect(screen.getByTestId('member-items-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('member-group')).not.toBeInTheDocument()
  })

  it('renders item rows with hrefs and listed groups', () => {
    render(
      <MemberPublicPage
        member={member({
          items: [
            {
              itemId: 'i1',
              kind: 'product',
              title: 'Sourdough Loaf',
              brandLabel: null,
              href: '/m/maya/p/sourdough-loaf-i1',
            },
          ],
          groups: [{ slug: 'oak-park-bakers', name: 'Oak Park Bakers', kind: 'interest' }],
        })}
        loggedIn={false}
      />,
    )
    const item = screen.getByTestId('member-item')
    expect(item).toHaveTextContent('Sourdough Loaf')
    expect(item.querySelector('a')).toHaveAttribute('href', '/m/maya/p/sourdough-loaf-i1')
    expect(screen.getByTestId('member-group')).toHaveTextContent('Oak Park Bakers')
  })
})
