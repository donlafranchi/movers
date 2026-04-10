'use client'

import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { PIN_COLORS } from '@/lib/map-config'
import type { OwnershipTier } from '@/lib/types'

interface MapPreviewProps {
  latitude: number
  longitude: number
  ownershipTier: OwnershipTier
}

export function MapPreview({ latitude, longitude, ownershipTier }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [longitude, latitude],
      zoom: 14,
      interactive: false,
    })

    const pinConfig = PIN_COLORS[ownershipTier]
    const el = document.createElement('div')
    el.style.width = '24px'
    el.style.height = '24px'
    el.style.borderRadius = '50%'
    el.style.backgroundColor = pinConfig.hex
    el.style.border = '2px solid white'
    el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'

    new mapboxgl.Marker({ element: el }).setLngLat([longitude, latitude]).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [latitude, longitude, ownershipTier])

  return (
    <div
      data-testid="map-preview"
      ref={containerRef}
      className="w-full h-48 rounded-xl overflow-hidden"
    />
  )
}
