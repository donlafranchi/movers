// T082 — Public gathering Item page, Member-hosted path (F034).
// Spec:   planning/now/scenario-F034-member-hosts-recurring-gathering.md
//   /m/[handle]/e/[slug] — a gathering hosted by a Member (no Group filing).
// The Member page (/m/[handle]) is the one intentionally global namespace per
// ADR-20; gathering Items not filed under a Group hang off it.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { resolveGathering, nextOccurrence } from '@/lib/items/resolve-gathering'
import { GatheringPublicPage } from '@/components/item/GatheringPublicPage'

interface Props {
  params: Promise<{ handle: string; slug: string }>
}

function occurrenceLabel(startsAt: string | null, recurrenceRule: string | null): string | null {
  const occ = nextOccurrence(startsAt, recurrenceRule, new Date())
  return occ
    ? occ.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params
  const supabase = await createClient()
  const gathering = await resolveGathering(supabase, { handle, itemSlug: slug })
  if (!gathering) {
    return { title: 'Not found — Movers, Makers & Shakers' }
  }
  return {
    title: `${gathering.title} — Movers, Makers & Shakers`,
    description: gathering.description || gathering.title,
  }
}

export default async function MemberGatheringPage({ params }: Props) {
  const { handle, slug } = await params
  const supabase = await createClient()
  const gathering = await resolveGathering(supabase, { handle, itemSlug: slug })
  if (!gathering) {
    notFound()
  }
  return (
    <GatheringPublicPage
      gathering={gathering}
      groupHref={null}
      nextOccurrenceLabel={occurrenceLabel(gathering.startsAt, gathering.recurrenceRule)}
      shareUrl={`/m/${handle}/e/${slug}`}
    />
  )
}
