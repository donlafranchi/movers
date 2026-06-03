#!/usr/bin/env tsx
// T043 — Action-layer conformance check (extended by T051, T052)
// Source: development/tickets/done/T043-*; development/tickets/T051-*;
//         development/tickets/T052-*
//
// Four checks live here:
//   1. checkPrimaryWrites      — T043. .from('<table>').<write>() outside actions/
//   2. checkRouteHandlerImports — T051 Rule 2. non-GET route.ts must import @/actions
//   3. checkParameterizedQueries — T051 Rule 4. no ${} in .query`/.rpc` literals
//   (Rule 1 lives in eslint.config.mjs; Rule 3 lives in tests/rls-coverage.test.ts.)
//
// T052 additions:
//   - `--json` mode emits a single JSON object on stdout for the Phase 0
//     eval bootstrap to capture: { ok: boolean, violations: Violation[] }.
//   - ALLOWED_EXCEPTIONS gains scripts/bootstrap-eval-helpers.ts. The
//     supabase/test-helpers/ folder is also implicitly exempt because the
//     file lister only scans src/ tests/ evals/ scripts/ — and *.sql files
//     are not picked up by the .ts/.tsx filter.
//
// Exit codes:
//   0  no violations found
//   1  one or more violations — printed to stderr (or stdout JSON in --json mode)
//   2  internal error (script failure, not a code violation)

import { readFileSync, readdirSync, existsSync, type Dirent } from 'node:fs'
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
  // member_location_affinities retired by T061 (021); intentionally
  // removed from the protected list to match the dropped table.
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
  // b1.x — places + member↔geography substrate.
  'places',
  'place_events',
  'member_place_interests',
  'member_saved_searches',
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
  // T052 eval helpers — supabase/test-helpers/ is non-production SQL applied
  // only by the bootstrap script (see ADR-18). The bootstrap script itself
  // is the only sanctioned write path outside src/actions/ — its pg import
  // and direct insert into eval_artifacts ride this allowlist entry. The
  // hole is explicit, named, and confined to a single path.
  /^scripts\/bootstrap-eval-helpers\.ts$/,
]

interface Violation {
  rule: string
  file: string
  line: number
  column: number
  match: string
}

// Test-probe directories under src/ are gitignored to avoid noise, but
// the conformance script must still scan them so probe-based negative
// tests can fire the rules. listTsFiles() merges git-tracked files,
// non-gitignored untracked files, and an explicit walk of probe dirs.
const PROBE_DIRS = [
  resolve(SRC_DIR, '__sql_probe__'),
  resolve(SRC_DIR, '__lint_probe__'),
  resolve(SRC_DIR, 'app', 'api', '__probe__'),
]

function walkTs(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue
    const p = resolve(dir, e.name)
    if (e.isDirectory()) walkTs(p, out)
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
      out.push(relative(ROOT, p))
    }
  }
}

function listTsFiles(): string[] {
  const set = new Set<string>()
  try {
    const out = execSync('git ls-files --cached --others --exclude-standard "*.ts" "*.tsx"', {
      cwd: ROOT,
      encoding: 'utf8',
    })
    out
      .split('\n')
      .filter((l) => l.length > 0)
      .filter((l) => l.startsWith('src/') || l.startsWith('tests/') || l.startsWith('evals/') || l.startsWith('scripts/'))
      .forEach((l) => set.add(l))
  } catch {
    const out: string[] = []
    walkTs(SRC_DIR, out)
    out.forEach((l) => set.add(l))
  }
  // Always include probe-dir files even when gitignored.
  for (const d of PROBE_DIRS) {
    const out: string[] = []
    walkTs(d, out)
    out.forEach((l) => set.add(l.split(sep).join('/')))
  }
  return Array.from(set)
}

function isExempt(relPath: string): boolean {
  const normalized = relPath.split(sep).join('/')
  return ALLOWED_EXCEPTIONS.some((re) => re.test(normalized))
}

// ─────────────────────────────────────────────────────────────────────
// Check 1 (T043) — direct writes to protected tables.
// ─────────────────────────────────────────────────────────────────────

