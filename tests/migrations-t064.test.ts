import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// T064 — file-shape assertions for 020_items_made_at.sql.
// Spec: product/systems/item.md § Provenance. ADR-21 verification-ladder reshape.

const file = resolve(__dirname, '..', 'supabase', 'migrations', '020_items_made_at.sql')
const stripComments = (s: string) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('T064 — 020_items_made_at.sql', () => {
  it('exists', () => expect(existsSync(file)).toBe(true))

  const sql = stripComments(readFileSync(file, 'utf8'))

  it('adds made_at_place_id as nullable FK to places with on delete restrict', () => {
    expect(sql).toMatch(/alter table\s+public\.items\s+add column if not exists\s+made_at_place_id\s+uuid[\s\S]*?references\s+public\.places\(id\)\s+on delete restrict/i)
  })

  it('adds made_at_verification_source NOT NULL DEFAULT \'none\'', () => {
    expect(sql).toMatch(/add column if not exists\s+made_at_verification_source\s+text\s+not null\s+default\s+'none'/i)
  })

  it('adds the 4-value verification_source CHECK (includes community_attested per ADR-21 reshape)', () => {
    expect(sql).toMatch(/add constraint\s+items_made_at_verification_source_check\s+check\s*\(\s*made_at_verification_source\s+in\s*\(\s*'none'\s*,\s*'self_attested'\s*,\s*'community_attested'\s*,\s*'document_supported'\s*\)\s*\)/i)
  })

  it('adds the items_made_at_only_on_products CHECK', () => {
    expect(sql).toMatch(/add constraint\s+items_made_at_only_on_products\s+check\s*\(\s*made_at_place_id\s+is\s+null\s+or\s+kind\s*=\s*'product'\s*\)/i)
  })

  it('creates idx_items_made_at_place partial index', () => {
    expect(sql).toMatch(/create index if not exists\s+idx_items_made_at_place[\s\S]*?on\s+public\.items\s*\(\s*made_at_place_id\s*\)[\s\S]*?where\s+made_at_place_id\s+is\s+not\s+null/i)
  })

  it('extends item_events.event_kind CHECK with 3 made_at kinds', () => {
    for (const kind of ['item.made_at_set', 'item.made_at_removed', 'item.made_at_verified']) {
      expect(sql).toContain(`'${kind}'`)
    }
  })

  it('preserves the existing item_events kinds (item.created, item.published, etc.)', () => {
    for (const kind of [
      'item.created',
      'item.updated',
      'item.published',
      'item.location_attached',
      'item.fulfilled',
      'item.brand_label_changed',
    ]) {
      expect(sql).toContain(`'${kind}'`)
    }
  })
})
