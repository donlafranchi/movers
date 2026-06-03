import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHmac } from 'node:crypto'

// T044 — Tests for the auth-signup route + migration shape.
//
// DB-runtime tests (real auth.users insert → trigger fires → route called →
// members + member.created row appear) live in web/evals/phase-0/floor.spec.ts.
// This Vitest suite covers route-layer logic in isolation by mocking the
// action handler — fast, deterministic, no DB required.

const WEB_ROOT = resolve(__dirname, '..')
const MIGRATIONS_DIR = resolve(WEB_ROOT, 'supabase', 'migrations')
const ROUTE_PATH = resolve(WEB_ROOT, 'src', 'app', 'api', 'internal', 'auth-signup', 'route.ts')

// ---- Migration shape ----

describe('T044 — 006_auth_signup_hook.sql', () => {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, '006_auth_signup_hook.sql'), 'utf8')
  const stripped = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

  it('enables pg_net, pgcrypto, and supabase_vault extensions', () => {
    expect(stripped).toMatch(/create extension if not exists pg_net/i)
    expect(stripped).toMatch(/create extension if not exists pgcrypto/i)
    expect(stripped).toMatch(/create extension if not exists supabase_vault/i)
  })

  it('defines handle_new_auth_user() with security definer', () => {
    expect(stripped).toMatch(/create or replace function\s+public\.handle_new_auth_user\(\)/i)
    expect(stripped).toMatch(/security definer/i)
  })

  it('reads configuration from vault.decrypted_secrets (not custom GUCs)', () => {
    expect(stripped).toMatch(/from\s+vault\.decrypted_secrets/i)
    expect(stripped).toMatch(/name\s*=\s*'auth_signup_hook_secret'/i)
    expect(stripped).toMatch(/name\s*=\s*'auth_signup_hook_url'/i)
    // Defensive: no leftover ALTER DATABASE / app.* GUC reads from the old design.
    expect(stripped).not.toMatch(/current_setting\(\s*'app\./i)
  })

  it('HMAC-SHA256 signs the payload with extensions.hmac', () => {
    expect(stripped).toMatch(/extensions\.hmac\([\s\S]+?sha256/i)
  })

  it('posts via pg_net with x-signature header', () => {
    expect(stripped).toMatch(/net\.http_post/i)
    expect(stripped).toMatch(/x-signature/i)
  })

  it('skips system Member auth.users rows (defensive)', () => {
    expect(stripped).toMatch(/00000000-0000-0000-0000-000000000001/)
  })

  it('attaches the after-insert trigger on auth.users', () => {
    expect(stripped).toMatch(/create trigger\s+on_auth_user_created[\s\S]+after insert on\s+auth\.users[\s\S]+execute function\s+public\.handle_new_auth_user/i)
  })

  it('no-ops with a warning if GUCs are unset (does not block signup)', () => {
    expect(stripped).toMatch(/raise warning/i)
    expect(stripped).toMatch(/return new/i)
  })
})

// ---- Phase 0 migrations directory final state ----

describe('T044 — Phase 0 migrations directory state', () => {
  it('contains all five Phase 0 migrations', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(files).toEqual(
      expect.arrayContaining([
        '001_extensions.sql',
        '002_members.sql',
        '004_item_embeddings.sql',
        '005_member_embeddings.sql',
        '006_auth_signup_hook.sql',
      ]),
    )
  })

  it('every migration filename matches Supabase pattern', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    for (const f of files) {
      expect(f).toMatch(/^\d+_[a-z0-9_]+\.sql$/i)
    }
  })
})

// ---- Route handler behavior ----

// Mock the action handler so we don't touch a DB. We assert what arguments
// the route passes to it, and synthesize responses to verify error mapping.
const mockHandler = vi.fn()

vi.mock('@/actions', async () => {
  const actual = await vi.importActual<typeof import('../src/actions/index')>('@/actions')
  return {
    ...actual,
    getHandler: (name: string) => {
      if (name === 'member.create') return mockHandler
      return null
    },
  }
})

// Resolve the route module AFTER the mock is registered.
let POST: (req: Request) => Promise<Response>

const SECRET = 'test-secret-must-be-at-least-16-chars-long'

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('http://localhost:3000/api/internal/auth-signup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: bodyText,
  })
}

beforeAll(async () => {
  process.env.AUTH_SIGNUP_HOOK_SECRET = SECRET
  const mod = await import('../src/app/api/internal/auth-signup/route')
  POST = mod.POST as unknown as (req: Request) => Promise<Response>
})

afterAll(() => {
  delete process.env.AUTH_SIGNUP_HOOK_SECRET
  mockHandler.mockReset()
})

