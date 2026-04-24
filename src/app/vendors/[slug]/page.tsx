import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase-server'
import type { Vendor, Market, VendorCategory } from '@/lib/types'
import { VendorProfilePage } from './VendorProfilePage'

interface Props {
  params: Promise<{ slug: string }>
}

async function getVendor(slug: string): Promise<{
  vendor: Vendor
  markets: Market[]
  categories: VendorCategory[]
} | null> {
  const supabase = await createClient()
  const { data: vendor } = await supabase.from('businesses').select('*').eq('slug', slug).single()
  if (!vendor) return null

  const [{ data: mvRows }, { data: catRows }] = await Promise.all([
    supabase.from('market_vendors').select('market_id').eq('vendor_id', vendor.id),
    supabase.from('vendor_categories').select('*').eq('vendor_id', vendor.id),
  ])

  const marketIds = (mvRows ?? []).map((r) => r.market_id)
  let markets: Market[] = []
  if (marketIds.length > 0) {
    const { data: mRows } = await supabase.from('markets').select('*').in('id', marketIds)
    markets = (mRows ?? []) as Market[]
  }

  return {
    vendor: vendor as Vendor,
    markets,
    categories: (catRows ?? []) as VendorCategory[],
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const result = await getVendor(slug)
  if (!result) return { title: 'Vendor Not Found — Main Street Market' }
  const { vendor } = result
  const description = vendor.tagline || vendor.story?.slice(0, 160) || `${vendor.city}, ${vendor.state}`
  const url = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://mainstreetmarket.com'}/vendors/${slug}`
  const ogImage = vendor.cover_photo_url || `${process.env.NEXT_PUBLIC_SITE_URL || 'https://mainstreetmarket.com'}/og-default.png`
  return {
    title: `${vendor.name} — Main Street Market`,
    description,
    openGraph: {
      title: vendor.name,
      description,
      url,
      images: [{ url: ogImage }],
      type: 'website',
    },
  }
}

export default async function VendorPage({ params }: Props) {
  const { slug } = await params
  const result = await getVendor(slug)
  if (!result) notFound()
  return <VendorProfilePage vendor={result.vendor} markets={result.markets} categories={result.categories} />
}
