import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// T063 — file-shape assertions for 019_member_saved_searches.sql.
// Spec: product/systems/member.md § Saved searches. ADR-21.

const file = resolve(__dirname, '..', 'supabase', 'migrations', '019_member_saved_searches.sql')
const stripComments = (s: string) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('T063 — 019_member_saved_searches.sql', () => {
  it('exists', () => expect(existsSync(file)).toBe(true))

  const sql = stripComments(readFileSync(file, 'utf8'))

  it('creates public.member_saved_searches with uuid PK', () => {
    expect(sql).toMatch(/create table\s+public\.member_saved_searches/i)
    expect(sql).toMatch(/id\s+uuid\s+not null\s+default\s+gen_random_uuid\(\)\s+primary key/i)
  })

  it('declares label CHECK 1-80 chars', () => {
    expect(sql).toMatch(/label\s+text\s+not null\s+check\s*\(\s*char_length\(label\)\s+between\s+1\s+and\s+80\s*\)/i)
  })

  it('declares place_id and location_id as nullable FKs with on delete restrict', () => {
    expect(sql).toMatch(/place_id\s+uuid\s+references\s+public\.places\(id\)\s+on delete restrict/i)
    expect(sql).toMatch(/location_id\s+uuid\s+references\s+public\.locations\(id\)\s+on delete restrict/i)
  })

  it('declares interest_tags and item_kinds as text[] not null default empty', () => {
    expect(sql).toMatch(/interest_tags\s+text\[\]\s+not null\s+default\s+'\{\}'/i)
    expect(sql).toMatch(/item_kinds\s+text\[\]\s+not null\s+default\s+'\{\}'/i)
  })

  it('declares at_least_one_filter CHECK (place / location / interest_tags must have a value)', () => {
    expect(sql).toMatch(/constraint\s+at_least_one_filter\s+check\s*\([\s\S]*?place_id\s+is\s+not\s+null[\s\S]*?or\s+location_id\s+is\s+not\s+null[\s\S]*?or\s+array_length\(interest_tags,\s*1\)\s+is\s+not\s+null/i)
  })

  it('enables RLS and creates owner-only SELECT policy', () => {
    expect(sql).toMatch(/alter table\s+public\.member_saved_searches\s+enable\s+row\s+level\s+security/i)
    expect(sql).toMatch(/create policy\s+member_saved_searches_owner_read[\s\S]*?for\s+select[\s\S]*?using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i)
  })

  it('creates no INSERT/UPDATE/DELETE policy (action-layer-only writes)', () => {
    expect(sql).not.toMatch(/create policy[\s\S]*?on\s+public\.member_saved_searches\s+for\s+(insert|update|delete)/i)
  })

  it('extends member_events.event_kind CHECK with 3 saved_search kinds', () => {
    for (const kind of [
      'member.saved_search.created',
      'member.saved_search.updated',
      'member.saved_search.removed',
    ]) {
      expect(sql).toContain(`'${kind}'`)
    }
  })

  it('creates the updated_at trigger', () => {
    expect(sql).toMatch(/create trigger\s+member_saved_searches_set_updated_at[\s\S]*?execute function\s+public\.update_updated_at_column/i)
  })
})
