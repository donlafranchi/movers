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
import { withTransaction } from '@/actions/_lib/db'
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
  // action just hands the URL back so the client redirects.
  //
  // T073b fix-forward: the locations table has NO `place_id` column —
  // the place resolution is geographic (via public.place_for_coords on
  // the location's geography Point) per 022_places_reverse_geocode.sql.
  // Original T073 used a PostgREST relational join that silently returned
  // null and tripped the `shop_url_unresolved` throw on every activation.
  // Reaches into the action-layer pg pool so we can call the RPC + walk
  // the parent_id chain.
  const { destinationUrl } = await withTransaction(async (client) => {
    const groupRes = await client.query<{
      slug: string
      anchor_location_id: string | null
    }>(
      `select slug, anchor_location_id
         from public.groups
        where id = $1`,
      [input.groupId],
    )
    const group = groupRes.rows[0]
    if (!group?.anchor_location_id || !group.slug) {
      throw new SellActionError(
        'Your shop was created, but we could not resolve its public URL. Refresh /you to see it.',
        'shop_url_unresolved',
      )
    }
    // Resolve the place via the location's geography centroid → place_for_coords.
    // place_for_coords expects (lat, lon); we extract from the Point.
    const placeRes = await client.query<{ place_id: string | null }>(
      `select (public.place_for_coords(
                 st_y(l.geography::geometry),
                 st_x(l.geography::geometry)
               )).place_id
         from public.locations l
        where l.id = $1`,
      [group.anchor_location_id],
    )
    const placeId = placeRes.rows[0]?.place_id
    if (!placeId) {
      throw new SellActionError(
        'Your shop was created, but we could not resolve a place for its anchor Location.',
        'shop_url_unresolved',
      )
    }
    // Walk the parent_id chain to assemble the slash-joined slug path
    // (innermost place last). Recursive CTE keeps it one query.
    const pathRes = await client.query<{ path: string }>(
      `with recursive chain(id, slug, parent_id, depth) as (
         select id, slug, parent_id, 0 from public.places where id = $1
         union all
         select p.id, p.slug, p.parent_id, c.depth + 1
           from public.places p join chain c on p.id = c.parent_id
       )
       select string_agg(slug, '/' order by depth desc) as path from chain`,
      [placeId],
    )
    const placePath = pathRes.rows[0]?.path
    if (!placePath) {
      throw new SellActionError(
        'Your shop was created, but we could not assemble its place URL.',
        'shop_url_unresolved',
      )
    }
    return { destinationUrl: `/p/${placePath}/g/${group.slug}` }
  })
  return { destinationUrl }
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
  // own substrate ticket (flagged in SPEC-PATCHES). At b1 we insert via
  // the action-layer pg pool (service-role DB connection) so we bypass
  // RLS without exposing service-role to the browser.
  //
  // T073b fix-forward: original T073a used the supabase server client
  // (session-bound, RLS-enforced). `locations` has no INSERT RLS policy
  // — all writes are designed to go through the action layer. The eval
  // surfaced "new row violates row-level security policy for table
  // locations" on every inline-add attempt. Routing through `withTransaction`
  // mirrors what `location.create` will do once that handler lands.
  const slug =
    input.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  try {
    return await withTransaction(async (client) => {
      const result = await client.query<{ id: string; label: string }>(
        `insert into public.locations
           (member_id, kind, label, slug, geography)
         values ($1, 'permanent', $2, $3, $4)
         returning id, label`,
        [
          memberId,
          input.label,
          slug,
          input.geographyWkt ?? 'SRID=4326;POINT(-121.4944 38.5816)',
        ],
      )
      const row = result.rows[0]
      if (!row) {
        throw new SellActionError(
          'Could not save the new Location.',
          'location_create_failed',
        )
      }
      return { id: row.id, label: row.label ?? input.label }
    })
  } catch (err) {
    if (err instanceof SellActionError) throw err
    throw new SellActionError(
      err instanceof Error ? err.message : 'Could not save the new Location.',
      'location_create_failed',
    )
  }
}
