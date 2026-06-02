'use server'

// T078 — Server actions for the product composer (F038).
// Spec:   planning/now/scenario-F038-producer-lists-product.md
// Ticket: development/tickets/T078-product-composer-surface.md
//
// Thin server-action wrapper around item.create (T077). Resolves the auth
// user, invokes the handler with publish=true (the F038 one-transaction
// path), then assembles the canonical Item URL the client redirects to:
//   - filed under a Group → /p/[…place]/g/[group-slug]/p/[item-slug]
//   - sold as individual  → /m/[handle]/p/[item-slug]
// Item slug = toSlug(title) + '-' + first 8 chars of the item id (the
// "random suffix" per ADR-22; items has no slug column at b1 — see
// T079 DEVIATIONS). The Item-page resolver parses the trailing fragment.

import { createClient } from '@/lib/supabase-server'
import { resolveActionContext } from '@/lib/action-context'
import { withTransaction } from '@/actions/_lib/db'
import { itemCreate, ActionError } from '@/actions'
import { toSlug } from '@/lib/slugify'

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
    throw new SellActionError('You must be signed in to list a product.', 'unauthenticated')
  }
  return data.user.id
}

function rethrow(err: unknown): never {
  if (err instanceof ActionError) throw new SellActionError(err.message, err.code)
  throw err
}

export interface CreateProductInput {
  groupId?: string
  title: string
  description: string
  priceCents: number | null
  priceUnit?: string
  locationId?: string
  madeAtPlaceId?: string
}

export async function createProductAction(
  input: CreateProductInput,
): Promise<{ itemId: string; destinationUrl: string }> {
  const memberId = await requireMemberId()
  const ctx = resolveActionContext({ actingMemberId: memberId })

  let itemId: string
  try {
    const result = await itemCreate(ctx, {
      memberId,
      kind: 'product',
      title: input.title,
      description: input.description,
      groupId: input.groupId,
      priceCents: input.priceCents,
      priceUnit: input.priceUnit,
      locationId: input.locationId,
      madeAtPlaceId: input.madeAtPlaceId,
      publish: true,
    })
    itemId = result.itemId
  } catch (err) {
    rethrow(err)
  }

  const itemSlug = `${toSlug(input.title) || 'product'}-${itemId.slice(0, 8)}`
  const destinationUrl = await resolveDestinationUrl({
    groupId: input.groupId,
    memberId,
    itemSlug,
  })
  return { itemId, destinationUrl }
}

/** Assemble the canonical Item URL. Group path reuses the place-resolution
 *  shape from sell/actions.ts (group slug + parent_id walk via place_for_coords
 *  on the anchor Location). Individual path uses the Member handle. */
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
          return `/p/${placePath}/g/${group.slug}/p/${args.itemSlug}`
        }
      }
      // Group filing but place unresolved — fall through to the Member path so
      // the product still has a working canonical URL.
    }

    const memberRes = await client.query<{ handle: string }>(
      `select handle from public.members where id = $1`,
      [args.memberId],
    )
    const handle = memberRes.rows[0]?.handle
    if (!handle) {
      throw new SellActionError(
        'Your product was published, but we could not resolve its URL. Refresh /you to see it.',
        'item_url_unresolved',
      )
    }
    return `/m/${handle}/p/${args.itemSlug}`
  })
}
