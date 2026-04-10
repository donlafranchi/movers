'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

interface CategoryInputProps {
  value: string
  onChange: (value: string) => void
  error?: string
}

export function CategoryInput({ value, onChange, error }: CategoryInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchSuggestions = useCallback((query: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query.trim()) {
      setSuggestions([])
      return
    }

    timerRef.current = setTimeout(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('businesses')
        .select('category')
        .ilike('category', `%${query}%`)
        .limit(20)

      if (data) {
        const unique = [...new Set(data.map((d) => d.category))]
        setSuggestions(unique.slice(0, 5))
      }
    }, 300)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} data-testid="field-category" className="relative">
      <span className="text-sm font-medium">Category</span>
      <input
        type="text"
        required
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          fetchSuggestions(e.target.value)
          setShowSuggestions(true)
        }}
        onFocus={() => value && setShowSuggestions(true)}
        placeholder="e.g. Restaurant, Veterinary, Grocery"
        className="mt-1 block w-full rounded border px-3 py-2 text-sm"
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border rounded shadow-lg z-10">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onChange(s)
                setShowSuggestions(false)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {error && <p data-testid="field-error" className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  )
}
