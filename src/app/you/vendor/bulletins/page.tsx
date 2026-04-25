'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import type { VendorBulletin } from '@/lib/types'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

interface Row {
  bulletin: VendorBulletin
  delivered: number
  opened: number
  clicked: number
}

export default function BulletinsListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const client = supabase()
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace('/auth/login?next=/you/vendor/bulletins')
        return
      }
      const { data: vendor } = await client
        .from('businesses')
        .select('id')
        .eq('user_id', data.user.id)
        .limit(1)
        .maybeSingle()
      if (!vendor) {
        router.replace('/join')
        return
      }
      const { data: bulls } = await client
        .from('vendor_bulletins')
        .select('*')
        .eq('vendor_id', vendor.id)
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
      const bulletins = (bulls ?? []) as VendorBulletin[]
      const built: Row[] = await Promise.all(
        bulletins.map(async (b) => {
          const { data: deliveries } = await client
            .from('bulletin_deliveries')
            .select('opened_at, clicked_at')
            .eq('bulletin_id', b.id)
          const list = deliveries ?? []
          return {
            bulletin: b,
            delivered: list.length,
            opened: list.filter((d) => d.opened_at).length,
            clicked: list.filter((d) => d.clicked_at).length,
          }
        })
      )
      setRows(built)
      setLoaded(true)
    })
  }, [router])

  return (
    <main className="pb-24 max-w-3xl mx-auto p-4" data-testid="bulletins-list-page">
      <Link href="/you/vendor" className="text-sm text-[--color-accent] hover:underline">
        ← Back to vendor mode
      </Link>
      <header className="mt-3 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Bulletins</h1>
        <Link href="/you/vendor/bulletins/new" data-testid="bulletin-new" className="btn-primary">
          New bulletin
        </Link>
      </header>

      {!loaded && <p className="text-sm text-neutral-600 mt-6">Loading…</p>}

      {loaded && rows.length === 0 && (
        <div className="mt-8 text-center py-10 px-6 border border-dashed border-neutral-300 rounded-xl">
          <p className="text-sm text-neutral-600">You haven't sent any bulletins yet.</p>
          <Link href="/you/vendor/bulletins/new" className="mt-4 inline-flex btn-primary">
            Write your first bulletin
          </Link>
        </div>
      )}

      {loaded && rows.length > 0 && (
        <ul className="mt-6 divide-y divide-neutral-200 border border-neutral-200 rounded-xl bg-white">
          {rows.map((r) => (
            <li key={r.bulletin.id} data-testid="bulletin-row">
              <Link
                href={`/you/vendor/bulletins/${r.bulletin.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 truncate">
                    {r.bulletin.title || r.bulletin.body.slice(0, 60)}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {r.bulletin.published_at
                      ? new Date(r.bulletin.published_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Draft'}
                  </p>
                </div>
                <div className="flex gap-4 text-xs text-neutral-600 whitespace-nowrap">
                  <span>{r.delivered} sent</span>
                  <span>{r.opened} opened</span>
                  <span>{r.clicked} clicked</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
