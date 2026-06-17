import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// T106 — file-shape assertions for adding starts_at to the discoverable_items MV
// + the two consuming RPC updates. DB-touching behavior (past-event filtering,
// next-occurrence sort, CONCURRENT refresh) is verified against running Supabase
// at the deploy step; these are static-shape guards (T103/T075 precedent — no
// Docker in this build env).

const MIG = resolve(__dirname, '..', 'supabase', 'migrations')
const stripComments = (s: string) =>
  s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('T106 — 034_discoverable_items_starts_at.sql', () => {
  const file = resolve(MIG, '034_discoverable_items_starts_at.sql')
  it('exists', () => expect(existsSync(file)).toBe(true))
  const sql = stripComments(readFileSync(file, 'utf8'))

  it('drops then recreates the MV (Postgres cannot ALTER a column into an MV)', () => {
    expect(sql).toMatch(/drop materialized view if exists\s+public\.discoverable_items/i)
    expect(sql).toMatch(/create materialized view\s+public\.discoverable_items as/i)
  })

  it('sources starts_at from item_gatherings via a lateral join and selects it', () => {
    expect(sql).toMatch(/from\s+public\.item_gatherings\s+ig/i)
    expect(sql).toMatch(/gs\.starts_at\s+as\s+starts_at/i)
  })

  it('preserves the unique index on item_id (CONCURRENT refresh precondition)', () => {
    expect(sql).toMatch(
      /create unique index\s+unique_idx_discoverable_items\s+on\s+public\.discoverable_items\s*\(\s*item_id\s*\)/i,
    )
  })

  it('recreates all existing browse indexes + the GiST geography index', () => {
    expect(sql).toMatch(/idx_discoverable_items_kind/i)
    expect(sql).toMatch(/idx_discoverable_items_category/i)
    expect(sql).toMatch(/idx_discoverable_items_group/i)
    expect(sql).toMatch(/idx_discoverable_items_geography\s+on\s+public\.discoverable_items\s+using gist/i)
    expect(sql).toMatch(/idx_discoverable_items_recency/i)
  })

  it('adds the starts_at index', () => {
    expect(sql).toMatch(
      /create index\s+idx_discoverable_items_starts_at\s+on\s+public\.discoverable_items\s*\(\s*starts_at asc nulls last\s*\)/i,
    )
  })

  it('re-grants select to anon + authenticated', () => {
    expect(sql).toMatch(/grant select on\s+public\.discoverable_items\s+to\s+anon,\s*authenticated/i)
  })

  it('venue_nearby_items hard-filters past + dateless gatherings; sorts by next occurrence', () => {
    expect(sql).toMatch(/create or replace function\s+public\.venue_nearby_items/i)
    expect(sql).toMatch(/di\.starts_at is null or di\.starts_at >= now\(\)/i)
    expect(sql).toMatch(/di\.item_kind\s*(<>|!=)\s*'gathering' or di\.starts_at is not null/i)
    expect(sql).toMatch(/di\.starts_at asc nulls last/i)
  })

  it('venue_hosted_items applies the same only-upcoming filter (base-table query)', () => {
    expect(sql).toMatch(/create or replace function\s+public\.venue_hosted_items/i)
    expect(sql).toMatch(/ig\.starts_at is null or ig\.starts_at >= now\(\)/i)
    expect(sql).toMatch(/i\.kind\s*(<>|!=)\s*'gathering' or ig\.starts_at is not null/i)
  })

  it('locality_feed_items hard-filters upcoming-only (no bucket CASE) and keeps the tag boost', () => {
    expect(sql).toMatch(/create or replace function\s+public\.locality_feed_items/i)
    expect(sql).toMatch(/di\.primary_tag = any\s*\(\s*p_tags\s*\)/i) // tag boost retained
    expect(sql).toMatch(/di\.starts_at is null or di\.starts_at >= now\(\)/i)
    expect(sql).toMatch(/di\.item_kind\s*(<>|!=)\s*'gathering' or di\.starts_at is not null/i)
    // The 3-bucket sort was replaced by a hard filter.
    expect(sql).not.toMatch(/when di\.starts_at >= now\(\) then 0/i)
  })
})
