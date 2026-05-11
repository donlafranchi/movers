// T043 — Action context resolver
// Source: development/tickets/done/T043-* § action-context.ts
//
// Builds an ActionContext from a Next.js Request. Used by route handlers
// (T044 wires the auth-signup route). For most routes, actingMemberId comes
// from the authenticated user's Supabase session. For the auth-signup hook,
// actingMemberId is the 'self-bootstrap' sentinel until member.create
// resolves it to the freshly-inserted member id.

import { makeContext, type ActionContext, type ActingMemberId } from '@/actions/_lib/context'
import { getPool } from '@/actions/_lib/db'

export interface ResolveContextOptions {
  actingMemberId: ActingMemberId
  viaDelegationId?: string | null
}

// Resolve an action context for a route invocation. The caller is
// responsible for passing the actingMemberId (resolved from
// auth.uid() on a normal route, or 'self-bootstrap' on the auth-signup
// hook).
//
// Note: the context returned here is NOT yet bound to a transaction —
// withTransaction inside the handler body acquires the transaction-bound
// client. This resolver only sets up the per-call metadata.
export async function resolveActionContext(
  opts: ResolveContextOptions,
): Promise<ActionContext> {
  // The db field is overwritten by withTransaction. We pass a placeholder
  // client from the pool here; handlers that don't open a transaction
  // (read-only handlers, none yet at b1) use this client directly.
  const client = await getPool().connect()
  return makeContext({
    actingMemberId: opts.actingMemberId,
    viaDelegationId: opts.viaDelegationId ?? null,
    db: client,
  })
}
