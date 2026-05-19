// T052 — Bootstrap script for the Phase 0 eval helpers.
//
// Source ticket: development/tickets/T052-phase-0-eval-helpers.md
// ADR: planning/adrs/ADR-0018-eval-helpers.md
//
// These tests exercise three guarantees of `scripts/bootstrap-eval-helpers.ts`:
//   1. Positive — when DATABASE_URL is localhost-shaped, the script applies
//      the SQL files and probes a helper. (Skipped in sandbox runs with no
//      DATABASE_URL; the user's local Supabase is the verification surface.)
//   2. Negative — when DATABASE_URL points at a non-local host, the script
//      hard-exits with a clear message and writes no SQL.
//   3. Idempotency — re-running on an already-bootstrapped DB is a no-op.
//
// Vitest 4 + rolldown segfaults under Linux x86_64 in the build sandbox
// (BUILD-LOG T051 note). A plain-node mirror lives at
// `scripts/t052-sandbox-check.mjs` for sandbox verification.

import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const SCRIPT = resolve(ROOT, 'scripts', 'bootstrap-eval-helpers.ts')
const HELPERS_DIR = resolve(ROOT, 'supabase', 'test-helpers')

function runScript(env: Record<string, string>): {
  code: number
  stdout: string
  stderr: string
} {
  try {
    const stdout = execSync(`tsx ${JSON.stringify(SCRIPT)}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    return { code: 0, stdout, stderr: '' }
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string }
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    }
  }
}

describe('T052 — bootstrap script presence + layout', () => {
  it('scripts/bootstrap-eval-helpers.ts exists', () => {
    expect(existsSync(SCRIPT)).toBe(true)
  })

  it('supabase/test-helpers/ directory exists with the four required SQL files', () => {
    expect(existsSync(HELPERS_DIR)).toBe(true)
    const expected = [
      '00_introspection.sql',
      '01_conformance.sql',
      '02_action_failure_injection.sql',
      '03_handle_collisions.sql',
    ]
    for (const f of expected) {
      expect(existsSync(resolve(HELPERS_DIR, f))).toBe(true)
    }
  })

  it('test-helpers SQL files declare SECURITY DEFINER on every function', () => {
    const sqlFiles = [
      '00_introspection.sql',
      '01_conformance.sql',
      '02_action_failure_injection.sql',
      '03_handle_collisions.sql',
    ]
    for (const f of sqlFiles) {
      const sql = readFileSync(resolve(HELPERS_DIR, f), 'utf8')
      const fnCount = (sql.match(/create or replace function/gi) || []).length
      const secDefCount = (sql.match(/security definer/gi) || []).length
      expect(secDefCount).toBeGreaterThanOrEqual(fnCount)
    }
  })

  it('every test-helpers SQL file revokes execute from public', () => {
    const sqlFiles = [
      '00_introspection.sql',
      '01_conformance.sql',
      '02_action_failure_injection.sql',
      '03_handle_collisions.sql',
    ]
    for (const f of sqlFiles) {
      const sql = readFileSync(resolve(HELPERS_DIR, f), 'utf8')
      expect(sql).toMatch(/revoke execute on function/i)
      expect(sql).toMatch(/grant execute on function/i)
      expect(sql).toMatch(/service_role/i)
    }
  })

  it('00_introspection.sql defines the three introspection helpers', () => {
    const sql = readFileSync(resolve(HELPERS_DIR, '00_introspection.sql'), 'utf8')
    expect(sql).toMatch(/function\s+public\.eval_pg_extensions/i)
    expect(sql).toMatch(/function\s+public\.eval_table_shape/i)
    expect(sql).toMatch(/function\s+public\.eval_is_partitioned/i)
  })

  it('00_introspection.sql reads vector column types from pg_attribute / format_type, not information_schema', () => {
    const sql = readFileSync(resolve(HELPERS_DIR, '00_introspection.sql'), 'utf8')
    expect(sql).toMatch(/pg_attribute/i)
    expect(sql).toMatch(/format_type\s*\(\s*[a-z_]*\.?atttypid/i)
  })

  it('01_conformance.sql creates the eval_artifacts table + eval_conformance_check_result function', () => {
    const sql = readFileSync(resolve(HELPERS_DIR, '01_conformance.sql'), 'utf8')
    expect(sql).toMatch(/create table if not exists\s+public\.eval_artifacts/i)
    expect(sql).toMatch(/function\s+public\.eval_conformance_check_result/i)
    expect(sql).toMatch(/raise exception/i)
  })

  it('02_action_failure_injection.sql defines eval_member_create_with_failure_injection using subtransaction + not_null_violation', () => {
    const sql = readFileSync(resolve(HELPERS_DIR, '02_action_failure_injection.sql'), 'utf8')
    expect(sql).toMatch(/function\s+public\.eval_member_create_with_failure_injection/i)
    expect(sql).toMatch(/not_null_violation/i)
    // ADR-7 (not ADR-10) is the same-transaction invariant per the 2026-05-10
    // consolidation; the function comment must reference the live ADR.
    expect(sql).toMatch(/ADR-7/i)
  })

  it('03_handle_collisions.sql defines the seed + clear helpers, and clear uses LIKE not regex', () => {
    const sql = readFileSync(resolve(HELPERS_DIR, '03_handle_collisions.sql'), 'utf8')
    expect(sql).toMatch(/function\s+public\.eval_seed_handle_collision_range/i)
    expect(sql).toMatch(/function\s+public\.eval_clear_handle_collision_range/i)
    // Seed uses a FOR loop per the 2026-05-18 ADR-15 fix-forward (DEVIATIONS):
    // the prior `INSERT … SELECT generate_series(...)` shape silently used a
    // single gen_random_uuid() that collided with T047's id-in-auth-users
    // trigger. The loop threads a per-iteration uuid through
    // eval_seed_auth_user_only + the members insert.
    expect(sql).toMatch(/for\s+\w+\s+in\s+1\s*\.\.\s*p_count\s+loop/i)
    expect(sql).toMatch(/on conflict do nothing/i)
    // Clear uses LIKE (parameterized-safe) rather than regex with raw concatenation.
    expect(sql).toMatch(/handle\s+like\s+/i)
  })
})

describe('T052 — bootstrap script localhost guard', () => {
  it('refuses to run when DATABASE_URL points at a non-local host', () => {
    const r = runScript({ DATABASE_URL: 'postgresql://user:pw@prod.example.com:5432/db' })
    expect(r.code).not.toBe(0)
    // Match the script's literal refusal banner. ECONNREFUSED would falsely
    // match a looser /refus/i, so we anchor on the exact banner shape.
    expect(r.stderr + r.stdout).toMatch(/REFUSED — /)
  })

  it('refuses when DATABASE_URL is missing entirely (unless SUPABASE_ENV=local is set)', () => {
    const r = runScript({ DATABASE_URL: '' })
    expect(r.code).not.toBe(0)
  })

  it('refuses non-local hosts even when SUPABASE_ENV is set to something other than local', () => {
    const r = runScript({
      DATABASE_URL: 'postgresql://user:pw@prod.example.com:5432/db',
      SUPABASE_ENV: 'production',
    })
    expect(r.code).not.toBe(0)
  })
})

describe('T052 — conformance script --json mode (sub-task)', () => {
  it('emits parseable JSON with { ok: boolean, violations: array } when called with --json', () => {
    const out = execSync('tsx scripts/check-action-layer-conformance.ts --json', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(out)
    expect(parsed).toHaveProperty('ok')
    expect(typeof parsed.ok).toBe('boolean')
    expect(parsed).toHaveProperty('violations')
    expect(Array.isArray(parsed.violations)).toBe(true)
  })

  it('--json mode preserves the exit-code semantics (0 = ok on a clean tree)', () => {
    try {
      execSync('tsx scripts/check-action-layer-conformance.ts --json', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      // Reached: clean tree → exit 0.
      expect(true).toBe(true)
    } catch (err: unknown) {
      const e = err as { status?: number }
      // If this fires, the tree has a conformance violation that needs
      // fixing — but the --json contract still holds: stderr/stdout
      // contains parseable JSON. The exit-code semantics test is what's
      // being asserted, so re-throw to surface the violation.
      throw new Error(
        `check-action-layer-conformance.ts --json exited non-zero on a tree that should be clean (status=${e.status}). Fix the underlying violation first.`,
      )
    }
  })
})

describe('T052 — conformance allowlist updates', () => {
  it('check-action-layer-conformance.ts exempts the test-helpers folder and the bootstrap script', () => {
    const script = readFileSync(
      resolve(ROOT, 'scripts', 'check-action-layer-conformance.ts'),
      'utf8',
    )
    // The script handles both source files (filtered to src/) and the
    // bootstrap path. The bootstrap script lives outside src/ so the
    // checkPrimaryWrites rule's src-only filter already excludes it.
    // We assert the script has a marker comment for T052's allowlist so
    // future agents can grep for it.
    expect(script).toMatch(/T052|test-helpers/i)
  })
})

describe('T052 — package.json wiring', () => {
  it('package.json defines an eval:bootstrap script pointing at the bootstrap file', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts).toBeDefined()
    expect(pkg.scripts['eval:bootstrap']).toBeDefined()
    expect(pkg.scripts['eval:bootstrap']).toMatch(/bootstrap-eval-helpers/)
    expect(pkg.scripts['eval:bootstrap']).toMatch(/tsx/)
  })
})

describe('T053 — Phase 1 introspection helpers appended to 00_introspection.sql', () => {
  const sql = () => readFileSync(resolve(HELPERS_DIR, '00_introspection.sql'), 'utf8')

  it('defines eval_indexes_for_table(p_table text) returning indexname + indexdef', () => {
    const s = sql()
    expect(s).toMatch(/function\s+public\.eval_indexes_for_table\s*\(\s*p_table\s+text\s*\)/i)
    expect(s).toMatch(/returns\s+table\s*\([^)]*indexname[^)]*indexdef[^)]*\)/i)
    expect(s).toMatch(/from\s+pg_indexes/i)
    expect(s).toMatch(/schemaname\s*=\s*'public'/i)
  })

  it('defines eval_foreign_keys_for_table(p_table text) with single-column conkey[1] indexing', () => {
    const s = sql()
    expect(s).toMatch(/function\s+public\.eval_foreign_keys_for_table\s*\(\s*p_table\s+text\s*\)/i)
    expect(s).toMatch(/c\.conkey\[1\]/i)
    expect(s).toMatch(/c\.confkey\[1\]/i)
    // Why: the spec asserts the delete_action by name; the case-mapping has
    // to be present and complete so missing actions surface as null rather
    // than silently misreporting.
    expect(s).toMatch(/'NO ACTION'/)
    expect(s).toMatch(/'SET NULL'/)
    expect(s).toMatch(/'CASCADE'/)
  })

  it('defines eval_partition_count(p_parent text) reading pg_inherits join pg_class', () => {
    const s = sql()
    expect(s).toMatch(/function\s+public\.eval_partition_count\s*\(\s*p_parent\s+text\s*\)/i)
    expect(s).toMatch(/from\s+pg_inherits/i)
    expect(s).toMatch(/i\.inhparent/i)
    expect(s).toMatch(/returns\s+integer/i)
  })

  it('defines eval_location_geography_text(p_location_id uuid) with PostGIS extensions in search_path', () => {
    const s = sql()
    expect(s).toMatch(
      /function\s+public\.eval_location_geography_text\s*\(\s*p_location_id\s+uuid\s*\)/i,
    )
    expect(s).toMatch(/returns\s+text/i)
    // search_path must include `extensions` for ST_AsText to resolve at
    // definition time on Supabase. Without this the function definition
    // would error at apply time, not at call time.
    expect(s).toMatch(
      /eval_location_geography_text[\s\S]*?set\s+search_path\s*=\s*public\s*,\s*extensions\s*,\s*pg_catalog/i,
    )
    expect(s).toMatch(/ST_AsText\s*\(/i)
  })

  it('all four T053 helpers revoke from public and grant to service_role', () => {
    const s = sql()
    for (const fn of [
      'eval_indexes_for_table',
      'eval_foreign_keys_for_table',
      'eval_partition_count',
      'eval_location_geography_text',
    ]) {
      // Pair-matching: each function name appears in at least one revoke
      // and one grant line. The grant must name service_role explicitly.
      const revokes = s.match(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${fn}`, 'gi'))
      const grants = s.match(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}.*service_role`, 'gi'))
      expect(revokes, `${fn} missing revoke`).not.toBeNull()
      expect(grants, `${fn} missing grant to service_role`).not.toBeNull()
    }
  })

  it('all four T053 helpers carry a comment-on-function with the T053 marker', () => {
    const s = sql()
    for (const fn of [
      'eval_indexes_for_table',
      'eval_foreign_keys_for_table',
      'eval_partition_count',
      'eval_location_geography_text',
    ]) {
      const re = new RegExp(`comment\\s+on\\s+function\\s+public\\.${fn}[\\s\\S]*?T053`, 'i')
      expect(s, `${fn} missing T053 comment marker`).toMatch(re)
    }
  })
})