function checkPrimaryWrites(relPath: string, content: string): Violation[] {
  const violations: Violation[] = []
  const lines = content.split('\n')
  const tablePattern = PROTECTED_TABLES.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')
  const methodPattern = WRITE_METHODS.join('|')
  const re = new RegExp(
    `\\.from\\(\\s*['"\`](${tablePattern})['"\`]\\s*\\)\\s*\\.\\s*(${methodPattern})\\s*\\(`,
    'g',
  )
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      violations.push({
        rule: 'Rule (T043) — direct write',
        file: relPath,
        line: i + 1,
        column: m.index + 1,
        match: m[0],
      })
    }
  }
  return violations
}

// ─────────────────────────────────────────────────────────────────────
// Check 2 (T051 Rule 2) — non-GET API routes must import @/actions.
// ─────────────────────────────────────────────────────────────────────

interface ExemptionEntry {
  path: string
  reason: string
  expires_at: string
  follow_up_ticket: string
}

const EXEMPTION_LEDGER_PATH = resolve(ROOT, 'scripts', 'action-layer-exemptions.json')
const TICKET_REGEX = /^T\d{3}$/

function loadExemptionLedger(): { entries: ExemptionEntry[]; errors: string[] } {
  const errors: string[] = []
  if (!existsSync(EXEMPTION_LEDGER_PATH)) {
    errors.push(
      `action-layer-exemptions.json missing at ${relative(ROOT, EXEMPTION_LEDGER_PATH)}. Create as [] if there are no exemptions.`,
    )
    return { entries: [], errors }
  }
  let raw: string
  try {
    raw = readFileSync(EXEMPTION_LEDGER_PATH, 'utf8')
  } catch (e) {
    errors.push(`failed to read ${EXEMPTION_LEDGER_PATH}: ${String(e)}`)
    return { entries: [], errors }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    errors.push(`action-layer-exemptions.json is not valid JSON: ${String(e)}`)
    return { entries: [], errors }
  }
  if (!Array.isArray(parsed)) {
    errors.push('action-layer-exemptions.json must be a JSON array (use [] for none).')
    return { entries: [], errors }
  }
  const now = Date.now()
  const validated: ExemptionEntry[] = []
  for (let i = 0; i < parsed.length; i++) {
    const e = parsed[i] as Partial<ExemptionEntry> & Record<string, unknown>
    const where = `action-layer-exemptions.json[${i}]`
    if (typeof e.path !== 'string' || e.path.length === 0) {
      errors.push(`${where}: 'path' missing or empty`)
      continue
    }
    if (typeof e.reason !== 'string' || e.reason.length < 10) {
      errors.push(`${where} (${e.path}): 'reason' must be a string of >=10 chars`)
      continue
    }
    if (typeof e.expires_at !== 'string') {
      errors.push(`${where} (${e.path}): 'expires_at' must be an ISO-8601 string`)
      continue
    }
    const t = Date.parse(e.expires_at)
    if (Number.isNaN(t)) {
      errors.push(`${where} (${e.path}): 'expires_at' is not a valid ISO-8601 date: ${e.expires_at}`)
      continue
    }
    if (t < now) {
      errors.push(`${where} (${e.path}): 'expires_at' is in the past (${e.expires_at})`)
      continue
    }
    if (typeof e.follow_up_ticket !== 'string' || !TICKET_REGEX.test(e.follow_up_ticket)) {
      errors.push(`${where} (${e.path}): 'follow_up_ticket' must match /^T\\d{3}$/`)
      continue
    }
    validated.push({
      path: e.path,
      reason: e.reason,
      expires_at: e.expires_at,
      follow_up_ticket: e.follow_up_ticket,
    })
  }
  return { entries: validated, errors }
}

const HTTP_METHODS_NON_GET = ['POST', 'PUT', 'PATCH', 'DELETE']
const EXPORT_HTTP_RE = /export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g
const ACTIONS_IMPORT_RE = /from\s+['"]@\/actions(?:\/[^'"]*)?['"]/
const EXEMPT_ANNOT_RE = /\/\/\s*action-layer:exempt\b/

