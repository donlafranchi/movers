import { describe, it, expect } from 'vitest'
import { validateHandle, suggestHandles } from './handles'

// T089 — pure handle helpers.

describe('T089 — validateHandle', () => {
  it('accepts 4–30 lowercase/number/hyphen handles', () => {
    expect(validateHandle('maya')).toBe(true)
    expect(validateHandle('oak-park-maya')).toBe(true)
    expect(validateHandle('a1b2')).toBe(true)
  })
  it('rejects too short, too long, uppercase, spaces, symbols', () => {
    expect(validateHandle('ab')).toBe(false)
    expect(validateHandle('a'.repeat(31))).toBe(false)
    expect(validateHandle('Maya')).toBe(false)
    expect(validateHandle('maya jones')).toBe(false)
    expect(validateHandle('maya!')).toBe(false)
  })
})

describe('T089 — suggestHandles', () => {
  it('returns up to 3 valid, deterministic candidates', () => {
    const a = suggestHandles('maya')
    const b = suggestHandles('maya')
    expect(a).toEqual(b) // deterministic — no RNG
    expect(a.length).toBeGreaterThanOrEqual(1)
    expect(a.length).toBeLessThanOrEqual(3)
    for (const s of a) expect(validateHandle(s)).toBe(true)
    expect(a).toContain('maya-2')
  })
  it('cleans an invalid base into valid suggestions', () => {
    for (const s of suggestHandles('Maya Jones!')) expect(validateHandle(s)).toBe(true)
  })
})
