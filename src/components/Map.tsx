'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAP_DEFAULTS, PIN_COLORS, CLUSTER_CONFIG } from '@/lib/map-config'
import { useMapBusinesses, type Bounds } from '@/hooks/useMapBusinesses'
import type { Business, OwnershipTier } from '@/lib/types'

const SOURCE_ID = 'businesses'

function businessesToGeoJSON(businesses: Business[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: businesses
      .filter((b) => b.latitude != null && b.longitude != null)
      .map((b) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [b.longitude!, b.latitude!] },
        properties: {
          id: b.id,
          name: b.name,
          ownership_tier: b.ownership_tier,
          street_address: b.street_address,
          city: b.city,
          state: b.state,
          category: b.category,
        },
      })),
  }
}

export function Map() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({})
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
      // Add clustered GeoJSON source
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: CLUSTER_CONFIG.clusterMaxZoom,
        clusterRadius: CLUSTER_CONFIG.clusterRadius,
      })

      // Invisible layers for querying — rendering is done via HTML markers
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: { 'circle-radius': 0, 'circle-opacity': 0 },
      })

      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: { 'circle-radius': 0, 'circle-opacity': 0 },
      })

      const bounds = getBounds()
      if (bounds) fetchBusinesses(bounds)
    })

    map.on('moveend', () => {
      const bounds = getBounds()
      if (bounds) fetchBusinesses(bounds)
    })

    // Re-render markers when the map finishes rendering (zoom, move, source data update)
    map.on('render', () => {
      if (!map.isSourceLoaded(SOURCE_ID)) return
      updateMarkers(map)
    })

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: MAP_DEFAULTS.geolocatedZoom,
          })
        },
        () => {}
      )
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  function updateMarkers(map: mapboxgl.Map) {
    const features = map.querySourceFeatures(SOURCE_ID)
    const newMarkerIds = new Set<string>()

    for (const feature of features) {
      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
      const props = feature.properties!

      if (props.cluster) {
        const clusterId = props.cluster_id as number
        const count = props.point_count as number
        const key = `cluster-${clusterId}`
        newMarkerIds.add(key)

        if (!markersRef.current[key]) {
          const el = document.createElement('div')
          el.setAttribute('data-testid', 'map-cluster')
          el.textContent = String(count)
          el.style.width = '36px'
          el.style.height = '36px'
          el.style.borderRadius = '50%'
          el.style.backgroundColor = '#374151'
          el.style.color = 'white'
          el.style.display = 'flex'
          el.style.alignItems = 'center'
          el.style.justifyContent = 'center'
          el.style.fontSize = '13px'
          el.style.fontWeight = '700'
          el.style.border = '2px solid white'
          el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
          el.style.cursor = 'pointer'

          el.addEventListener('click', (e) => {
            e.stopPropagation()
            const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource
            source.getClusterExpansionZoom(clusterId, (_err, zoom) => {
              if (zoom != null) map.flyTo({ center: coords, zoom })
            })
          })

          const marker = new mapboxgl.Marker({ element: el }).setLngLat(coords).addTo(map)
          markersRef.current[key] = marker
        }
      } else {
        const id = props.id as string
        const key = `pin-${id}`
        newMarkerIds.add(key)

        if (!markersRef.current[key]) {
          const tier = props.ownership_tier as OwnershipTier
          const pinConfig = PIN_COLORS[tier]
          if (!pinConfig) continue

          const el = document.createElement('div')
          el.setAttribute('data-testid', 'map-pin')
          el.setAttribute('data-ownership', tier)
          el.setAttribute('data-color', pinConfig.name)
          el.setAttribute('data-business-id', id)
          el.style.width = '24px'
          el.style.height = '24px'
          el.style.borderRadius = '50%'
          el.style.backgroundColor = pinConfig.hex
          el.style.border = '2px solid white'
          el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)'
          el.style.cursor = 'pointer'

          el.addEventListener('click', (e) => {
            e.stopPropagation()
            const biz = businesses.find((b) => b.id === id)
            if (biz) setSelectedBusiness(biz)
          })

          const marker = new mapboxgl.Marker({ element: el }).setLngLat(coords).addTo(map)
          markersRef.current[key] = marker
        }
      }
    }

    // Remove markers that are no longer in view
    for (const key of Object.keys(markersRef.current)) {
      if (!newMarkerIds.has(key)) {
        markersRef.current[key].remove()
        delete markersRef.current[key]
      }
    }
  }

  // Update GeoJSON source when businesses change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
    if (!source) return

    // Clear existing markers so they get recreated with fresh data
    for (const key of Object.keys(markersRef.current)) {
      markersRef.current[key].remove()
      delete markersRef.current[key]
    }

    source.setData(businessesToGeoJSON(businesses))
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
