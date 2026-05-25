import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// T062 — file-shape assertions for 018_member_place_interests.sql.
// Spec: product/systems/member.md § Place-interest scope. ADR-21.

const file = resolve(__dirname, '..', 'supabase', 'migrations', '018_member_place_interests.sql')
const stripComments = (s: string) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('T062 — 018_member_place_interests.sql', () => {
  it('exists', () => expect(existsSync(file)).toBe(true))

  const sql = stripComments(readFileSync(file, 'utf8'))

  it('creates public.member_place_interests with composite PK', () => {
    expect(sql).toMatch(/create table\s+public\.member_place_interests/i)
    expect(sql).toMatch(/primary key\s*\(\s*member_id\s*,\s*place_id\s*,\s*scope_kind\s*\)/i)
  })

  it('declares scope_kind CHECK with primary_home and secondary', () => {
    expect(sql).toMatch(/check\s*\(\s*scope_kind\s+in\s*\(\s*'primary_home'\s*,\s*'secondary'\s*\)\s*\)/i)
  })

  it('declares member_id FK with on delete cascade', () => {
    expect(sql).toMatch(/member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i)
  })

  it('declares place_id FK with on delete restrict (places are not deleted away from interests)', () => {
    expect(sql).toMatch(/place_id\s+uuid\s+not null\s+references\s+public\.places\(id\)\s+on delete restrict/i)
  })

  it('creates uniq_primary_home_active partial UNIQUE on (member_id) for active primary_home rows', () => {
    expect(sql).toMatch(/create unique index\s+uniq_primary_home_active[\s\S]*?on\s+public\.member_place_interests\s*\(\s*member_id\s*\)[\s\S]*?where\s+scope_kind\s*=\s*'primary_home'\s+and\s+removed_at\s+is\s+null/i)
  })

  it('enables RLS and creates owner-only SELECT policy', () => {
    expect(sql).toMatch(/alter table\s+public\.member_place_interests\s+enable\s+row\s+level\s+security/i)
    expect(sql).toMatch(/create policy\s+member_place_interests_owner_read[\s\S]*?for\s+select[\s\S]*?using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i)
  })

  it('creates no INSERT/UPDATE/DELETE policy (action-layer-only writes)', () => {
    expect(sql).not.toMatch(/create policy[\s\S]*?on\s+public\.member_place_interests\s+for\s+(insert|update|delete)/i)
  })

  it('extends member_events.event_kind CHECK with 4 place_interest kinds', () => {
    for (const kind of [
      'member.place_interest_added',
      'member.place_interest_removed',
      'member.place_interest_promoted',
      'member.place_interest_demoted',
    ]) {
      expect(sql).toContain(`'${kind}'`)
    }
  })
})
