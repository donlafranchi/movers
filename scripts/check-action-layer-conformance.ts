#!/usr/bin/env tsx
// T043 — Action-layer conformance check
// Source: development/tickets/done/T043-* § Conformance check (CI gate skeleton)
//
// Greps the codebase for direct writes (.insert(, .update(, .delete(, .upsert()
// against the protected table list. Per ADR-7, only the action layer at
// web/src/actions/ is permitted to write to these tables. Phase 1 expands
// the list as more tables land.
//
// Phase 0 implementation is a coarse regex sweep. At Phase 1+, when the
// protected-table list grows, this may need to switch to an AST-based check
// (ts-morph or similar) to avoid false positives in strings / comments.
//
// Exit codes:
//   0  no violations found
//   1  one or more violations — printed to stderr
//   2  internal error (script failure, not a code violation)

import { readFileSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = resolve(__dirname, '..')
const SRC_DIR = resolve(ROOT, 'src')

// Tables whose writes must go through the action layer. Grow this list as
// Phase 1 lands items / locations / groups / child tables.
const PROTECTED_TABLES = [
  'members',
  'member_events',
  'member_privacy',
  'member_interests',
  'member_follows',
  'member_handle_history',
  'member_threads',
  'member_messages',
  'member_thread_participants',
  'member_self_records',
  'member_delegations',
  'member_location_affinities',
  // Phase 1 additions (kept here so the check surface is forward-stable):
  'items',
  'item_products',
  'item_services',
  'item_gatherings',
  'item_wonders',
  'item_locations',
  'item_responses',
  'item_tags',
  'item_hashtags',
  'item_events',
  'locations',
  'location_permanent',
  'location_recurring_temporary',
  'location_areas',
  'location_events',
  'groups',
  'group_businesses',
  'group_event_anchored',
  'group_memberships',
  'group_events',
] as const

const WRITE_METHODS = ['insert', 'update', 'delete', 'upsert'] as const

// Files matching these globs are allowed to bypass the rule.
// Build agent maintains this list; reviewer audits it on each ticket.
const ALLOWED_EXCEPTIONS = [
  // The action layer itself.
  /^src\/actions\//,
  // Vitest unit tests under tests/. They may mock or stub the action layer.
  /^tests\//,
  // Vitest co-located tests inside src/.
  /\.test\.ts$/,
  /\.test\.tsx$/,
  // Playwright eval specs.
  /^evals\//,
  // This conformance script itself.
  /^scripts\/check-action-layer-conformance\.ts$/,
]

interface Violation {
  file: string
  line: number
  column: number
  match: string
}

function listTsFiles(): string[] {
  try {
    // Use git ls-files for speed and to respect .gitignore. `--cached` =
    // tracked, `--others --exclude-standard` = untracked + not-gitignored.
    // This catches new files developers haven't staged yet — important
    // because the rule applies to all code, not just committed code.
    // Falls back to a manual walk if git isn't available.
    const out = execSync('git ls-files --cached --others --exclude-standard "*.ts" "*.tsx"', {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return out
      .split('\n')
      .filter((l) => l.length > 0)
      .filter((l) => l.startsWith(`src${sep}`) || l.startsWith(`tests${sep}`) || l.startsWith(`evals${sep}`) || l.startsWith(`scripts${sep}`) || l.startsWith('src/') || l.startsWith('tests/') || l.startsWith('evals/') || l.startsWith('scripts/'))
  } catch {
    // Fallback walk
    const out: string[] = []
    const walk = (dir: string): void => {
      const entries = require('node:fs').readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue
        const p = resolve(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
          out.push(relative(ROOT, p))
        }
      }
    }
    walk(SRC_DIR)
    return out
  }
}

function isExempt(relPath: string): boolean {
  const normalized = relPath.split(sep).join('/')
  return ALLOWED_EXCEPTIONS.some((re) => re.test(normalized))
}

function scanFile(relPath: string, content: string): Violation[] {
  const violations: Violation[] = []
  const lines = content.split('\n')
  // Match a Supabase-style chain: .from('<table>').<method>( OR
  // .from("<table>").<method>(. Plain string interpolations are excluded
  // by design — the check is for literal table names.
  const tablePattern = PROTECTED_TABLES.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')
  const methodPattern = WRITE_METHODS.join('|')
  // Capture: .from('table').method(  OR  .from("table").method(
  const re = new RegExp(
    `\\.from\\(\\s*['"\`](${tablePattern})['"\`]\\s*\\)\\s*\\.\\s*(${methodPattern})\\s*\\(`,
    'g',
  )
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      violations.push({
        file: relPath,
        line: i + 1,
        column: m.index + 1,
        match: m[0],
      })
    }
  }
  return violations
}

function main(): number {
  const files = listTsFiles()
  const allViolations: Violation[] = []
  for (const f of files) {
    if (isExempt(f)) continue
    let content: string
    try {
      content = readFileSync(resolve(ROOT, f), 'utf8')
    } catch {
      continue
    }
    allViolations.push(...scanFile(f, content))
  }

  if (allViolations.length === 0) {
    console.log('check-action-layer-conformance: OK (no violations found)')
    console.log(`  scanned ${files.length} files; protected tables: ${PROTECTED_TABLES.length}`)
    return 0
  }

  console.error(
    `check-action-layer-conformance: FAIL — ${allViolations.length} violation(s):`,
  )
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}:${v.column}  ${v.match}`)
  }
  console.error('')
  console.error(
    'Per ADR-7, writes to these tables must go through web/src/actions/. If this write is legitimate (test, eval, scripted migration), add the file to ALLOWED_EXCEPTIONS in this script with a justification comment.',
  )
  return 1
}

try {
  process.exit(main())
} catch (err) {
  console.error('check-action-layer-conformance: internal error')
  console.error(err)
  process.exit(2)
}
