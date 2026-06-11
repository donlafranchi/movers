import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// T103 — file-shape assertions for the metro_polygons discovery overlay.
// Spec: PLATFORM-PATTERNS § metro-polygon overlay (D1–D4) · discovery.md §
//       Community-awareness feed · member.md § Place-interest scope.
// DB-touching behavior is verified by the SQL contract test
// (supabase/tests/resolve_home_metro.sql) against running Supabase; these are
// static-shape guards (T075 precedent — no Docker in this build env).

const MIG = resolve(__dirname, '..', 'supabase', 'migrations')
const TESTS = resolve(__dirname, '..', 'supabase', 'tests')
const stripComments = (s: string) =>
  s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('T103 — 031_metro_polygons.sql', () => {
  const file = resolve(MIG, '031_metro_polygons.sql')
  it('exists', () => expect(existsSync(file)).toBe(true))
  const raw = readFileSync(file, 'utf8')
  const sql = stripComments(raw)

  it('creates metro_polygons with the spec columns (D2 — CSA grain)', () => {
    expect(sql).toMatch(/create table\s+public\.metro_polygons/i)
    expect(sql).toMatch(/id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i)
    expect(sql).toMatch(/name\s+text\s+not null/i)
    expect(sql).toMatch(/slug\s+text\s+unique\s+not null/i)
    expect(sql).toMatch(/csa_code\s+text\s+unique\s+not null/i)
    expect(sql).toMatch(/geography\s+geography\(\s*Polygon\s*,\s*4326\s*\)\s+not null/i)
    expect(sql).toMatch(/centroid\s+geography\(\s*Point\s*,\s*4326\s*\)\s+not null/i)
    expect(sql).toMatch(/source\s+text\s+not null\s+default\s+'Census-CSA-2023'/i)
    expect(sql).toMatch(/metadata\s+jsonb\s+not null\s+default\s+'\{\}'/i)
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
  })

  it('creates the GiST geography index (ST_Contains hot path)', () => {
    expect(sql).toMatch(
      /create index\s+idx_metro_polygons_geography\s+on\s+public\.metro_polygons\s+using gist\s*\(\s*geography\s*\)/i,
    )
  })

  it('adds members.home_metro_id FK (on delete set null) + partial index', () => {
    expect(sql).toMatch(
      /alter table\s+public\.members\s+add column\s+(if not exists\s+)?home_metro_id\s+uuid\s+references\s+public\.metro_polygons\(id\)\s+on delete set null/i,
    )
    expect(sql).toMatch(
      /create index\s+(if not exists\s+)?idx_members_home_metro\s+on\s+public\.members\s*\(\s*home_metro_id\s*\)\s+where\s+deleted_at\s+is\s+null\s+and\s+home_metro_id\s+is\s+not\s+null/i,
    )
  })

  it('enables RLS and ships the public select policy (D1 — discovery overlay)', () => {
    expect(sql).toMatch(/alter table\s+public\.metro_polygons\s+enable row level security/i)
    expect(sql).toMatch(
      /create policy\s+metro_select_public\s+on\s+public\.metro_polygons\s+for\s+select\s+using\s*\(\s*true\s*\)/i,
    )
  })

  it('ships NO client INSERT/UPDATE/DELETE policy (platform-curated, D1)', () => {
    expect(sql).not.toMatch(/for\s+(insert|update|delete)/i)
  })

  it('defines resolve_home_metro(point geography) STABLE / SECURITY INVOKER with grants', () => {
    expect(sql).toMatch(
      /create or replace function\s+public\.resolve_home_metro\s*\(\s*point\s+geography\s*\)\s+returns uuid/i,
    )
    expect(sql).toMatch(/\bstable\b/i)
    expect(sql).toMatch(/security invoker/i)
    expect(sql).toMatch(/language sql/i)
    expect(sql).toMatch(/st_contains\s*\(\s*geography/i)
    // deterministic tiebreak — smallest polygon by area
    expect(sql).toMatch(/order by\s+st_area\s*\(\s*geography/i)
    expect(sql).toMatch(
      /grant execute on function\s+public\.resolve_home_metro[\s\S]*?to\s+authenticated\s*,\s*anon/i,
    )
  })

  it('seeds the Sacramento-Roseville CSA (code 472) with derived centroid', () => {
    expect(sql).toMatch(/insert\s+into\s+public\.metro_polygons/i)
    expect(sql).toContain("'472'")
    expect(sql).toMatch(/sacramento-roseville-ca/i)
    // centroid derived in-transaction with ST_PointOnSurface fallback (T076 precedent)
    expect(sql).toMatch(/st_centroid/i)
    expect(sql).toMatch(/st_pointonsurface/i)
  })

  it('does NOT create a places region/metro row (D3 — overlay, not tree)', () => {
    expect(sql).not.toMatch(/insert\s+into\s+public\.places/i)
    expect(sql).not.toMatch(/kind\s*=\s*'region'/i)
  })

  it('backfills home_metro_id via the primary_home place-interest path (no home_location_id)', () => {
    expect(sql).toMatch(/update\s+public\.members/i)
    expect(sql).toMatch(/member_place_interests/i)
    expect(sql).toMatch(/primary_home/i)
    expect(sql).toMatch(/resolve_home_metro/i)
  })
})

describe('T103 — resolve_home_metro contract test fixture', () => {
  const file = resolve(TESTS, 'resolve_home_metro.sql')
  it('exists', () => expect(existsSync(file)).toBe(true))
  const sql = readFileSync(file, 'utf8')

  it('covers the four contract cases', () => {
    expect(sql).toMatch(/inside .*sacramento|point inside/i)
    expect(sql).toMatch(/outside|nyc|null metro/i)
    expect(sql).toMatch(/null input/i)
    expect(sql).toMatch(/smallest|tiebreak|overlap/i)
  })
})
