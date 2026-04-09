import { describe, it, expect } from 'vitest'
import { OWNERSHIP_TIERS, REPORT_PILLARS } from '@/lib/types'
import type { OwnershipTier, ReportPillar } from '@/lib/types'

describe('OWNERSHIP_TIERS', () => {
  it('has exactly 6 tiers', () => {
    expect(Object.keys(OWNERSHIP_TIERS)).toHaveLength(6)
  })

  it('includes all expected tiers', () => {
    const expected: OwnershipTier[] = [
      'independent', 'coop', 'local-franchise', 'challenger', 'mission-driven', 'pe-corporate',
    ]
    expect(Object.keys(OWNERSHIP_TIERS).sort()).toEqual(expected.sort())
  })

  it('each tier has label, color, and description', () => {
    for (const tier of Object.values(OWNERSHIP_TIERS)) {
      expect(tier.label).toBeTruthy()
      expect(tier.color).toBeTruthy()
      expect(tier.description).toBeTruthy()
    }
  })
})

describe('REPORT_PILLARS', () => {
  it('has exactly 4 pillars', () => {
    expect(Object.keys(REPORT_PILLARS)).toHaveLength(4)
  })

  it('includes all expected pillars', () => {
    const expected: ReportPillar[] = ['customers', 'employees', 'community', 'planet']
    expect(Object.keys(REPORT_PILLARS).sort()).toEqual(expected.sort())
  })

  it('each pillar has emoji, label, and description', () => {
    for (const pillar of Object.values(REPORT_PILLARS)) {
      expect(pillar.emoji).toBeTruthy()
      expect(pillar.label).toBeTruthy()
      expect(pillar.description).toBeTruthy()
    }
  })
})
