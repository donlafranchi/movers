// T092 — Public Member page (F032).
// Spec: planning/now/scenario-F032-viewer-finds-member-page-and-follows.md.
//   /m/[handle] — the one intentionally global namespace (ADR-20). Renders the
//   Member header, authored Items, listed Group memberships, standing badge,
//   and an auth-gated Follow CTA. A soft-deleted / nonexistent handle 404s
//   (RLS members_public_read yields no row → resolveMemberPage null).

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { resolveMemberPage } from '@/lib/member/resolve-member-page'
import { MemberPublicPage } from '@/components/member/MemberPublicPage'

interface Props {
  params: Promise<{ handle: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const supabase = await createClient()
  const member = await resolveMemberPage(supabase, { handle })
  if (!member) {
    return { title: 'Not found — Movers, Makers & Shakers' }
  }
  return {
    title: `${member.displayName} (@${member.handle}) — Movers, Makers & Shakers`,
    description: member.bio || `${member.displayName} on Movers, Makers & Shakers`,
  }
}

export default async function MemberPage({ params }: Props) {
  const { handle } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const member = await resolveMemberPage(supabase, { handle, viewerId: user?.id ?? null })
  if (!member) {
    notFound()
  }

  return <MemberPublicPage member={member} loggedIn={!!user} />
}
