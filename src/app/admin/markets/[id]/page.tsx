import { notFound } from 'next/navigation'
import { MarketForm } from '@/components/admin/MarketForm'
import { requireAdmin } from '@/lib/admin'
import type { Market } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function EditMarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin()
  if (!guard.ok) return null
  const { data } = await guard.admin.from('markets').select('*').eq('id', id).maybeSingle()
  if (!data) notFound()
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Edit market</h1>
      <MarketForm market={data as Market} />
    </div>
  )
}
