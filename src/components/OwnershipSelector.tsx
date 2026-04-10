'use client'

import type { OwnershipTier } from '@/lib/types'
import { PIN_COLORS } from '@/lib/map-config'

const SELECTOR_OPTIONS: { tier: OwnershipTier; description: string }[] = [
  { tier: 'independent', description: 'I own this business myself or with a partner' },
  { tier: 'coop', description: 'This business is owned by its workers or members' },
  { tier: 'local-franchise', description: 'I own a franchise location locally' },
  { tier: 'challenger', description: "We're a smaller company competing against big chains" },
  { tier: 'mission-driven', description: "We're a B Corp, PBC, or have a social mission" },
  { tier: 'pe-corporate', description: 'This business is owned by a corporation or investment firm' },
]

interface OwnershipSelectorProps {
  value: OwnershipTier | null
  onChange: (tier: OwnershipTier) => void
  error?: string
}

export function OwnershipSelector({ value, onChange, error }: OwnershipSelectorProps) {
  return (
    <div data-testid="field-ownership-type">
      <span className="text-sm font-medium">Ownership Type</span>
      <div className="mt-2 space-y-2">
        {SELECTOR_OPTIONS.map(({ tier, description }) => {
          const pinConfig = PIN_COLORS[tier]
          const selected = value === tier
          return (
            <button
              key={tier}
              type="button"
              data-testid="ownership-option"
              data-value={tier}
              onClick={() => onChange(tier)}
              className={`w-full text-left rounded-lg border px-3 py-3 transition ${
                selected
                  ? 'border-foreground bg-zinc-50 dark:bg-zinc-800'
                  : 'border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: pinConfig.hex }}
                />
                <span className="font-medium text-sm">{pinConfig.name === 'gold' ? 'Independent' : tier.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
              </div>
              <p data-testid="ownership-description" className="text-xs text-zinc-500 mt-1 ml-5">
                {description}
              </p>
            </button>
          )
        })}
      </div>
      {error && <p data-testid="field-error" className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  )
}

export { SELECTOR_OPTIONS }
