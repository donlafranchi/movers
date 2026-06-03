import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// T049 — file-shape assertions for member_location_affinities.
// Source ticket: development/tickets/T049-member-location-affinities.md.
// Spec: product/systems/member.md lines 261-306.
// Privacy posture: ADR-16 (planning/DECISIONS.md) — owner-only RLS + three
// SECURITY DEFINER scalar functions + service_role for backend pipelines.
// Numbering: rebuild plan labeled this 007i_*; renumbered to 011_* per the
// Phase 1 consolidation already established in T047/T048.

const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')

const read = (file: string) =>
  readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

describe('T049 — migrations directory state after T049', () => {
  it('contains 011_member_location_affinities.sql alongside the prior Phase 1 set', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(expect.arrayContaining([
      '001_extensions.sql',
      '002_members.sql',
      '004_item_embeddings.sql',
      '005_member_embeddings.sql',
      '006_auth_signup_hook.sql',
      '007_locations.sql',
      '008_locations_owner_read.sql',
      '009_members_phase1.sql',
      '010_member_interests_follows.sql',
      '011_member_location_affinities.sql',
      '030_member_discoverability.sql',
    ]))
  })
})

describe('T049 — 011_member_location_affinities.sql: table shape', () => {
  const raw = read('011_member_location_affinities.sql')
  const sql = stripComments(raw)

  it('creates the public.member_location_affinities table', () => {
    expect(sql).toMatch(/create table\s+public\.member_location_affinities/i)
  })

  it('declares member_id NOT NULL FK with on delete cascade', () => {
    expect(sql).toMatch(
      /member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i,
    )
  })

  it('declares location_id NOT NULL FK with on delete cascade', () => {
    expect(sql).toMatch(
      /location_id\s+uuid\s+not null\s+references\s+public\.locations\(id\)\s+on delete cascade/i,
    )
  })

  it('declares affinity_kind CHECK on the six locked values', () => {
    expect(sql).toMatch(/affinity_kind\s+text\s+not null/i)
    // All six kinds, order-independent.
    for (const kind of ['lives', 'works', 'plays', 'visits', 'follows', 'liked']) {
      expect(sql).toMatch(new RegExp(`'${kind}'`))
    }
    expect(sql).toMatch(
      /check\s*\(\s*affinity_kind\s+in\s*\(\s*'lives'\s*,\s*'works'\s*,\s*'plays'\s*,\s*'visits'\s*,\s*'follows'\s*,\s*'liked'\s*\)\s*\)/i,
    )
  })

  it('declares created_at default now() and removed_at nullable (soft-remove)', () => {
    expect(sql).toMatch(/created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
    expect(sql).toMatch(/removed_at\s+timestamptz\b(?!\s*not null)/i)
  })

  it('declares composite PK on (member_id, location_id, affinity_kind)', () => {
    expect(sql).toMatch(
      /primary key\s*\(\s*member_id\s*,\s*location_id\s*,\s*affinity_kind\s*\)/i,
    )
  })
})

describe('T049 — 011_member_location_affinities.sql: indexes', () => {
  const raw = read('011_member_location_affinities.sql')
  const sql = stripComments(raw)

  it('creates idx_affinity_member_active partial on (member_id, affinity_kind) where removed_at is null', () => {
    expect(sql).toMatch(
      /create index\s+idx_affinity_member_active\s+on\s+public\.member_location_affinities\s*\(\s*member_id\s*,\s*affinity_kind\s*\)\s+where\s+removed_at is null/i,
    )
  })

  it("creates idx_affinity_location_followers partial on (location_id) where affinity_kind = 'follows' and removed_at is null", () => {
    expect(sql).toMatch(
      /create index\s+idx_affinity_location_followers\s+on\s+public\.member_location_affinities\s*\(\s*location_id\s*\)\s+where\s+affinity_kind\s*=\s*'follows'\s+and\s+removed_at is null/i,
    )
  })

  it("creates idx_affinity_location_locals partial on (location_id, affinity_kind) where affinity_kind in ('lives','works') and removed_at is null", () => {
    expect(sql).toMatch(
      /create index\s+idx_affinity_location_locals\s+on\s+public\.member_location_affinities\s*\(\s*location_id\s*,\s*affinity_kind\s*\)\s+where\s+affinity_kind\s+in\s*\(\s*'lives'\s*,\s*'works'\s*\)\s+and\s+removed_at is null/i,
    )
  })
})

describe('T049 — 011_member_location_affinities.sql: RLS posture (ADR-16)', () => {
  const raw = read('011_member_location_affinities.sql')
  const sql = stripComments(raw)

  it('enables RLS on the table', () => {
    expect(sql).toMatch(
      /alter table\s+public\.member_location_affinities\s+enable row level security/i,
    )
  })

  it('defines exactly one owner-read policy keyed by auth.uid()', () => {
    expect(sql).toMatch(
      /create policy\s+member_location_affinities_owner_read[\s\S]+for select[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i,
    )
  })

  it('does NOT define a public-read or peer-read policy on the table', () => {
    // No public-read using (true).
    expect(sql).not.toMatch(
      /create policy[^;]+member_location_affinities[^;]+for select[\s\S]+using\s*\(\s*true\s*\)/i,
    )
    // No per-kind exception that would relax to peer reads.
    expect(sql).not.toMatch(
      /create policy\s+member_location_affinities_(public|peer)_read/i,
    )
  })

  it('does NOT define INSERT / UPDATE / DELETE policies (action-layer-only writes)', () => {
    expect(sql).not.toMatch(/policy[^;]+member_location_affinities[^;]+for insert/i)
    expect(sql).not.toMatch(/policy[^;]+member_location_affinities[^;]+for update/i)
    expect(sql).not.toMatch(/policy[^;]+member_location_affinities[^;]+for delete/i)
  })
})

describe('T049 — 011_member_location_affinities.sql: SECURITY DEFINER functions (ADR-16)', () => {
  const raw = read('011_member_location_affinities.sql')
  const sql = stripComments(raw)

  it('defines public.member_is_local_to_location(uuid, uuid) returns boolean as STABLE security definer', () => {
    expect(sql).toMatch(
      /create or replace function\s+public\.member_is_local_to_location\s*\(\s*p_member_id\s+uuid\s*,\s*p_location_id\s+uuid\s*\)\s+returns\s+boolean/i,
    )
    // Pull the function body for narrower assertions.
    const match = sql.match(
      /create or replace function\s+public\.member_is_local_to_location[\s\S]+?\$\$;/i,
    )
    expect(match, 'member_is_local_to_location body not found').not.toBeNull()
    const body = match![0]
    expect(body).toMatch(/security definer/i)
    expect(body).toMatch(/set search_path\s*=\s*public/i)
    expect(body).toMatch(/\bstable\b/i)
  })

  it('defines public.count_likes_for_location(uuid) returns integer as STABLE security definer', () => {
    expect(sql).toMatch(
      /create or replace function\s+public\.count_likes_for_location\s*\(\s*p_location_id\s+uuid\s*\)\s+returns\s+integer/i,
    )
    const match = sql.match(
      /create or replace function\s+public\.count_likes_for_location[\s\S]+?\$\$;/i,
    )
    expect(match, 'count_likes_for_location body not found').not.toBeNull()
    const body = match![0]
    expect(body).toMatch(/security definer/i)
    expect(body).toMatch(/set search_path\s*=\s*public/i)
    expect(body).toMatch(/\bstable\b/i)
  })

  it('defines public.count_followers_for_location(uuid) returns integer as STABLE security definer', () => {
    expect(sql).toMatch(
      /create or replace function\s+public\.count_followers_for_location\s*\(\s*p_location_id\s+uuid\s*\)\s+returns\s+integer/i,
    )
    const match = sql.match(
      /create or replace function\s+public\.count_followers_for_location[\s\S]+?\$\$;/i,
    )
    expect(match, 'count_followers_for_location body not found').not.toBeNull()
    const body = match![0]
    expect(body).toMatch(/security definer/i)
    expect(body).toMatch(/set search_path\s*=\s*public/i)
    expect(body).toMatch(/\bstable\b/i)
  })

  it('grants execute on all three functions to authenticated AND anon', () => {
    expect(sql).toMatch(
      /grant execute on function\s+public\.member_is_local_to_location\s*\(\s*uuid\s*,\s*uuid\s*\)\s+to\s+(authenticated\s*,\s*anon|anon\s*,\s*authenticated)/i,
    )
    expect(sql).toMatch(
      /grant execute on function\s+public\.count_likes_for_location\s*\(\s*uuid\s*\)\s+to\s+(authenticated\s*,\s*anon|anon\s*,\s*authenticated)/i,
    )
    expect(sql).toMatch(
      /grant execute on function\s+public\.count_followers_for_location\s*\(\s*uuid\s*\)\s+to\s+(authenticated\s*,\s*anon|anon\s*,\s*authenticated)/i,
    )
  })

  it('member_is_local_to_location filters on lives/works and removed_at is null', () => {
    const match = sql.match(
      /create or replace function\s+public\.member_is_local_to_location[\s\S]+?\$\$;/i,
    )
    const body = match![0]
    expect(body).toMatch(/affinity_kind\s+in\s*\(\s*'lives'\s*,\s*'works'\s*\)/i)
    expect(body).toMatch(/removed_at is null/i)
  })

  it("count_likes_for_location filters on affinity_kind = 'liked' and removed_at is null", () => {
    const match = sql.match(
      /create or replace function\s+public\.count_likes_for_location[\s\S]+?\$\$;/i,
    )
    const body = match![0]
    expect(body).toMatch(/affinity_kind\s*=\s*'liked'/i)
    expect(body).toMatch(/removed_at is null/i)
  })

  it("count_followers_for_location filters on affinity_kind = 'follows' and removed_at is null", () => {
    const match = sql.match(
      /create or replace function\s+public\.count_followers_for_location[\s\S]+?\$\$;/i,
    )
    const body = match![0]
    expect(body).toMatch(/affinity_kind\s*=\s*'follows'/i)
    expect(body).toMatch(/removed_at is null/i)
  })
})
