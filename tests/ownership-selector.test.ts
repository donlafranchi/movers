import { describe, it, expect } from 'vitest'
import { SELECTOR_OPTIONS } from '@/components/OwnershipSelector'

describe('SELECTOR_OPTIONS', () => {
  it('has 6 ownership tiers', () => {
    expect(SELECTOR_OPTIONS).toHaveLength(6)
  })

  it('each option has a tier and description', () => {
    SELECTOR_OPTIONS.forEach((opt) => {
      expect(opt.tier).toBeTruthy()
      expect(opt.description).toBeTruthy()
      expect(opt.description.length).toBeGreaterThan(10)
    })
  })

  it('includes all required tiers', () => {
    const tiers = SELECTOR_OPTIONS.map((o) => o.tier)
    expect(tiers).toContain('independent')
    expect(tiers).toContain('coop')
    expect(tiers).toContain('local-franchise')
    expect(tiers).toContain('challenger')
    expect(tiers).toContain('mission-driven')
    expect(tiers).toContain('pe-corporate')
  })
})
