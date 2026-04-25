import { describe, it, expect } from 'vitest'
import { MAP_DEFAULTS, PIN_COLORS, CLUSTER_CONFIG } from '@/lib/map-config'
import type { OwnershipTier } from '@/lib/types'

describe('MAP_DEFAULTS', () => {
  it('has US center as default', () => {
    expect(MAP_DEFAULTS.center).toEqual([-98.5795, 39.8283])
  })

  it('has zoom level 4 for default view', () => {
    expect(MAP_DEFAULTS.zoom).toBe(4)
  })

  it('has zoom level 13 for geolocated view', () => {
    expect(MAP_DEFAULTS.geolocatedZoom).toBe(13)
  })

  it('has a debounce value', () => {
    expect(MAP_DEFAULTS.debounceMs).toBe(300)
  })
})

describe('CLUSTER_CONFIG', () => {
  it('has clusterMaxZoom', () => {
    expect(CLUSTER_CONFIG.clusterMaxZoom).toBe(14)
  })

  it('has clusterRadius', () => {
    expect(CLUSTER_CONFIG.clusterRadius).toBe(50)
  })
})

describe('PIN_COLORS', () => {
  const allTiers: OwnershipTier[] = [
    'independent', 'coop', 'local-franchise', 'challenger', 'mission-driven', 'pe-corporate',
  ]

  it('defines colors for all 6 ownership tiers', () => {
    expect(Object.keys(PIN_COLORS)).toHaveLength(6)
    allTiers.forEach((tier) => {
      expect(PIN_COLORS[tier]).toBeDefined()
      expect(PIN_COLORS[tier].hex).toMatch(/^#[0-9A-F]{6}$/i)
      expect(PIN_COLORS[tier].name).toBeTruthy()
    })
  })

  it('maps green→gray ownership spectrum (deep green = local, near-black = extractive)', () => {
    expect(PIN_COLORS.coop.name).toBe('deep-green')
    expect(PIN_COLORS.independent.name).toBe('green')
    expect(PIN_COLORS['mission-driven'].name).toBe('sage')
    expect(PIN_COLORS['local-franchise'].name).toBe('gray-green')
    expect(PIN_COLORS.challenger.name).toBe('light-gray')
    expect(PIN_COLORS['pe-corporate'].name).toBe('near-black')
  })

  it('all color names are unique', () => {
    const names = Object.values(PIN_COLORS).map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('all hex values are unique', () => {
    const hexes = Object.values(PIN_COLORS).map((c) => c.hex)
    expect(new Set(hexes).size).toBe(hexes.length)
  })
})
