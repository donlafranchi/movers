#!/usr/bin/env tsx
// T052 — Bootstrap script for the Phase 0 eval helpers.
// Source: development/tickets/T052-phase-0-eval-helpers.md
// ADR:    planning/adrs/ADR-0018-eval-helpers.md
//
// PRODUCTION-SAFETY CONSTRAINT (load-bearing)
//
// The helpers in supabase/test-helpers/*.sql write directly to public.members
// and public.member_events — the canonical action-layer conformance
// violations. This script is the ONLY sanctioned path to apply them, and
// the host check below is what prevents accidental application to a
// non-local database. The check is intentionally a hard exit, not a warning.
//
// The matching CI hole: web/scripts/check-action-layer-conformance.ts has
// an explicit allowlist entry for supabase/test-helpers/ and this script's
// path (see the script header). That allowlist is the one place where the
// "no direct writes outside web/src/actions/" rule has a documented hole.
//
// Order of operations:
//   1. Resolve DATABASE_URL; refuse if non-local.
//   2. Apply supabase/test-helpers/*.sql in lexicographic order. Idempotent
//      via `create or replace function` + `create table if not exists`.
//   3. Run `npm run check:action-layer -- --json`, capture the result.
//   4. Upsert into public.eval_artifacts with key='conformance_check'.
//
// Then `npx playwright test evals/phase-0/floor.spec.ts` can complete.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

// pg is allowlisted here because this is the bootstrap path explicitly
// exempted by the action-layer-conformance script. See script header
// `ALLOWED_EXCEPTIONS` for the matching entry.
import { Client } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const HELPERS_DIR = resolve(ROOT, 'supabase', 'test-helpers')

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal'])

function refuse(message: string): never {
  // Refusal goes to stderr with a clearly-marked label so failures in CI
  // are obvious. Exit code 2 distinguishes guard refusal from connection
  // failures (which exit 1 from pg).
  process.stderr.write(`bootstrap-eval-helpers: REFUSED — ${message}\n`)
  process.stderr.write(
    'This script applies eval-only SQL to public.members and public.member_events. ' +
      'It is only safe against a local Supabase instance. Set DATABASE_URL to a ' +
      'localhost / 127.0.0.1 / host.docker.internal URL, or run `supabase start` first.\n',
  )
  process.exit(2)
}

function resolveLocalDbUrl(): string {
  const url = process.env.DATABASE_URL?.trim()
  const supabaseEnv = process.env.SUPABASE_ENV?.trim().toLowerCase()

  if (!url || url.length === 0) {
    if (supabaseEnv === 'local') {
      // Sanctioned override: developer explicitly asserts local + did not
      // export DATABASE_URL. Fall back to the standard supabase CLI port.
      return 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    }
    refuse('DATABASE_URL is not set (and SUPABASE_ENV != local).')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (err) {
    refuse(`DATABASE_URL is not a parseable URL: ${(err as Error).message}`)
  }

  const host = parsed.hostname.toLowerCase()
  if (!LOCAL_HOSTS.has(host)) {
    refuse(
      `DATABASE_URL host "${host}" is not in the local-host allowlist ` +
        `[${[...LOCAL_HOSTS].join(', ')}]. ` +
        `SUPABASE_ENV=${supabaseEnv ?? '<unset>'} is not sufficient to override a non-local host.`,
    )
  }

  return url
}

function listHelperFiles(): string[] {
  if (!existsSync(HELPERS_DIR)) {
    process.stderr.write(`bootstrap-eval-helpers: missing folder ${HELPERS_DIR}\n`)
    process.exit(1)
  }
  return readdirSync(HELPERS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort() // lexicographic — 00_, 01_, 02_, 03_, ...
}

async function applyHelpers(client: Client): Promise<void> {
  const files = listHelperFiles()
  if (files.length === 0) {
    process.stderr.write('bootstrap-eval-helpers: no .sql files found in supabase/test-helpers/\n')
    process.exit(1)
  }
  for (const f of files) {
    const path = resolve(HELPERS_DIR, f)
    const sql = readFileSync(path, 'utf8')
    process.stdout.write(`bootstrap-eval-helpers: applying ${f}\n`)
    // Single-shot query: each helper file is a self-contained set of
    // CREATE OR REPLACE / CREATE TABLE IF NOT EXISTS statements. Errors
    // bubble — fail fast on the first broken file rather than mask a
    // schema drift.
    await client.query(sql)
  }
}

function captureConformanceResult(): { ok: boolean; violations: unknown[] } {
  // Invoke the conformance script directly with --json. We use the local
  // tsx binary to avoid an `npm run` indirection that could buffer or
  // re-shape stdout. Exit code is informative but the JSON output is the
  // contract — a violation exits non-zero but still emits a parseable
  // {ok:false, violations:[...]} that the spec can assert against.
  const tsxBin = resolve(ROOT, 'node_modules', '.bin', 'tsx')
  const script = resolve(ROOT, 'scripts', 'check-action-layer-conformance.ts')
  let stdout = ''
  try {
    stdout = execFileSync(tsxBin, [script, '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    // Non-zero exit just means there are violations — the JSON is still in
    // stdout. We want to capture and surface it; only a non-parseable
    // result is a real crash.
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string }
    stdout = e.stdout?.toString() ?? ''
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    process.stderr.write(
      'bootstrap-eval-helpers: check-action-layer --json did not emit parseable JSON.\n',
    )
    process.stderr.write(`  stdout (first 500 chars): ${stdout.slice(0, 500)}\n`)
    process.exit(1)
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { ok?: unknown }).ok !== 'boolean' ||
    !Array.isArray((parsed as { violations?: unknown }).violations)
  ) {
    process.stderr.write(
      'bootstrap-eval-helpers: check-action-layer --json output does not match { ok: boolean, violations: array }\n',
    )
    process.exit(1)
  }
  return parsed as { ok: boolean; violations: unknown[] }
}

async function upsertConformanceArtifact(
  client: Client,
  result: { ok: boolean; violations: unknown[] },
): Promise<void> {
  await client.query(
    `insert into public.eval_artifacts (key, value, created_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, created_at = now()`,
    ['conformance_check', JSON.stringify(result)],
  )
}

async function main(): Promise<void> {
  const dbUrl = resolveLocalDbUrl()

  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await applyHelpers(client)
    const result = captureConformanceResult()
    await upsertConformanceArtifact(client, result)
    process.stdout.write(
      `bootstrap-eval-helpers: done. conformance_check.ok=${result.ok} violations=${result.violations.length}\n`,
    )
  } finally {
    await client.end()
  }
}

main().catch((err: unknown) => {
  const e = err as Error & { code?: string }
  process.stderr.write(`bootstrap-eval-helpers: failed — ${e.message ?? String(err)}\n`)
  if (e.code) process.stderr.write(`  pg error code: ${e.code}\n`)
  process.exit(1)
})
