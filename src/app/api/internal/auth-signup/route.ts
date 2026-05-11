// T044 — /api/internal/auth-signup route
// Source: notes/migration-to-primitives.md § Phase 0
//
// The Postgres `on_auth_user_created` trigger POSTs to this route via
// pg_net with an HMAC-SHA256-signed payload. The route validates the
// signature, calls the member.create action handler with a
// 'self-bootstrap' acting Member id, and returns the new member id +
// handle. Idempotent on retry — duplicate authUserId returns 409.
//
// Runs on the Node runtime (per T043 db.ts decision — `pg` doesn't work
// on Edge). Cold-start cost is acceptable for signup-rate traffic.

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  ACTION_ERROR_HTTP_STATUS,
  ActionError,
  getHandler,
  type ActionErrorCode,
} from '@/actions'
import { resolveActionContext } from '@/lib/action-context'
import type { MemberCreateResult } from '@/actions/member'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const triggerPayloadSchema = z.object({
  authUserId: z.string().uuid(),
  email: z.string().email(),
  handleSuggestion: z
    .string()
    .min(4)
    .max(30)
    .regex(/^[a-z0-9-]+$/)
    .optional()
    .nullable(),
  displayName: z.string().min(1).max(60).optional().nullable(),
})

function constantTimeHexEqual(a: string, b: string): boolean {
  // Hex strings of different lengths are unequal.
  if (a.length !== b.length) return false
  // Parse to bytes for timing-safe compare. If parsing fails (non-hex),
  // returns false rather than throwing.
  let bufA: Buffer
  let bufB: Buffer
  try {
    bufA = Buffer.from(a, 'hex')
    bufB = Buffer.from(b, 'hex')
  } catch {
    return false
  }
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export async function POST(req: NextRequest) {
  const secret = process.env.AUTH_SIGNUP_HOOK_SECRET
  if (!secret || secret.length < 16) {
    // 16-char minimum is a conservative floor; production secrets should
    // be 32+ random bytes. This guards against an empty-string env var.
    return NextResponse.json(
      { error: 'configuration_error', message: 'AUTH_SIGNUP_HOOK_SECRET not set or too short' },
      { status: 500 },
    )
  }

  // Read body once as raw text — we need the exact byte sequence for HMAC.
  const bodyText = await req.text()
  const provided = (req.headers.get('x-signature') ?? '').trim().toLowerCase()
  const expected = createHmac('sha256', secret).update(bodyText).digest('hex')

  if (!constantTimeHexEqual(provided, expected)) {
    return NextResponse.json(
      { error: 'invalid_signature' },
      { status: 401 },
    )
  }

  // Parse + validate. Zod-failures map to 400. Note: handleSuggestion may
  // arrive as `null` from the trigger (jsonb null vs JSON omitted); the
  // schema accepts both.
  let parsed: z.infer<typeof triggerPayloadSchema>
  try {
    parsed = triggerPayloadSchema.parse(JSON.parse(bodyText))
  } catch (err) {
    return NextResponse.json(
      { error: 'validation_error', details: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    )
  }

  // Normalize: pass `undefined` to the handler if the trigger sent null.
  const handlerInput = {
    authUserId: parsed.authUserId,
    email: parsed.email,
    ...(parsed.handleSuggestion ? { handleSuggestion: parsed.handleSuggestion } : {}),
    ...(parsed.displayName ? { displayName: parsed.displayName } : {}),
  }

  const ctx = resolveActionContext({ actingMemberId: 'self-bootstrap' })
  const handler = getHandler('member.create')
  if (!handler) {
    return NextResponse.json(
      { error: 'configuration_error', message: 'member.create not registered' },
      { status: 500 },
    )
  }

  try {
    const result = (await handler(ctx, handlerInput)) as MemberCreateResult
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof ActionError) {
      const code = err.code as ActionErrorCode
      return NextResponse.json(
        { error: err.code, message: err.message, details: err.details },
        { status: ACTION_ERROR_HTTP_STATUS[code] },
      )
    }
    // Unexpected error — log server-side, generic 500 to client.
    console.error('[auth-signup] unexpected error:', err)
    return NextResponse.json(
      { error: 'internal_error' },
      { status: 500 },
    )
  }
}

// Reject any non-POST method explicitly.
export async function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 })
}
