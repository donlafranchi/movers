'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Vendor } from '@/lib/types'
import { getCategoryPinColor } from '@/lib/categories'
import { MAP_DEFAULTS } from '@/lib/map-config'

interface Item {
  vendor: Vendor
  primaryCategory: string | null
}

export function ExploreMap({ vendors }: { vendors: Item[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [selected, setSelected] = useState<Item | null>(null)

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
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    const bounds = new mapboxgl.LngLatBounds()
    let hasAny = false

    for (const item of vendors) {
      const v = item.vendor
      if (v.latitude == null || v.longitude == null) continue
      const el = document.createElement('div')
      el.style.cssText = `width:18px;height:18px;border-radius:50%;background:${getCategoryPinColor(item.primaryCategory ?? '')};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer`
      el.setAttribute('data-testid', 'map-pin')
      el.setAttribute('data-vendor-slug', v.slug)
      el.addEventListener('click', () => setSelected(item))
      const marker = new mapboxgl.Marker(el).setLngLat([v.longitude, v.latitude]).addTo(map)
      markersRef.current.push(marker)
      bounds.extend([v.longitude, v.latitude])
      hasAny = true
    }

    if (hasAny) map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 })
  }, [vendors])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" data-testid="explore-map" />
      {selected && (
        <div className="absolute bottom-4 left-4 right-4 bg-white rounded-xl shadow-lg p-3 border border-neutral-200">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-neutral-900 truncate">{selected.vendor.name}</p>
              {selected.vendor.tagline && (
                <p className="text-xs text-neutral-600 truncate">{selected.vendor.tagline}</p>
              )}
            </div>
            <Link
              href={`/vendors/${selected.vendor.slug}`}
              className="text-sm font-medium text-[--color-accent] whitespace-nowrap"
            >
              View →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
