import { describe, it, expect } from 'vitest'
import { toSlug } from '@/lib/slugify'

describe('toSlug edge cases for listing URLs', () => {
  it('handles accented characters', () => {
    expect(toSlug('Café Boulangerie')).toBe('caf-boulangerie')
  })

  it('handles numbers', () => {
    expect(toSlug('Route 66 Diner')).toBe('route-66-diner')
  })

  it('handles all-special input', () => {
    expect(toSlug('!@#$%')).toBe('')
  })

  it('generates URL-safe slugs', () => {
    const slug = toSlug('The Best Vet in Austin, TX!')
    expect(slug).toMatch(/^[a-z0-9-]+$/)
  })
})
