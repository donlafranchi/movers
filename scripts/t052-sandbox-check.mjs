// T052 sandbox smoke — mirrors web/tests/eval-bootstrap.test.ts assertions
// without depending on Vitest (which segfaults under Linux x86_64 in the
// build sandbox per BUILD-LOG T051 note). Run: `node scripts/t052-sandbox-check.mjs`.
//
// Coverage:
//   - layout (test-helpers/ + the four .sql files; bootstrap script present)
//   - SQL function shape (SECURITY DEFINER + revoke/grant on every fn)
//   - introspection helpers present + vector typing via format_type
//   - conformance helpers (eval_artifacts + eval_conformance_check_result)
//   - failure-injection helper (subtransaction + not_null_violation + ADR-7)
//   - handle-collision helpers (generate_series + LIKE clear path)
//   - bootstrap script localhost guard (negative path; positive path needs DB)
//   - --json flag on the conformance script
//   - package.json wires `eval:bootstrap`
//
// Positive-path bootstrap (apply SQL + probe) requires a live local Postgres
// and is the user's manual smoke step. The script tries to detect a live DB
// at $DATABASE_URL and skip those checks otherwise.

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const HELPERS_DIR = resolve(ROOT, 'supabase', 'test-helpers')
const SCRIPT = resolve(ROOT, 'scripts', 'bootstrap-eval-helpers.ts')
const CONFORMANCE = resolve(ROOT, 'scripts', 'check-action-layer-conformance.ts')

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
    if (!failures.find((f) => f.startsWith(label))) failures.push(label)
  }
}

// ─── layout ────────────────────────────────────────────────────────────
check('supabase/test-helpers/ exists', () => existsSync(HELPERS_DIR))
check('bootstrap-eval-helpers.ts exists', () => existsSync(SCRIPT))

const REQUIRED_SQL = [
  '00_introspection.sql',
  '01_conformance.sql',
  '02_action_failure_injection.sql',
  '03_handle_collisions.sql',
]
for (const f of REQUIRED_SQL) {
  check(`test-helpers/${f} exists`, () => existsSync(resolve(HELPERS_DIR, f)))
}

