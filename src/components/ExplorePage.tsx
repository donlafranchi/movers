'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, X, MapIcon, List } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import type { Vendor, Market, VendorCategory, WeekdaySlug } from '@/lib/types'
import { CATEGORIES, CATEGORY_ORDER, type CategorySlug } from '@/lib/categories'
import { WEEKDAYS } from '@/lib/types'
import { useMarket } from './MarketContext'
import { VendorCard } from './VendorCard'
import { MarketPill } from './MarketPill'

const ExploreMap = dynamic(() => import('./ExploreMap').then((m) => m.ExploreMap), { ssr: false })

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

const TRENDING = ['sourdough', 'honey', 'tomatoes', 'soap', 'eggs', 'flowers']

interface VendorRow {
  vendor: Vendor
  primaryCategory: string | null
  marketIds: string[]
}

export function ExplorePage() {
  const router = useRouter()
  const params = useSearchParams()
  const { selectedMarket, allMarkets } = useMarket()

  const [query, setQuery] = useState(params.get('q') ?? '')
  const [view, setView] = useState<'list' | 'map'>((params.get('view') as 'list' | 'map') ?? 'list')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(params.get('category'))
  const [marketSlugFilter, setMarketSlugFilter] = useState<string | null>(params.get('market'))
  const [dayFilter, setDayFilter] = useState<WeekdaySlug | null>((params.get('day') as WeekdaySlug) ?? null)

  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [loaded, setLoaded] = useState(false)

  const marketBySlug = useMemo(() => new Map(allMarkets.map((m) => [m.slug, m])), [allMarkets])
  const marketById = useMemo(() => new Map(allMarkets.map((m) => [m.id, m])), [allMarkets])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const client = supabase()
      const [{ data: vRows }, { data: cRows }, { data: mvRows }] = await Promise.all([
        client.from('businesses').select('*'),
        client.from('vendor_categories').select('*'),
        client.from('market_vendors').select('vendor_id, market_id'),
      ])
      if (cancelled) return
      const allVendors = (vRows ?? []) as Vendor[]
      const allCats = (cRows ?? []) as VendorCategory[]
      const allLinks = (mvRows ?? []) as { vendor_id: string; market_id: string }[]

      const rows = allVendors.map((v) => {
        const myCats = allCats.filter((c) => c.vendor_id === v.id)
        const primary = myCats.find((c) => c.is_primary)?.category_slug ?? myCats[0]?.category_slug ?? null
        const marketIds = allLinks.filter((l) => l.vendor_id === v.id).map((l) => l.market_id)
        return { vendor: v, primaryCategory: primary, marketIds }
      })
      setVendors(rows)
      setLoaded(true)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const sp = new URLSearchParams()
    if (query) sp.set('q', query)
    if (categoryFilter) sp.set('category', categoryFilter)
    if (marketSlugFilter) sp.set('market', marketSlugFilter)
    if (dayFilter) sp.set('day', dayFilter)
    if (view !== 'list') sp.set('view', view)
    const qs = sp.toString()
    router.replace(`/explore${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [query, categoryFilter, marketSlugFilter, dayFilter, view, router])

  const effectiveMarketSlug = marketSlugFilter ?? selectedMarket?.slug ?? null
  const effectiveMarket = effectiveMarketSlug ? marketBySlug.get(effectiveMarketSlug) ?? null : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vendors.filter((row) => {
      if (categoryFilter && row.primaryCategory !== categoryFilter) {
        const cats = vendors.find((v) => v.vendor.id === row.vendor.id)
        if (!cats) return false
      }
      if (categoryFilter) {
        const cat = row.primaryCategory
        if (cat !== categoryFilter) return false
      }
      if (effectiveMarket) {
        if (!row.marketIds.includes(effectiveMarket.id)) return false
      }
      if (dayFilter) {
        const matchedAny = row.marketIds.some((id) => marketById.get(id)?.schedule_days.includes(dayFilter))
        if (!matchedAny) return false
      }
      if (q) {
        const hay = `${row.vendor.name} ${row.vendor.tagline ?? ''} ${row.primaryCategory ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [vendors, query, categoryFilter, effectiveMarket, dayFilter, marketById])

  const showEmptyState = !query && !categoryFilter && !marketSlugFilter && !dayFilter

  const clearAll = () => {
    setQuery('')
    setCategoryFilter(null)
    setMarketSlugFilter(null)
    setDayFilter(null)
  }

  const anyFilter = !!(query || categoryFilter || marketSlugFilter || dayFilter)

  return (
    <main className="pb-64 md:pb-24" data-testid="explore-page">
      {/* Desktop top header */}
      <header className="hidden md:block sticky top-14 z-20 bg-white border-b border-neutral-200">
        <div className="max-w-5xl mx-auto p-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              placeholder="Search vendors, products, markets"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="search-input-desktop"
              className="w-full pl-9 pr-9 py-2.5 text-sm border border-neutral-300 rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
          <div className="mt-3 flex gap-2 items-center">
            <MarketPill />
            <FilterChip
              label={categoryFilter ? CATEGORIES[categoryFilter as CategorySlug]?.label ?? 'Category' : 'Category'}
              active={!!categoryFilter}
              onClear={categoryFilter ? () => setCategoryFilter(null) : undefined}
              menuItems={CATEGORY_ORDER.map((slug) => ({
                label: `${CATEGORIES[slug].emoji} ${CATEGORIES[slug].label}`,
                onSelect: () => setCategoryFilter(slug),
                selected: categoryFilter === slug,
              }))}
            />
            <FilterChip
              label={dayFilter ? WEEKDAYS.find((w) => w.slug === dayFilter)?.short ?? 'Day' : 'Day'}
              active={!!dayFilter}
              onClear={dayFilter ? () => setDayFilter(null) : undefined}
              menuItems={WEEKDAYS.map((w) => ({
                label: w.long,
                onSelect: () => setDayFilter(w.slug),
                selected: dayFilter === w.slug,
              }))}
            />
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => setView('list')}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md ${
                  view === 'list' ? 'bg-emerald-700 text-white' : 'bg-neutral-100 text-neutral-700'
                }`}
              >
                <List size={14} /> List
              </button>
              <button
                type="button"
                onClick={() => setView('map')}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md ${
                  view === 'map' ? 'bg-emerald-700 text-white' : 'bg-neutral-100 text-neutral-700'
                }`}
              >
                <MapIcon size={14} /> Map
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile bottom-anchored controls — order from bottom up: nav, search, filters, view toggle */}
      <div
        className="fixed inset-x-0 z-40 md:hidden bg-white/95 backdrop-blur border-t border-neutral-200"
        style={{ bottom: 'calc(64px + env(safe-area-inset-bottom))' }}
        data-testid="bottom-controls"
      >
        {/* View toggle row (top of stack) */}
        <div className="px-3 pt-2 pb-1 flex gap-2">
          <button
            type="button"
            onClick={() => setView('list')}
            data-active={view === 'list'}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-sm rounded-md ${
              view === 'list' ? 'bg-emerald-700 text-white' : 'bg-neutral-100 text-neutral-700'
            }`}
          >
            <List size={14} /> List
          </button>
          <button
            type="button"
            onClick={() => setView('map')}
            data-active={view === 'map'}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 text-sm rounded-md ${
              view === 'map' ? 'bg-emerald-700 text-white' : 'bg-neutral-100 text-neutral-700'
            }`}
          >
            <MapIcon size={14} /> Map
          </button>
        </div>

        {/* Filter chips row */}
        <div className="px-3 py-2 flex gap-2 overflow-x-auto">
          <MarketPill />
          <FilterChip
            label={categoryFilter ? CATEGORIES[categoryFilter as CategorySlug]?.label ?? 'Category' : 'Category'}
            active={!!categoryFilter}
            onClear={categoryFilter ? () => setCategoryFilter(null) : undefined}
            menuItems={CATEGORY_ORDER.map((slug) => ({
              label: `${CATEGORIES[slug].emoji} ${CATEGORIES[slug].label}`,
              onSelect: () => setCategoryFilter(slug),
              selected: categoryFilter === slug,
            }))}
            placement="top"
          />
          <FilterChip
            label={dayFilter ? WEEKDAYS.find((w) => w.slug === dayFilter)?.short ?? 'Day' : 'Day'}
            active={!!dayFilter}
            onClear={dayFilter ? () => setDayFilter(null) : undefined}
            menuItems={WEEKDAYS.map((w) => ({
              label: w.long,
              onSelect: () => setDayFilter(w.slug),
              selected: dayFilter === w.slug,
            }))}
            placement="top"
          />
          {anyFilter && (
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-neutral-600 whitespace-nowrap px-2"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Search input row (closest to nav, easiest thumb reach) */}
        <div className="px-3 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              placeholder="Search vendors, products, markets"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="search-input"
              className="w-full pl-9 pr-9 py-2.5 text-sm border border-neutral-300 rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {showEmptyState ? (
        <section className="px-3 md:px-6 py-6 space-y-8">
          <div>
            <h2 className="text-sm font-semibold text-neutral-700 mb-2">Trending searches</h2>
            <div className="flex flex-wrap gap-2">
              {TRENDING.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setQuery(t)}
                  className="rounded-full bg-neutral-100 hover:bg-neutral-200 px-3 py-1 text-sm text-neutral-700"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-neutral-700 mb-2">Popular categories</h2>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORY_ORDER.map((slug) => {
                const meta = CATEGORIES[slug]
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => setCategoryFilter(slug)}
                    className="aspect-square bg-neutral-50 hover:bg-neutral-100 rounded-xl flex flex-col items-center justify-center gap-1 p-2"
                  >
                    <span className="text-2xl">{meta.emoji}</span>
                    <span className="text-[11px] font-medium text-neutral-700 text-center leading-tight">
                      {meta.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </section>
      ) : view === 'list' ? (
        <section className="px-3 md:px-6 py-4">
          <p className="text-sm text-neutral-600 mb-3" data-testid="result-count">
            {loaded ? (
              <>
                {filtered.length} vendor{filtered.length === 1 ? '' : 's'}
                {query && <> match &ldquo;{query}&rdquo;</>}
              </>
            ) : (
              'Loading…'
            )}
          </p>
          {filtered.length === 0 && loaded ? (
            <div className="text-center py-12 text-sm text-neutral-600">
              <p>No vendors match your filters.</p>
              <button onClick={clearAll} className="mt-2 text-emerald-700 underline">
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map((row) => (
                <li key={row.vendor.id}>
                  <VendorCard vendor={row.vendor} primaryCategory={row.primaryCategory} compact />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="h-[calc(100vh-260px)]">
          <ExploreMap vendors={filtered.map((r) => ({ vendor: r.vendor, primaryCategory: r.primaryCategory }))} />
        </section>
      )}
    </main>
  )
}

interface FilterChipProps {
  label: string
  active: boolean
  onClear?: () => void
  menuItems: { label: string; onSelect: () => void; selected: boolean }[]
  placement?: 'bottom' | 'top'
}

function FilterChip({ label, active, onClear, menuItems, placement = 'bottom' }: FilterChipProps) {
  const [open, setOpen] = useState(false)
  const menuPosClasses =
    placement === 'top' ? 'absolute z-50 bottom-full mb-1' : 'absolute z-50 top-full mt-1'
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium border transition-colors whitespace-nowrap ${
          active ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-neutral-700 border-neutral-300'
        }`}
      >
        {label}
        {active && onClear && (
          <span
            onClick={(e) => {
              e.stopPropagation()
              onClear()
              setOpen(false)
            }}
            className="ml-1"
            role="button"
          >
            <X size={12} />
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`${menuPosClasses} w-48 bg-white rounded-lg border border-neutral-200 shadow-lg max-h-64 overflow-y-auto`}>
            {menuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  item.onSelect()
                  setOpen(false)
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-neutral-100 ${
                  item.selected ? 'font-medium text-emerald-700' : 'text-neutral-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
