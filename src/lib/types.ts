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
  is_featured?: boolean
  featured_at?: string | null
  tagline?: string | null
  cover_photo_url?: string | null
  website_url?: string | null
  instagram_handle?: string | null
  contact_email?: string | null
}

export type Vendor = Business

export type WeekdaySlug = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface Market {
  id: string
  name: string
  slug: string
  city: string
  state: string
  latitude: number
  longitude: number
  schedule_days: WeekdaySlug[]
  schedule_start_time: string | null
  schedule_end_time: string | null
  description: string | null
  created_at: string
}

export interface MarketVendor {
  id: string
  market_id: string
  vendor_id: string
  created_at: string
}

export interface VendorCategory {
  id: string
  vendor_id: string
  category_slug: string
  is_primary: boolean
  created_at: string
}

export interface Follow {
  id: string
  user_id: string
  vendor_id: string
  created_at: string
  last_active_at: string | null
  unfollowed_at: string | null
}

export type EventType = 'market_session' | 'class' | 'community_project' | 'vendor_special'
export type EventHostType = 'vendor' | 'market' | 'platform'
export type EventStatus = 'scheduled' | 'cancelled' | 'completed'

export interface PlatformEvent {
  id: string
  event_type: EventType
  host_type: EventHostType
  host_id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  recurrence: Record<string, unknown> | null
  location_lat: number
  location_lng: number
  location_label: string | null
  cost_cents: number | null
  capacity: number | null
  cover_photo_url: string | null
  status: EventStatus
  created_at: string
  updated_at: string
}

export interface VendorBulletin {
  id: string
  vendor_id: string
  author_user_id: string
  title: string | null
  body: string
  cover_photo_url: string | null
  attached_event_id: string | null
  published_at: string | null
  audience: 'all_followers'
  delivery_channels: { in_app: boolean; email: boolean; push: boolean }
  stats: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface BulletinDelivery {
  bulletin_id: string
  user_id: string
  delivered_at: string
  opened_at: string | null
  clicked_at: string | null
  unsubscribed_at: string | null
}

export type VendorEventName =
  | 'profile_view'
  | 'support_click'
  | 'follow'
  | 'unfollow'
  | 'share'
  | 'bulletin_open'
  | 'bulletin_click'
  | 'bulletin_published'

export interface VendorAnalyticsEvent {
  id: string
  vendor_id: string
  user_id: string | null
  event_name: VendorEventName
  referrer: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export interface VendorStatsDaily {
  vendor_id: string
  day: string
  profile_views: number
  support_clicks: number
  new_follows: number
  unfollows: number
  shares: number
  bulletin_opens: number
}

export interface UserPreferences {
  user_id: string
  selected_market_id: string | null
  follow_emails_enabled: boolean
  updated_at: string
}

export const WEEKDAYS: { slug: WeekdaySlug; short: string; long: string; index: number }[] = [
  { slug: 'sun', short: 'Sun', long: 'Sunday', index: 0 },
  { slug: 'mon', short: 'Mon', long: 'Monday', index: 1 },
  { slug: 'tue', short: 'Tue', long: 'Tuesday', index: 2 },
  { slug: 'wed', short: 'Wed', long: 'Wednesday', index: 3 },
  { slug: 'thu', short: 'Thu', long: 'Thursday', index: 4 },
  { slug: 'fri', short: 'Fri', long: 'Friday', index: 5 },
  { slug: 'sat', short: 'Sat', long: 'Saturday', index: 6 },
]

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
