// F030 — Newcomer signup + locality feed fixture.
//
// Seeds the read-side state F030 verifies:
//   - A producer Member ("Sam") with a Location inside a test Place polygon,
//     and two PUBLISHED Items (a product + a gathering) attached to that
//     Location — so the locality feed has rows near the Place.
//   - A test Place ("Oak Park (F030)") with a polygon covering the Location,
//     plus a barren Place ("Quietville (F030)") whose polygon holds no Items
//     (empty-state test).
//   - A fresh newcomer Member ("Nadia") with a hashed password and NO
//     primary_home — the onboarding flow's subject. Signs in via the UI, then
//     completes /onboarding.
//
// The fixture seeds its own Place polygon so it does not depend on the
// unmerged T076 region-polygon seed. The MV (discoverable_items) is refreshed
// by inserting an item.published event row (the 016 trigger).
//
// Idempotent across reruns: identities resolve by stable handle; Places /
// Locations / Items resolve lookup-or-create by slug / label / title.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const SAM = {
  email: 'sam-f030@example.test',
  password: 'F030-test-password',
  handle: 'sam-f030-test',
  displayName: 'Sam Rivera',
} as const

export const NADIA = {
  email: 'nadia-f030@example.test',
  password: 'F030-test-password',
  handle: 'nadia-f030-test',
  displayName: 'Nadia Okonkwo',
} as const

// A point in Oak Park, Sacramento, and a polygon comfortably around it.
const FEED_POINT = { lon: -121.4794, lat: 38.5449 }
export const OAK_PARK_F030 = {
  slug: 'oak-park-f030',
  displayName: 'Oak Park (F030)',
} as const
export const BARREN_F030 = {
  slug: 'quietville-f030',
  displayName: 'Quietville (F030)',
} as const

// Two published Items the feed should surface near OAK_PARK_F030.
export const PRODUCT = { title: 'Oak Park Sourdough Loaf (F030)' } as const
export const GATHERING = { title: 'Drake’s Pottery Night (F030)' } as const

export interface SeededF030Fixture {
  samId: string
  nadiaId: string
  oakParkPlaceId: string
  barrenPlaceId: string
  locationId: string
  productItemId: string
  gatheringItemId: string
}

