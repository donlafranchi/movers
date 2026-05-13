// T051 — Rule 4 — No template-literal SQL with interpolations.
// Source ticket: development/tickets/T051-action-layer-ci-enforcement.md
//
// Exercises the conformance script's `checkParameterizedQueries` step by
// dropping probe files into a sandbox directory and invoking the script.
// Probes use try/finally so a failed assertion never leaves a probe in
// the tree (which would otherwise break subsequent runs).

import { describe, it, expect, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const PROBE_DIR = resolve(ROOT, 'src', '__sql_probe__')
const SCRIPT = 'tsx scripts/check-action-layer-conformance.ts'

function runScript(): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(SCRIPT, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer }
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    }
  }
}

function writeProbe(name: string, content: string): string {
  mkdirSync(PROBE_DIR, { recursive: true })
  const p = resolve(PROBE_DIR, name)
  writeFileSync(p, content, 'utf8')
  return p
}

afterAll(() => rmSync(PROBE_DIR, { recursive: true, force: true }))

describe('T051 Rule 4 — parameterized SQL only', () => {
  it('positive: passes on the current tree (event-log.ts annotated)', () => {
    const r = runScript()
    expect(r.code).toBe(0)
  })

  it('negative: flags a template literal with an unannotated ${...} interpolation', () => {
    const probe = writeProbe(
      'probe-bad.ts',
      [
        'export async function bad(client: { query: (q: string, v?: unknown[]) => Promise<void> }, userInput: string) {',
        '  await client.query(`select * from t where id = ${userInput}`)',
        '}',
      ].join('\n'),
    )
    try {
      const r = runScript()
      expect(r.code).toBe(1)
      expect(r.stderr).toMatch(/Rule 4|parameterized|sql-injection/i)
      expect(r.stderr).toContain('src/__sql_probe__/probe-bad.ts')
    } finally {
      rmSync(probe, { force: true })
    }
  })

  it('positive: bare annotation payload (no TypeName) does NOT pass', () => {
    const probe = writeProbe(
      'probe-bare-annot.ts',
      [
        'export async function loose(client: { query: (q: string) => Promise<void> }, table: string) {',
        '  // sql-injection-safe: trust me',
        '  await client.query(`select * from ${table}`)',
        '}',
      ].join('\n'),
    )
    try {
      const r = runScript()
      expect(r.code).toBe(1)
      expect(r.stderr).toMatch(/enum-constrained by/)
    } finally {
      rmSync(probe, { force: true })
    }
  })

  it('positive: well-formed annotation (enum-constrained by TypeName) passes', () => {
    const probe = writeProbe(
      'probe-good-annot.ts',
      [
        "type AllowedTable = 'foo' | 'bar'",
        'export async function good(client: { query: (q: string) => Promise<void> }, table: AllowedTable) {',
        '  // sql-injection-safe: enum-constrained by AllowedTable',
        '  await client.query(`select * from ${table}`)',
        '}',
      ].join('\n'),
    )
    try {
      const r = runScript()
      expect(r.code).toBe(0)
    } finally {
      rmSync(probe, { force: true })
    }
  })

  it('positive: proper parameterization $1 with no interpolation passes', () => {
    const probe = writeProbe(
      'probe-param.ts',
      [
        'export async function param(client: { query: (q: string, v: unknown[]) => Promise<void> }, id: string) {',
        '  await client.query(`select * from t where id = $1`, [id])',
        '}',
      ].join('\n'),
    )
    try {
      const r = runScript()
      expect(r.code).toBe(0)
    } finally {
      rmSync(probe, { force: true })
    }
  })
})
