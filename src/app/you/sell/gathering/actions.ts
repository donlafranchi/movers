'use server'

// T081 — Server action for the gathering composer (F034).
// Spec:   planning/now/scenario-F034-member-hosts-recurring-gathering.md
// Ticket: development/tickets/T081-gathering-composer-surface.md
//
// Thin server-action wrapper around item.create (T080 gathering arm). Resolves
// the auth user, invokes the handler with kind='gathering' + publish=true (the
// F034 one-transaction path), maps the user-language kind to schedule_kind,
// then assembles the canonical Item URL the client redirects to:
//   - filed under a Group → /p/[…place]/g/[group-slug]/e/[item-slug]
//   - hosted as a Member  → /m/[handle]/e/[item-slug]
// Item slug = toSlug(title) + '-' + first 8 chars of the item id (the "random
// suffix" per ADR-22; items has no slug column at b1 — see T079 DEVIATIONS).

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import { withTransaction } from '@/actions/_lib/db'
import { itemCreate, ActionError } from '@/actions'
import { toSlug } from '@/lib/slugify'

type GatheringKind = 'one_time' | 'recurring' | 'open_meetup'

class GatheringActionError extends Error {
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
    throw new GatheringActionError('You must be signed in to host a gathering.', 'unauthenticated')
  }
  return data.user.id
}

function rethrow(err: unknown): never {
  if (err instanceof ActionError) throw new GatheringActionError(err.message, err.code)
  throw err
}

// User-language kind → item_locations.schedule_kind (one_time|recurring|ongoing).
const SCHEDULE_KIND: Record<GatheringKind, 'one_time' | 'recurring' | 'ongoing'> = {
  one_time: 'one_time',
  recurring: 'recurring',
  open_meetup: 'ongoing',
}

export interface CreateGatheringInput {
  groupId?: string
  title: string
  description: string
  gatheringKind: GatheringKind
  startsAt?: string
  recurrenceRule?: string
  capacity?: number
  costCents?: number | null
  whatToBring?: string
  locationId?: string
}

export async function createGatheringAction(
  input: CreateGatheringInput,
): Promise<{ itemId: string; destinationUrl: string }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })

  let itemId: string
  try {
    const result = await itemCreate(ctx, {
      memberId,
      kind: 'gathering',
      title: input.title,
      description: input.description,
      groupId: input.groupId,
      locationId: input.locationId,
      scheduleKind: input.locationId ? SCHEDULE_KIND[input.gatheringKind] : undefined,
      startsAt: input.startsAt,
      recurrenceRule: input.recurrenceRule,
      capacity: input.capacity ?? null,
      costCents: input.costCents ?? null,
      whatToBring: input.whatToBring,
      publish: true,
    })
    itemId = result.itemId
  } catch (err) {
    rethrow(err)
  }

  const itemSlug = `${toSlug(input.title) || 'gathering'}-${itemId.slice(0, 8)}`
  const destinationUrl = await resolveDestinationUrl({
    groupId: input.groupId,
    memberId,
    itemSlug,
  })
  return { itemId, destinationUrl }
}

/** Assemble the canonical Item URL. Group path mirrors the product action
 *  (group slug + parent_id walk via place_for_coords on the anchor Location),
 *  swapping the `/p/` resource segment for `/e/`. Member path uses the handle. */
async function resolveDestinationUrl(args: {
  groupId?: string
  memberId: string
  itemSlug: string
}): Promise<string> {
  return withTransaction(async (client) => {
    if (args.groupId) {
      const groupRes = await client.query<{ slug: string; anchor_location_id: string | null }>(
        `select slug, anchor_location_id from public.groups where id = $1`,
        [args.groupId],
      )
      const group = groupRes.rows[0]
      if (group?.slug && group.anchor_location_id) {
        const pathRes = await client.query<{ path: string | null }>(
          `with recursive chain(id, slug, parent_id, depth) as (
             select p.id, p.slug, p.parent_id, 0
               from public.places p
               join public.locations l on l.id = $1
              where p.id = (public.place_for_coords(
                              st_y(l.geography::geometry),
                              st_x(l.geography::geometry))).place_id
             union all
             select p.id, p.slug, p.parent_id, c.depth + 1
               from public.places p join chain c on p.id = c.parent_id
           )
           select string_agg(slug, '/' order by depth desc) as path from chain`,
          [group.anchor_location_id],
        )
        const placePath = pathRes.rows[0]?.path
        if (placePath) {
          return `/p/${placePath}/g/${group.slug}/e/${args.itemSlug}`
        }
      }
    }

    const memberRes = await client.query<{ handle: string }>(
      `select handle from public.members where id = $1`,
      [args.memberId],
    )
    const handle = memberRes.rows[0]?.handle
    if (!handle) {
      throw new GatheringActionError(
        'Your gathering was published, but we could not resolve its URL. Refresh /you to see it.',
        'item_url_unresolved',
      )
    }
    return `/m/${handle}/e/${args.itemSlug}`
  })
}
