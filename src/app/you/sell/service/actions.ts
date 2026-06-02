'use server'

// T082 — Server actions for the service composer (F040).
// Spec:   planning/now/scenario-F040-producer-lists-service.md
// Ticket: development/tickets/T082-service-composer-surface.md
//
// Thin server-action wrapper around item.create (T077/T080/T081). Resolves the
// auth user, resolves the center Location's coords for the service-area circle,
// invokes the handler with kind='service' + publish=true (the F040
// one-transaction path), then assembles the canonical Item URL:
//   - filed under a Group → /p/[…place]/g/[group-slug]/s/[item-slug]
//   - sold as individual  → /m/[handle]/s/[item-slug]
// Item slug = toSlug(title)-<first 8 of itemId> (mirror T078).

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import { withTransaction } from '@/actions/_lib/db'
import { itemCreate, ActionError } from '@/actions'
import { toSlug } from '@/lib/slugify'
import type { RateModel } from '@/components/sell/ServiceComposer'

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
    throw new SellActionError('You must be signed in to list a service.', 'unauthenticated')
  }
  return data.user.id
}

function rethrow(err: unknown): never {
  if (err instanceof ActionError) throw new SellActionError(err.message, err.code)
  throw err
}

export interface CreateServiceInput {
  groupId?: string
  title: string
  description: string
  rateModel: RateModel
  rateCents: number | null
  /** Center of the service-area circle (and the anchor Location). */
  centerLocationId?: string
  /** Service-area radius in meters. */
  radiusMeters?: number
}

export async function createServiceAction(
  input: CreateServiceInput,
): Promise<{ itemId: string; destinationUrl: string }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })

  // Resolve the center Location's coords so item.create can buffer the circle.
  let centerLat: number | undefined
  let centerLon: number | undefined
  if (input.centerLocationId && input.radiusMeters) {
    const coords = await resolveLocationCoords(input.centerLocationId)
    if (coords) {
      centerLat = coords.lat
      centerLon = coords.lon
    }
  }

  let itemId: string
  try {
    const result = await itemCreate(ctx, {
      memberId,
      kind: 'service',
      title: input.title,
      description: input.description,
      groupId: input.groupId,
      rateModel: input.rateModel,
      rateCents: input.rateCents,
      locationId: input.centerLocationId,
      serviceAreaCenterLat: centerLat,
      serviceAreaCenterLon: centerLon,
      serviceAreaRadiusMeters:
        centerLat != null && centerLon != null ? input.radiusMeters : undefined,
      publish: true,
    })
    itemId = result.itemId
  } catch (err) {
    rethrow(err)
  }

  const itemSlug = `${toSlug(input.title) || 'service'}-${itemId.slice(0, 8)}`
  const destinationUrl = await resolveDestinationUrl({
    groupId: input.groupId,
    memberId,
    itemSlug,
  })
  return { itemId, destinationUrl }
}

/** Extract the center point (lat, lon) from a Location's geography. */
async function resolveLocationCoords(
  locationId: string,
): Promise<{ lat: number; lon: number } | null> {
  return withTransaction(async (client) => {
    const res = await client.query<{ lat: number | null; lon: number | null }>(
      `select st_y(geography::geometry) as lat, st_x(geography::geometry) as lon
         from public.locations where id = $1`,
      [locationId],
    )
    const row = res.rows[0]
    if (!row || row.lat == null || row.lon == null) return null
    return { lat: row.lat, lon: row.lon }
  })
}

/** Assemble the canonical Item URL. Mirrors product/actions.ts but appends the
 *  `/s/` service segment. Group path reuses the place-resolution shape from
 *  sell/actions.ts (group slug + parent_id walk via place_for_coords). */
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
          return `/p/${placePath}/g/${group.slug}/s/${args.itemSlug}`
        }
      }
      // Group filing but place unresolved — fall through to the Member path.
    }

    const memberRes = await client.query<{ handle: string }>(
      `select handle from public.members where id = $1`,
      [args.memberId],
    )
    const handle = memberRes.rows[0]?.handle
    if (!handle) {
      throw new SellActionError(
        'Your service was published, but we could not resolve its URL. Refresh /you to see it.',
        'item_url_unresolved',
      )
    }
    return `/m/${handle}/s/${args.itemSlug}`
  })
}
