'use client'

import { useState, useEffect } from 'react'
import { MapPin } from 'lucide-react'
import { useMarket } from './MarketContext'
import { MarketSelector } from './MarketSelector'

export function MarketPill() {
  const { selectedMarket } = useMarket()
  const [open, setOpen] = useState(false)
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => setUserLocation(null),
      { maximumAge: 600000, timeout: 5000 }
    )
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="market-pill"
        className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-800 transition-colors"
      >
        <MapPin size={14} className="text-emerald-700" />
        {selectedMarket ? (
          <>
            <span className="text-neutral-500">Your Market:</span>
            <span className="truncate max-w-[14ch]">{selectedMarket.name}</span>
          </>
        ) : (
          <span>Select your market</span>
        )}
      </button>
      <MarketSelector open={open} onClose={() => setOpen(false)} userLocation={userLocation} />
    </>
  )
}
