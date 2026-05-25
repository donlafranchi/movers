import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// T061 — file-shape assertions for 021_retire_member_location_affinities.sql
// and side-effect cleanups.
//
// Source ticket: development/tickets/T061-retire-member-location-affinities.md
// Spec: ADR-21 § Supersedes; planning/rebuild-plan.md b1 rule 7.
// Encodes the absence-as-enforcement of ADR-16's affinity-row privacy —
// ownership transfers to T062 (member_place_interests).

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')
const EVALS_DIR = resolve(__dirname, '..', 'evals', 'phase-1')

const read = (p: string) => readFileSync(p, 'utf8')
const stripComments = (sql: string) =>
  sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n')

describe('T061 — 021 retire-affinities migration', () => {
  const file = resolve(MIGRATIONS_DIR, '021_retire_member_location_affinities.sql')

  it('migration file exists', () => {
    expect(existsSync(file)).toBe(true)
  })

  const sql = stripComments(read(file))

  it('drops the three SECURITY DEFINER functions installed by T049', () => {
    expect(sql).toMatch(/drop function if exists\s+public\.member_is_local_to_location\(\s*uuid\s*,\s*uuid\s*\)/i)
    expect(sql).toMatch(/drop function if exists\s+public\.count_likes_for_location\(\s*uuid\s*\)/i)
    expect(sql).toMatch(/drop function if exists\s+public\.count_followers_for_location\(\s*uuid\s*\)/i)
  })

  it('drops public.member_location_affinities', () => {
    expect(sql).toMatch(/drop table if exists\s+public\.member_location_affinities/i)
  })

  it('rewrites member_events event_kind CHECK without the dead kinds', () => {
    expect(sql).toMatch(/alter table\s+public\.member_events\s+drop constraint if exists\s+member_events_event_kind_check/i)
    expect(sql).toMatch(/alter table\s+public\.member_events\s+add constraint\s+member_events_event_kind_check\s+check\s*\(\s*event_kind\s+in/i)
    // The dropped kinds must NOT be in the new constraint.
    const newCheckMatch = sql.match(/add constraint\s+member_events_event_kind_check\s+check\s*\(\s*event_kind\s+in\s*\(([\s\S]*?)\)\s*\)/i)
    expect(newCheckMatch, 'new CHECK list must parse').not.toBeNull()
    const newList = newCheckMatch![1]
    expect(newList).not.toMatch(/member\.location_affinity_added/)
    expect(newList).not.toMatch(/member\.location_affinity_removed/)
  })

  it('preserves the unrelated member_events kinds (member.created, member.followed, etc.)', () => {
    const newCheckMatch = sql.match(/add constraint\s+member_events_event_kind_check\s+check\s*\(\s*event_kind\s+in\s*\(([\s\S]*?)\)\s*\)/i)
    const list = newCheckMatch![1]
    for (const kind of [
      'member.created',
      'member.profile_updated',
      'member.followed',
      'member.unfollowed',
      'member.delegation_granted',
      'member.handle_changed',
    ]) {
      expect(list).toContain(`'${kind}'`)
    }
  })

  it('adds the four T062 place_interest event kinds + three T063 saved_search kinds', () => {
    const newCheckMatch = sql.match(/add constraint\s+member_events_event_kind_check\s+check\s*\(\s*event_kind\s+in\s*\(([\s\S]*?)\)\s*\)/i)
    const list = newCheckMatch![1]
    for (const kind of [
      'member.place_interest_added',
      'member.place_interest_removed',
      'member.place_interest_promoted',
      'member.place_interest_demoted',
      'member.saved_search.created',
      'member.saved_search.updated',
      'member.saved_search.removed',
    ]) {
      expect(list).toContain(`'${kind}'`)
    }
  })
})

describe('T061 — eval cleanups', () => {
  it('members-affinities.spec.ts is deleted (table is gone)', () => {
    expect(existsSync(resolve(EVALS_DIR, 'members-affinities.spec.ts'))).toBe(false)
  })

  it('floor.spec.ts no longer references member_location_affinities in the table census', () => {
    const floor = read(resolve(EVALS_DIR, 'floor.spec.ts'))
    // The census array previously listed the table as a string literal.
    expect(floor).not.toMatch(/"member_location_affinities"/)
    // Cite comments rewritten to reference ADR-21 / T061.
    expect(floor).toMatch(/retired by T061|ADR-21/i)
  })
})
