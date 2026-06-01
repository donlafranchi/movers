// T073 — Resume detection for the Sell walkthrough.
// Spec:   planning/now/scenario-F036-member-creates-business-group-via-sell-walkthrough.md
// Ticket: development/tickets/T073-sell-walkthrough-and-you-sell-cta.md
//
// Pure helper: given a Supabase client + a Member id, returns the routing
// signal the /you Sell CTA needs to pick a label + destination:
//
//   - draftGroup        — caller's in-flight kind='business' draft (resume)
//   - hasActiveBusinessGroup — caller already founded ≥1 active Shop (skip walkthrough)
//   - neither           — first-time Seller (fresh walkthrough)
//
// Three CTA branches per T073 acceptance criteria:
//   1) neither               → "Sell"                       → opens walkthrough at step 1
//   2) draftGroup            → "Continue setting up your shop" → walkthrough w/ resumeFromStep + hydrated state
//   3) hasActiveBusinessGroup → "Sell"                       → /you/sell index stub
//
// The helper is intentionally Supabase-client-shaped (not pg-shaped) so it
// can run from either a server component (createServerClient) or a client
// component (createBrowserClient). RLS does the auth filtering — we still
// pass memberId so the query is explicit about whose drafts it wants.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface DraftGroupSummary {
  groupId: string
  brandName: string | null
  anchorLocationId: string | null
  publicDescription: string | null
  /** 0-indexed: the step the composer should resume on. */
  resumeFromStep: number
}

export interface SellRoutingSignal {
  draftGroup: DraftGroupSummary | null
  hasActiveBusinessGroup: boolean
}

interface DraftRow {
  id: string
  name: string | null
  anchor_location_id: string | null
  group_businesses: { display_name: string | null; public_description: string | null }[] | null
}

// Source of truth lives in src/actions/group/constants.ts. Duplicating the
// string here avoids pulling the actions barrel (and its pg/zod deps) into
// the /you bundle. A unit test in getDraftGroup.test.ts asserts equality.
const DRAFT_NAME_PLACEHOLDER = 'untitled-draft'

/**
 * Compute which step the composer should resume on, given a draft row.
 * Maps onto the 5-step SellWalkthrough:
 *   0 = Brand name
 *   1 = Anchor Location
 *   2 = About
 *   3 = Locality (Tier 0)
 *   4 = Review & done
 *
 * The rule: resume on the *first un-set required field*. Optional fields
 * (About, Locality) don't gate resume — we don't strand the user on an
 * optional step they already chose to skip.
 */
export function resumeStepFor(d: {
  brandName: string | null
  anchorLocationId: string | null
}): number {
  if (!d.brandName || d.brandName === DRAFT_NAME_PLACEHOLDER) return 0
  if (!d.anchorLocationId) return 1
  return 2 // Brand + anchor set → resume on About (next non-blocked step)
}

export async function getDraftGroup(
  supabase: SupabaseClient,
  memberId: string,
): Promise<SellRoutingSignal> {
  // 1) Active business-Group membership check. Determines whether the CTA
  // routes to walkthrough vs the /you/sell index.
  const { data: activeRows, error: activeErr } = await supabase
    .from('group_memberships')
    .select('group_id, groups!inner(kind, lifecycle_state)')
    .eq('member_id', memberId)
    .is('left_at', null)
    .eq('groups.kind', 'business')
    .eq('groups.lifecycle_state', 'active')

  if (activeErr) {
    // Surface the error to the caller — refuse to silently fall through to
    // the first-time-Seller branch on a query failure. The caller decides
    // how to surface it (toast / log / retry).
    throw new Error(`getDraftGroup: failed to read active memberships: ${activeErr.message}`)
  }
  const hasActiveBusinessGroup = (activeRows ?? []).length > 0

  // If they already have an active Shop, the walkthrough is the wrong
  // destination — skip the draft lookup. Caller routes to /you/sell.
  if (hasActiveBusinessGroup) {
    return { draftGroup: null, hasActiveBusinessGroup: true }
  }

  // 2) Draft-Group lookup. The most-recent draft wins (multi-draft is a
  // pathological state, not a supported flow — but we don't deadlock on it).
  const { data: draftRows, error: draftErr } = await supabase
    .from('groups')
    .select('id, name, anchor_location_id, group_businesses(display_name, public_description)')
    .eq('founder_member_id', memberId)
    .eq('kind', 'business')
    .eq('lifecycle_state', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)

  if (draftErr) {
    throw new Error(`getDraftGroup: failed to read drafts: ${draftErr.message}`)
  }

  const draft = (draftRows ?? [])[0] as DraftRow | undefined
  if (!draft) {
    return { draftGroup: null, hasActiveBusinessGroup: false }
  }

  // The composer step-1 writes display_name into group_businesses; the
  // spine `name` mirrors it. Either source is acceptable — prefer the
  // business row since it's the source of truth for kind='business'.
  const biz = Array.isArray(draft.group_businesses)
    ? draft.group_businesses[0]
    : null
  const rawName = biz?.display_name ?? draft.name
  const brandName = rawName && rawName !== DRAFT_NAME_PLACEHOLDER ? rawName : null
  const publicDescription = biz?.public_description ?? null

  return {
    draftGroup: {
      groupId: draft.id,
      brandName,
      anchorLocationId: draft.anchor_location_id,
      publicDescription,
      resumeFromStep: resumeStepFor({ brandName, anchorLocationId: draft.anchor_location_id }),
    },
    hasActiveBusinessGroup: false,
  }
}

// Use the same placeholder string as the action handlers
// (src/actions/group/constants.ts → DRAFT_NAME_PLACEHOLDER). Drift here
// would silently flip "needs brand" to "has brand" on resume.
//
// We intentionally don't import from the actions barrel — the actions module
// pulls in pg + zod, which would bloat the bundle for /you. Keep the constant
// duplicated and assert equality in a unit test (see getDraftGroup.test.tsx).
export const SELL_DRAFT_NAME_PLACEHOLDER = DRAFT_NAME_PLACEHOLDER
