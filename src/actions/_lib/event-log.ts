// T043 — Event-log writer
// Source: development/tickets/done/T043-* § _lib/event-log.ts; ADR-10
//
// appendEvent writes one row to the named event table (member_events at
// Phase 0; item_events / location_events / group_events at Phase 1). The
// write goes via the transaction-bound DB handle on the context, so the
// event row and the originating row commit/rollback together.

import type { ActionContext } from './context'
import { injectAudit } from './audit'

export type EventTable =
  | 'member_events'
  // Phase 1 will add: 'item_events' | 'location_events' | 'group_events'

export interface EventRowInput {
  member_id?: string
  item_id?: string
  location_id?: string
  group_id?: string
  event_kind: string
  payload?: Record<string, unknown>
}

export async function appendEvent(
  ctx: ActionContext,
  table: EventTable,
  row: EventRowInput,
): Promise<void> {
  const payload = {
    ...(row.payload ?? {}),
    trace_id: ctx.traceId,
  }

  // Build the row with audit fields injected. The injector throws if the
  // actingMemberId is still the 'self-bootstrap' sentinel.
  const audited = injectAudit(ctx, {
    ...row,
    payload,
  })

  // Each event table at Phase 0 has the same column shape: (target_id),
  // event_kind, payload, acting_member_id, via_delegation_id, created_at.
  // member_events.target_id is `member_id`. Future tables: item_events ->
  // item_id, etc.
  const targetColumn = targetColumnFor(table)
  const targetValue =
    row.member_id ?? row.item_id ?? row.location_id ?? row.group_id
  if (!targetValue) {
    throw new Error(
      `appendEvent: ${table} requires a ${targetColumn} value on the row input.`,
    )
  }

  // sql-injection-safe: enum-constrained by EventTable
  await ctx.db.query(
    `insert into public.${table}
       (${targetColumn}, event_kind, payload, acting_member_id, via_delegation_id, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      targetValue,
      audited.event_kind,
      audited.payload,
      audited.acting_member_id,
      audited.via_delegation_id,
      ctx.now(),
    ],
  )
}

function targetColumnFor(table: EventTable): string {
  switch (table) {
    case 'member_events':
      return 'member_id'
    default:
      throw new Error(`appendEvent: unknown event table ${table}`)
  }
}
