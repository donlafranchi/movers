import type { OwnershipTier } from '@/lib/types'
import { PIN_COLORS } from '@/lib/map-config'

const BADGE_DESCRIPTIONS: Record<OwnershipTier, string> = {
  independent: 'Locally owned and operated',
  coop: 'Worker or member owned',
  'local-franchise': 'Locally owned franchise',
  challenger: 'Competing against market consolidation',
  'mission-driven': 'B Corp / Public Benefit Corporation',
  'pe-corporate': 'Private equity or corporate owned',
}

interface OwnershipBadgeProps {
  tier: OwnershipTier
  className?: string
}

export function OwnershipBadge({ tier, className = '' }: OwnershipBadgeProps) {
  const pinConfig = PIN_COLORS[tier]
  const description = BADGE_DESCRIPTIONS[tier]

  return (
    <div data-testid="ownership-badge" className={`flex items-center gap-2 ${className}`}>
      <span
        data-testid="badge-color"
        className="inline-block w-3 h-3 rounded-full shrink-0"
        style={{ backgroundColor: pinConfig.hex }}
      />
      <span data-testid="badge-label" className="text-sm font-medium">
        {description}
      </span>
    </div>
  )
}

export { BADGE_DESCRIPTIONS }
