import { describe, it, expect } from 'vitest'
import { REPORT_PILLARS } from '@/lib/types'
import type { ReportPillar } from '@/lib/types'

const ALL_PILLARS: ReportPillar[] = ['customers', 'employees', 'community', 'planet']

describe('REPORT_PILLARS for ReportForm', () => {
  it('has exactly 4 pillars', () => {
    expect(Object.keys(REPORT_PILLARS)).toHaveLength(4)
  })

  it('each pillar has emoji, label, and description', () => {
    ALL_PILLARS.forEach((p) => {
      expect(REPORT_PILLARS[p].emoji).toBeTruthy()
      expect(REPORT_PILLARS[p].label).toBeTruthy()
      expect(REPORT_PILLARS[p].description).toBeTruthy()
    })
  })

  it('pillar labels are human-readable', () => {
    expect(REPORT_PILLARS.customers.label).toBe('Customers')
    expect(REPORT_PILLARS.employees.label).toBe('Employees')
    expect(REPORT_PILLARS.community.label).toBe('Community')
    expect(REPORT_PILLARS.planet.label).toBe('Planet')
  })
})