describe('T044 — auth-signup route file exists', () => {
  it('exists at src/app/api/internal/auth-signup/route.ts', () => {
    expect(existsSync(ROUTE_PATH)).toBe(true)
  })

  it('declares runtime = "nodejs" (per T043 db.ts decision)', () => {
    const content = readFileSync(ROUTE_PATH, 'utf8')
    expect(content).toMatch(/export const runtime = ['"]nodejs['"]/i)
  })
})

describe('T044 — signature validation', () => {
  it('rejects a request with no x-signature header', async () => {
    mockHandler.mockReset()
    const body = { authUserId: '00000000-0000-0000-0000-0000000000aa', email: 'a@b.test' }
    const res = await POST(makeReq(body))
    expect(res.status).toBe(401)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('rejects a request with an invalid x-signature', async () => {
    mockHandler.mockReset()
    const body = { authUserId: '00000000-0000-0000-0000-0000000000bb', email: 'b@b.test' }
    const res = await POST(makeReq(body, { 'x-signature': 'deadbeef'.repeat(8) }))
    expect(res.status).toBe(401)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('accepts a request with a valid x-signature', async () => {
    mockHandler.mockReset()
    mockHandler.mockResolvedValueOnce({ memberId: 'm-1', handle: 'alice' })
    const body = { authUserId: '00000000-0000-0000-0000-0000000000cc', email: 'alice@b.test' }
    const bodyText = JSON.stringify(body)
    const res = await POST(makeReq(bodyText, { 'x-signature': sign(bodyText) }))
    expect(res.status).toBe(200)
    expect(mockHandler).toHaveBeenCalledOnce()
    const [ctx, input] = mockHandler.mock.calls[0]
    expect(ctx.actingMemberId).toBe('self-bootstrap')
    expect(input).toMatchObject({ authUserId: body.authUserId, email: body.email })
  })

  it('accepts hex signatures case-insensitively (trigger may send upper or lower)', async () => {
    mockHandler.mockReset()
    mockHandler.mockResolvedValueOnce({ memberId: 'm-1', handle: 'alice' })
    const body = { authUserId: '00000000-0000-0000-0000-0000000000dd', email: 'a@b.test' }
    const bodyText = JSON.stringify(body)
    const res = await POST(makeReq(bodyText, { 'x-signature': sign(bodyText).toUpperCase() }))
    expect(res.status).toBe(200)
  })
})

describe('T044 — input validation', () => {
  it('returns 400 when authUserId is not a uuid', async () => {
    mockHandler.mockReset()
    const body = { authUserId: 'not-a-uuid', email: 'a@b.test' }
    const bodyText = JSON.stringify(body)
    const res = await POST(makeReq(bodyText, { 'x-signature': sign(bodyText) }))
    expect(res.status).toBe(400)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('returns 400 when email is invalid', async () => {
    mockHandler.mockReset()
    const body = { authUserId: '00000000-0000-0000-0000-0000000000ee', email: 'not-an-email' }
    const bodyText = JSON.stringify(body)
    const res = await POST(makeReq(bodyText, { 'x-signature': sign(bodyText) }))
    expect(res.status).toBe(400)
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('accepts handleSuggestion = null from the trigger', async () => {
    mockHandler.mockReset()
    mockHandler.mockResolvedValueOnce({ memberId: 'm-1', handle: 'alice' })
    const body = {
      authUserId: '00000000-0000-0000-0000-0000000000ff',
      email: 'alice@b.test',
      handleSuggestion: null,
    }
    const bodyText = JSON.stringify(body)
    const res = await POST(makeReq(bodyText, { 'x-signature': sign(bodyText) }))
    expect(res.status).toBe(200)
    const [, input] = mockHandler.mock.calls[0]
    // Null should NOT be forwarded as 'handleSuggestion' to the handler.
    expect(input.handleSuggestion).toBeUndefined()
  })
})

describe('T044 — error mapping from ActionError', () => {
  it('maps ConflictError → 409', async () => {
    const { ConflictError } = await import('../src/actions/_lib/errors')
    mockHandler.mockReset()
    mockHandler.mockRejectedValueOnce(new ConflictError('duplicate signup'))
    const body = { authUserId: '00000000-0000-0000-0000-000000000001'.replace(/.$/, '2'), email: 'a@b.test' }
    const bodyText = JSON.stringify(body)
    const res = await POST(makeReq(bodyText, { 'x-signature': sign(bodyText) }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toBe('conflict_error')
  })

  it('maps ValidationError → 400', async () => {
    const { ValidationError } = await import('../src/actions/_lib/errors')
    mockHandler.mockReset()
    mockHandler.mockRejectedValueOnce(new ValidationError('bad input'))
    const body = { authUserId: '00000000-0000-0000-0000-000000000033', email: 'a@b.test' }
    const bodyText = JSON.stringify(body)
    const res = await POST(makeReq(bodyText, { 'x-signature': sign(bodyText) }))
    expect(res.status).toBe(400)
  })

  it('maps unknown errors → 500', async () => {
    mockHandler.mockReset()
    mockHandler.mockRejectedValueOnce(new Error('boom'))
    const body = { authUserId: '00000000-0000-0000-0000-000000000044', email: 'a@b.test' }
    const bodyText = JSON.stringify(body)
    const res = await POST(makeReq(bodyText, { 'x-signature': sign(bodyText) }))
    expect(res.status).toBe(500)
  })
})

describe('T044 — method-not-allowed', () => {
  it('GET returns 405', async () => {
    const mod = await import('../src/app/api/internal/auth-signup/route')
    const GET = mod.GET as unknown as () => Promise<Response>
    const res = await GET()
    expect(res.status).toBe(405)
  })
})
