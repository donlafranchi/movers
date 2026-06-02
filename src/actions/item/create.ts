// T077 — item.create handler
// Source: development/tickets/T077-item-action-handlers.md § item.create
// Spec:   product/systems/item.md § Data model implications;
//         product/systems/action-layer.md § Same-transaction row+event invariant (ADR-10)
//
// Creates a kind='product' Item with its item_products child, optionally an
// item_locations pickup row, optionally publishes it — all in one transaction.
// Emits item.created (+ item.location_attached when a Location is attached,
// + item.published when published) in the same transaction (ADR-10).
//
// brand_label is derived from the filed Group's group_businesses.display_name
// so the Item page's "brand resolve-up" renders the moment the Item publishes.
// When no Group is filed (sell-as-individual), brand_label stays null.
//
// Only kind='product' ships at b1; the spine reserves the other kinds. The
// product composer (F038) is the only caller at b1.

import { z } from 'zod'
import { defineHandler } from '../_lib/handler'
import { withTransaction } from '../_lib/db'
import { appendEvent } from '../_lib/event-log'
import { AuthorizationError } from '../_lib/errors'
import type { ActionContext } from '../_lib/context'

// item_locations.schedule_kind CHECK vocabulary (per 015_items.sql). A
// "permanent pickup point" (F038 Data-Captured) maps to 'ongoing' — see the
// T077 DEVIATIONS entry; 'permanent' is not a valid schedule_kind.
const SCHEDULE_KINDS = ['one_time', 'recurring', 'ongoing', 'by_appointment'] as const

export const itemCreateInput = z.object({
  memberId: z.string().uuid(),
  // b1 ships products only; the spine reserves service/gathering/wonder/etc.
  kind: z.literal('product'),
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  groupId: z.string().uuid().optional(),
  // null = free product (renders "Free"); omitted = also free.
  priceCents: z.number().int().min(0).nullable().optional(),
  priceUnit: z.string().max(40).optional(),
  photoUrls: z.array(z.string()).optional(),
  locationId: z.string().uuid().optional(),
  // Defaults to 'ongoing' in the body (see SCHEDULE_KINDS note).
  scheduleKind: z.enum(SCHEDULE_KINDS).optional(),
  // F039 territory; F038 skip-path leaves this undefined.
  madeAtPlaceId: z.string().uuid().optional(),
  publish: z.boolean().optional(),
})

export type ItemCreateInput = z.infer<typeof itemCreateInput>

export interface ItemCreateResult {
  itemId: string
  state: 'draft' | 'published'
}

export const itemCreate = defineHandler(
  'item.create',
  itemCreateInput,
  async (ctx: ActionContext, input: ItemCreateInput): Promise<ItemCreateResult> => {
    return withTransaction(async (client) => {
      const txCtx: ActionContext = { ...ctx, db: client }

      // brand_label resolve-up + owner authorization for a Group filing.
      let brandLabel: string | null = null
      if (input.groupId) {
        // Caller must be an active owner-role member of the business Group.
        const ownerRes = await client.query<{ ok: boolean }>(
          `select true as ok
             from public.group_memberships gm
             join public.groups g on g.id = gm.group_id
            where gm.group_id = $1
              and gm.member_id = $2
              and gm.role = 'owner'
              and gm.left_at is null
              and g.kind = 'business'`,
          [input.groupId, input.memberId],
        )
        if (ownerRes.rows.length === 0) {
          throw new AuthorizationError(
            `item.create: member ${input.memberId} is not an active owner of business group ${input.groupId}`,
          )
        }
        const bizRes = await client.query<{ display_name: string }>(
          `select display_name from public.group_businesses where group_id = $1`,
          [input.groupId],
        )
        brandLabel = bizRes.rows[0]?.display_name ?? null
      }

      const state = input.publish ? 'published' : 'draft'

      // Spine row.
      const itemRes = await client.query<{ id: string }>(
        `insert into public.items
           (member_id, kind, group_id, title, description, brand_label, state, made_at_place_id)
         values ($1, 'product', $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          input.memberId,
          input.groupId ?? null,
          input.title,
          input.description ?? '',
          brandLabel,
          state,
          input.madeAtPlaceId ?? null,
        ],
      )
      const itemId = itemRes.rows[0]?.id
      if (!itemId) {
        throw new Error('item.create: insert returned no row')
      }

      // Product child.
      await client.query(
        `insert into public.item_products (item_id, price_cents, price_unit, photo_urls)
         values ($1, $2, $3, $4)`,
        [
          itemId,
          input.priceCents ?? null,
          input.priceUnit ?? null,
          input.photoUrls ?? [],
        ],
      )

      // item.created — always.
      await appendEvent(txCtx, 'item_events', {
        item_id: itemId,
        event_kind: 'item.created',
        payload: {
          kind: 'product',
          group_id: input.groupId ?? null,
          state,
        },
      })

      // Optional pickup Location attachment.
      if (input.locationId) {
        const scheduleKind = input.scheduleKind ?? 'ongoing'
        await client.query(
          `insert into public.item_locations (item_id, location_id, schedule_kind, status)
           values ($1, $2, $3, 'approved')`,
          [itemId, input.locationId, scheduleKind],
        )
        await appendEvent(txCtx, 'item_events', {
          item_id: itemId,
          event_kind: 'item.location_attached',
          payload: {
            location_id: input.locationId,
            schedule_kind: scheduleKind,
          },
        })
      }

      // Publish event (state was set to 'published' on the spine insert above).
      if (input.publish) {
        await appendEvent(txCtx, 'item_events', {
          item_id: itemId,
          event_kind: 'item.published',
          payload: { from_state: 'draft' },
        })
      }

      return { itemId, state }
    })
  },
)