const NO_NEW_MIGRATIONS = () => {
  const expected = [
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
  ]
  const actual = readdirSync(resolve(ROOT, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
  return JSON.stringify(actual) === JSON.stringify(expected)
}
check('no new files added to supabase/migrations/', NO_NEW_MIGRATIONS)

// ─── SQL function shape ────────────────────────────────────────────────
const readIfExists = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const stripComments = (sql) =>
  sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n')

for (const f of REQUIRED_SQL) {
  const sql = readIfExists(resolve(HELPERS_DIR, f))
  if (!sql) continue
  const stripped = stripComments(sql)
  const fnCount = (stripped.match(/create or replace function/gi) || []).length
  const secDefCount = (stripped.match(/security definer/gi) || []).length
  check(`${f}: every function declares SECURITY DEFINER (${fnCount} fns, ${secDefCount} security definer)`, () =>
    fnCount > 0 && secDefCount >= fnCount,
  )
  check(`${f}: revokes execute from public`, () => /revoke\s+execute\s+on\s+function/i.test(stripped))
  check(`${f}: grants execute to service_role`, () =>
    /grant\s+execute\s+on\s+function[\s\S]*service_role/i.test(stripped),
  )
  check(`${f}: opens with ticket reference T052`, () => /T052/.test(sql))
}

// ─── 00_introspection.sql ───────────────────────────────────────────────
{
  const sql = readIfExists(resolve(HELPERS_DIR, '00_introspection.sql'))
  const stripped = stripComments(sql)
  check('eval_pg_extensions defined returning (extname text)', () =>
    /function\s+public\.eval_pg_extensions\s*\(\s*\)\s+returns\s+table\s*\(\s*extname\s+text\s*\)/i.test(stripped),
  )
  check('eval_pg_extensions queries pg_extension for vector + postgis', () =>
    /pg_extension/i.test(stripped) && /'vector'/.test(stripped) && /'postgis'/.test(stripped),
  )
  check('eval_table_shape defined with (p_table text)', () =>
    /function\s+public\.eval_table_shape\s*\(\s*p_table\s+text\s*\)/i.test(stripped),
  )
  check('eval_table_shape returns (column_name text, data_type text, is_nullable text)', () =>
    /returns\s+table\s*\(\s*column_name\s+text\s*,\s*data_type\s+text\s*,\s*is_nullable\s+text\s*\)/i.test(stripped),
  )
  check('eval_table_shape uses pg_attribute + format_type for vector typing', () =>
    /pg_attribute/i.test(stripped) && /format_type\s*\(\s*[a-z_]*\.?atttypid/i.test(stripped),
  )
  check('eval_is_partitioned defined with (p_table text) returns boolean', () =>
    /function\s+public\.eval_is_partitioned\s*\(\s*p_table\s+text\s*\)\s+returns\s+boolean/i.test(stripped),
  )
  check("eval_is_partitioned checks relkind = 'p'", () => /relkind\s*=\s*'p'/.test(stripped))
}

// ─── 01_conformance.sql ────────────────────────────────────────────────
{
  const sql = readIfExists(resolve(HELPERS_DIR, '01_conformance.sql'))
  const stripped = stripComments(sql)
  check('eval_artifacts table created idempotently', () =>
    /create table if not exists\s+public\.eval_artifacts/i.test(stripped),
  )
  check('eval_artifacts has key text primary key, value jsonb, created_at timestamptz', () => {
    return (
      /key\s+text\s+primary key/i.test(stripped) &&
      /value\s+jsonb/i.test(stripped) &&
      /created_at\s+timestamptz/i.test(stripped)
    )
  })
  check('eval_conformance_check_result defined returns jsonb', () =>
    /function\s+public\.eval_conformance_check_result\s*\(\s*\)\s+returns\s+jsonb/i.test(stripped),
  )
  check('eval_conformance_check_result raises a clear error if row missing', () => {
    return (
      /raise exception/i.test(stripped) &&
      /(eval:bootstrap|bootstrap.*before)/i.test(stripped)
    )
  })
}

// ─── 02_action_failure_injection.sql ───────────────────────────────────
{
  const sql = readIfExists(resolve(HELPERS_DIR, '02_action_failure_injection.sql'))
  const stripped = stripComments(sql)
  check('eval_member_create_with_failure_injection defined with (p_id uuid) returns jsonb', () =>
    /function\s+public\.eval_member_create_with_failure_injection\s*\(\s*p_id\s+uuid\s*\)\s+returns\s+jsonb/i.test(stripped),
  )
  check('helper uses subtransaction (begin ... exception)', () =>
    /\bbegin\b[\s\S]*\bexception\s+when\s+not_null_violation\b/i.test(stripped),
  )
  check('helper inserts into members + member_events', () =>
    /insert into\s+(public\.)?members\b/i.test(stripped) &&
    /insert into\s+(public\.)?member_events\b/i.test(stripped),
  )
  check('helper returns rolledBack + membersRowRemaining keys', () =>
    /jsonb_build_object\s*\([\s\S]*['"]rolledBack['"][\s\S]*['"]membersRowRemaining['"]/i.test(stripped),
  )
  check('helper references ADR-7 (not ADR-10) in commentary', () => /ADR-7/.test(sql))
}

// ─── 03_handle_collisions.sql ──────────────────────────────────────────
{
  const sql = readIfExists(resolve(HELPERS_DIR, '03_handle_collisions.sql'))
  const stripped = stripComments(sql)
  check('eval_seed_handle_collision_range defined with (p_base text, p_count int) returns void', () =>
    /function\s+public\.eval_seed_handle_collision_range\s*\(\s*p_base\s+text\s*,\s*p_count\s+(int|integer)\s*\)\s+returns\s+void/i.test(stripped),
  )
  check('seed uses generate_series for one-shot insert', () => /generate_series/i.test(stripped))
  check('seed uses gen_random_uuid() for ids', () => /gen_random_uuid\s*\(\s*\)/i.test(stripped))
  check('seed is idempotent via on conflict do nothing', () => /on conflict[\s\S]*do nothing/i.test(stripped))
  check('eval_clear_handle_collision_range defined with (p_base text) returns void', () =>
    /function\s+public\.eval_clear_handle_collision_range\s*\(\s*p_base\s+text\s*\)\s+returns\s+void/i.test(stripped),
  )
  check('clear deletes from member_events before members (FK ordering)', () => {
    const evIdx = stripped.search(/delete from\s+(public\.)?member_events/i)
    const mIdx = stripped.search(/delete from\s+(public\.)?members\b/i)
    return evIdx >= 0 && mIdx >= 0 && evIdx < mIdx
  })
  check('clear uses LIKE (parameterized-safe) not regex concatenation', () =>
    /handle\s+like\s+p_base/i.test(stripped) || /handle\s+=\s+p_base\b[\s\S]*handle\s+like/i.test(stripped),
  )
}

// ─── bootstrap script localhost guard ──────────────────────────────────
const runBootstrap = (env) => {
  try {
    const stdout = execSync(`npx -y tsx ${JSON.stringify(SCRIPT)}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    }
  }
}

if (existsSync(SCRIPT)) {
  const r1 = runBootstrap({ DATABASE_URL: 'postgresql://user:pw@prod.example.com:5432/db', SUPABASE_ENV: '' })
  check('bootstrap refuses non-local DATABASE_URL (prod.example.com)', () => r1.code !== 0)
  check('bootstrap prints a clear refusal message for non-local DB', () =>
    /local|localhost|non[- ]local|refus/i.test(r1.stderr + r1.stdout),
  )
  const r2 = runBootstrap({ DATABASE_URL: '', SUPABASE_ENV: '' })
  check('bootstrap refuses when DATABASE_URL is missing', () => r2.code !== 0)
  const r3 = runBootstrap({
    DATABASE_URL: 'postgresql://user:pw@prod.example.com:5432/db',
    SUPABASE_ENV: 'production',
  })
  check('bootstrap refuses non-local host even when SUPABASE_ENV != local', () => r3.code !== 0)
  // A truthy localhost guard should *accept* (or attempt to connect to) localhost. We won't
  // actually have a DB up in the sandbox, so we look for a different failure mode (connect
  // error, not refusal).
  const r4 = runBootstrap({
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    SUPABASE_ENV: '',
  })
  check('bootstrap accepts 127.0.0.1 host past the guard (fails on connect or applies SQL)', () => {
    // Either exits 0 (DB present, SQL applied) OR exits non-zero with a connect-level
    // error rather than a "non-local" guard refusal.
    if (r4.code === 0) return true
    const combined = r4.stderr + r4.stdout
    // Negative match: guard message is "REFUSED — DATABASE_URL host ..." or
    // "REFUSED — DATABASE_URL is not set". ECONNREFUSED is a pg-level connect
    // error and means the guard already let us through — that's what we want.
    return !/REFUSED — /.test(combined)
  })
} else {
  check('bootstrap script localhost guard — SKIPPED (script missing)', () => false)
}

// ─── --json mode on conformance script ─────────────────────────────────
try {
  const out = execSync(`npx -y tsx ${JSON.stringify(CONFORMANCE)} --json`, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let parsed
  let parseOk = false
  try {
    parsed = JSON.parse(out)
    parseOk = true
  } catch {
    parseOk = false
  }
  check('--json mode emits parseable JSON', () => parseOk)
  if (parseOk) {
    check('--json output has { ok: boolean, violations: array }', () =>
      typeof parsed.ok === 'boolean' && Array.isArray(parsed.violations),
    )
    check('--json output on clean tree shows ok=true and violations=[]', () =>
      parsed.ok === true && parsed.violations.length === 0,
    )
  }
} catch (err) {
  check('--json mode does not crash on a clean tree', () => false)
  failures.push(`  (--json crash: status=${err.status} stderr=${(err.stderr ?? '').toString().slice(0, 200)})`)
}

// ─── conformance allowlist marker ──────────────────────────────────────
{
  const script = readIfExists(CONFORMANCE)
  check('conformance script references test-helpers in allowlist or comments', () =>
    /test-helpers/i.test(script),
  )
  check('conformance script remarks T052', () => /T052/.test(script))
}

// ─── package.json eval:bootstrap script ────────────────────────────────
{
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  check('package.json scripts has eval:bootstrap', () => Boolean(pkg.scripts && pkg.scripts['eval:bootstrap']))
  if (pkg.scripts && pkg.scripts['eval:bootstrap']) {
    check('eval:bootstrap script points at bootstrap-eval-helpers', () =>
      /bootstrap-eval-helpers/.test(pkg.scripts['eval:bootstrap']),
    )
    check('eval:bootstrap uses tsx runner', () => /tsx/.test(pkg.scripts['eval:bootstrap']))
  }
}

// ─── summary ────────────────────────────────────────────────────────────
console.log('')
console.log(`T052 sandbox check: passed=${passed} failed=${failed}`)
if (failed > 0) {
  for (const f of failures) console.log('  - FAIL', f)
  process.exit(1)
}
process.exit(0)
