import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// T075 — file-shape assertions for the member_business_jurisdictions substrate.
// Spec: product/systems/business-jurisdiction.md § Data model implications /
//       § Action handlers / § RLS. Ticket: development/tickets/T075-*.
// DB-touching behavior is verified by the SQL test + Playwright evals against
// running Supabase; these are static-shape guards.

const MIG = resolve(__dirname, '..', 'supabase', 'migrations')
const SEEDS = resolve(__dirname, '..', 'supabase', 'seeds')
const TESTS = resolve(__dirname, '..', 'supabase', 'tests')
const stripComments = (s: string) =>
  s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

describe('T075 — 024_member_business_jurisdictions.sql', () => {
  const file = resolve(MIG, '024_member_business_jurisdictions.sql')
  it('exists', () => expect(existsSync(file)).toBe(true))
  const sql = stripComments(readFileSync(file, 'utf8'))

  it('creates member_business_jurisdictions with the spec columns', () => {
    expect(sql).toMatch(/create table\s+public\.member_business_jurisdictions/i)
    expect(sql).toMatch(/member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i)
    expect(sql).toMatch(/group_id\s+uuid\s+not null\s+references\s+public\.groups\(id\)\s+on delete cascade/i)
    expect(sql).toMatch(/zip\s+text\s+not null\s+check\s*\(\s*zip\s*~\s*'\^\[0-9\]\{5\}\$'\s*\)/i)
    expect(sql).toMatch(/state\s+text\s+check\s*\(\s*state\s*~\s*'\^\[A-Z\]\{2\}\$'\s*\)/i)
    expect(sql).toMatch(/legal_entity_name\s+text/i)
    expect(sql).toMatch(/verification_source\s+text\s+not null/i)
    expect(sql).toMatch(/check\s*\(\s*verification_source\s+in\s*\(\s*'self_attested'\s*,\s*'community_attested'\s*,\s*'document_upload'\s*\)\s*\)/i)
    expect(sql).toMatch(/verified_at\s+timestamptz/i)
    expect(sql).toMatch(/source_document_id\s+uuid/i)
    expect(sql).toMatch(/removed_at\s+timestamptz/i)
  })

  it('does NOT add the documentation-only primary key_constraint_note column', () => {
    expect(sql).not.toMatch(/primary key_constraint_note/i)
    expect(sql).not.toMatch(/generated always as/i)
  })

  it('creates the active-row partial unique index on (member_id, group_id)', () => {
    expect(sql).toMatch(
      /create unique index\s+ux_jurisdiction_member_group_active\s+on\s+public\.member_business_jurisdictions\s*\(\s*member_id\s*,\s*group_id\s*\)\s+where\s+removed_at\s+is\s+null/i,
    )
  })

  it('creates the active-row zip lookup index', () => {
    expect(sql).toMatch(
      /create index\s+idx_jurisdiction_zip_active\s+on\s+public\.member_business_jurisdictions\s*\(\s*zip\s*\)\s+where\s+removed_at\s+is\s+null/i,
    )
  })

  it('enables RLS and ships the public-active select policy', () => {
    expect(sql).toMatch(/alter table\s+public\.member_business_jurisdictions\s+enable row level security/i)
    expect(sql).toMatch(/create policy\s+mbj_select_public_active\s+on\s+public\.member_business_jurisdictions\s+for\s+select\s+using\s*\(\s*removed_at\s+is\s+null\s*\)/i)
  })

  it('ships NO client INSERT/UPDATE/DELETE policy (action-layer-only writes)', () => {
    expect(sql).not.toMatch(/for\s+(insert|update|delete)/i)
  })

  it('extends member_events.event_kind CHECK with the two jurisdiction kinds', () => {
    expect(sql).toMatch(/drop constraint if exists\s+member_events_event_kind_check/i)
    expect(sql).toMatch(/'member\.business_jurisdiction_set'/)
    expect(sql).toMatch(/'member\.business_jurisdiction_removed'/)
  })

  it('preserves prior member_events kinds when extending the CHECK', () => {
    for (const kind of [
      'member.created',
      'member.place_interest_added',
      'member.saved_search.created',
    ]) {
      expect(sql).toContain(`'${kind}'`)
    }
  })
})

