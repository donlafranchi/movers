export type OwnershipTier =
  | 'independent'
  | 'coop'
  | 'local-franchise'
  | 'challenger'
  | 'mission-driven'
  | 'pe-corporate'

export type ReportPillar = 'customers' | 'employees' | 'community' | 'planet'

export interface Business {
  id: string
  user_id: string | null
  name: string
  slug: string
  street_address: string
  city: string
  state: string
  zip: string
  latitude: number | null
  longitude: number | null
  category: string
  ownership_tier: OwnershipTier
  story: string | null
  parent_company: string | null
  location_count: number | null
  certification_type: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Support {
  id: string
  user_id: string
  business_id: string
  created_at: string
}

export interface Report {
  id: string
  user_id: string
  business_id: string
  pillar: ReportPillar
  description: string
  source_url: string | null
  personal_witness: boolean
  created_at: string
}

export const OWNERSHIP_TIERS: Record<OwnershipTier, { label: string; color: string; description: string }> = {
  independent: {
    label: 'Independent',
    color: 'ownership-independent',
    description: 'Single-location, owner-operated',
  },
  coop: {
    label: 'Worker-Owned / Co-op',
    color: 'ownership-coop',
    description: 'Community rooted',
  },
  'local-franchise': {
    label: 'Local Franchise',
    color: 'ownership-local-franchise',
    description: 'Local owner, national brand',
  },
  challenger: {
    label: 'Community Challenger',
    color: 'ownership-challenger',
    description: 'Actively competing against a monopoly',
  },
  'mission-driven': {
    label: 'Mission-Driven',
    color: 'ownership-mission-driven',
    description: 'B Corp, public benefit corp, or demonstrated commitment to community',
  },
  'pe-corporate': {
    label: 'PE / Corporate Chain',
    color: 'ownership-pe-corporate',
    description: 'Absent owner, money leaving town',
  },
}

export const REPORT_PILLARS: Record<ReportPillar, { emoji: string; label: string; description: string }> = {
  customers: {
    emoji: '🤝',
    label: 'Customers',
    description: 'Deceptive practices, refusal of service, discrimination',
  },
  employees: {
    emoji: '👷',
    label: 'Employees',
    description: 'Wage theft, unsafe conditions, exploitation, retaliation',
  },
  community: {
    emoji: '🏘️',
    label: 'Community',
    description: 'Pollution, displacement, hostile behavior',
  },
  planet: {
    emoji: '🌍',
    label: 'Planet',
    description: 'Environmental violations, animal cruelty, resource destruction',
  },
}
