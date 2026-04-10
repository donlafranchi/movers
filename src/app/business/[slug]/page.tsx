import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import { OWNERSHIP_TIERS } from '@/lib/types'
import type { Business } from '@/lib/types'
import { BusinessListingPage } from './BusinessListingPage'

interface Props {
  params: Promise<{ slug: string }>
}

async function getBusiness(slug: string): Promise<Business | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('businesses')
    .select('*')
    .eq('slug', slug)
    .single()

  return data as Business | null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const business = await getBusiness(slug)

  if (!business) {
    return { title: 'Business Not Found — Main Street Market' }
  }

  const tierLabel = OWNERSHIP_TIERS[business.ownership_tier]?.label ?? business.ownership_tier
  const description = business.story?.trim()
    ? business.story.slice(0, 160)
    : `${tierLabel} · ${business.category} · ${business.city}, ${business.state}`

  const url = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://mainstreetmarket.com'}/business/${slug}`
  const ogImage = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://mainstreetmarket.com'}/og-default.png`

  return {
    title: `${business.name} — Main Street Market`,
    description,
    openGraph: {
      title: business.name,
      description,
      url,
      images: [{ url: ogImage }],
      type: 'website',
    },
  }
}

export default async function BusinessPage({ params }: Props) {
  const { slug } = await params
  const business = await getBusiness(slug)

  if (!business) notFound()

  return <BusinessListingPage business={business} />
}
