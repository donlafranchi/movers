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
  memberPlaceInterestAdd,
  memberPlaceInterestRemove,
  memberInterestsAdd,
  memberFollow,
  memberUnfollow,
} from './member'
import { groupCreate, groupUpdateDraft, groupActivate } from './group'
import { itemCreate, itemPublish, itemAttachLocation, itemQrCardRequest } from './item'
import type { NamedActionHandler } from './_lib/handler'

const REGISTRY: Record<string, NamedActionHandler<unknown, unknown>> = {
  'member.create': memberCreate as unknown as NamedActionHandler<unknown, unknown>,
  'group.create': groupCreate as unknown as NamedActionHandler<unknown, unknown>,
  'group.update_draft': groupUpdateDraft as unknown as NamedActionHandler<unknown, unknown>,
  'group.activate': groupActivate as unknown as NamedActionHandler<unknown, unknown>,
  'item.create': itemCreate as unknown as NamedActionHandler<unknown, unknown>,
  'item.publish': itemPublish as unknown as NamedActionHandler<unknown, unknown>,
  'item.attach_location': itemAttachLocation as unknown as NamedActionHandler<unknown, unknown>,
  'item.qr_card.request': itemQrCardRequest as unknown as NamedActionHandler<unknown, unknown>,
  'member.business_jurisdiction.set': memberBusinessJurisdictionSet as unknown as NamedActionHandler<unknown, unknown>,
  'member.business_jurisdiction.remove': memberBusinessJurisdictionRemove as unknown as NamedActionHandler<unknown, unknown>,
  'member.place_interest.add': memberPlaceInterestAdd as unknown as NamedActionHandler<unknown, unknown>,
  'member.place_interest.remove': memberPlaceInterestRemove as unknown as NamedActionHandler<unknown, unknown>,
  'member.interests.add': memberInterestsAdd as unknown as NamedActionHandler<unknown, unknown>,
  'member.follow': memberFollow as unknown as NamedActionHandler<unknown, unknown>,
  'member.unfollow': memberUnfollow as unknown as NamedActionHandler<unknown, unknown>,
}

export function getHandler(name: string): NamedActionHandler<unknown, unknown> | null {
  return REGISTRY[name] ?? null
}

export function listHandlers(): string[] {
  return Object.keys(REGISTRY).sort()
}

// Re-exports for convenience.
export {
  memberCreate,
  memberPlaceInterestAdd,
  memberInterestsAdd,
  memberFollow,
  memberUnfollow,
  memberBusinessJurisdictionSet,
  memberBusinessJurisdictionRemove,
  memberSavedSearchCreate,
  memberSavedSearchRemove,
} from './member'
export { groupCreate, groupUpdateDraft, groupActivate } from './group'
export { itemCreate, itemPublish, itemAttachLocation, itemQrCardRequest } from './item'
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
