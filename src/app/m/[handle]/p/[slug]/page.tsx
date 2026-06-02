// T079 — Public product Item page, individual-seller path (F038).
// Spec:   planning/now/scenario-F038-producer-lists-product.md
//   /m/[handle]/p/[slug] — a product sold as an individual (no Group filing).
// The Member page (/m/[handle]) is the one intentionally global namespace
// per ADR-20; product Items not filed under a Group hang off it.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { resolveProduct } from '@/lib/items/resolve-product'
import { ProductPublicPage } from '@/components/item/ProductPublicPage'

interface Props {
  params: Promise<{ handle: string; slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle, slug } = await params
  const supabase = await createClient()
  const product = await resolveProduct(supabase, { handle, itemSlug: slug })
  if (!product) {
    return { title: 'Not found — Movers, Makers & Shakers' }
  }
  return {
    title: `${product.title} — Movers, Makers & Shakers`,
    description: product.description || product.title,
  }
}

export default async function MemberProductPage({ params }: Props) {
  const { handle, slug } = await params
  const supabase = await createClient()
  const product = await resolveProduct(supabase, { handle, itemSlug: slug })
  if (!product) {
    notFound()
  }
  // Individual products have no Group page to resolve up to.
  return <ProductPublicPage product={product} groupHref={null} />
}
