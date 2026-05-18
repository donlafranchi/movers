// T052 — `--json` mode for the action-layer-conformance script.
// Source ticket: development/tickets/T052-phase-0-eval-helpers.md (sub-task)
//
// The Phase 0 eval bootstrap runs `check-action-layer --json` and stashes
// the parsed object in public.eval_artifacts so the Playwright spec can
// read it via eval_conformance_check_result(). The contract:
//   - One JSON object on stdout: { ok: boolean, violations: array }.
//   - Exit code semantics unchanged from the text mode (0 / 1 / 2).
//   - Human-readable text suppressed when --json is set so the JSON is
//     the only thing on stdout.

import { describe, it, expect, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const PROBE_DIR = resolve(ROOT, 'src', '__sql_probe__')
const SCRIPT = 'tsx scripts/check-action-layer-conformance.ts --json'

function run(): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(SCRIPT, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
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

afterAll(() => rmSync(PROBE_DIR, { recursive: true, force: true }))

describe('T052 — check-action-layer --json mode', () => {
  it('clean tree: exits 0 and emits { ok: true, violations: [] }', () => {
    const r = run()
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed).toEqual({ ok: true, violations: [] })
  })

  it('dirty tree: emits { ok: false, violations: [...] } and exits 1', () => {
    mkdirSync(PROBE_DIR, { recursive: true })
    writeFileSync(
      resolve(PROBE_DIR, 'probe-bad.ts'),
      [
        'export async function bad(client: { query: (q: string, v?: unknown[]) => Promise<void> }, userInput: string) {',
        '  await client.query(`select * from t where id = ${userInput}`)',
        '}',
      ].join('\n'),
      'utf8',
    )
    try {
      const r = run()
      expect(r.code).toBe(1)
      const parsed = JSON.parse(r.stdout)
      expect(parsed.ok).toBe(false)
      expect(Array.isArray(parsed.violations)).toBe(true)
      expect(parsed.violations.length).toBeGreaterThan(0)
      const v = parsed.violations[0]
      expect(v).toHaveProperty('rule')
      expect(v).toHaveProperty('file')
      expect(v).toHaveProperty('line')
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true })
    }
  })

  it('stdout in --json mode is exactly one JSON object (no banner text)', () => {
    const r = run()
    expect(r.code).toBe(0)
    // The whole stdout must parse — no preamble, no trailing chatter.
    expect(() => JSON.parse(r.stdout)).not.toThrow()
    // And the parsed shape must be the contract.
    const parsed = JSON.parse(r.stdout)
    expect(Object.keys(parsed).sort()).toEqual(['ok', 'violations'])
  })
})
