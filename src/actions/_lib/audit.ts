// T043 — Audit-field injector
// Source: development/tickets/done/T043-* § _lib/audit.ts; ADR-6
//
// Adds acting_member_id + via_delegation_id to any event-row payload before
// it is written. The actingMemberId may be the 'self-bootstrap' sentinel —
// callers (only member.create) must resolve it to a real uuid before
// invoking injectAudit. injectAudit asserts on this to fail fast.

import type { ActionContext } from './context'

export interface AuditedRow {
  acting_member_id: string
  via_delegation_id: string | null
}

export function injectAudit<T extends Record<string, unknown>>(
  ctx: ActionContext,
  row: T,
): T & AuditedRow {
  if (ctx.actingMemberId === 'self-bootstrap') {
    throw new Error(
      "injectAudit: actingMemberId is still 'self-bootstrap' — member.create must resolve to the new member id before appending the event.",
    )
  }
  return {
    ...row,
    acting_member_id: ctx.actingMemberId,
    via_delegation_id: ctx.viaDelegationId,
  }
}
