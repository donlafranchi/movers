// T092 — Public Member page (F032).
// T095 — Discoverability gate: private-by-default, robots noindex, tombstone.
// Spec: planning/now/scenario-F032-viewer-finds-member-page-and-follows.md
//       product/systems/member.md § Privacy controls (Ratified 2026-06-03)
//   /m/[handle] — the one intentionally global namespace (ADR-20). The resolver
//   returns render / tombstone / notfound (see resolve-member-page.ts):
//     notfound  → 404 (anon never learns a non-public Member exists).
//     tombstone → a signed-in viewer hit a 'private' Member's URL.
//     render    → the page, with robots noindex unless the Member is discoverable
//                 AND public.
//   This is always a direct-URL navigation, so viaDirectLink = true.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { resolveMemberPage } from '@/lib/member/resolve-member-page'
import { MemberPublicPage } from '@/components/member/MemberPublicPage'

interface Props {
  params: Promise<{ handle: string }>
}

const NOINDEX = { index: false, follow: false } as const

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const supabase = await createClient()
  const view = await resolveMemberPage(supabase, { handle, viaDirectLink: true })

  if (view.kind === 'notfound') {
    return { title: 'Not found — Movers, Makers & Shakers', robots: NOINDEX }
  }
  if (view.kind === 'tombstone') {
    return { title: 'Private profile — Movers, Makers & Shakers', robots: NOINDEX }
  }
  const { page, indexable } = view
  return {
    title: `${page.displayName} (@${page.handle}) — Movers, Makers & Shakers`,
    description: page.bio || `${page.displayName} on Movers, Makers & Shakers`,
    // Indexable only when the Member opted into discoverability AND is public.
    ...(indexable ? {} : { robots: NOINDEX }),
  }
}

export default async function MemberPage({ params }: Props) {
  const { handle } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const view = await resolveMemberPage(supabase, {
    handle,
    viewerId: user?.id ?? null,
    viaDirectLink: true,
  })

  if (view.kind === 'notfound') {
    notFound()
  }

  if (view.kind === 'tombstone') {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center" data-testid="member-private-tombstone">
        <h1 className="text-lg font-semibold text-neutral-900">This member&rsquo;s profile is private.</h1>
        <p className="mt-2 text-sm text-neutral-600">
          They haven&rsquo;t made their profile visible to other members.
        </p>
      </main>
    )
  }

  return <MemberPublicPage member={view.page} loggedIn={!!user} />
}
