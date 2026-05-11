// T043 — Action context
// Source: development/tickets/done/T043-* § _lib/context.ts
//
// ActionContext carries the per-call state every handler needs:
//   - actingMemberId: the Member id attributed to the event log
//   - viaDelegationId: the delegation chain (b2/b3 substrate; null at b1)
//   - traceId: per-call uuid; injected into payload.trace_id for correlation
//   - db: a transaction-bound DB client (the pg.PoolClient inside withTransaction)
//   - now: () => Date — injectable for tests
//
// The 'self-bootstrap' sentinel for actingMemberId is the ONE documented
// exception to ADR-6's "audit field references an existing acting Member."
// Only member.create may resolve 'self-bootstrap' — it does so by setting
// actingMemberId = the freshly-inserted member.id BEFORE writing the event
// row. The row on disk satisfies the invariant.

import type { PoolClient } from 'pg'

export type ActingMemberId = string | 'self-bootstrap'

export interface ActionContext {
  actingMemberId: ActingMemberId
  viaDelegationId: string | null
  traceId: string
  db: PoolClient
  now: () => Date
}

// Build a default context. Used by route handlers; tests may stub fields.
export function makeContext(opts: {
  actingMemberId: ActingMemberId
  viaDelegationId?: string | null
  traceId?: string
  db: PoolClient
  now?: () => Date
}): ActionContext {
  return {
    actingMemberId: opts.actingMemberId,
    viaDelegationId: opts.viaDelegationId ?? null,
    traceId: opts.traceId ?? crypto.randomUUID(),
    db: opts.db,
    now: opts.now ?? (() => new Date()),
  }
}
