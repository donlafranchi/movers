import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// T070 — file-shape assertions for 023_groups_lifecycle_state.sql.
// Spec: product/systems/groups.md § Schema (lifecycle_state) + § Event log entries
// (group.activated). Backs the Multi-step composer recipe's partial-state contract
// from product/ui/design-language.md.

const file = resolve(__dirname, '..', 'supabase', 'migrations', '023_groups_lifecycle_state.sql')
const stripComments = (s: string) =>
  s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('T070 — 023_groups_lifecycle_state.sql', () => {
  it('exists', () => expect(existsSync(file)).toBe(true))

  const sql = stripComments(readFileSync(file, 'utf8'))

  it('adds groups.lifecycle_state column with NOT NULL DEFAULT \'active\'', () => {
    expect(sql).toMatch(
      /alter table\s+public\.groups\s+add column if not exists\s+lifecycle_state\s+text\s+not null\s+default\s+'active'/i,
    )
  })

  it('adds groups_lifecycle_state_check constraint with the three-value enum', () => {
    expect(sql).toMatch(
      /add constraint\s+groups_lifecycle_state_check\s+check\s*\(\s*lifecycle_state\s+in\s*\(\s*'draft'\s*,\s*'active'\s*,\s*'dissolved'\s*\)\s*\)/i,
    )
  })

  it('drops groups_lifecycle_state_check before adding (idempotent re-runs)', () => {
    expect(sql).toMatch(/drop constraint if exists\s+groups_lifecycle_state_check/i)
  })

  it('creates idx_groups_lifecycle as a partial index where dissolved_at is null', () => {
    expect(sql).toMatch(
      /create index if not exists\s+idx_groups_lifecycle[\s\S]*?on\s+public\.groups\s*\(\s*lifecycle_state\s*\)[\s\S]*?where\s+dissolved_at\s+is\s+null/i,
    )
  })

  it('drops the prior groups_select_listed policy', () => {
    expect(sql).toMatch(/drop policy if exists\s+groups_select_listed\s+on\s+public\.groups/i)
  })

  it('creates groups_select_active_or_own_draft policy with both clauses', () => {
    expect(sql).toMatch(
      /create policy\s+groups_select_active_or_own_draft\s+on\s+public\.groups\s+for\s+select\s+using\s*\(/i,
    )
    // Public clause must combine active + listed + not-dissolved (narrows the
    // prior groups_select_listed scope by lifecycle_state).
    expect(sql).toMatch(/lifecycle_state\s*=\s*'active'/i)
    expect(sql).toMatch(/discoverability\s*=\s*'listed'/i)
    expect(sql).toMatch(/dissolved_at\s+is\s+null/i)
    // Founder-draft carve-out must scope to founder_member_id = auth.uid().
    expect(sql).toMatch(/lifecycle_state\s*=\s*'draft'/i)
    expect(sql).toMatch(/founder_member_id\s*=\s*auth\.uid\(\)/i)
  })

  it('extends group_events.event_kind CHECK with group.activated', () => {
    expect(sql).toMatch(
      /add constraint\s+group_events_event_kind_check\s+check\s*\(\s*event_kind\s+in\s*\([\s\S]*?'group\.activated'[\s\S]*?\)\s*\)/i,
    )
  })

  it('preserves the existing group_events kinds when extending the CHECK', () => {
    for (const kind of [
      'group.created',
      'group.member_joined',
      'group.member_left',
      'group.role_changed',
      'group.dormant',
      'group.revived',
      'group.dissolved',
    ]) {
      expect(sql).toContain(`'${kind}'`)
    }
  })

  it('drops the prior group_events_event_kind_check before re-adding (idempotent)', () => {
    expect(sql).toMatch(
      /drop constraint if exists\s+group_events_event_kind_check/i,
    )
  })
})
