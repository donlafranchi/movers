import { describe, it, expect } from 'vitest'
import { BADGE_DESCRIPTIONS } from '@/components/OwnershipBadge'
import { PIN_COLORS } from '@/lib/map-config'
import type { OwnershipTier } from '@/lib/types'

const ALL_TIERS: OwnershipTier[] = [
  'independent', 'coop', 'local-franchise', 'challenger', 'mission-driven', 'pe-corporate',
]

describe('BADGE_DESCRIPTIONS', () => {
  it('has a description for every ownership tier', () => {
    ALL_TIERS.forEach((tier) => {
      expect(BADGE_DESCRIPTIONS[tier]).toBeDefined()
      expect(BADGE_DESCRIPTIONS[tier].length).toBeGreaterThan(0)
    })
  })

  it('has a matching PIN_COLOR for every badge tier', () => {
    ALL_TIERS.forEach((tier) => {
      expect(PIN_COLORS[tier]).toBeDefined()
    })
  })

  it('independent says locally owned', () => {
    expect(BADGE_DESCRIPTIONS.independent).toContain('Locally owned')
  })

  it('pe-corporate mentions private equity', () => {
    expect(BADGE_DESCRIPTIONS['pe-corporate'].toLowerCase()).toContain('private equity')
  })

  it('mission-driven mentions B Corp', () => {
    expect(BADGE_DESCRIPTIONS['mission-driven']).toContain('B Corp')
  })
})
