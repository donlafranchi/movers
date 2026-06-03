// T088 — Locality scope picker (F030). Minimal client control to change the
// feed's Place before signing up. Navigates to /?place=<slug>.
'use client'

import { useRouter } from 'next/navigation'

export interface ScopeOption {
  slug: string
  displayName: string
}

export function ScopePicker({
  current,
  options,
}: {
  current: string
  options: ScopeOption[]
}) {
  const router = useRouter()
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-600" data-testid="scope-picker">
      <span>Showing</span>
      <select
        className="chip"
        value={current}
        aria-label="Choose a locality"
        onChange={(e) => router.push(`/?place=${e.target.value}`)}
      >
        {options.map((o) => (
          <option key={o.slug} value={o.slug}>
            {o.displayName}
          </option>
        ))}
      </select>
    </label>
  )
}
