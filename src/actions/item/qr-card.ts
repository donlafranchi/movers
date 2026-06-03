// T093 — item.qr_card.request handler (F041)
// Source: development/tickets/T093-qr-card-lib-and-handler.md
// Spec:   planning/now/scenario-F041-producer-generates-qr-card.md;
//         product/systems/item.md (canonical URL, ADR-20 + ADR-22); ADR-10.
//
// Generates a print-quality QR PNG for one of the acting Member's own Items.
// Owner-only; refuses drafts/soft-deleted Items (QR cards are for findable
// Items). Resolves the Item's canonical URL — group-filed → place-scoped path,
// otherwise the owner's Member-scoped path — and logs item.qr_card_requested.
// The PNG is generated on demand and not persisted at b1.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import { AuthorizationError, ConflictError, NotFoundError } from '../_lib/errors'
import type { ActionContext } from '../_lib/context'
import {
  buildItemSlug,
  groupScopedItemPath,
  memberScopedItemPath,
  qrCardFilename,
  absoluteItemUrl,
  generateQrCardPng,
} from '@/lib/items/qr-card'

export const itemQrCardRequestInput = z.object({
  itemId: z.string().uuid(),
  /** Canonical origin to encode (e.g. https://movers-makers-shakers.com) so a
   *  printed/scanned card opens an absolute URL. Optional for origin-agnostic
   *  unit tests; the surface always supplies it. */
  baseUrl: z.string().url().optional(),
})

export type ItemQrCardRequestInput = z.infer<typeof itemQrCardRequestInput>

export interface ItemQrCardRequestResult {
  itemId: string
  kind: string
  /** The URL the QR encodes — absolute when a baseUrl was supplied, else the
   *  origin-relative canonical path. */
  url: string
  /** Base64-encoded PNG raster. */
  pngBase64: string
  filename: string
}

interface ItemRow {
  member_id: string
  kind: string
  state: string
  title: string
  group_id: string | null
}

export const itemQrCardRequest = defineHandler(
  'item.qr_card.request',
  itemQrCardRequestInput,
  async (
    ctx: ActionContext,
    input: ItemQrCardRequestInput,
  ): Promise<ItemQrCardRequestResult> => {
    const actingMemberId = ctx.actingMemberId
    if (actingMemberId === 'self-bootstrap') {
      throw new Error(
        'item.qr_card.request: actingMemberId must be resolved before invocation',
      )
    }

    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      const itemRes = await client.query<ItemRow>(
        `select member_id, kind, state, title, group_id
           from public.items
          where id = $1 and deleted_at is null`,
        [input.itemId],
      )
      const item = itemRes.rows[0]
      if (!item) {
        throw new NotFoundError(`item.qr_card.request: item ${input.itemId} not found`)
      }
      if (item.member_id !== actingMemberId) {
        throw new AuthorizationError(
          `item.qr_card.request: acting member ${actingMemberId} does not own item ${input.itemId}`,
        )
      }
      if (item.state !== 'published') {
        throw new ConflictError(
          `item.qr_card.request: item ${input.itemId} is not published (state=${item.state})`,
        )
      }

      const slug = buildItemSlug(item.title, input.itemId)
      const path = await resolveCanonicalUrl(client, {
        kind: item.kind,
        slug,
        groupId: item.group_id,
        memberId: item.member_id,
      })
      const url = absoluteItemUrl(path, input.baseUrl)

      const png = await generateQrCardPng(url)

      await appendEvent(txCtx, 'item_events', {
        item_id: input.itemId,
        event_kind: 'item.qr_card_requested',
        payload: { kind: item.kind, url },
      })

      return {
        itemId: input.itemId,
        kind: item.kind,
        url,
        pngBase64: png.toString('base64'),
        filename: qrCardFilename(item.kind, slug),
      }
    })
  },
)

/**
 * Resolve the Item's canonical URL. Group-filed Items nest under the place
 * path derived from the Group's anchor Location (mirrors the composer's
 * resolveDestinationUrl in you/sell/product/actions.ts); fall back to the
 * owner's Member-scoped path when there is no Group or the place is
 * unresolved, so every Item still has a working canonical URL.
 */
async function resolveCanonicalUrl(
  client: import('pg').PoolClient,
  args: { kind: string; slug: string; groupId: string | null; memberId: string },
): Promise<string> {
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
        return groupScopedItemPath({
          placePath,
          groupSlug: group.slug,
          kind: args.kind,
          slug: args.slug,
        })
      }
    }
  }

  const memberRes = await client.query<{ handle: string }>(
    `select handle from public.members where id = $1`,
    [args.memberId],
  )
  const handle = memberRes.rows[0]?.handle
  if (!handle) {
    throw new NotFoundError(
      `item.qr_card.request: owner ${args.memberId} has no handle to resolve a URL`,
    )
  }
  return memberScopedItemPath({ handle, kind: args.kind, slug: args.slug })
}
