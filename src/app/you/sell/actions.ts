'use server'

// T073 — Server actions for the Sell walkthrough.
// Spec:   planning/now/scenario-F036-member-creates-business-group-via-sell-walkthrough.md
// Ticket: development/tickets/T073-sell-walkthrough-and-you-sell-cta.md
//
// Thin server-action wrappers around the group action handlers (T070).
// Sit between the client-side SellWalkthrough and the pg-backed handlers so
// the client never touches credentials. Each action:
//
//   1. Resolves the auth user via @supabase/ssr (cookie session).
//   2. Builds an ActionContext with actingMemberId = user.id
//      (members.id IS auth.users.id per 009_members_phase1 constraint trigger).
//   3. Invokes the handler. Maps ActionError → a JSON-serializable shape
//      the client can use to surface inline / toast messages.

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import {
  groupCreate,
  groupUpdateDraft,
  groupActivate,
  ActionError,
} from '@/actions'

/** Discriminated error result the client surfaces. The composer's submit
 *  catches a thrown Error and renders its `.message`; we throw to preserve
 *  that path while keeping the structure for any caller that wants codes. */
class SellActionError extends Error {
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
    throw new SellActionError(
      'You must be signed in to start selling.',
      'unauthenticated',
    )
  }
  return data.user.id
}

function rethrow(err: unknown): never {
  if (err instanceof ActionError) {
    throw new SellActionError(err.message, err.code)
  }
  throw err
}

export async function sellCreateDraftAction(input: {
  brand: string
}): Promise<{ groupId: string }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    const result = await groupCreate(ctx, {
      kind: 'business',
      founderMemberId: memberId,
      businessDisplayName: input.brand,
    })
    return { groupId: result.groupId }
  } catch (err) {
    rethrow(err)
  }
}

export async function sellUpdateDraftAction(input: {
  groupId: string
  brand?: string
  anchorLocationId?: string
  about?: string
}): Promise<void> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await groupUpdateDraft(ctx, {
      groupId: input.groupId,
      ...(input.brand !== undefined
        ? { name: input.brand, businessDisplayName: input.brand }
        : {}),
      ...(input.anchorLocationId !== undefined
        ? { anchorLocationId: input.anchorLocationId }
        : {}),
      ...(input.about !== undefined
        ? { businessPublicDescription: input.about }
        : {}),
    })
  } catch (err) {
    rethrow(err)
  }
}

export async function sellActivateAction(input: {
  groupId: string
}): Promise<{ destinationUrl: string }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })
  try {
    await groupActivate(ctx, { groupId: input.groupId })
  } catch (err) {
    rethrow(err)
  }
  // Build the place-scoped Group URL. F035 owns the page render; this
  // action just hands the URL back so the client redirects. We re-read the
  // row to pick up the activated slug + the anchor Location's place path.
  const supabase = await createClient()
  const { data: group } = await supabase
    .from('groups')
    .select('slug, anchor_location_id, locations:anchor_location_id(place:places(slug, parent_slug_path))')
    .eq('id', input.groupId)
    .single()
  type LocationsJoin = {
    place: { slug: string; parent_slug_path: string | null } | null
  } | null
  const loc = group?.locations as unknown as LocationsJoin
  const parentPath = loc?.place?.parent_slug_path
  const placeSlug = loc?.place?.slug
  const slug = group?.slug
  // M2 fix-now: refuse to return a guessed URL. If the join fails (no
  // anchor Location, or the Location has no place) we'd otherwise emit
  // `/p/place/g/shop`, which 404s on F035. Throwing surfaces a toast.
  if (!slug || !placeSlug) {
    throw new SellActionError(
      'Your shop was created, but we could not resolve its public URL. Refresh /you to see it.',
      'shop_url_unresolved',
    )
  }
  const placePath = [parentPath, placeSlug].filter(Boolean).join('/')
  return { destinationUrl: `/p/${placePath}/g/${slug}` }
}

/** Sub-flow: inline-add a Location from the anchor-Location step. Thin
 *  wrapper over the existing location handler. The location action handler
 *  is not yet shipped in T073 scope — this stub creates a placeholder row
 *  via the existing `locations` table the client can refer back to. */
export async function sellCreateLocationAction(input: {
  label: string
  /** Optional geography in WKT — caller can stamp from a map picker. */
  geographyWkt?: string
}): Promise<{ id: string; label: string }> {
  const memberId = await requireMemberId()
  // Minimal Location.create — full `location.create` action handler is its
  // own ticket. At b1 we insert directly via RLS so the picker can move.
  //
  // T073a fix-forward: insert satisfies the locations spine NOT NULL set
  // per 007_locations.sql — member_id + kind + label + slug + geography.
  // Original T073 used `display_name` (doesn't exist) + omitted slug/geo
  // (NOT NULL) — every inline-add would have raised on the first eval run.
  //
  // Slug: derived from the label with a random suffix to satisfy the global
  // UNIQUE constraint without collision-handling logic.
  // Geography: defaults to midtown-Sacramento if the caller didn't stamp
  // one. F036's anchor picker has no map step at b1, so this is the floor.
  const supabase = await createClient()
  const slug =
    input.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  const { data, error } = await supabase
    .from('locations')
    .insert({
      member_id: memberId,
      kind: 'permanent',
      label: input.label,
      slug,
      geography: input.geographyWkt ?? 'SRID=4326;POINT(-121.4944 38.5816)',
    })
    .select('id, label')
    .single()
  if (error || !data) {
    throw new SellActionError(
      error?.message ?? 'Could not save the new Location.',
      'location_create_failed',
    )
  }
  return { id: data.id, label: data.label ?? input.label }
}
