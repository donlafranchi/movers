import { notFound } from 'next/navigation'
import { VendorForm } from '@/components/admin/VendorForm'
import { requireAdmin } from '@/lib/admin'
import type { CategorySlug } from '@/lib/categories'
import type { Vendor, Market } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function EditVendorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guard = await requireAdmin()
  if (!guard.ok) return null
  const { data: vendor } = await guard.admin.from('businesses').select('*').eq('slug', slug).maybeSingle()
  if (!vendor) notFound()
  const [{ data: markets }, { data: mv }, { data: vc }] = await Promise.all([
    guard.admin.from('markets').select('*').order('name'),
    guard.admin.from('market_vendors').select('market_id').eq('vendor_id', vendor.id),
    guard.admin.from('vendor_categories').select('category_slug, is_primary').eq('vendor_id', vendor.id),
  ])
  const initialMarketIds = (mv ?? []).map((r) => r.market_id as string)
  const initialCategorySlugs = (vc ?? []).map((r) => r.category_slug as CategorySlug)
  const initialPrimary = (vc ?? []).find((r) => r.is_primary)?.category_slug as CategorySlug | undefined ?? null
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">{vendor.name}</h1>
      <p className="mb-4 text-xs text-neutral-500">/{vendor.slug}</p>
      <VendorForm
        vendor={vendor as Vendor}
        markets={(markets ?? []) as Market[]}
        initialMarketIds={initialMarketIds}
        initialCategorySlugs={initialCategorySlugs}
        initialPrimary={initialPrimary}
      />
    </div>
  )
}
