'use client'

import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import type { Business } from '@/lib/types'
import { MAP_DEFAULTS } from '@/lib/map-config'

export interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

export function useMapBusinesses() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = createClient()

  const fetchBusinesses = useCallback(async (bounds: Bounds | null, category?: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(async () => {
      setLoading(true)
      let query = supabase
        .from('businesses')
        .select('*')

      // Apply bounds filter only when no category search (browsing the map)
      // Category searches query globally so we can zoom to results
      if (bounds && !category) {
        query = query
          .gte('latitude', bounds.south)
          .lte('latitude', bounds.north)
          .gte('longitude', bounds.west)
          .lte('longitude', bounds.east)
      }

      if (category) {
        query = query.ilike('category', `%${category}%`)
      }

      const { data, error } = await query.limit(500)

      if (!error && data) {
        setBusinesses(data as Business[])
      }
      setLoading(false)
    }, MAP_DEFAULTS.debounceMs)
  }, [])

  return { businesses, loading, fetchBusinesses }
}
