// T043 — Action layer registry
// Source: development/tickets/done/T043-*
//
// getHandler(name) resolves to a NamedActionHandler. The route layer calls
// this to dispatch action invocations. Adding a new handler is two lines:
// import + registry entry.

import {
  memberCreate,
  memberBusinessJurisdictionSet,
  memberBusinessJurisdictionRemove,
} from './member'
import { groupCreate, groupUpdateDraft, groupActivate } from './group'
import { itemCreate, itemPublish, itemAttachLocation } from './item'
import type { NamedActionHandler } from './_lib/handler'

const REGISTRY: Record<string, NamedActionHandler<unknown, unknown>> = {
  'member.create': memberCreate as unknown as NamedActionHandler<unknown, unknown>,
  'group.create': groupCreate as unknown as NamedActionHandler<unknown, unknown>,
  'group.update_draft': groupUpdateDraft as unknown as NamedActionHandler<unknown, unknown>,
  'group.activate': groupActivate as unknown as NamedActionHandler<unknown, unknown>,
  'item.create': itemCreate as unknown as NamedActionHandler<unknown, unknown>,
  'item.publish': itemPublish as unknown as NamedActionHandler<unknown, unknown>,
  'item.attach_location': itemAttachLocation as unknown as NamedActionHandler<unknown, unknown>,
  'member.business_jurisdiction.set': memberBusinessJurisdictionSet as unknown as NamedActionHandler<unknown, unknown>,
  'member.business_jurisdiction.remove': memberBusinessJurisdictionRemove as unknown as NamedActionHandler<unknown, unknown>,
}

export function getHandler(name: string): NamedActionHandler<unknown, unknown> | null {
  return REGISTRY[name] ?? null
}

export function listHandlers(): string[] {
  return Object.keys(REGISTRY).sort()
}

// Re-exports for convenience.
export { memberCreate } from './member'
export { groupCreate, groupUpdateDraft, groupActivate } from './group'
export { itemCreate, itemPublish, itemAttachLocation } from './item'
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
