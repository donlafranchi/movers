import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// T041 — file-shape assertions for the Phase 0 migrations.
// The DB-runtime assertions live in web/evals/phase-0/floor.spec.ts (Playwright
// against a running Supabase). This file is the build agent's own minimal
// red→green target derived from T041's acceptance checklist.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const read = (file: string) =>
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

// Strip line comments before structural assertions so doc comments
// describing a future FK addition don't trigger a "FK exists" match.
const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T041 — Phase 0 migrations directory state', () => {
  it('contains the three Phase 0 migration files from the pre-step wipe', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(
      expect.arrayContaining([
        '001_extensions.sql',
        '004_item_embeddings.sql',
        '005_member_embeddings.sql',
      ]),
    )
  })

  it('contains no legacy migrations from the pre-rebuild era', () => {
    const files = readdirSync(MIGRATIONS_DIR)
    expect(files).not.toContain('001_initial_schema.sql')
    expect(files).not.toContain('002_markets_and_follows.sql')
    expect(files).not.toContain('003_foundational_schema.sql')
    expect(files).not.toContain('004_system_runs.sql')
    expect(files).not.toContain('005_bulletin_mutes.sql')
    expect(files).not.toContain('006_rollup_vendor_stats.sql')
  })
})

describe('T041 — 001_extensions.sql', () => {
  const sql = read('001_extensions.sql')

  it('enables the pgvector extension idempotently', () => {
    expect(sql).toMatch(/create extension if not exists vector\s*;/i)
  })

  it('enables the postgis extension idempotently', () => {
    expect(sql).toMatch(/create extension if not exists postgis\s*;/i)
  })
})

describe('T041 — 004_item_embeddings.sql', () => {
  const sql = read('004_item_embeddings.sql')

  it('creates the item_embeddings table', () => {
    expect(sql).toMatch(/create table\s+public\.item_embeddings/i)
  })

  it('declares item_id as a NOT NULL uuid', () => {
    expect(sql).toMatch(/item_id\s+uuid\s+not null/i)
  })

  it('declares model_version as a NOT NULL text', () => {
    expect(sql).toMatch(/model_version\s+text\s+not null/i)
  })

  it('declares embedding as vector(1536) NOT NULL', () => {
    expect(sql).toMatch(/embedding\s+vector\(\s*1536\s*\)\s+not null/i)
  })

  it('declares created_at with default now()', () => {
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
  })

  it('uses a composite primary key on (item_id, model_version)', () => {
    expect(sql).toMatch(/primary key\s*\(\s*item_id\s*,\s*model_version\s*\)/i)
  })

  it('does NOT declare a foreign key to items (table does not exist yet)', () => {
    expect(stripComments(sql)).not.toMatch(/references\s+public\.items/i)
  })

  it('documents the deferred FK addition for the Phase 1 items-spine ticket', () => {
    expect(sql).toMatch(/foreign key/i)
    expect(sql).toMatch(/items\(id\)/i)
  })
})

describe('T041 — 005_member_embeddings.sql', () => {
  const sql = read('005_member_embeddings.sql')

  it('creates the member_embeddings table', () => {
    expect(sql).toMatch(/create table\s+public\.member_embeddings/i)
  })

  it('declares member_id as a NOT NULL uuid', () => {
    expect(sql).toMatch(/member_id\s+uuid\s+not null/i)
  })

  it('declares embedding as vector(1536) NOT NULL', () => {
    expect(sql).toMatch(/embedding\s+vector\(\s*1536\s*\)\s+not null/i)
  })

  it('uses a composite primary key on (member_id, model_version)', () => {
    expect(sql).toMatch(/primary key\s*\(\s*member_id\s*,\s*model_version\s*\)/i)
  })

  it('does NOT declare a foreign key to members (table lands in T042)', () => {
    expect(stripComments(sql)).not.toMatch(/references\s+public\.members/i)
  })
})
