// T049 sandbox smoke — mirrors web/tests/migrations-t049.test.ts assertions
// without depending on Vitest (which segfaults under Linux x86_64 in the
// build sandbox per BUILD-LOG T051 note). Run: `node scripts/t049-sandbox-check.mjs`.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations')
const MIGRATION = '011_member_location_affinities.sql'

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
check('directory contains 011_member_location_affinities.sql', () => {
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

// ----- table shape -----
check('creates public.member_location_affinities', () =>
  /create table\s+public\.member_location_affinities/i.test(sql),
)
check('member_id NOT NULL FK on delete cascade', () =>
  /member_id\s+uuid\s+not null\s+references\s+public\.members\(id\)\s+on delete cascade/i.test(sql),
)
check('location_id NOT NULL FK on delete cascade', () =>
  /location_id\s+uuid\s+not null\s+references\s+public\.locations\(id\)\s+on delete cascade/i.test(sql),
)
check('affinity_kind text NOT NULL', () => /affinity_kind\s+text\s+not null/i.test(sql))
for (const kind of ['lives', 'works', 'plays', 'visits', 'follows', 'liked']) {
  check(`affinity_kind enum contains '${kind}'`, () => new RegExp(`'${kind}'`).test(sql))
}
check('affinity_kind CHECK enumerates all six in order', () =>
  /check\s*\(\s*affinity_kind\s+in\s*\(\s*'lives'\s*,\s*'works'\s*,\s*'plays'\s*,\s*'visits'\s*,\s*'follows'\s*,\s*'liked'\s*\)\s*\)/i.test(sql),
)
check('created_at default now()', () =>
  /created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i.test(sql),
)
check('removed_at nullable', () => /removed_at\s+timestamptz\b(?!\s*not null)/i.test(sql))
check('composite PK on (member_id, location_id, affinity_kind)', () =>
  /primary key\s*\(\s*member_id\s*,\s*location_id\s*,\s*affinity_kind\s*\)/i.test(sql),
)

// ----- indexes -----
check('idx_affinity_member_active partial on (member_id, affinity_kind) where removed_at is null', () =>
  /create index\s+idx_affinity_member_active\s+on\s+public\.member_location_affinities\s*\(\s*member_id\s*,\s*affinity_kind\s*\)\s+where\s+removed_at is null/i.test(sql),
)
check("idx_affinity_location_followers partial on (location_id) where affinity_kind = 'follows' and removed_at is null", () =>
  /create index\s+idx_affinity_location_followers\s+on\s+public\.member_location_affinities\s*\(\s*location_id\s*\)\s+where\s+affinity_kind\s*=\s*'follows'\s+and\s+removed_at is null/i.test(sql),
)
check("idx_affinity_location_locals partial on (location_id, affinity_kind) where affinity_kind in ('lives','works') and removed_at is null", () =>
  /create index\s+idx_affinity_location_locals\s+on\s+public\.member_location_affinities\s*\(\s*location_id\s*,\s*affinity_kind\s*\)\s+where\s+affinity_kind\s+in\s*\(\s*'lives'\s*,\s*'works'\s*\)\s+and\s+removed_at is null/i.test(sql),
)

// ----- RLS -----
check('RLS enabled on table', () =>
  /alter table\s+public\.member_location_affinities\s+enable row level security/i.test(sql),
)
check('single owner-read policy keyed by auth.uid()', () =>
  /create policy\s+member_location_affinities_owner_read[\s\S]+for select[\s\S]+using\s*\(\s*member_id\s*=\s*auth\.uid\(\)\s*\)/i.test(sql),
)
check('no public-read using (true) on member_location_affinities', () =>
  !/create policy[^;]+member_location_affinities[^;]+for select[\s\S]+using\s*\(\s*true\s*\)/i.test(sql),
)
check('no public/peer named read policy', () =>
  !/create policy\s+member_location_affinities_(public|peer)_read/i.test(sql),
)
check('no INSERT policy on table', () =>
  !/policy[^;]+member_location_affinities[^;]+for insert/i.test(sql),
)
check('no UPDATE policy on table', () =>
  !/policy[^;]+member_location_affinities[^;]+for update/i.test(sql),
)
check('no DELETE policy on table', () =>
  !/policy[^;]+member_location_affinities[^;]+for delete/i.test(sql),
)

// ----- SECURITY DEFINER functions -----
const FN = {
  member_is_local_to_location: {
    sig: /create or replace function\s+public\.member_is_local_to_location\s*\(\s*p_member_id\s+uuid\s*,\s*p_location_id\s+uuid\s*\)\s+returns\s+boolean/i,
    body: /create or replace function\s+public\.member_is_local_to_location[\s\S]+?\$\$;/i,
    extra: [
      [/affinity_kind\s+in\s*\(\s*'lives'\s*,\s*'works'\s*\)/i, "filters on 'lives' and 'works'"],
      [/removed_at is null/i, 'filters removed_at is null'],
    ],
    grant: /grant execute on function\s+public\.member_is_local_to_location\s*\(\s*uuid\s*,\s*uuid\s*\)\s+to\s+(authenticated\s*,\s*anon|anon\s*,\s*authenticated)/i,
  },
  count_likes_for_location: {
    sig: /create or replace function\s+public\.count_likes_for_location\s*\(\s*p_location_id\s+uuid\s*\)\s+returns\s+integer/i,
    body: /create or replace function\s+public\.count_likes_for_location[\s\S]+?\$\$;/i,
    extra: [
      [/affinity_kind\s*=\s*'liked'/i, "filters affinity_kind = 'liked'"],
      [/removed_at is null/i, 'filters removed_at is null'],
    ],
    grant: /grant execute on function\s+public\.count_likes_for_location\s*\(\s*uuid\s*\)\s+to\s+(authenticated\s*,\s*anon|anon\s*,\s*authenticated)/i,
  },
  count_followers_for_location: {
    sig: /create or replace function\s+public\.count_followers_for_location\s*\(\s*p_location_id\s+uuid\s*\)\s+returns\s+integer/i,
    body: /create or replace function\s+public\.count_followers_for_location[\s\S]+?\$\$;/i,
    extra: [
      [/affinity_kind\s*=\s*'follows'/i, "filters affinity_kind = 'follows'"],
      [/removed_at is null/i, 'filters removed_at is null'],
    ],
    grant: /grant execute on function\s+public\.count_followers_for_location\s*\(\s*uuid\s*\)\s+to\s+(authenticated\s*,\s*anon|anon\s*,\s*authenticated)/i,
  },
}

for (const [name, { sig, body, extra, grant }] of Object.entries(FN)) {
  check(`${name}: signature present`, () => sig.test(sql))
  const m = sql.match(body)
  check(`${name}: body extractable`, () => !!m)
  if (m) {
    const b = m[0]
    check(`${name}: security definer`, () => /security definer/i.test(b))
    check(`${name}: set search_path = public`, () => /set search_path\s*=\s*public/i.test(b))
    check(`${name}: STABLE`, () => /\bstable\b/i.test(b))
    for (const [re, label] of extra) {
      check(`${name}: ${label}`, () => re.test(b))
    }
  }
  check(`${name}: grant execute to authenticated + anon`, () => grant.test(sql))
}

console.log(`passed=${passed} failed=${failed}`)
if (failed) {
  for (const f of failures) console.log(' - FAIL', f)
  process.exit(1)
}
process.exit(0)