describe('T075 — 025_zip_metro_crosswalk.sql', () => {
  const file = resolve(MIG, '025_zip_metro_crosswalk.sql')
  it('exists', () => expect(existsSync(file)).toBe(true))
  const sql = stripComments(readFileSync(file, 'utf8'))

  it('creates zip_metro_crosswalk with the spec columns', () => {
    expect(sql).toMatch(/create table\s+public\.zip_metro_crosswalk/i)
    expect(sql).toMatch(/zip\s+text\s+primary key\s+check\s*\(\s*zip\s*~\s*'\^\[0-9\]\{5\}\$'\s*\)/i)
    expect(sql).toMatch(/msa_code\s+text\s+not null/i)
    expect(sql).toMatch(/msa_name\s+text\s+not null/i)
    expect(sql).toMatch(/state\s+text\s+not null\s+check\s*\(\s*state\s*~\s*'\^\[A-Z\]\{2\}\$'\s*\)/i)
    expect(sql).toMatch(/source\s+text\s+not null\s+default/i)
    expect(sql).toMatch(/refreshed_at\s+timestamptz\s+not null\s+default\s+now\(\)/i)
  })

  it('adds places.msa_code (column absent before this ticket — DEVIATION-logged)', () => {
    expect(sql).toMatch(/alter table\s+public\.places\s+add column if not exists\s+msa_code\s+text/i)
  })

  it('adds locations.place_id join path (column absent before this ticket — DEVIATION-logged)', () => {
    expect(sql).toMatch(/alter table\s+public\.locations\s+add column if not exists\s+place_id\s+uuid/i)
  })

  it('loads the Sacramento seed (inlined — no psql backslash include)', () => {
    expect(sql).toMatch(/insert\s+into\s+public\.zip_metro_crosswalk/i)
    expect(sql).not.toMatch(/\\i(r)?\s/) // \i / \ir would fail the supabase driver
  })

  it('enables RLS on zip_metro_crosswalk with a public-read policy (Rule 3)', () => {
    expect(sql).toMatch(/alter table\s+public\.zip_metro_crosswalk\s+enable row level security/i)
    expect(sql).toMatch(/create policy\s+zmc_select_public\s+on\s+public\.zip_metro_crosswalk\s+for\s+select\s+using\s*\(\s*true\s*\)/i)
  })

  it('defines the SECURITY DEFINER proximity function with grants', () => {
    expect(sql).toMatch(/create or replace function\s+public\.zip_is_proximal_to_location\s*\(\s*zip\s+text\s*,\s*location_id\s+uuid\s*\)\s+returns boolean/i)
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(/\bstable\b/i)
    expect(sql).toMatch(/language sql/i)
    expect(sql).toMatch(/grant execute on function\s+public\.zip_is_proximal_to_location[\s\S]*?to\s+authenticated\s*,\s*anon/i)
  })
})

describe('T075 — Sacramento crosswalk seed', () => {
  const file = resolve(SEEDS, 'zip_metro_crosswalk_sacramento.sql')
  it('exists', () => expect(existsSync(file)).toBe(true))
  const sql = readFileSync(file, 'utf8')

  it('inserts into zip_metro_crosswalk with CBSA 40900', () => {
    expect(sql).toMatch(/insert\s+into\s+public\.zip_metro_crosswalk/i)
    expect(sql).toContain('40900')
  })

  it('covers the downtown Sacramento eval ZIPs', () => {
    for (const zip of ['95818', '95816', '95814']) {
      expect(sql).toContain(zip)
    }
  })
})

describe('T075 — proximity SQL test fixture', () => {
  const file = resolve(TESTS, 'zip_is_proximal_to_location.sql')
  it('exists', () => expect(existsSync(file)).toBe(true))
  const sql = readFileSync(file, 'utf8')

  it('covers the five contract cases', () => {
    expect(sql).toMatch(/same.?msa|same metro/i)
    expect(sql).toMatch(/different.?msa|cross.?msa/i)
    expect(sql).toMatch(/unknown zip/i)
    expect(sql).toMatch(/null place_id|no place/i)
    expect(sql).toMatch(/null msa_code|no msa/i)
  })
})
