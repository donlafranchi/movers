'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Heart, User, Search } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import type { Vendor, Market, VendorCategory } from '@/lib/types'
import { CATEGORIES, CATEGORY_ORDER } from '@/lib/categories'
import { formatNextMarketDate } from '@/lib/market-dates'
import { useMarket } from './MarketContext'
import { MarketPill } from './MarketPill'
import { VendorCard } from './VendorCard'
import { AuthCtaButtons } from './AuthCtaButtons'
import { RecruitmentGrid } from './RecruitmentGrid'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

interface VendorWithMeta {
  vendor: Vendor
  primaryCategory: string | null
  nextMarket: Market | null
}

function pickPrimary(cats: VendorCategory[], vendorId: string): string | null {
  const v = cats.filter((c) => c.vendor_id === vendorId)
  const primary = v.find((c) => c.is_primary)
  return primary?.category_slug ?? v[0]?.category_slug ?? null
}

function pickNextMarket(vendorId: string, allMarkets: Market[], links: { vendor_id: string; market_id: string }[]): Market | null {
  const ids = links.filter((l) => l.vendor_id === vendorId).map((l) => l.market_id)
  const matching = allMarkets.filter((m) => ids.includes(m.id))
  if (matching.length === 0) return null
  let best: { m: Market; date: Date } | null = null
  for (const m of matching) {
    const slug = m.schedule_days
    if (slug.length === 0) continue
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      const map: string[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
      if ((slug as string[]).includes(map[d.getDay()])) {
        if (!best || d < best.date) best = { m, date: d }
        break
      }
    }
  }
  return best?.m ?? null
}

