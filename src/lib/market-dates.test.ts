import { describe, it, expect } from 'vitest'
import { nextMarketDate, formatNextMarketDate } from './market-dates'

describe('nextMarketDate', () => {
  it('returns null for empty schedule', () => {
    expect(nextMarketDate([])).toBeNull()
  })

  it('returns today if scheduled for today', () => {
    const wed = new Date('2026-04-22T10:00:00')
    const d = nextMarketDate(['wed'], wed)
    expect(d?.getDay()).toBe(3)
    expect(d?.toDateString()).toBe(wed.toDateString())
  })

  it('returns next occurrence of a weekday', () => {
    const tue = new Date('2026-04-21T10:00:00')
    const d = nextMarketDate(['sat'], tue)
    expect(d?.getDay()).toBe(6)
  })

  it('picks the soonest of multiple scheduled days', () => {
    const mon = new Date('2026-04-20T10:00:00')
    const d = nextMarketDate(['sat', 'wed'], mon)
    expect(d?.getDay()).toBe(3)
  })

  it('wraps around the week', () => {
    const fri = new Date('2026-04-24T10:00:00')
    const d = nextMarketDate(['mon'], fri)
    expect(d?.getDay()).toBe(1)
  })
})

describe('formatNextMarketDate', () => {
  it('returns Today when scheduled for today', () => {
    const wed = new Date('2026-04-22T10:00:00')
    expect(formatNextMarketDate(['wed'], wed)).toBe('Today')
  })

  it('returns Tomorrow for the next day', () => {
    const fri = new Date('2026-04-24T10:00:00')
    expect(formatNextMarketDate(['sat'], fri)).toBe('Tomorrow')
  })

  it('returns Day Mon N for future dates', () => {
    const mon = new Date('2026-04-20T10:00:00')
    const s = formatNextMarketDate(['sat'], mon)
    expect(s).toMatch(/Sat Apr \d+/)
  })
})