function checkRouteHandlerImports(
  relPath: string,
  content: string,
  ledger: ExemptionEntry[],
): Violation[] {
  if (!/^src\/app\/api\/.*route\.tsx?$/.test(relPath)) return []
  const violations: Violation[] = []
  const methods = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = EXPORT_HTTP_RE.exec(content)) !== null) {
    methods.add(m[1])
  }
  const hasNonGet = HTTP_METHODS_NON_GET.some((mm) => methods.has(mm))
  if (!hasNonGet) return []

  const hasActionsImport = ACTIONS_IMPORT_RE.test(content)
  const hasExemptAnnotation = EXEMPT_ANNOT_RE.test(content)
  const ledgerEntry = ledger.find((e) => e.path === relPath)

  if (hasExemptAnnotation) {
    if (!ledgerEntry) {
      violations.push({
        rule: 'Rule 2 (T051) — exempt annotation without ledger entry',
        file: relPath,
        line: 1,
        column: 1,
        match: `// action-layer:exempt found in ${relPath} but no entry in action-layer-exemptions.json`,
      })
    }
    return violations
  }

  if (!hasActionsImport) {
    violations.push({
      rule: 'Rule 2 (T051) — non-GET route missing @/actions import',
      file: relPath,
      line: 1,
      column: 1,
      match: `route exports [${Array.from(methods).join(', ')}] but does not import from '@/actions/...'`,
    })
  }
  return violations
}

// ─────────────────────────────────────────────────────────────────────
// Check 3 (T051 Rule 4) — no template-literal SQL with interpolations.
// ─────────────────────────────────────────────────────────────────────

// The annotation must name a TypeScript union/enum: "enum-constrained by Foo".
const SQL_SAFE_ANNOTATION_RE = /\/\/\s*sql-injection-safe:\s*enum-constrained by\s+[A-Z][A-Za-z0-9_]+/
// A *bare* annotation that fails the well-formed check above must still be
// recognized so we can flag it explicitly (rather than silently pass through).
const SQL_LOOSE_ANNOTATION_RE = /\/\/\s*sql-injection-safe:/

function isInsideExempt(relPath: string): boolean {
  // The conformance script itself includes regex literals that look like
  // .query` patterns. Exempt the script and the parameterized-test cases.
  if (relPath === 'scripts/check-action-layer-conformance.ts') return true
  return false
}

function checkParameterizedQueries(relPath: string, content: string): Violation[] {
  if (isInsideExempt(relPath)) return []
  if (!relPath.startsWith('src/')) return []
  if (!/\.(ts|tsx)$/.test(relPath)) return []
  const violations: Violation[] = []
  const lines = content.split('\n')
  // Find every `.query(` or `.rpc(` followed by an opening backtick.
  // Allow whitespace and newlines between the open-paren and the backtick.
  const callRe = /\.(query|rpc)\s*\(\s*`/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(content)) !== null) {
    const callStart = m.index
    const backtickIdx = callStart + m[0].length - 1
    // Find the matching closing backtick. Template literals don't nest in
    // the simple case; advance past the contents until we hit an unescaped `.
    let i = backtickIdx + 1
    let interpolated = false
    while (i < content.length) {
      const c = content[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '$' && content[i + 1] === '{') {
        interpolated = true
        // Skip to matching close brace (rough — assumes no nested braces with mismatched quotes).
        let depth = 1
        i += 2
        while (i < content.length && depth > 0) {
          const cc = content[i]
          if (cc === '{') depth++
          else if (cc === '}') depth--
          i++
        }
        continue
      }
      if (c === '`') break
      i++
    }
    if (!interpolated) continue

    // Locate source line of the call.
    const upTo = content.slice(0, callStart)
    const lineNum = upTo.split('\n').length
    const lineText = lines[lineNum - 1] ?? ''
    const column = callStart - upTo.lastIndexOf('\n')

    // Annotation may appear on the call's source line OR on any of the
    // 3 lines immediately above (multi-line template literals can't carry
    // a // comment inside the SQL body). Look back through whitespace and
    // comment-only lines.
    const annotationCandidates: string[] = [lineText]
    for (let k = 2; k <= 4; k++) {
      const prior = lines[lineNum - k] ?? ''
      annotationCandidates.push(prior)
      if (prior.trim() === '' || prior.trim().startsWith('//') || prior.trim().startsWith('*')) {
        continue
      }
      break
    }
    const joined = annotationCandidates.join('\n')
    const hasWellFormed = SQL_SAFE_ANNOTATION_RE.test(joined)
    const hasLoose = SQL_LOOSE_ANNOTATION_RE.test(joined)
    if (hasWellFormed) continue
    if (hasLoose) {
      violations.push({
        rule: 'Rule 4 (T051) — sql-injection-safe annotation must be: enum-constrained by <TypeName>',
        file: relPath,
        line: lineNum,
        column,
        match: m[0],
      })
      continue
    }
    violations.push({
      rule: 'Rule 4 (T051) — parameterized-query violation: ${...} in .query/.rpc template literal',
      file: relPath,
      line: lineNum,
      column,
      match: m[0],
    })
  }
  return violations
}

