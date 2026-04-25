'use client'

import { useEffect, useState, use } from 'react'
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

export default function BulletinDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id } = use(params)
  const [bulletin, setBulletin] = useState<VendorBulletin | null>(null)
  const [stats, setStats] = useState<{ delivered: number; opened: number; clicked: number; unsubscribed: number }>({
    delivered: 0,
    opened: 0,
    clicked: 0,
    unsubscribed: 0,
  })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const client = supabase()
    client.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.replace('/auth/login')
        return
      }
      const { data: b } = await client.from('vendor_bulletins').select('*').eq('id', id).maybeSingle()
      if (!b) {
        setLoaded(true)
        return
      }
      setBulletin(b as VendorBulletin)
      const { data: deliveries } = await client
        .from('bulletin_deliveries')
        .select('opened_at, clicked_at, unsubscribed_at')
        .eq('bulletin_id', id)
      const list = deliveries ?? []
      setStats({
        delivered: list.length,
        opened: list.filter((d) => d.opened_at).length,
        clicked: list.filter((d) => d.clicked_at).length,
        unsubscribed: list.filter((d) => d.unsubscribed_at).length,
      })
      setLoaded(true)
    })
  }, [id, router])

  if (!loaded) return <main className="p-4 pb-24">Loading…</main>
  if (!bulletin) {
    return (
      <main className="p-4 pb-24 max-w-2xl mx-auto">
        <p className="text-sm text-neutral-600">Bulletin not found.</p>
      </main>
    )
  }

  return (
    <main className="pb-24 max-w-2xl mx-auto p-4" data-testid="bulletin-detail-page">
      <Link href="/you/vendor/bulletins" className="text-sm text-[--color-accent] hover:underline">
        ← Back to bulletins
      </Link>

      <article className="mt-4 card p-5">
        {bulletin.title && <h1 className="text-xl font-semibold text-neutral-900">{bulletin.title}</h1>}
        <p className="text-xs text-neutral-500 mt-1">
          Published{' '}
          {bulletin.published_at &&
            new Date(bulletin.published_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
        </p>
        <p className="text-sm text-neutral-700 mt-4 whitespace-pre-wrap">{bulletin.body}</p>
      </article>

      <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Delivered" value={stats.delivered} />
        <Stat label="Opened" value={stats.opened} />
        <Stat label="Clicked" value={stats.clicked} />
        <Stat label="Unsubscribed" value={stats.unsubscribed} />
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-xs uppercase tracking-wide text-neutral-500 font-semibold">{label}</p>
      <p className="text-2xl font-semibold text-neutral-900 mt-1">{value}</p>
    </div>
  )
}
