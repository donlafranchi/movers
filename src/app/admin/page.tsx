import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminIndex() {
  const guard = await requireAdmin()
  if (!guard.ok) return null
  const [{ count: marketCount }, { count: vendorCount }] = await Promise.all([
    guard.admin.from('markets').select('id', { head: true, count: 'exact' }),
    guard.admin.from('businesses').select('id', { head: true, count: 'exact' }),
  ])
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="text-sm text-neutral-600">Edit live data. Changes apply immediately.</p>
      <div className="grid grid-cols-2 gap-4">
        <Link href="/admin/markets" className="card card-hover p-5">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Markets</div>
          <div className="mt-1 text-2xl font-semibold">{marketCount ?? 0}</div>
          <div className="mt-3 text-sm text-[var(--color-accent)]">Manage markets →</div>
        </Link>
        <Link href="/admin/vendors" className="card card-hover p-5">
          <div className="text-xs uppercase tracking-wide text-neutral-500">Vendors</div>
          <div className="mt-1 text-2xl font-semibold">{vendorCount ?? 0}</div>
          <div className="mt-3 text-sm text-[var(--color-accent)]">Manage vendors →</div>
        </Link>
      </div>
    </div>
  )
}