function main(): number {
  // T052 sub-task — `--json` mode for the action-layer-conformance check.
  // The bootstrap-eval-helpers.ts script ingests this output and writes it
  // into public.eval_artifacts under key='conformance_check'. The Playwright
  // spec then reads it via the eval_conformance_check_result() helper.
  //
  // Contract:
  //   - Always emits a single JSON object on stdout: { ok, violations }.
  //   - Exit code semantics unchanged: 0 = clean, 1 = violations, 2 = crash.
  //   - The human-readable text mode is the default (no flag); `--json`
  //     suppresses the text output entirely so the JSON is the only thing
  //     written to stdout.
  const jsonMode = process.argv.includes('--json')

  const files = listTsFiles()
  const { entries: ledger, errors: ledgerErrors } = loadExemptionLedger()
  const allViolations: Violation[] = []

  for (const f of files) {
    let content: string
    try {
      content = readFileSync(resolve(ROOT, f), 'utf8')
    } catch {
      continue
    }
    // Check 1 (T043): primary writes. Probe dirs & test/eval files are exempt.
    if (!isExempt(f)) {
      allViolations.push(...checkPrimaryWrites(f, content))
    }
    // Check 2 (T051 Rule 2): route handler imports. Always applied; the
    // probe dir under src/app/api/__probe__/ is meant to fire this rule.
    allViolations.push(...checkRouteHandlerImports(f, content, ledger))
    // Check 3 (T051 Rule 4): parameterized queries. Probe dirs participate.
    allViolations.push(...checkParameterizedQueries(f, content))
  }

  for (const err of ledgerErrors) {
    allViolations.push({
      rule: 'Rule 2 (T051) — exemption ledger error',
      file: relative(ROOT, EXEMPTION_LEDGER_PATH),
      line: 1,
      column: 1,
      match: err,
    })
  }

  if (jsonMode) {
    // Single line of JSON to stdout — easy to parse, easy to grep, easy
    // to stash in a Postgres jsonb column.
    process.stdout.write(
      JSON.stringify({ ok: allViolations.length === 0, violations: allViolations }) + '\n',
    )
    return allViolations.length === 0 ? 0 : 1
  }

  if (allViolations.length === 0) {
    console.log('check-action-layer-conformance: OK (no violations found)')
    console.log(
      `  scanned ${files.length} files; protected tables: ${PROTECTED_TABLES.length}; exemptions: ${ledger.length}`,
    )
    return 0
  }

  console.error(
    `check-action-layer-conformance: FAIL — ${allViolations.length} violation(s):`,
  )
  for (const v of allViolations) {
    console.error(`  [${v.rule}]`)
    console.error(`    ${v.file}:${v.line}:${v.column}  ${v.match}`)
  }
  console.error('')
  console.error(
    'Per ADR-7 + T051: writes go through web/src/actions/; non-GET routes import @/actions; SQL uses parameters ($1, $2) — not ${} interpolation.',
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