export function HomeFeed() {
  const { selectedMarket } = useMarket()
  const [hero, setHero] = useState<Vendor | null>(null)
  const [vendorsNearby, setVendorsNearby] = useState<VendorWithMeta[]>([])
  const [marketsNearby, setMarketsNearby] = useState<Market[]>([])
  const [followedVendors, setFollowedVendors] = useState<VendorWithMeta[]>([])
  const [recentlyViewed, setRecentlyViewed] = useState<VendorWithMeta[]>([])
  const [isAuth, setIsAuth] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const client = supabase()
    let cancelled = false

    async function load() {
      const { data: userData } = await client.auth.getUser()
      const userId = userData.user?.id
      const authed = !!userId
      if (cancelled) return
      setIsAuth(authed)

      const [{ data: vendors }, { data: markets }, { data: cats }, { data: mvLinks }] = await Promise.all([
        client.from('businesses').select('*').limit(50),
        client.from('markets').select('*'),
        client.from('vendor_categories').select('*'),
        client.from('market_vendors').select('vendor_id, market_id'),
      ])

      const allVendors = (vendors ?? []) as Vendor[]
      const allMarkets = (markets ?? []) as Market[]
      const allCats = (cats ?? []) as VendorCategory[]
      const allLinks = (mvLinks ?? []) as { vendor_id: string; market_id: string }[]

      const featured = allVendors
        .filter((v) => v.is_featured)
        .sort((a, b) => (b.featured_at ?? '').localeCompare(a.featured_at ?? ''))[0]
      setHero(featured ?? allVendors[0] ?? null)

      const filterByMarket = (vList: Vendor[]) => {
        if (!selectedMarket) return vList
        const vIds = allLinks.filter((l) => l.market_id === selectedMarket.id).map((l) => l.vendor_id)
        return vList.filter((v) => vIds.includes(v.id))
      }

      const nearbyList = filterByMarket(allVendors).slice(0, 10).map((v) => ({
        vendor: v,
        primaryCategory: pickPrimary(allCats, v.id),
        nextMarket: pickNextMarket(v.id, allMarkets, allLinks),
      }))
      setVendorsNearby(nearbyList)

      setMarketsNearby(allMarkets.slice(0, 6))

      if (authed) {
        const { data: follows } = await client
          .from('follows')
          .select('vendor_id')
          .eq('user_id', userId)
          .is('unfollowed_at', null)
        const followedIds = (follows ?? []).map((f) => f.vendor_id)
        const followedList = allVendors
          .filter((v) => followedIds.includes(v.id))
          .map((v) => ({
            vendor: v,
            primaryCategory: pickPrimary(allCats, v.id),
            nextMarket: pickNextMarket(v.id, allMarkets, allLinks),
          }))
        setFollowedVendors(followedList)
      }

      try {
        const raw = localStorage.getItem('msm.recentlyViewed')
        const ids: string[] = raw ? JSON.parse(raw) : []
        const list = ids
          .map((id) => allVendors.find((v) => v.id === id))
          .filter((v): v is Vendor => !!v)
          .map((v) => ({
            vendor: v,
            primaryCategory: pickPrimary(allCats, v.id),
            nextMarket: pickNextMarket(v.id, allMarkets, allLinks),
          }))
        setRecentlyViewed(list)
      } catch {}

      setLoaded(true)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [selectedMarket])

  return (
    <main className="pb-40 md:pb-24" data-testid="home-feed">
      {/* Top: minimal market pill only on mobile */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-neutral-200 md:hidden">
        <div className="px-3 py-2 flex items-center justify-between gap-2">
          <MarketPill />
          {isAuth ? (
            <div className="flex items-center gap-1">
              <Link href="/following" aria-label="Following" className="p-2">
                <Heart size={20} className="text-neutral-700" />
              </Link>
              <Link href="/you" aria-label="You" className="p-2">
                <User size={20} className="text-neutral-700" />
              </Link>
            </div>
          ) : (
            <AuthCtaButtons variant="compact" />
          )}
        </div>
      </header>

      {/* Bottom-anchored search bar (mobile only) */}
      <div
        className="fixed inset-x-0 z-40 px-3 md:hidden"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}
      >
        <Link
          href="/explore"
          className="flex items-center gap-2 bg-white shadow-lg border border-neutral-200 rounded-full px-4 py-3 text-sm text-neutral-500"
        >
          <Search size={16} />
          <span>Search vendors, products, markets</span>
        </Link>
      </div>

      {/* Hero */}
      <section className="px-3 md:px-6 pt-4">
        {hero ? (
          <Link
            href={`/vendors/${hero.slug}`}
            data-testid="hero-vendor"
            className="block relative h-56 md:h-72 rounded-2xl overflow-hidden bg-gradient-to-br from-[--color-accent-tint] to-amber-200"
          >
            {hero.cover_photo_url && (
              <img src={hero.cover_photo_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
              <p className="text-xs uppercase tracking-wider opacity-90">Featured Vendor</p>
              <h2 className="text-2xl font-semibold mt-1">{hero.name}</h2>
              {hero.tagline && <p className="text-sm opacity-90 mt-1 line-clamp-2">{hero.tagline}</p>}
            </div>
          </Link>
        ) : loaded ? (
          <div className="h-40 rounded-2xl bg-neutral-100 flex items-center justify-center text-neutral-500 text-sm">
            No featured vendor yet
          </div>
        ) : (
          <div className="h-56 md:h-72 rounded-2xl bg-neutral-100 animate-pulse" />
        )}

        {!isAuth && (
          <p className="mt-3 text-center text-sm text-neutral-700 italic">
            Every dollar you spend here stays here.
          </p>
        )}
      </section>

      {!isAuth && (
        <section className="px-3 md:px-6 mt-6" data-testid="signup-banner">
          <div className="rounded-2xl border border-[--color-accent-tint] bg-gradient-to-br from-[--color-accent-tint] to-amber-50 overflow-hidden">
            <div className="p-4 md:p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[--color-accent]">
                Join Main Street — free, always
              </p>
              <h2 className="mt-1 text-lg md:text-xl font-semibold text-neutral-900">
                Help us build a market that actually serves Sacramento.
              </h2>
            </div>
            <div className="grid md:grid-cols-2 gap-px bg-[--color-accent-tint]">
              <Link
                href="/auth/signup"
                data-testid="signup-banner-buyer"
                className="block bg-white hover:bg-[--color-accent-tint] p-4 md:p-5 transition-colors"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">For shoppers</p>
                <p className="mt-1 font-semibold text-neutral-900">Follow your makers →</p>
                <p className="mt-1 text-sm text-neutral-600">
                  Save vendors, get market reminders, see what's fresh this week.
                </p>
              </Link>
              <Link
                href="/join"
                data-testid="signup-banner-seller"
                className="block bg-white hover:bg-amber-50 p-4 md:p-5 transition-colors"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">For makers & sellers</p>
                <p className="mt-1 font-semibold text-neutral-900">List your business — free →</p>
                <p className="mt-1 text-sm text-neutral-600">
                  90 seconds to set up. No fees, ever. You keep every customer.
                </p>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Shop by Category */}
      <section className="px-3 md:px-6 mt-8">
        <h2 className="text-lg font-semibold text-neutral-900 mb-3">Shop by Category</h2>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {CATEGORY_ORDER.map((slug) => {
            const meta = CATEGORIES[slug]
            return (
              <Link
                key={slug}
                href={`/explore?category=${slug}`}
                data-testid={`category-tile-${slug}`}
                className="aspect-square bg-neutral-50 hover:bg-neutral-100 rounded-xl flex flex-col items-center justify-center gap-1 p-2 transition-colors"
              >
                <span className="text-2xl">{meta.emoji}</span>
                <span className="text-[11px] font-medium text-neutral-700 text-center leading-tight">{meta.label}</span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Vendors near you */}
      <Rail title="Vendors near you" seeAllHref="/explore">
        {vendorsNearby.length > 0 ? (
          vendorsNearby.map((v) => (
            <VendorCard key={v.vendor.id} vendor={v.vendor} primaryCategory={v.primaryCategory} nextMarket={v.nextMarket} />
          ))
        ) : loaded ? (
          <p className="text-sm text-neutral-500 px-3">No vendors found{selectedMarket ? ` at ${selectedMarket.name}` : ''}.</p>
        ) : (
          [0, 1, 2].map((i) => <div key={i} className="w-56 h-56 bg-neutral-100 rounded-xl animate-pulse" />)
        )}
      </Rail>

      {/* Markets near you */}
      <section className="px-3 md:px-6 mt-8">
        <h2 className="text-lg font-semibold text-neutral-900 mb-3">Markets near you</h2>
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 snap-x">
          {marketsNearby.map((m) => (
            <Link
              key={m.id}
              href={`/explore?market=${m.slug}`}
              data-testid="market-card"
              className="flex-shrink-0 w-52 bg-white border border-neutral-200 rounded-xl p-4 snap-start"
            >
              <p className="font-medium text-neutral-900 line-clamp-1">{m.name}</p>
              <p className="text-xs text-neutral-600 mt-1">{m.city}, {m.state}</p>
              <p className="text-xs text-[--color-accent] mt-2 font-medium">
                Next: {formatNextMarketDate(m.schedule_days)}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* From vendors you follow */}
      {isAuth && followedVendors.length > 0 && (
        <Rail title="From vendors you follow" seeAllHref="/following">
          {followedVendors.map((v) => (
            <VendorCard key={v.vendor.id} vendor={v.vendor} primaryCategory={v.primaryCategory} nextMarket={v.nextMarket} />
          ))}
        </Rail>
      )}

      {/* Recently viewed */}
      {recentlyViewed.length > 0 && (
        <Rail title="Recently viewed">
          {recentlyViewed.map((v) => (
            <VendorCard key={v.vendor.id} vendor={v.vendor} primaryCategory={v.primaryCategory} nextMarket={v.nextMarket} compact />
          ))}
        </Rail>
      )}

      <div className="px-3 md:px-6 mt-10">
        <Link href="/explore" className="block w-full text-center bg-neutral-100 hover:bg-neutral-200 rounded-xl py-3 text-sm font-medium text-neutral-800">
          Explore all categories →
        </Link>
      </div>

      <div className="mt-10">
        <RecruitmentGrid />
      </div>
    </main>
  )
}

function Rail({ title, seeAllHref, children }: { title: string; seeAllHref?: string; children: React.ReactNode }) {
  return (
    <section className="px-3 md:px-6 mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
        {seeAllHref && (
          <Link href={seeAllHref} className="text-sm text-[--color-accent] font-medium">
            See all →
          </Link>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 snap-x">{children}</div>
    </section>
  )
}
