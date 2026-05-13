// T051 — Rule 1 — No service-role / raw-pg imports outside _lib/.
// Source ticket: development/tickets/T051-action-layer-ci-enforcement.md
//
// Exercises eslint.config.mjs's no-restricted-imports + no-restricted-syntax
// rules by writing probe files and invoking `npx eslint` against them.

import { describe, it, expect, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const PROBE_DIR = resolve(ROOT, 'src', '__lint_probe__')

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function runEslintOn(relPath: string): RunResult {
  try {
    const stdout = execSync(`npx --no-install eslint ${relPath}`, {
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

function writeProbe(name: string, content: string): string {
  mkdirSync(PROBE_DIR, { recursive: true })
  const p = resolve(PROBE_DIR, name)
  writeFileSync(p, content, 'utf8')
  return p
}

afterAll(() => rmSync(PROBE_DIR, { recursive: true, force: true }))

describe('T051 Rule 1 — credential boundary', () => {
  it('negative: importing pg from outside _lib/ fires no-restricted-imports', () => {
    const probe = writeProbe(
      'probe-pg.ts',
      ['import { Pool } from "pg"', 'export const p = new Pool()'].join('\n'),
    )
    try {
      // Eslint is configured to ignore src/__lint_probe__/** per Rule 1's
      // exemption list (probe path is exempt). Run against a non-exempt
      // target by copying the probe to a non-probe location.
      const relProbe = 'src/__lint_probe__/probe-pg.ts'
      // Override the ignore: pass --no-ignore to bypass eslint.config.mjs's
      // globalIgnores AND the local Rule 1 ignores list.
      const r = (() => {
        try {
          const stdout = execSync(`npx --no-install eslint --no-ignore ${relProbe}`, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          return { code: 0, stdout, stderr: '' }
        } catch (err: unknown) {
          const e = err as {
            status?: number
            stdout?: Buffer | string
            stderr?: Buffer | string
          }
          return {
            code: e.status ?? 1,
            stdout: e.stdout?.toString() ?? '',
            stderr: e.stderr?.toString() ?? '',
          }
        }
      })()
      expect(r.code).not.toBe(0)
      const combined = r.stdout + r.stderr
      expect(combined).toMatch(/no-restricted-imports/)
      expect(combined).toMatch(/probe-pg\.ts/)
    } finally {
      rmSync(probe, { force: true })
    }
  })

  it('positive: type-only pg import is allowed', () => {
    // src/lib/action-context.ts already does this in the current tree; it
    // must lint clean. Run eslint against it specifically.
    const r = runEslintOn('src/lib/action-context.ts')
    // The file may have unrelated warnings/errors; assert specifically
    // that no Rule 1 violation appears.
    const combined = r.stdout + r.stderr
    expect(combined).not.toMatch(/Rule 1 \(T051\).*pg/)
  })

  it('negative: bare createClient from @supabase/supabase-js fires the rule', () => {
    const probe = writeProbe(
      'probe-supabase-js.ts',
      [
        'import { createClient } from "@supabase/supabase-js"',
        'export const c = createClient("https://example.com", "key")',
      ].join('\n'),
    )
    try {
      const relProbe = 'src/__lint_probe__/probe-supabase-js.ts'
      const r = (() => {
        try {
          const stdout = execSync(`npx --no-install eslint --no-ignore ${relProbe}`, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          return { code: 0, stdout, stderr: '' }
        } catch (err: unknown) {
          const e = err as {
            status?: number
            stdout?: Buffer | string
            stderr?: Buffer | string
          }
          return {
            code: e.status ?? 1,
            stdout: e.stdout?.toString() ?? '',
            stderr: e.stderr?.toString() ?? '',
          }
        }
      })()
      expect(r.code).not.toBe(0)
      const combined = r.stdout + r.stderr
      expect(combined).toMatch(/no-restricted-imports/)
    } finally {
      rmSync(probe, { force: true })
    }
  })

  it('negative: process.env.SUPABASE_SERVICE_ROLE_KEY reference fires no-restricted-syntax', () => {
    const probe = writeProbe(
      'probe-service-role.ts',
      [
        'export function k(): string | undefined {',
        '  return process.env.SUPABASE_SERVICE_ROLE_KEY',
        '}',
      ].join('\n'),
    )
    try {
      const relProbe = 'src/__lint_probe__/probe-service-role.ts'
      const r = (() => {
        try {
          const stdout = execSync(`npx --no-install eslint --no-ignore ${relProbe}`, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          return { code: 0, stdout, stderr: '' }
        } catch (err: unknown) {
          const e = err as {
            status?: number
            stdout?: Buffer | string
            stderr?: Buffer | string
          }
          return {
            code: e.status ?? 1,
            stdout: e.stdout?.toString() ?? '',
            stderr: e.stderr?.toString() ?? '',
          }
        }
      })()
      expect(r.code).not.toBe(0)
      const combined = r.stdout + r.stderr
      expect(combined).toMatch(/no-restricted-syntax/)
      expect(combined).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
    } finally {
      rmSync(probe, { force: true })
    }
  })
})
