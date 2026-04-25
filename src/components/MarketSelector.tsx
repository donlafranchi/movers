'use client'

import { useMemo, useState } from 'react'
import { MapPin, X, Search } from 'lucide-react'
import type { Market } from '@/lib/types'
import { WEEKDAYS } from '@/lib/types'
import { useMarket } from './MarketContext'

interface Props {
  open: boolean
  onClose: () => void
  userLocation?: { latitude: number; longitude: number } | null
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3959
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function formatDays(days: string[]): string {
  return days.map((d) => WEEKDAYS.find((w) => w.slug === d)?.short ?? d).join(', ')
}

export function MarketSelector({ open, onClose, userLocation }: Props) {
  const { allMarkets, selectedMarket, setSelectedMarket } = useMarket()
  const [query, setQuery] = useState('')

  const annotated = useMemo(() => {
    return allMarkets.map((m) => {
      const distance = userLocation
        ? haversineMiles(
            { lat: userLocation.latitude, lng: userLocation.longitude },
            { lat: Number(m.latitude), lng: Number(m.longitude) }
          )
        : null
      return { market: m, distance }
    })
  }, [allMarkets, userLocation])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return annotated
    return annotated.filter(
      (a) =>
        a.market.name.toLowerCase().includes(q) ||
        a.market.city.toLowerCase().includes(q) ||
        a.market.state.toLowerCase().includes(q)
    )
  }, [annotated, query])

  const nearby = userLocation
    ? filtered.filter((a) => a.distance !== null && a.distance <= 25).sort((a, b) => (a.distance! - b.distance!))
    : []
  const others = userLocation
    ? filtered.filter((a) => a.distance === null || a.distance > 25).sort((a, b) => a.market.name.localeCompare(b.market.name))
    : filtered.sort((a, b) => a.market.name.localeCompare(b.market.name))

  if (!open) return null

  const handleSelect = (m: Market) => {
    setSelectedMarket(m)
    onClose()
  }

  const handleClear = () => {
    setSelectedMarket(null)
    onClose()
  }

  const renderRow = (a: { market: Market; distance: number | null }) => {
    const isSelected = selectedMarket?.id === a.market.id
    return (
      <button
        key={a.market.id}
        type="button"
        onClick={() => handleSelect(a.market)}
        data-market-slug={a.market.slug}
        data-selected={isSelected ? 'true' : 'false'}
        className={`w-full text-left border rounded-lg p-3 transition-colors ${
          isSelected ? 'border-[--color-accent] bg-[--color-accent-tint]' : 'border-neutral-200 hover:border-neutral-400'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium text-neutral-900">{a.market.name}</p>
            <p className="text-xs text-neutral-600 mt-0.5">
              {a.market.city}, {a.market.state}
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              {formatDays(a.market.schedule_days)}
              {a.market.schedule_start_time && a.market.schedule_end_time && (
                <> · {a.market.schedule_start_time}–{a.market.schedule_end_time}</>
              )}
            </p>
          </div>
          {a.distance !== null && (
            <span className="text-xs text-neutral-500 whitespace-nowrap">{a.distance.toFixed(1)} mi</span>
          )}
        </div>
      </button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        data-testid="market-selector"
        className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-neutral-200">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MapPin size={18} /> Your Market
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 border-b border-neutral-200">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              placeholder="Search markets by name or city"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[--color-accent]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {nearby.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Near You</h3>
              <div className="space-y-2">{nearby.map(renderRow)}</div>
            </div>
          )}
          {others.length > 0 && (
            <div>
              {nearby.length > 0 && (
                <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Other Markets</h3>
              )}
              <div className="space-y-2">{others.map(renderRow)}</div>
            </div>
          )}
          {filtered.length === 0 && (
            <p className="text-sm text-neutral-600 text-center py-8">No markets match &ldquo;{query}&rdquo;</p>
          )}
        </div>

        {selectedMarket && (
          <div className="p-4 border-t border-neutral-200">
            <button
              type="button"
              onClick={handleClear}
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              Clear selection
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
