// T083 — Public service Item page, individual-seller path (F040).
// Spec:   planning/now/scenario-F040-producer-lists-service.md
//   /m/[handle]/s/[slug] — a service sold as an individual (no Group filing).
// The Member page (/m/[handle]) is the one intentionally global namespace
// per ADR-20; service Items not filed under a Group hang off it.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { resolveService } from '@/lib/items/resolve-service'
import { isItemOwner } from '@/lib/items/is-item-owner'
import { ServicePublicPage } from '@/components/item/ServicePublicPage'

interface Props {
  params: Promise<{ handle: string; slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params
  const supabase = await createClient()
  const service = await resolveService(supabase, { handle, itemSlug: slug })
  if (!service) {
    return { title: 'Not found — Movers, Makers & Shakers' }
  }
  return {
    title: `${service.title} — Movers, Makers & Shakers`,
    description: service.description || service.title,
  }
}

export default async function MemberServicePage({ params }: Props) {
  const { handle, slug } = await params
  const supabase = await createClient()
  const service = await resolveService(supabase, { handle, itemSlug: slug })
  if (!service) {
    notFound()
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isOwner = await isItemOwner(supabase, service.itemId, user?.id ?? null)
  // Individual services have no Group page to resolve up to.
  return <ServicePublicPage service={service} groupHref={null} isOwner={isOwner} />
}
