import { describe, it, expect } from 'vitest'
import { toSlug } from '@/lib/slugify'

describe('toSlug', () => {
  it('converts to lowercase', () => {
    expect(toSlug('My Business')).toBe('my-business')
  })

  it('replaces spaces with hyphens', () => {
    expect(toSlug('The Coffee Shop')).toBe('the-coffee-shop')
  })

  it('removes special characters', () => {
    expect(toSlug("Joe's Bar & Grill")).toBe('joe-s-bar-grill')
  })

  it('trims leading and trailing hyphens', () => {
    expect(toSlug('  --Hello World--  ')).toBe('hello-world')
  })

  it('collapses multiple hyphens', () => {
    expect(toSlug('foo   bar')).toBe('foo-bar')
  })

  it('handles empty string', () => {
    expect(toSlug('')).toBe('')
  })
})
