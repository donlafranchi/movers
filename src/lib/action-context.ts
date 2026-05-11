// T043 — Action context resolver
// Source: development/tickets/done/T043-* § action-context.ts
//
// Builds an ActionContext from a Next.js Request. Used by route handlers
// (T044 wires the auth-signup route). For most routes, actingMemberId comes
// from the authenticated user's Supabase session. For the auth-signup hook,
// actingMemberId is the 'self-bootstrap' sentinel until member.create
// resolves it to the freshly-inserted member id.

import type { PoolClient } from 'pg'
import { makeContext, type ActionContext, type ActingMemberId } from '@/actions/_lib/context'

export interface ResolveContextOptions {
  actingMemberId: ActingMemberId
  viaDelegationId?: string | null
}

// Sentinel PoolClient that throws on any access. Handlers MUST go through
// withTransaction which provides a real transaction-bound client; the
// route-layer ctx.db is a placeholder for type safety, never read.
const SENTINEL_DB: PoolClient = new Proxy({} as PoolClient, {
  get(_target, prop) {
    throw new Error(
      `ActionContext.db: handlers must use withTransaction; the route-layer db is a sentinel (attempted access: ${String(prop)})`,
    )
  },
})

// Resolve an action context for a route invocation. The caller passes the
// actingMemberId (resolved from auth.uid() on a normal route, or
// 'self-bootstrap' on the auth-signup hook).
//
// Note: ctx.db is a sentinel — handlers MUST use withTransaction. This
// keeps the route-layer free of pool-client lifecycle concerns.
export function resolveActionContext(opts: ResolveContextOptions): ActionContext {
  return makeContext({
    actingMemberId: opts.actingMemberId,
    viaDelegationId: opts.viaDelegationId ?? null,
    db: SENTINEL_DB,
  })
}
