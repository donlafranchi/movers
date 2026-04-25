'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { User, Search } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import type { PlatformEvent, Vendor, Market, VendorBulletin } from '@/lib/types'
import { useMarket } from './MarketContext'
import { AuthCtaButtons } from './AuthCtaButtons'
import { RecruitmentGrid } from './RecruitmentGrid'
import { EventCard, buildHostMaps } from './EventCard'
import { BulletinFeedCard } from './BulletinFeedCard'

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

type FilterChip = 'all' | 'markets' | 'specials'

const FILTERS: { id: FilterChip; label: string; types: string[] | null }[] = [
  { id: 'all', label: 'All', types: null },
  { id: 'markets', label: 'Markets', types: ['market_session'] },
  { id: 'specials', label: 'Vendor Specials', types: ['vendor_special'] },
]

const FEED_LIMIT = 50
const WINDOW_DAYS = 30

interface BulletinWithVendor {
  bulletin: VendorBulletin
  vendor: Vendor
}

export function HomeFeed() {
  const { selectedMarket } = useMarket()
  const [isAuth, setIsAuth] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterChip>('all')
  const [events, setEvents] = useState<PlatformEvent[]>([])
  const [vendorMap, setVendorMap] = useState<ReturnType<typeof buildHostMaps>['vendorMap']>(new Map())
  const [marketMap, setMarketMap] = useState<ReturnType<typeof buildHostMaps>['marketMap']>(new Map())
  const [bulletins, setBulletins] = useState<BulletinWithVendor[]>([])
  const [mutedVendorIds, setMutedVendorIds] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/jobs/generate-market-sessions', { method: 'POST' }).catch(() => {})
  }, [])

  useEffect(() => {
    const client = supabase()
    let cancelled = false

    async function load() {
      const { data: userData } = await client.auth.getUser()
      const uid = userData.user?.id
      const authed = !!uid
      if (cancelled) return
      setIsAuth(authed)
      setUserId(uid ?? null)

      const now = new Date().toISOString()
      const horizon = new Date(Date.now() + WINDOW_DAYS * 24 * 3600 * 1000).toISOString()

      const [{ data: ev }, { data: vRows }, { data: mRows }] = await Promise.all([
        client
          .from('events')
          .select('*')
          .eq('status', 'scheduled')
          .gte('starts_at', now)
          .lte('starts_at', horizon)
          .order('starts_at', { ascending: true })
          .limit(FEED_LIMIT),
        client.from('businesses').select('*'),
        client.from('markets').select('*'),
      ])

      if (cancelled) return

      const allVendors = (vRows ?? []) as Vendor[]
      const allMarkets = (mRows ?? []) as Market[]
      const { vendorMap: vm, marketMap: mm } = buildHostMaps(allVendors, allMarkets)
      setVendorMap(vm)
      setMarketMap(mm)
      setEvents((ev ?? []) as PlatformEvent[])

      if (authed && uid) {
        const [{ data: follows }, { data: mutes }] = await Promise.all([
          client.from('follows').select('vendor_id').eq('user_id', uid).is('unfollowed_at', null),
          client.from('bulletin_mutes').select('vendor_id').eq('user_id', uid),
        ])
        const muteSet = new Set((mutes ?? []).map((m) => m.vendor_id))
        setMutedVendorIds(muteSet)
        const followIds = (follows ?? []).map((f) => f.vendor_id).filter((id) => !muteSet.has(id))
        if (followIds.length > 0) {
          const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
          const { data: bulls } = await client
            .from('vendor_bulletins')
            .select('*')
            .in('vendor_id', followIds)
            .not('published_at', 'is', null)
            .gte('published_at', since)
            .order('published_at', { ascending: false })
            .limit(10)
          const list: BulletinWithVendor[] = ((bulls ?? []) as VendorBulletin[])
            .map((b) => {
              const v = allVendors.find((x) => x.id === b.vendor_id)
              return v ? { bulletin: b, vendor: v } : null
            })
            .filter((x): x is BulletinWithVendor => !!x)
          setBulletins(list)
        }
      }

      setLoaded(true)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [selectedMarket])

  const visible = filter === 'all'
    ? events
    : events.filter((e) => FILTERS.find((f) => f.id === filter)!.types!.includes(e.event_type))

  return (
    <main className="pb-40 md:pb-24" data-testid="home-feed">
      {/* Mobile top header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-neutral-200 md:hidden">
        <div className="px-3 py-2 flex items-center justify-between gap-2">
          <Link href="/" className="font-semibold text-[--color-accent]">Main Street</Link>
          {isAuth ? (
            <Link href="/you" aria-label="You" className="p-2">
              <User size={20} className="text-neutral-700" />
            </Link>
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

      <section className="px-3 md:px-6 pt-4">
        <h1 className="text-xl md:text-2xl font-semibold text-neutral-900">
          {selectedMarket ? `What's on near ${selectedMarket.name}` : "What's happening near you"}
        </h1>
        <p className="text-sm text-neutral-600 mt-1">
          Markets, vendor specials, and community events in the next 30 days.
        </p>
      </section>

      {/* Filter chips */}
      <nav className="px-3 md:px-6 mt-4 flex gap-2 overflow-x-auto" data-testid="feed-filters">
        {FILTERS.map((f) => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              type="button"
              data-testid="feed-filter-chip"
              data-active={active}
              onClick={() => setFilter(f.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-[--color-accent] text-white'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </nav>

      {/* Pinned bulletins */}
      {bulletins.filter((b) => !mutedVendorIds.has(b.vendor.id)).length > 0 && (
        <section className="px-3 md:px-6 mt-6" data-testid="bulletin-pinned-section">
          <h2 className="text-lg font-semibold text-neutral-900 mb-3">From vendors you follow</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {bulletins
              .filter((b) => !mutedVendorIds.has(b.vendor.id))
              .map((b) => (
                <BulletinFeedCard
                  key={b.bulletin.id}
                  bulletin={b.bulletin}
                  vendor={b.vendor}
                  userId={userId}
                  onMute={(vid) => setMutedVendorIds((prev) => new Set(prev).add(vid))}
                />
              ))}
          </div>
        </section>
      )}

      {/* Event grid */}
      <section className="px-3 md:px-6 mt-6">
        {!loaded ? (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-56 rounded-xl bg-neutral-100 animate-pulse" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12 px-6 border border-dashed border-neutral-300 rounded-xl">
            <p className="text-sm text-neutral-600">
              No upcoming events near {selectedMarket?.name ?? 'you'}.
            </p>
            <Link
              href="/explore"
              className="mt-4 inline-flex items-center justify-center rounded-full bg-[--color-accent] text-white px-4 py-2 text-sm font-medium"
            >
              Explore vendors →
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
            {visible.map((e) => {
              const host = e.host_type === 'vendor' ? vendorMap.get(e.host_id) : marketMap.get(e.host_id)
              if (!host) return null
              return (
                <EventCard
                  key={e.id}
                  event={e}
                  hostName={host.name}
                  hostSlug={host.slug}
                  hostType={e.host_type === 'market' ? 'market' : 'vendor'}
                  hostCoverPhotoUrl={host.coverPhotoUrl}
                />
              )
            })}
          </div>
        )}
      </section>

      <div className="mt-12">
        <RecruitmentGrid />
      </div>
    </main>
  )
}
