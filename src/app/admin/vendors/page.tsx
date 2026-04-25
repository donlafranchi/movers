import Link from 'next/link'
import { requireAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

export default async function AdminVendorsList() {
  const guard = await requireAdmin()
  if (!guard.ok) return null
  const { data: vendors } = await guard.admin
    .from('businesses')
    .select('id, name, slug, city, state, category, ownership_tier')
    .order('name')
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <Link href="/register-vendor" className="btn-secondary text-sm">+ Add via vendor flow</Link>
      </div>
      <div className="card divide-y divide-neutral-200">
        {(vendors ?? []).map((v) => (
          <div key={v.id} className="flex items-center gap-4 p-4">
            <div className="flex-1">
              <div className="font-medium">{v.name}</div>
              <div className="text-xs text-neutral-500">
                {v.city}, {v.state} · {v.category} · {v.ownership_tier}
              </div>
            </div>
            <Link href={`/vendors/${v.slug}`} className="text-xs text-neutral-500 hover:underline">View</Link>
            <Link href={`/admin/vendors/${v.slug}`} className="btn-secondary text-sm">Edit</Link>
          </div>
        ))}
        {(!vendors || vendors.length === 0) && (
          <div className="p-6 text-center text-sm text-neutral-500">No vendors yet.</div>
        )}
      </div>
    </div>
  )
}
