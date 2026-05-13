// T051 — Rule 2 — Every non-GET API route must import from @/actions/.
// Source ticket: development/tickets/T051-action-layer-ci-enforcement.md

import { describe, it, expect, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const PROBE_DIR = resolve(ROOT, 'src', 'app', 'api', '__probe__')
const PROBE_FILE = resolve(PROBE_DIR, 'route.ts')
const LEDGER = resolve(ROOT, 'scripts', 'action-layer-exemptions.json')
const SCRIPT = 'tsx scripts/check-action-layer-conformance.ts'

function runScript(): { code: number; stdout: string; stderr: string } {
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

function writeProbe(content: string): void {
  mkdirSync(PROBE_DIR, { recursive: true })
  writeFileSync(PROBE_FILE, content, 'utf8')
}

function readLedger(): string {
  return readFileSync(LEDGER, 'utf8')
}

function writeLedger(content: string): void {
  writeFileSync(LEDGER, content, 'utf8')
}

afterAll(() => rmSync(PROBE_DIR, { recursive: true, force: true }))

describe('T051 Rule 2 — non-GET route handler imports', () => {
  it('positive: passes on the current tree', () => {
    const r = runScript()
    expect(r.code).toBe(0)
  })

  it('negative: missing @/actions import flags the route', () => {
    writeProbe(
      [
        "import { NextResponse } from 'next/server'",
        'export async function POST() { return NextResponse.json({}) }',
      ].join('\n'),
    )
    try {
      const r = runScript()
      expect(r.code).toBe(1)
      expect(r.stderr).toMatch(/Rule 2/)
      expect(r.stderr).toContain('src/app/api/__probe__/route.ts')
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true })
    }
  })

  it('negative: exempt annotation without ledger entry still fails', () => {
    writeProbe(
      [
        '// action-layer:exempt — testing',
        "import { NextResponse } from 'next/server'",
        'export async function POST() { return NextResponse.json({}) }',
      ].join('\n'),
    )
    try {
      const r = runScript()
      expect(r.code).toBe(1)
      expect(r.stderr).toMatch(/Rule 2/)
      expect(r.stderr).toMatch(/no entry in action-layer-exemptions/i)
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true })
    }
  })

  it('positive: exempt annotation with valid ledger entry passes', () => {
    const original = readLedger()
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    writeLedger(
      JSON.stringify(
        [
          {
            path: 'src/app/api/__probe__/route.ts',
            reason: 'temporary probe used by Rule 2 positive-annotated test',
            expires_at: future,
            follow_up_ticket: 'T999',
          },
        ],
        null,
        2,
      ),
    )
    writeProbe(
      [
        '// action-layer:exempt — annotated probe with valid ledger entry',
        "import { NextResponse } from 'next/server'",
        'export async function POST() { return NextResponse.json({}) }',
      ].join('\n'),
    )
    try {
      const r = runScript()
      expect(r.code).toBe(0)
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true })
      writeLedger(original)
    }
  })

  it('exemption ledger schema: rejects malformed ledger (expires_at in past)', () => {
    const original = readLedger()
    writeLedger(
      JSON.stringify(
        [
          {
            path: 'src/app/api/__probe__/route.ts',
            reason: 'past-dated, should reject',
            expires_at: '2000-01-01T00:00:00.000Z',
            follow_up_ticket: 'T999',
          },
        ],
        null,
        2,
      ),
    )
    try {
      const r = runScript()
      expect(r.code).toBe(1)
      expect(r.stderr).toMatch(/expires_at.*past/i)
    } finally {
      writeLedger(original)
    }
  })
})
