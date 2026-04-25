import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminMarketsList() {
  const guard = await requireAdmin()
  if (!guard.ok) return null
  const { data: markets } = await guard.admin.from('markets').select('*').order('name')
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Markets</h1>
        <Link href="/admin/markets/new" className="btn-primary">+ Add market</Link>
      </div>
      <div className="card divide-y divide-neutral-200">
        {(markets ?? []).map((m) => (
          <div key={m.id} className="flex items-center gap-4 p-4">
            <div className="flex-1">
              <div className="font-medium">{m.name}</div>
              <div className="text-xs text-neutral-500">
                {m.city}, {m.state} · {m.schedule_days?.join(', ') || 'no schedule'}
              </div>
            </div>
            <Link href={`/admin/markets/${m.id}`} className="btn-secondary text-sm">Edit</Link>
          </div>
        ))}
        {(!markets || markets.length === 0) && (
          <div className="p-6 text-center text-sm text-neutral-500">No markets yet.</div>
        )}
      </div>
    </div>
  )
}
