'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import type { Vendor, Market } from '@/lib/types'
import { CATEGORIES } from '@/lib/categories'
import { formatNextMarketDate, nextMarketDate } from '@/lib/market-dates'
import { FollowButton } from '@/components/FollowButton'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

interface Row {
  vendor: Vendor
  primaryCategorySlug: string | null
  nextMarket: Market | null
  nextDate: Date | null
}

export default function FollowingPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    const client = supabase()
    client.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id
      if (!uid) {
        setAuthed(false)
        setLoaded(true)
        return
      }
      setAuthed(true)
      const { data: follows } = await client.from('follows').select('vendor_id').eq('user_id', uid)
      const ids = (follows ?? []).map((f) => f.vendor_id)
      if (ids.length === 0) {
        setLoaded(true)
        return
      }
      const [{ data: vRows }, { data: mvRows }, { data: catRows }, { data: mRows }] = await Promise.all([
        client.from('businesses').select('*').in('id', ids),
        client.from('market_vendors').select('vendor_id, market_id').in('vendor_id', ids),
        client.from('vendor_categories').select('*').in('vendor_id', ids),
        client.from('markets').select('*'),
      ])
      const vendors = (vRows ?? []) as Vendor[]
      const allMarkets = (mRows ?? []) as Market[]
      const allLinks = (mvRows ?? []) as { vendor_id: string; market_id: string }[]
      const allCats = (catRows ?? []) as { vendor_id: string; category_slug: string; is_primary: boolean }[]

      const built: Row[] = vendors.map((v) => {
        const mIds = allLinks.filter((l) => l.vendor_id === v.id).map((l) => l.market_id)
        const myMarkets = allMarkets.filter((m) => mIds.includes(m.id))
        let best: { m: Market; date: Date } | null = null
        for (const m of myMarkets) {
          const d = nextMarketDate(m.schedule_days)
          if (d && (!best || d < best.date)) best = { m, date: d }
        }
        const myCats = allCats.filter((c) => c.vendor_id === v.id)
        const primary = myCats.find((c) => c.is_primary)?.category_slug ?? myCats[0]?.category_slug ?? null
        return { vendor: v, primaryCategorySlug: primary, nextMarket: best?.m ?? null, nextDate: best?.date ?? null }
      })

      built.sort((a, b) => {
        if (a.nextDate && b.nextDate) return a.nextDate.getTime() - b.nextDate.getTime()
        if (a.nextDate) return -1
        if (b.nextDate) return 1
        return a.vendor.name.localeCompare(b.vendor.name)
      })

      setRows(built)
      setLoaded(true)
    })
  }, [])

  if (authed === false) {
    return (
      <main className="p-6 pb-24 max-w-md mx-auto text-center">
        <h1 className="text-xl font-semibold">Following</h1>
        <p className="mt-3 text-neutral-600 text-sm">Sign up to follow vendors and get updates when they&apos;re at the market.</p>
        <Link
          href="/auth/signup"
          className="mt-4 inline-flex items-center justify-center bg-emerald-700 text-white rounded-md px-4 py-2 text-sm font-medium"
        >
          Sign Up
        </Link>
      </main>
    )
  }

  return (
    <main className="pb-24 max-w-3xl mx-auto" data-testid="following-page">
      <header className="px-4 md:px-6 pt-4">
        <h1 className="text-2xl font-semibold">Following</h1>
      </header>

      {!loaded && <p className="px-4 md:px-6 mt-4 text-sm text-neutral-600">Loading…</p>}

      {loaded && rows.length === 0 && (
        <div className="px-4 md:px-6 mt-6 text-center text-sm text-neutral-600">
          <p>You&apos;re not following anyone yet.</p>
          <Link href="/" className="mt-3 inline-block text-emerald-700 underline">
            Browse vendors
          </Link>
        </div>
      )}

      <ul className="mt-4 px-4 md:px-6 space-y-3">
        {rows.map((row) => {
          const meta = row.primaryCategorySlug
            ? CATEGORIES[row.primaryCategorySlug as keyof typeof CATEGORIES]
            : null
          return (
            <li
              key={row.vendor.id}
              data-testid="following-row"
              data-vendor-slug={row.vendor.slug}
              className="bg-white border border-neutral-200 rounded-xl p-3 flex gap-3"
            >
              <Link href={`/vendors/${row.vendor.slug}`} className="flex-shrink-0">
                <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-emerald-100 to-amber-100 flex items-center justify-center text-2xl">
                  {row.vendor.cover_photo_url ? (
                    <img src={row.vendor.cover_photo_url} alt="" className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <span>{meta?.emoji ?? '🌱'}</span>
                  )}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <Link href={`/vendors/${row.vendor.slug}`}>
                  <p className="font-medium text-neutral-900 truncate">{row.vendor.name}</p>
                </Link>
                {row.vendor.tagline && (
                  <p className="text-xs text-neutral-600 truncate">{row.vendor.tagline}</p>
                )}
                {row.nextMarket && row.nextDate ? (
                  <p className="text-xs text-emerald-700 mt-1 font-medium">
                    Next: {row.nextMarket.name} · {formatNextMarketDate(row.nextMarket.schedule_days)}
                  </p>
                ) : (
                  <p className="text-xs text-neutral-500 mt-1">No upcoming market dates</p>
                )}
              </div>
              <div className="flex-shrink-0 self-center">
                <FollowButton vendorId={row.vendor.id} vendorName={row.vendor.name} size="sm" />
              </div>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