let admin: SupabaseClient | null = null
function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('F030 fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required')
  }
  if (!admin) {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return admin
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const isUniqueViolation = (msg: string) =>
  /duplicate key|already exists|unique constraint/i.test(msg)

async function lookupMemberByHandle(handle: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from('members')
    .select('id')
    .eq('handle', handle)
    .maybeSingle()
  if (error) throw new Error(`lookupMemberByHandle(${handle}): ${error.message}`)
  return data?.id ?? null
}

async function ensureIdentity(opts: {
  email: string
  password: string
  handle: string
  displayName: string
}): Promise<string> {
  const sb = adminClient()
  for (let attempt = 0; attempt < 12; attempt++) {
    const existingId = await lookupMemberByHandle(opts.handle)
    if (existingId) {
      await sb.rpc('eval_seed_auth_user_with_password', {
        p_id: existingId,
        p_email: opts.email,
        p_password: opts.password,
      })
      return existingId
    }
    const id = randomUUID()
    const { data, error } = await sb.rpc('eval_seed_auth_user_with_password', {
      p_id: id,
      p_email: opts.email,
      p_password: opts.password,
    })
    if (error) {
      if (isUniqueViolation(error.message)) {
        await delay(200)
        continue
      }
      throw new Error(`ensureIdentity(${opts.email}): ${error.message}`)
    }
    const authId = (data as string | null) ?? id
    const { error: memErr } = await sb
      .from('members')
      .insert({ id: authId, handle: opts.handle, display_name: opts.displayName })
    if (memErr) {
      if (isUniqueViolation(memErr.message)) {
        await delay(200)
        continue
      }
      throw new Error(`ensureIdentity(${opts.handle}) member insert: ${memErr.message}`)
    }
    return authId
  }
  throw new Error(`ensureIdentity(${opts.handle}): exhausted retries`)
}

async function sacramentoCityId(): Promise<string> {
  const sb = adminClient()
  const { data, error } = await sb
    .from('places')
    .select('id, kind, parent_id, places!parent_id(slug)')
    .eq('slug', 'sacramento')
    .eq('kind', 'city')
  if (error) throw new Error(`sacramentoCityId: ${error.message}`)
  const row = (data ?? [])[0] as { id: string } | undefined
  if (!row) throw new Error('sacramentoCityId: seed missing (run migrations 017 first)')
  return row.id
}

/** Box polygon (MultiPolygon, SRID 4326) around a center point. */
function boxMultiPolygon(lon: number, lat: number, half = 0.04): string {
  const x0 = lon - half
  const x1 = lon + half
  const y0 = lat - half
  const y1 = lat + half
  return `SRID=4326;MULTIPOLYGON(((${x0} ${y0}, ${x1} ${y0}, ${x1} ${y1}, ${x0} ${y1}, ${x0} ${y0})))`
}

async function ensurePlace(opts: {
  parentId: string
  slug: string
  displayName: string
  lon: number
  lat: number
}): Promise<string> {
  const sb = adminClient()
  const { data: existing } = await sb
    .from('places')
    .select('id')
    .eq('parent_id', opts.parentId)
    .eq('slug', opts.slug)
    .maybeSingle()
  const geography = boxMultiPolygon(opts.lon, opts.lat)
  if (existing) {
    await sb.from('places').update({ geography }).eq('id', existing.id)
    return existing.id
  }
  const { data, error } = await sb
    .from('places')
    .insert({
      parent_id: opts.parentId,
      slug: opts.slug,
      display_name: opts.displayName,
      kind: 'neighborhood',
      geography,
    })
    .select('id')
    .single()
  if (error || !data) {
    if (error && isUniqueViolation(error.message)) {
      const { data: won } = await sb
        .from('places')
        .select('id')
        .eq('parent_id', opts.parentId)
        .eq('slug', opts.slug)
        .maybeSingle()
      if (won) return won.id
    }
    throw new Error(`ensurePlace(${opts.slug}): ${error?.message ?? 'no row'}`)
  }
  return data.id
}

async function ensureLocation(opts: {
  label: string
  memberId: string
  lon: number
  lat: number
}): Promise<string> {
  const sb = adminClient()
  const { data: existing } = await sb
    .from('locations')
    .select('id')
    .eq('member_id', opts.memberId)
    .eq('label', opts.label)
    .maybeSingle()
  if (existing) return existing.id
  const slug = `${opts.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${randomUUID().slice(0, 8)}`
  const { data, error } = await sb
    .from('locations')
    .insert({
      member_id: opts.memberId,
      kind: 'permanent',
      label: opts.label,
      slug,
      geography: `SRID=4326;POINT(${opts.lon} ${opts.lat})`,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`ensureLocation(${opts.label}): ${error?.message ?? 'no row'}`)
  return data.id
}

/** Seed a published Item (individual; no group) attached to a Location, and
 *  fire item.published so the discoverable_items MV refreshes. */
async function ensurePublishedItem(opts: {
  memberId: string
  kind: 'product' | 'gathering'
  title: string
  category: string
  locationId: string
  primaryTag: string
}): Promise<string> {
  const sb = adminClient()
  const { data: existing } = await sb
    .from('items')
    .select('id')
    .eq('member_id', opts.memberId)
    .eq('title', opts.title)
    .maybeSingle()
  let itemId = existing?.id as string | undefined

  if (!itemId) {
    itemId = randomUUID()
    const { error } = await sb.from('items').insert({
      id: itemId,
      member_id: opts.memberId,
      kind: opts.kind,
      title: opts.title,
      state: 'published',
      category: opts.category,
    })
    if (error) throw new Error(`ensurePublishedItem(${opts.title}) items: ${error.message}`)

    if (opts.kind === 'product') {
      await sb.from('item_products').insert({ item_id: itemId, price_cents: 800, price_unit: 'loaf' })
    } else {
      await sb.from('item_gatherings').insert({
        item_id: itemId,
        host_member_id: opts.memberId,
        starts_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
        recurrence_rule: 'FREQ=WEEKLY',
      })
    }
    await sb.from('item_locations').insert({ item_id: itemId, location_id: opts.locationId, status: 'approved' })
    await sb.from('item_tags').insert({ item_id: itemId, tag: opts.primaryTag })
  }

  // Fire the MV refresh trigger (016): AFTER INSERT on item_events where
  // event_kind='item.published'. Idempotent enough for re-runs.
  await sb.from('item_events').insert({
    item_id: itemId,
    event_kind: 'item.published',
    acting_member_id: opts.memberId,
    payload: { seeded_by: 'F030-fixture' },
  })
  return itemId
}

export async function seedF030Fixture(): Promise<SeededF030Fixture> {
  const samId = await ensureIdentity(SAM)
  const nadiaId = await ensureIdentity(NADIA)
  const sacId = await sacramentoCityId()

  const oakParkPlaceId = await ensurePlace({
    parentId: sacId,
    slug: OAK_PARK_F030.slug,
    displayName: OAK_PARK_F030.displayName,
    lon: FEED_POINT.lon,
    lat: FEED_POINT.lat,
  })
  // Barren Place: polygon far from the Location → no Items.
  const barrenPlaceId = await ensurePlace({
    parentId: sacId,
    slug: BARREN_F030.slug,
    displayName: BARREN_F030.displayName,
    lon: -120.0,
    lat: 39.5,
  })

  const locationId = await ensureLocation({
    label: "Sam's Oak Park Stand (F030)",
    memberId: samId,
    lon: FEED_POINT.lon,
    lat: FEED_POINT.lat,
  })

  const productItemId = await ensurePublishedItem({
    memberId: samId,
    kind: 'product',
    title: PRODUCT.title,
    category: 'food',
    locationId,
    primaryTag: 'food-drink',
  })
  const gatheringItemId = await ensurePublishedItem({
    memberId: samId,
    kind: 'gathering',
    title: GATHERING.title,
    category: 'crafts',
    locationId,
    primaryTag: 'crafts',
  })

  return {
    samId,
    nadiaId,
    oakParkPlaceId,
    barrenPlaceId,
    locationId,
    productItemId,
    gatheringItemId,
  }
}
