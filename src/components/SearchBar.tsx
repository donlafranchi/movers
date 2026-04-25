'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useSearchSuggestions, type Suggestion } from '@/hooks/useSearchSuggestions'

interface SearchBarProps {
  onCategorySelect: (category: string) => void
  onLocationSelect: (coordinates: [number, number]) => void
  onCombinedSelect: (category: string, coordinates: [number, number]) => void
  onClear: () => void
  onNoResults: (query: string) => void
}

export function SearchBar({
  onCategorySelect,
  onLocationSelect,
  onCombinedSelect,
  onClear,
  onNoResults,
}: SearchBarProps) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { suggestions, search, clear: clearSuggestions } = useSearchSuggestions()

  const handleFocus = useCallback(() => {
    setExpanded(true)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleChange = useCallback((value: string) => {
    setQuery(value)
    search(value)
  }, [search])

  const handleSuggestionClick = useCallback((suggestion: Suggestion) => {
    setQuery(suggestion.label)
    setHasSelection(true)
    setExpanded(false)
    clearSuggestions()
    inputRef.current?.blur()

    // Check for combined search: "category in location"
    const inMatch = query.match(/^(.+?)\s+in\s+(.+)$/i)

    if (suggestion.type === 'category') {
      if (inMatch && suggestion.coordinates) {
        onCombinedSelect(suggestion.value, suggestion.coordinates)
      } else {
        onCategorySelect(suggestion.value)
      }
    } else if (suggestion.type === 'location' && suggestion.coordinates) {
      if (inMatch) {
        const categoryTerm = inMatch[1].trim()
        onCombinedSelect(categoryTerm, suggestion.coordinates)
      } else {
        onLocationSelect(suggestion.coordinates)
      }
    }
  }, [query, onCategorySelect, onLocationSelect, onCombinedSelect, clearSuggestions])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    // If there are suggestions, select the first one
    if (suggestions.length > 0) {
      handleSuggestionClick(suggestions[0])
    } else {
      onNoResults(query.trim())
    }
  }, [query, suggestions, handleSuggestionClick, onNoResults])

  const handleClear = useCallback(() => {
    setQuery('')
    setHasSelection(false)
    setExpanded(false)
    clearSuggestions()
    inputRef.current?.blur()
    onClear()
  }, [clearSuggestions, onClear])

  return (
    <div
      ref={containerRef}
      data-testid="search-bar"
      className="absolute bottom-6 left-4 right-4 z-20"
    >
      {expanded && suggestions.length > 0 && (
        <div
          data-testid="search-suggestions"
          className="mb-2 bg-white rounded-2xl shadow-[0_6px_16px_rgba(0,0,0,0.12)] overflow-hidden border border-[--color-border]"
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.type}-${s.value}-${i}`}
              data-testid="search-suggestion"
              onClick={() => handleSuggestionClick(s)}
              className="w-full text-left px-4 py-3 text-sm hover:bg-[--color-surface] flex items-center gap-3 border-b last:border-b-0 border-[--color-border] transition-colors"
            >
              <span className="text-[--color-fg-muted] text-xs w-5">
                {s.type === 'category' ? '🏷' : '📍'}
              </span>
              <span className="text-[--color-fg]">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative">
        <div className="flex items-center bg-white rounded-full shadow-[0_6px_16px_rgba(0,0,0,0.12)] border border-[--color-border] px-5 py-3.5">
          <svg
            className="w-5 h-5 text-[--color-fg-muted] mr-3 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            data-testid="search-input"
            type="text"
            placeholder="Search businesses..."
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={handleFocus}
            className="flex-1 bg-transparent outline-none text-sm text-[--color-fg] placeholder:text-[--color-fg-muted]"
          />
          {hasSelection && (
            <button
              type="button"
              data-testid="search-clear"
              onClick={handleClear}
              className="ml-2 text-[--color-fg-muted] hover:text-[--color-fg] transition-colors"
              aria-label="Clear search"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
