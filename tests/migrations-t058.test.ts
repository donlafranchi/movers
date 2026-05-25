import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// T058 — file-shape assertions for 017_places.sql.
// Source ticket: development/tickets/T058-places-table.md.
// Spec: product/systems/places.md § T1 + § Data model implications.
// ADR-20 (Accepted 2026-05-23) — locality-scoped URLs.
// Encodes ratified absolutes: places are platform-curated (no INSERT/UPDATE/DELETE policy);
// parent-scoped slug uniqueness (UNIQUE (parent_id, slug) + partial UNIQUE for NULL parent root).

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const read = (file: string) => readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T058 — migrations directory contains 017_places.sql', () => {
  it('lists 017_places.sql in the migrations directory', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    expect(files).toContain('017_places.sql')
  })
})

describe('T058 — 017_places.sql: public.places table shape', () => {
  const raw = read('017_places.sql')
  const sql = stripComments(raw)

  it('creates the public.places table', () => {
    expect(sql).toMatch(/create table\s+public\.places/i)
  })

  it('declares parent_id as a self-referential nullable FK', () => {
    expect(sql).toMatch(/parent_id\s+uuid\s+references\s+public\.places\(id\)/i)
  })

  it('declares the kind CHECK with all five enum values', () => {
    expect(sql).toMatch(/check\s*\(\s*kind\s+in\s*\(\s*'region'\s*,\s*'state'\s*,\s*'county'\s*,\s*'city'\s*,\s*'neighborhood'\s*\)\s*\)/i)
  })

  it('declares a slug regex CHECK (lowercase alphanumeric + hyphen)', () => {
    expect(sql).toMatch(/slug\s+text\s+not null\s+check\s*\(\s*slug\s*~/i)
  })

  it('declares the geography column as geography(MultiPolygon, 4326), nullable', () => {
    expect(sql).toMatch(/geography\s+geography\(MultiPolygon,\s*4326\)/i)
  })

  it('declares iso_country_code with 2-char length CHECK', () => {
    expect(sql).toMatch(/iso_country_code/i)
    expect(sql).toMatch(/char_length\(iso_country_code\)\s*=\s*2/i)
  })

  it('declares created_at, updated_at, deleted_at audit/soft-delete columns', () => {
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/deleted_at\s+timestamptz/i)
  })
})

describe('T058 — 017_places.sql: unique-constraint shape', () => {
  const sql = stripComments(read('017_places.sql'))

  it('creates UNIQUE (parent_id, slug) partial index for non-deleted rows', () => {
    expect(sql).toMatch(/create unique index\s+uniq_places_parent_slug[\s\S]*?on\s+public\.places\s*\(\s*parent_id\s*,\s*slug\s*\)[\s\S]*?where\s+deleted_at\s+is\s+null/i)
  })

  it('creates a partial UNIQUE on slug for the NULL-parent root case', () => {
    expect(sql).toMatch(/create unique index\s+uniq_places_root_slug[\s\S]*?on\s+public\.places\s*\(\s*slug\s*\)[\s\S]*?where\s+parent_id\s+is\s+null/i)
  })
})

describe('T058 — 017_places.sql: indexes', () => {
  const sql = stripComments(read('017_places.sql'))

  it('creates GIST index on geography for polygon containment', () => {
    expect(sql).toMatch(/create index[\s\S]*?on\s+public\.places\s+using\s+gist\s*\(\s*geography\s*\)/i)
  })

  it('creates btree index (parent_id, kind) for hierarchy walks', () => {
    expect(sql).toMatch(/create index\s+idx_places_parent_kind[\s\S]*?on\s+public\.places\s*\(\s*parent_id\s*,\s*kind\s*\)/i)
  })
})

describe('T058 — 017_places.sql: RLS posture (platform-curated absolute)', () => {
  const sql = stripComments(read('017_places.sql'))

  it('enables RLS on public.places', () => {
    expect(sql).toMatch(/alter table\s+public\.places\s+enable\s+row\s+level\s+security/i)
  })

  it('creates places_select_all SELECT policy (public-read)', () => {
    expect(sql).toMatch(/create policy\s+places_select_all[\s\S]*?for\s+select[\s\S]*?using\s*\(\s*deleted_at\s+is\s+null\s*\)/i)
  })

  it('does NOT create any INSERT/UPDATE/DELETE policy on public.places (ADR-20:173 absolute)', () => {
    // Encodes ratified absolute: platform-curated. Public writes would let
    // Members fork the URL namespace. Service-role-only writes via the
    // action layer.
    expect(sql).not.toMatch(/create policy[\s\S]*?on\s+public\.places\s+for\s+(insert|update|delete)/i)
  })
})

