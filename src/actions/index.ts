// T043 — Action layer registry
// Source: development/tickets/done/T043-*
//
// getHandler(name) resolves to a NamedActionHandler. The route layer calls
// this to dispatch action invocations. Adding a new handler is two lines:
// import + registry entry.

import { memberCreate } from './member'
import type { NamedActionHandler } from './_lib/handler'

const REGISTRY: Record<string, NamedActionHandler<unknown, unknown>> = {
  'member.create': memberCreate as unknown as NamedActionHandler<unknown, unknown>,
}

export function getHandler(name: string): NamedActionHandler<unknown, unknown> | null {
  return REGISTRY[name] ?? null
}

export function listHandlers(): string[] {
  return Object.keys(REGISTRY).sort()
}

// Re-exports for convenience.
export { memberCreate } from './member'
export {
  ActionError,
  ValidationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  TransientError,
  ACTION_ERROR_HTTP_STATUS,
  type ActionErrorCode,
} from './_lib/errors'
export { makeContext, type ActionContext, type ActingMemberId } from './_lib/context'
export { withTransaction, closePool } from './_lib/db'
