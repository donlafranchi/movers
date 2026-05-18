// T050 sandbox smoke — mirrors web/tests/migrations-t050.test.ts assertions
// without depending on Vitest (which segfaults under Linux x86_64 in the
// build sandbox per BUILD-LOG T051 note). Run: `node scripts/t050-sandbox-check.mjs`.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')
const MIGRATION = '012_member_agent_assistance.sql'

const stripComments = (sql) =>
  sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n')

let passed = 0
let failed = 0
const failures = []

const check = (label, predicate) => {
  let ok = false
  try {
    ok = !!predicate()
  } catch (e) {
    ok = false
    failures.push(`${label} — threw ${e.message}`)
  }
  if (ok) {
    passed++
  } else {
    failed++
    failures.push(label)
  }
}

// ----- directory state -----
check('directory contains 012_member_agent_assistance.sql alongside Phase 1 set', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  return JSON.stringify(files) === JSON.stringify([
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
    '012_member_agent_assistance.sql',
  ])
})

const path = resolve(MIGRATIONS_DIR, MIGRATION)
if (!existsSync(path)) {
  console.log(`SANDBOX: ${MIGRATION} not present — bailing out of body assertions (RED).`)
  console.log(`passed=${passed} failed=${failed}`)
  for (const f of failures) console.log(' - FAIL', f)
  process.exit(1)
}

const raw = readFileSync(path, 'utf8')
const sql = stripComments(raw)