describe('T058 — 017_places.sql: place_events log (ADR-10)', () => {
  const sql = stripComments(read('017_places.sql'))

  it('creates public.place_events partitioned by range (created_at)', () => {
    expect(sql).toMatch(/create table\s+public\.place_events[\s\S]*?partition\s+by\s+range\s*\(\s*created_at\s*\)/i)
  })

  it('declares the event_kind CHECK with the four required kinds', () => {
    expect(sql).toMatch(/event_kind\s+text\s+not null[\s\S]*?check\s*\(\s*event_kind\s+in\s*\([\s\S]*?'place\.created'[\s\S]*?'place\.updated'[\s\S]*?'place\.superseded'[\s\S]*?'place\.merged'[\s\S]*?\)\s*\)/i)
  })

  it('carries audit fields per ADR-7 (acting_member_id, via_delegation_id)', () => {
    expect(sql).toMatch(/acting_member_id\s+uuid/i)
    expect(sql).toMatch(/via_delegation_id\s+uuid/i)
  })

  it('registers ensure_place_events_partition / rotate_place_events_partitions functions', () => {
    expect(sql).toMatch(/create or replace function\s+public\.ensure_place_events_partition/i)
    expect(sql).toMatch(/create or replace function\s+public\.rotate_place_events_partitions/i)
    expect(sql).toMatch(/select\s+public\.rotate_place_events_partitions\(\)/i)
  })
})

describe('T058 — 017_places.sql: launch-locality seed', () => {
  const sql = stripComments(read('017_places.sql'))

  it("seeds California with the 2-letter USPS slug 'ca' as the state root (ADR-0022)", () => {
    expect(sql).toMatch(/insert into\s+public\.places[\s\S]*?'ca'[\s\S]*?'California'[\s\S]*?'state'/i)
  })

  it('seeds 5 counties under California (Sacramento, Yolo, Placer, El Dorado, Sutter)', () => {
    for (const slug of ['sacramento', 'yolo', 'placer', 'el-dorado', 'sutter']) {
      expect(sql).toMatch(new RegExp(`'${slug}'`))
    }
    // The 'county' kind appears in the multi-row insert.
    expect(sql).toMatch(/'county'/)
  })

  it('seeds Sacramento as a city under Sacramento County', () => {
    expect(sql).toMatch(/'sacramento'[\s\S]*?'Sacramento'[\s\S]*?'city'/i)
  })

  it('seeds West Sacramento as a city under Yolo County (NOT a Sacramento neighborhood) per ADR-0022', () => {
    // Encodes the ADR-0022 § Consequences seed-correction. West Sacramento is
    // an incorporated city in Yolo County; the prior MSA-era seed mis-filed it.
    expect(sql).toMatch(/yolo_county[\s\S]*?'west-sacramento'[\s\S]*?'West Sacramento'[\s\S]*?'city'/i)
  })

  it('seeds the 5 b1 launch neighborhoods under Sacramento city (west-sacramento NOT among them)', () => {
    // The neighborhood block is the final WITH ... INSERT chain. Snip that
    // chunk and assert against the 5 remaining neighborhoods.
    const nbrhdBlock = sql.match(/with sac_city as[\s\S]*?\) as n\(slug, display_name\);/)
    expect(nbrhdBlock, 'sac_city neighborhood block must parse').not.toBeNull()
    const block = nbrhdBlock![0]
    for (const slug of [
      'oak-park',
      'curtis-park',
      'east-sacramento',
      'midtown',
      'land-park',
    ]) {
      expect(block).toMatch(new RegExp(`'${slug}'`))
    }
    // west-sacramento is intentionally absent from the neighborhood block.
    expect(block).not.toMatch(/'west-sacramento'/)
  })
})

describe('T058 — 017_places.sql: ancestor_state_id + state-scoped city uniqueness (ADR-0022)', () => {
  const sql = stripComments(read('017_places.sql'))

  it('declares ancestor_state_id column (nullable FK back to places)', () => {
    expect(sql).toMatch(/ancestor_state_id\s+uuid[\s\S]*?references\s+public\.places\(id\)/i)
  })

  it('declares the city-must-have-state CHECK constraint', () => {
    expect(sql).toMatch(/constraint\s+places_city_must_have_state_ancestor\s+check\s*\(\s*kind\s*<>\s*'city'\s+or\s+ancestor_state_id\s+is\s+not\s+null\s*\)/i)
  })

  it('creates a partial UNIQUE for city slugs scoped to ancestor_state_id', () => {
    expect(sql).toMatch(/create unique index\s+uniq_places_city_per_state[\s\S]*?on\s+public\.places\s*\(\s*ancestor_state_id\s*,\s*slug\s*\)[\s\S]*?where\s+kind\s*=\s*'city'\s+and\s+deleted_at\s+is\s+null/i)
  })

  it('declares the BEFORE INSERT/UPDATE trigger that populates ancestor_state_id', () => {
    expect(sql).toMatch(/create or replace function\s+public\.places_set_ancestor_state_id\(\)/i)
    expect(sql).toMatch(/create trigger\s+places_set_ancestor_state_id[\s\S]*?before\s+insert\s+or\s+update[\s\S]*?execute function\s+public\.places_set_ancestor_state_id/i)
  })
})
