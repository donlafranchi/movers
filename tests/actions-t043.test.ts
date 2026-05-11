import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

// T043 — build-agent's own test suite. Covers:
//   - Action-layer file structure exists.
//   - Pure-function logic (handle derivation, display-name derivation).
//   - Zod schema validation behavior on member.create input.
//   - ValidationError taxonomy + http-status mapping.
//   - Conformance-check script catches a deliberately-planted violation.
//
// DB-touching assertions live in web/evals/phase-0/floor.spec.ts (Playwright
// against running Supabase). Build agent does NOT read that file.

const WEB_ROOT = resolve(__dirname, '..')
const ACTIONS_DIR = resolve(WEB_ROOT, 'src', 'actions')

describe('T043 — action layer scaffold structure', () => {
  const required = [
    'index.ts',
    '_lib/errors.ts',
    '_lib/context.ts',
    '_lib/handler.ts',
    '_lib/db.ts',
    '_lib/audit.ts',
    '_lib/event-log.ts',
    '_lib/handle-derivation.ts',
    'member/index.ts',
    'member/create.ts',
  ]

  for (const f of required) {
    it(`exists: src/actions/${f}`, () => {
      expect(existsSync(resolve(ACTIONS_DIR, f))).toBe(true)
    })
  }

  it('src/lib/action-context.ts exists', () => {
    expect(existsSync(resolve(WEB_ROOT, 'src', 'lib', 'action-context.ts'))).toBe(true)
  })

  it('scripts/check-action-layer-conformance.ts exists', () => {
    expect(
      existsSync(resolve(WEB_ROOT, 'scripts', 'check-action-layer-conformance.ts')),
    ).toBe(true)
  })

  it('package.json declares check:action-layer script', () => {
    const pkg = JSON.parse(readFileSync(resolve(WEB_ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts['check:action-layer']).toBeDefined()
  })

  it('package.json declares zod, pg, @types/pg, tsx dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(WEB_ROOT, 'package.json'), 'utf8'))
    expect(pkg.dependencies.zod).toBeDefined()
    expect(pkg.dependencies.pg).toBeDefined()
    expect(pkg.devDependencies['@types/pg']).toBeDefined()
    expect(pkg.devDependencies.tsx).toBeDefined()
  })
})

describe('T043 — handle derivation (pure)', () => {
  it('lowercases and strips non-alnum-hyphen', async () => {
    const { deriveHandleFromEmail } = await import('../src/actions/_lib/handle-derivation')
    expect(deriveHandleFromEmail('Maya.Sourdough+test@example.com')).toBe('maya-sourdough-test')
  })

  it('uses email local-part as the base', async () => {
    const { deriveHandleFromEmail } = await import('../src/actions/_lib/handle-derivation')
    expect(deriveHandleFromEmail('aaron@ferrari.fish')).toBe('aaron')
    // local part too short — gets padded with u- prefix and zeros
    expect(deriveHandleFromEmail('a@example.com').length).toBeGreaterThanOrEqual(4)
  })

  it('replaces dots, underscores, and spaces with hyphens', async () => {
    const { deriveHandleFromEmail } = await import('../src/actions/_lib/handle-derivation')
    expect(deriveHandleFromEmail('aaron.ferrari_fisheries@example.com')).toBe('aaron-ferrari-fisheries')
  })

  it('collapses repeated hyphens and trims leading/trailing', async () => {
    const { deriveHandleFromEmail } = await import('../src/actions/_lib/handle-derivation')
    expect(deriveHandleFromEmail('---maya---@example.com')).toBe('maya')
    expect(deriveHandleFromEmail('a..b..c@example.com')).toBe('a-b-c')
  })

  it('truncates to 30 chars', async () => {
    const { deriveHandleFromEmail } = await import('../src/actions/_lib/handle-derivation')
    const long = 'a'.repeat(50) + '@example.com'
    const out = deriveHandleFromEmail(long)
    expect(out.length).toBeLessThanOrEqual(30)
  })
})

describe('T043 — display-name derivation (pure)', () => {
  it('uses the email local-part with first-letter cap', async () => {
    const { deriveDisplayNameFromEmail } = await import('../src/actions/_lib/handle-derivation')
    expect(deriveDisplayNameFromEmail('maya@example.com')).toBe('Maya')
  })

  it('replaces dots and underscores with spaces, preserves inner case', async () => {
    const { deriveDisplayNameFromEmail } = await import('../src/actions/_lib/handle-derivation')
    expect(deriveDisplayNameFromEmail('maya.sourdough@example.com')).toBe('Maya sourdough')
    expect(deriveDisplayNameFromEmail('mcKinley.park@example.com')).toBe('McKinley park')
  })

  it('defaults to "User" if the local-part is empty after trim', async () => {
    const { deriveDisplayNameFromEmail } = await import('../src/actions/_lib/handle-derivation')
    expect(deriveDisplayNameFromEmail('___@example.com')).toBe('User')
  })
})

describe('T043 — handle collision suffix logic', () => {
  it('n<=1 returns base; n=2 returns "base-2"', async () => {
    const { suffixedHandle } = await import('../src/actions/_lib/handle-derivation')
    expect(suffixedHandle('maya', 1)).toBe('maya')
    expect(suffixedHandle('maya', 2)).toBe('maya-2')
    expect(suffixedHandle('maya', 99)).toBe('maya-99')
  })

  it('throws when n exceeds MAX_HANDLE_COLLISION_SUFFIX', async () => {
    const { suffixedHandle, MAX_HANDLE_COLLISION_SUFFIX } = await import('../src/actions/_lib/handle-derivation')
    expect(MAX_HANDLE_COLLISION_SUFFIX).toBe(99)
    expect(() => suffixedHandle('maya', 100)).toThrow(/exceeds MAX_HANDLE_COLLISION_SUFFIX/)
  })

  it('trims base to make room for suffix when near 30 chars', async () => {
    const { suffixedHandle } = await import('../src/actions/_lib/handle-derivation')
    const base = 'a'.repeat(30)
    const out = suffixedHandle(base, 12)
    expect(out.length).toBeLessThanOrEqual(30)
    expect(out.endsWith('-12')).toBe(true)
  })
})

describe('T043 — Zod input schema validates member.create', () => {
  it('accepts a valid input', async () => {
    const { memberCreateInput } = await import('../src/actions/member/create')
    const parsed = memberCreateInput.safeParse({
      authUserId: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      email: 'maya@example.com',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an invalid uuid', async () => {
    const { memberCreateInput } = await import('../src/actions/member/create')
    const parsed = memberCreateInput.safeParse({
      authUserId: 'not-a-uuid',
      email: 'maya@example.com',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an invalid email', async () => {
    const { memberCreateInput } = await import('../src/actions/member/create')
    const parsed = memberCreateInput.safeParse({
      authUserId: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      email: 'not-an-email',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a handleSuggestion that violates the regex', async () => {
    const { memberCreateInput } = await import('../src/actions/member/create')
    const parsed = memberCreateInput.safeParse({
      authUserId: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      email: 'maya@example.com',
      handleSuggestion: 'Maya!',
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a valid handleSuggestion', async () => {
    const { memberCreateInput } = await import('../src/actions/member/create')
    const parsed = memberCreateInput.safeParse({
      authUserId: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      email: 'maya@example.com',
      handleSuggestion: 'sourdough-maya',
    })
    expect(parsed.success).toBe(true)
  })
})

describe('T043 — ActionError taxonomy', () => {
  it('exports the five taxonomy classes', async () => {
    const mod = await import('../src/actions/_lib/errors')
    expect(new mod.ValidationError('x').code).toBe('validation_error')
    expect(new mod.AuthorizationError('x').code).toBe('authorization_error')
    expect(new mod.ConflictError('x').code).toBe('conflict_error')
    expect(new mod.NotFoundError('x').code).toBe('not_found_error')
    expect(new mod.TransientError('x').code).toBe('transient_error')
  })

  it('maps each code to an HTTP status', async () => {
    const { ACTION_ERROR_HTTP_STATUS } = await import('../src/actions/_lib/errors')
    expect(ACTION_ERROR_HTTP_STATUS.validation_error).toBe(400)
    expect(ACTION_ERROR_HTTP_STATUS.authorization_error).toBe(403)
    expect(ACTION_ERROR_HTTP_STATUS.conflict_error).toBe(409)
    expect(ACTION_ERROR_HTTP_STATUS.not_found_error).toBe(404)
    expect(ACTION_ERROR_HTTP_STATUS.transient_error).toBe(503)
  })
})

describe('T043 — defineHandler wraps Zod failures in ValidationError', () => {
  it('throws ValidationError on invalid input, never calls the body', async () => {
    const { defineHandler } = await import('../src/actions/_lib/handler')
    const { ValidationError } = await import('../src/actions/_lib/errors')
    const { z } = await import('zod')
    let bodyCalled = false
    const h = defineHandler('test.handler', z.object({ n: z.number() }), async () => {
      bodyCalled = true
      return null
    })
    // Build a minimal context. The body would barf if called — but the
    // schema check should fire first.
    await expect(
      h({ actingMemberId: 'fake', viaDelegationId: null, traceId: 'x', db: null as never, now: () => new Date() }, { n: 'not a number' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(bodyCalled).toBe(false)
  })
})

describe('T043 — registry resolution', () => {
  it('getHandler("member.create") returns the handler', async () => {
    const { getHandler } = await import('../src/actions/index')
    const h = getHandler('member.create')
    expect(h).not.toBeNull()
    expect(h?.name).toBe('member.create')
  })

  it('getHandler returns null for unknown names', async () => {
    const { getHandler } = await import('../src/actions/index')
    expect(getHandler('member.does_not_exist')).toBeNull()
  })

  it('listHandlers returns the registered names', async () => {
    const { listHandlers } = await import('../src/actions/index')
    const names = listHandlers()
    expect(names).toContain('member.create')
  })
})

describe('T043 — injectAudit', () => {
  it('adds acting_member_id and via_delegation_id from context', async () => {
    const { injectAudit } = await import('../src/actions/_lib/audit')
    const out = injectAudit(
      { actingMemberId: 'aaa', viaDelegationId: 'ddd', traceId: 'x', db: null as never, now: () => new Date() },
      { foo: 'bar' },
    )
    expect(out).toMatchObject({
      foo: 'bar',
      acting_member_id: 'aaa',
      via_delegation_id: 'ddd',
    })
  })

  it('throws if actingMemberId is still "self-bootstrap"', async () => {
    const { injectAudit } = await import('../src/actions/_lib/audit')
    expect(() =>
      injectAudit(
        { actingMemberId: 'self-bootstrap', viaDelegationId: null, traceId: 'x', db: null as never, now: () => new Date() },
        { foo: 'bar' },
      ),
    ).toThrow(/self-bootstrap/)
  })
})

describe('T043 — conformance check catches a deliberate violation', () => {
  const tempFile = resolve(WEB_ROOT, 'src', 'lib', '_conformance_probe.ts')
  it('flags a direct .insert against a protected table', () => {
    writeFileSync(
      tempFile,
      `// Temporary probe — should fail conformance check.\nexport function violate(client: any) {\n  return client.from('members').insert({ handle: 'x' })\n}\n`,
    )
    let exitCode = 0
    try {
      execSync('npm run -s check:action-layer', { cwd: WEB_ROOT, stdio: 'pipe' })
    } catch (err: unknown) {
      exitCode = (err as { status?: number })?.status ?? 1
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {
        // ignore
      }
    }
    expect(exitCode).toBe(1)
  })

  it('passes when no violations exist (post-cleanup)', () => {
    // Ensure the probe didn't survive.
    expect(existsSync(tempFile)).toBe(false)
    let exitCode = 0
    try {
      execSync('npm run -s check:action-layer', { cwd: WEB_ROOT, stdio: 'pipe' })
    } catch (err: unknown) {
      exitCode = (err as { status?: number })?.status ?? 1
    }
    expect(exitCode).toBe(0)
  })
})