// ----- member_self_records -----
check('creates public.member_self_records', () =>
  /create table\s+public\.member_self_records/i.test(sql),
)
check('member_self_records: member_id PK FK on delete cascade', () =>
  /member_id\s+uuid\s+primary key\s+references\s+public\.members\(id\)\s+on delete cascade/i.test(sql),
)
check("member_self_records: document jsonb NOT NULL default '{}'", () =>
  /document\s+jsonb\s+not null\s+default\s+'\{\}'::jsonb/i.test(sql),
)
check("member_self_records: scratch_or_full default 'scratch' with CHECK", () =>
  /scratch_or_full\s+text\s+not null\s+default\s+'scratch'\s+check\s*\(\s*scratch_or_full\s+in\s*\(\s*'scratch'\s*,\s*'full'\s*\)\s*\)/i.test(sql),
)
check('member_self_records: updated_at default now()', () =>
  /updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/i.test(sql),
)
check('member_self_records: updated_at trigger reuses public.update_updated_at_column()', () =>
  /create trigger\s+member_self_records_set_updated_at\s+before update\s+on\s+public\.member_self_records\s+for each row execute function\s+public\.update_updated_at_column\(\)/i.test(sql),
)
check('member_self_records: RLS enabled', () =>
  /alter table\s+public\.member_self_records\s+enable row level security/i.test(sql),
)
check('member_self_records: owner-read policy keyed by auth.uid()', () =>
  /create policy\s+member_self_records_owner_read[\s\S]+for select[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i.test(sql),
)
check('member_self_records: owner-update policy keyed by auth.uid()', () =>
  /create policy\s+member_self_records_owner_update[\s\S]+for update[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i.test(sql),
)
check('member_self_records: no INSERT policy', () =>
  !/policy[^;]+member_self_records[^;]+for insert/i.test(sql),
)
check('member_self_records: no DELETE policy', () =>
  !/policy[^;]+member_self_records[^;]+for delete/i.test(sql),
)
check('member_self_records: no bootstrap trigger on public.members', () =>
  // Reject any trigger on public.members that targets member_self_records,
  // and any function body that inserts into public.member_self_records.
  // The legitimate member_self_records_set_updated_at trigger fires BEFORE
  // UPDATE on public.member_self_records itself — does not match either.
  !/create\s+trigger\s+\w+\s+(after|before)\s+(insert|update)[^;]*\s+on\s+public\.members\b[\s\S]*?member_self_records/i.test(sql) &&
  !/insert\s+into\s+public\.member_self_records/i.test(sql),
)

// ----- member_delegations -----
check('creates public.member_delegations', () =>
  /create table\s+public\.member_delegations/i.test(sql),
)
check('member_delegations: id PK default gen_random_uuid()', () =>
  /id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i.test(sql),
)
check('member_delegations: member_id NOT NULL FK on delete cascade', () =>
  /member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i.test(sql),
)
check('member_delegations: grantee_label NOT NULL with length CHECK', () =>
  /grantee_label\s+text\s+not null\s+check\s*\(\s*char_length\(grantee_label\)\s+between\s+1\s+and\s+120\s*\)/i.test(sql),
)
check('member_delegations: scopes text[] NOT NULL with array_length >= 1', () =>
  /scopes\s+text\[\]\s+not null\s+check\s*\(\s*array_length\(scopes\s*,\s*1\)\s*>=\s*1\s*\)/i.test(sql),
)
check('member_delegations: granted_at default now()', () =>
  /granted_at\s+timestamptz\s+not null\s+default\s+now\(\)/i.test(sql),
)
check('member_delegations: expires_at nullable', () =>
  /expires_at\s+timestamptz\b(?!\s*not null)/i.test(sql),
)
check('member_delegations: revoked_at nullable', () =>
  /revoked_at\s+timestamptz\b(?!\s*not null)/i.test(sql),
)
check("member_delegations: metadata jsonb NOT NULL default '{}'", () =>
  /metadata\s+jsonb\s+not null\s+default\s+'\{\}'::jsonb/i.test(sql),
)
check('member_delegations: simplified partial index (member_id) where revoked_at is null', () =>
  /create index\s+idx_delegations_member_active\s+on\s+public\.member_delegations\s*\(\s*member_id\s*\)\s+where\s+revoked_at is null\s*;/i.test(sql),
)
check('member_delegations: partial index does NOT include now() predicate', () =>
  !/idx_delegations_member_active[\s\S]+expires_at\s*>\s*now\(\)/i.test(sql),
)
check('member_delegations: RLS enabled', () =>
  /alter table\s+public\.member_delegations\s+enable row level security/i.test(sql),
)
check('member_delegations: owner-read policy keyed by auth.uid()', () =>
  /create policy\s+member_delegations_owner_read[\s\S]+for select[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i.test(sql),
)
check('member_delegations: no public-read using (true)', () =>
  !/create policy[^;]+member_delegations[^;]+for select[\s\S]+using\s*\(\s*true\s*\)/i.test(sql),
)
check('member_delegations: no public/peer named read policy', () =>
  !/create policy\s+member_delegations_(public|peer)_read/i.test(sql),
)
check('member_delegations: no INSERT policy', () =>
  !/policy[^;]+member_delegations[^;]+for insert/i.test(sql),
)
check('member_delegations: no UPDATE policy', () =>
  !/policy[^;]+member_delegations[^;]+for update/i.test(sql),
)
check('member_delegations: no DELETE policy', () =>
  !/policy[^;]+member_delegations[^;]+for delete/i.test(sql),
)

// ----- FK retrofits (no NOT VALID — partitioned-table restriction) -----
// Postgres rejects NOT VALID FK on partitioned referencing tables
// (SQLSTATE 42809). Both member_events and location_events are
// RANGE-partitioned, so the ticket's mandated two-step pattern is
// incompatible. Fix-forward shape: single ADD CONSTRAINT that validates
// immediately (no-op on empty tables). DEVIATIONS entry recorded.
check('member_events FK retrofit: single add constraint with on delete set null', () =>
  /alter table\s+public\.member_events\s+add constraint\s+member_events_via_delegation_fkey\s+foreign key\s*\(\s*via_delegation_id\s*\)\s+references\s+public\.member_delegations\s*\(\s*id\s*\)\s+on delete set null\s*;/i.test(sql),
)
check('member_events FK retrofit: no NOT VALID (partitioned table)', () =>
  !/alter table\s+public\.member_events\s+add constraint\s+member_events_via_delegation_fkey[\s\S]*?not valid/i.test(sql) &&
  !/alter table\s+public\.member_events\s+validate constraint\s+member_events_via_delegation_fkey/i.test(sql),
)
check('location_events FK retrofit: single add constraint with on delete set null', () =>
  /alter table\s+public\.location_events\s+add constraint\s+location_events_via_delegation_fkey\s+foreign key\s*\(\s*via_delegation_id\s*\)\s+references\s+public\.member_delegations\s*\(\s*id\s*\)\s+on delete set null\s*;/i.test(sql),
)
check('location_events FK retrofit: no NOT VALID (partitioned table)', () =>
  !/alter table\s+public\.location_events\s+add constraint\s+location_events_via_delegation_fkey[\s\S]*?not valid/i.test(sql) &&
  !/alter table\s+public\.location_events\s+validate constraint\s+location_events_via_delegation_fkey/i.test(sql),
)

console.log(`passed=${passed} failed=${failed}`)
if (failed) {
  for (const f of failures) console.log(' - FAIL', f)
  process.exit(1)
}
process.exit(0)
