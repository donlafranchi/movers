'use client'

import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { geocode, type GeocodingResult } from '@/lib/geocoding'

export interface Suggestion {
  type: 'category' | 'location'
  label: string
  value: string
  coordinates?: [number, number]
}

// Simple fuzzy: generates ilike patterns for common misspellings
function fuzzyPattern(term: string): string {
  return `%${term}%`
}

export function useSearchSuggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const supabase = createClient()

  const search = useCallback((query: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!query.trim()) {
      setSuggestions([])
      return
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true)

      // Parse "category in location" pattern
      const inMatch = query.match(/^(.+?)\s+in\s+(.+)$/i)
      const categoryTerm = inMatch ? inMatch[1].trim() : query.trim()
      const locationTerm = inMatch ? inMatch[2].trim() : query.trim()

      const results: Suggestion[] = []

      // Category search from database
      const { data: categories } = await supabase
        .from('businesses')
        .select('category')
        .ilike('category', fuzzyPattern(categoryTerm))
        .limit(20)

      if (categories) {
        const unique = [...new Set(categories.map((c) => c.category))]
        unique.slice(0, 5).forEach((cat) => {
          results.push({ type: 'category', label: cat, value: cat })
        })
      }

      // Location search from Mapbox
      if (!inMatch || locationTerm) {
        const locations = await geocode(locationTerm)
        locations.slice(0, 3).forEach((loc: GeocodingResult) => {
          results.push({
            type: 'location',
            label: loc.name,
            value: loc.name,
            coordinates: loc.coordinates,
          })
        })
      }

      setSuggestions(results)
      setLoading(false)
    }, 300)
  }, [])

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSuggestions([])
  }, [])

  return { suggestions, loading, search, clear }
}
