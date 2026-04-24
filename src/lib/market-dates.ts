import { WEEKDAYS, type WeekdaySlug } from './types'

/**
 * Given a market's recurring schedule days, return the next upcoming date (UTC-naive).
 * Returns null if schedule is empty.
 */
export function nextMarketDate(scheduleDays: string[], from: Date = new Date()): Date | null {
  if (!scheduleDays || scheduleDays.length === 0) return null
  const slugToIndex = new Map<string, number>()
  for (const w of WEEKDAYS) slugToIndex.set(w.slug, w.index)
  const targets = scheduleDays
    .map((d) => slugToIndex.get(d as WeekdaySlug))
    .filter((i): i is number => typeof i === 'number')
  if (targets.length === 0) return null
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(from)
    d.setDate(d.getDate() + offset)
    if (targets.includes(d.getDay())) return d
  }
  return null
}

export function formatNextMarketDate(scheduleDays: string[], from: Date = new Date()): string | null {
  const d = nextMarketDate(scheduleDays, from)
  if (!d) return null
  const today = new Date(from)
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  const weekday = WEEKDAYS.find((w) => w.index === d.getDay())?.short ?? ''
  const mon = d.toLocaleDateString('en-US', { month: 'short' })
  return `${weekday} ${mon} ${d.getDate()}`
}
