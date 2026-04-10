'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAP_DEFAULTS, PIN_COLORS } from '@/lib/map-config'
import { useMapBusinesses, type Bounds } from '@/hooks/useMapBusinesses'
import type { Business, OwnershipTier } from '@/lib/types'

export function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
  const { businesses, fetchBusinesses } = useMapBusinesses()

  const getBounds = useCallback((): Bounds | null => {
    const map = mapRef.current
    if (!map) return null
    const b = map.getBounds()
    if (!b) return null
    return {
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    }
  }, [])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_DEFAULTS.style,
      center: MAP_DEFAULTS.center,
      zoom: MAP_DEFAULTS.zoom,
    })

    mapRef.current = map

    map.on('load', () => {
      const bounds = getBounds()
      if (bounds) fetchBusinesses(bounds)
    })

    map.on('moveend', () => {
      const bounds = getBounds()
      if (bounds) fetchBusinesses(bounds)
    })

    // Try geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: MAP_DEFAULTS.geolocatedZoom,
          })
        },
        () => {
          // Denied or error — stay on default center
        }
      )
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Sync markers with businesses
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clear old markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    businesses.forEach((biz) => {
      if (biz.latitude == null || biz.longitude == null) return

      const tier = biz.ownership_tier as OwnershipTier
      const pinConfig = PIN_COLORS[tier]
      if (!pinConfig) return

      const el = document.createElement('div')
      el.setAttribute('data-testid', 'map-pin')
      el.setAttribute('data-ownership', tier)
      el.setAttribute('data-color', pinConfig.name)
      el.setAttribute('data-business-id', biz.id)
      el.style.width = '24px'
      el.style.height = '24px'
      el.style.borderRadius = '50%'
      el.style.backgroundColor = pinConfig.hex
      el.style.border = '2px solid white'
      el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
      el.style.cursor = 'pointer'

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setSelectedBusiness(biz)
      })

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([biz.longitude, biz.latitude])
        .addTo(map)

      markersRef.current.push(marker)
    })
  }, [businesses])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-testid="map" className="h-full w-full" />
      {selectedBusiness && (
        <div
          data-testid="business-detail-card"
          className="absolute bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 rounded-t-2xl shadow-lg p-4 z-10"
        >
          <button
            onClick={() => setSelectedBusiness(null)}
            className="absolute top-2 right-3 text-zinc-400 text-xl"
            aria-label="Close"
          >
            ×
          </button>
          <h2 className="text-lg font-bold">{selectedBusiness.name}</h2>
          <p className="text-sm text-zinc-500 capitalize">
            {PIN_COLORS[selectedBusiness.ownership_tier]?.name} — {selectedBusiness.ownership_tier.replace('-', ' ')}
          </p>
          <p className="text-sm mt-1">
            {selectedBusiness.street_address}, {selectedBusiness.city}, {selectedBusiness.state}
          </p>
        </div>
      )}
    </div>
  )
}
