'use server'

// T097 — Server actions for the F037 Locally Owned claim widget.
// Spec:   planning/now/scenario-F037-maya-claims-locally-owned.md
// Ticket: development/tickets/T097-locally-owned-claim-widget.md
//
// Thin wrappers over the T075 jurisdiction handlers, mirroring
// src/app/you/sell/actions.ts. The client widget never touches credentials:
//   1. Resolve the auth user via @supabase/ssr (cookie session).
//   2. Build an ActionContext with actingMemberId = user.id.
//   3. Invoke the handler (which authorizes owner-role itself, throws
//      AuthorizationError for non-owners). Map ActionError → a serializable
//      Error the client surfaces inline.
//
// `.set` folds update into a soft-replace (T075 deviation #4): both the
// empty-state Add and the Edit path call setJurisdictionAction.

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import {
  memberBusinessJurisdictionSet,
  memberBusinessJurisdictionRemove,
  ActionError,
} from '@/actions'

class ClaimActionError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

async function requireMemberId(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new ClaimActionError('You must be signed in to manage this claim.', 'unauthenticated')
  }
  return data.user.id
}

function rethrow(err: unknown): never {
  if (err instanceof ActionError) {
    throw new ClaimActionError(err.message, err.code)
  }
  throw err
}

export async function setJurisdictionAction(input: {
  groupId: string
  zip: string
}): Promise<void> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await memberBusinessJurisdictionSet(ctx, { groupId: input.groupId, zip: input.zip })
  } catch (err) {
    rethrow(err)
  }
}

export async function removeJurisdictionAction(input: {
  groupId: string
}): Promise<void> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await memberBusinessJurisdictionRemove(ctx, { groupId: input.groupId })
  } catch (err) {
    rethrow(err)
  }
}
