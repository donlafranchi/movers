import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// T046 — file-shape assertions for the locations RLS fix-forward.
// Source: development/tickets/T046-locations-rls-fixes.md and the T045 M2
// code-review record. Three corrective items: owner-read RLS policy, partial
// GIST swap, sync_area_centroid() search_path extension.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const read = (file: string) =>
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T046 — migrations directory state after T046', () => {
  it('contains the seven migrations (001, 002, 004, 005, 006, 007, 008)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(
      expect.arrayContaining([
        '001_extensions.sql',
        '002_members.sql',
        '004_item_embeddings.sql',
        '005_member_embeddings.sql',
        '006_auth_signup_hook.sql',
        '007_locations.sql',
        '008_locations_owner_read.sql',
      ]),
    )
  })
})

describe('T046 — 008_locations_owner_read.sql', () => {
  const raw = read('008_locations_owner_read.sql')
  const sql = stripComments(raw)

  it('adds locations_owner_read policy for member_id = auth.uid() and not deleted', () => {
    expect(sql).toMatch(
      /create policy\s+locations_owner_read\s+on\s+public\.locations[\s\S]+for select[\s\S]+member_id\s*=\s*auth\.uid\(\)[\s\S]+deleted_at is null/i,
    )
  })

  it('drops the prior non-partial idx_locations_geog', () => {
    expect(sql).toMatch(/drop index if exists\s+(public\.)?idx_locations_geog/i)
  })

  it('recreates idx_locations_geog as a partial GIST (where deleted_at is null)', () => {
    expect(sql).toMatch(
      /create index\s+idx_locations_geog\s+on\s+public\.locations\s+using\s+gist\s*\(\s*geography\s*\)\s+where\s+deleted_at is null/i,
    )
  })

  it('rewrites sync_area_centroid() with search_path = public, extensions', () => {
    expect(sql).toMatch(/create or replace function\s+public\.sync_area_centroid/i)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/set search_path\s*=\s*public\s*,\s*extensions/i)
    expect(sql).toMatch(/ST_Centroid\s*\(\s*new\.polygon\s*\)/i)
  })

  it('does not introduce any new INSERT / DELETE policy on locations', () => {
    expect(sql).not.toMatch(/policy[^;]+locations[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+locations[^;]+for delete/i)
  })
})
