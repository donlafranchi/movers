'use client'

import type { ReportPillar } from '@/lib/types'
import { REPORT_PILLARS } from '@/lib/types'

const PILLAR_FORM_DESCRIPTIONS: Record<ReportPillar, string> = {
  customers: 'How they treat the people they serve',
  employees: 'How they treat the people who work there',
  community: 'How they impact the local community',
  planet: 'How they impact the environment',
}

const PILLAR_ORDER: ReportPillar[] = ['customers', 'employees', 'community', 'planet']

interface PillarSelectorProps {
  value: ReportPillar | null
  onChange: (pillar: ReportPillar) => void
  error?: string
}

export function PillarSelector({ value, onChange, error }: PillarSelectorProps) {
  return (
    <div>
      <span className="text-sm font-medium">What area does this concern?</span>
      <div className="mt-2 space-y-2">
        {PILLAR_ORDER.map((pillar) => {
          const config = REPORT_PILLARS[pillar]
          const selected = value === pillar
          return (
            <button
              key={pillar}
              type="button"
              data-testid="pillar-option"
              data-value={pillar}
              onClick={() => onChange(pillar)}
              className={`w-full text-left rounded-lg border px-3 py-3 transition ${
                selected
                  ? 'border-foreground bg-zinc-50 dark:bg-zinc-800'
                  : 'border-zinc-200 dark:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span>{config.emoji}</span>
                <span className="font-medium text-sm">{config.label}</span>
              </div>
              <p data-testid="pillar-description" className="text-xs text-zinc-500 mt-1 ml-7">
                {PILLAR_FORM_DESCRIPTIONS[pillar]}
              </p>
            </button>
          )
        })}
      </div>
      {error && <p data-testid="pillar-error" className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  )
}
