// F038 — A producer lists a product fixture seed.
//
// Seeds the read-side state F038's Item page verifies: a producer (Maya) with
// an ACTIVE kind='business' Group ("Oak Park Sourdough"), an anchor pickup
// Location, and a set of published kind='product' Items exercising every
// acceptance beat:
//   PAID_GROUP   — priced, filed under the Group → brand resolve-up + owner,
//                  pickup, NO Locally Made badge (skip-provenance path).
//   FREE_GROUP   — price_cents NULL → page renders "Free".
//   INDIVIDUAL   — no Group filing → /m/<handle>/p/<slug>, brand_label NULL.
//   MADE_GROUP   — made_at_place_id set → Locally Made badge present (the
//                  positive control that locks the data-gated badge seam).
//   DRAFT_GROUP  — state='draft' → must 404 (RLS items_select_published gate).
//
// The composer (T078) addresses an Item by `toSlug(title)-<first 8 of id>`;
// the resolver (T079) matches the trailing id fragment. The fixture inserts
// each Item with an explicit id so the spec can build the deterministic URL.
//
// Distinct *-f038-test identities from F035/F036 on purpose — isolation under
// `fullyParallel: true`, same rationale as the F035 fixture. Auth users get a
// real bcrypt-hashed password via `eval_seed_auth_user_with_password` so the
// UI sign-in flow can grant a session for the /you/sell reachability beat.
//
// Idempotent across re-runs: identities resolve by stable handle; the Group,
// Location, and each Item resolve lookup-or-create by founder + brand / title.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { markMemberDiscoverable } from './_member-privacy'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const MAYA = {
  email: 'maya-f038@example.test',
  password: 'F038-test-password',
  handle: 'maya-f038-test',
  displayName: 'Maya Okafor',
} as const

export const SHOP = {
  brandName: 'Oak Park Sourdough',
  slug: 'oak-park-sourdough-f038',
  publicDescription: 'Naturally-leavened sourdough baked at home in Oak Park.',
  // resolveProduct() / resolveShop() resolve by group slug alone; the place
  // segments before /g/ are illustrative. We use the scenario's canonical path.
  placePath: '/p/ca/sacramento/oak-park',
} as const

const PICKUP_LABEL = "Maya's Oak Park Kitchen"

// toSlug mirrors src/lib/slugify.ts exactly (the composer builds the URL slug
// the same way). Kept inline so the fixture pulls in no server-only modules.
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface SeededProduct {
  itemId: string
  title: string
  /** Public Item URL: place-scoped /g/<group>/p/<slug> or /m/<handle>/p/<slug>. */
  url: string
}

export interface SeededF038Fixture {
  maya: { memberId: string }
  groupId: string
  paidGroup: SeededProduct
  freeGroup: SeededProduct
  individual: SeededProduct
  madeGroup: SeededProduct | null // null only if no place row was found to claim
  draftGroup: SeededProduct
}

let admin: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'F038-product fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars are required',
    )
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
  const sb = adminClient()
  const { data, error } = await sb
    .from('members')
    .select('id')
    .eq('handle', handle)
    .maybeSingle()
  if (error) throw new Error(`lookupMemberByHandle(${handle}): ${error.message}`)
  return data?.id ?? null
}

/** Find-or-create an auth user + members row with a hashed password. Resolves
 *  by stable handle so re-runs survive partial cleanups. Race-safe under
 *  parallel-worker beforeAll (mirrors the F035 fixture). */
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
  throw new Error(`ensureIdentity(${opts.handle}): exhausted retries resolving identity`)
}

async function ensureLocation(opts: {
  label: string
  founderMemberId: string
}): Promise<string> {
  const sb = adminClient()
  const { data: existing } = await sb
    .from('locations')
    .select('id')
    .eq('member_id', opts.founderMemberId)
    .eq('label', opts.label)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  const slug = `${toSlug(opts.label)}-${randomUUID().slice(0, 8)}`
  const { data, error } = await sb
    .from('locations')
    .insert({
      member_id: opts.founderMemberId,
      kind: 'permanent',
      label: opts.label,
      slug,
      geography: 'SRID=4326;POINT(-121.4944 38.5816)',
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`ensureLocation(${opts.label}): ${error?.message ?? 'no row'}`)
  }
  return data.id
}

/** Lookup-or-create an ACTIVE kind='business' Group + group_businesses +
 *  founder owner membership. Idempotent by founder + brand. */
async function ensureBusinessGroup(opts: {
  founderMemberId: string
  anchorLocationId: string
}): Promise<string> {
  const sb = adminClient()
  const lookup = async () =>
    (
      await sb
        .from('groups')
        .select('id, group_businesses!inner(display_name)')
        .eq('founder_member_id', opts.founderMemberId)
        .eq('kind', 'business')
        .eq('group_businesses.display_name', SHOP.brandName)
        .maybeSingle()
    ).data
  const existing = await lookup()
  if (existing) return existing.id

  const id = randomUUID()
  const { error: groupErr } = await sb.from('groups').insert({
    id,
    kind: 'business',
    founder_member_id: opts.founderMemberId,
    anchor_location_id: opts.anchorLocationId,
    name: SHOP.brandName,
    slug: SHOP.slug,
    description: '',
    discoverability: 'listed', // public-read RLS keys on listed + non-dissolved
    lifecycle_state: 'active',
  })
  if (groupErr) {
    if (isUniqueViolation(groupErr.message)) {
      await delay(200)
      const won = await lookup()
      if (won) return won.id
    }
    throw new Error(`ensureBusinessGroup groups: ${groupErr.message}`)
  }
  const { error: bizErr } = await sb.from('group_businesses').insert({
    group_id: id,
    display_name: SHOP.brandName,
    public_description: SHOP.publicDescription,
  })
  if (bizErr) throw new Error(`ensureBusinessGroup group_businesses: ${bizErr.message}`)
  const { error: memErr } = await sb.from('group_memberships').insert({
    group_id: id,
    member_id: opts.founderMemberId,
    role: 'owner',
    source: 'explicit',
  })
  if (memErr) throw new Error(`ensureBusinessGroup membership: ${memErr.message}`)
  return id
}

/** Lookup-or-create a kind='product' Item + item_products child + (optional)
 *  item_locations pickup. Idempotent by member + title. Builds the public URL
 *  the way the composer does: <scope>/p/<toSlug(title)>-<first 8 of id>. */
async function ensureProduct(opts: {
  founderMemberId: string
  founderHandle: string
  title: string
  description: string
  priceCents: number | null
  priceUnit: string | null
  groupId: string | null
  brandLabel: string | null
  pickupLocationId: string | null
  madeAtPlaceId: string | null
  state: 'draft' | 'published'
}): Promise<SeededProduct> {
  const sb = adminClient()

  let itemId: string
  const { data: existing } = await sb
    .from('items')
    .select('id')
    .eq('member_id', opts.founderMemberId)
    .eq('kind', 'product')
    .eq('title', opts.title)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    itemId = existing.id
  } else {
    itemId = randomUUID()
    const { error: itemErr } = await sb.from('items').insert({
      id: itemId,
      member_id: opts.founderMemberId,
      kind: 'product',
      group_id: opts.groupId,
      title: opts.title,
      description: opts.description,
      state: opts.state,
      brand_label: opts.brandLabel,
      made_at_place_id: opts.madeAtPlaceId,
    })
    if (itemErr) {
      if (isUniqueViolation(itemErr.message)) {
        const { data: won } = await sb
          .from('items')
          .select('id')
          .eq('member_id', opts.founderMemberId)
          .eq('kind', 'product')
          .eq('title', opts.title)
          .limit(1)
          .maybeSingle()
        if (won) itemId = won.id
        else throw new Error(`ensureProduct(${opts.title}) items: ${itemErr.message}`)
      } else {
        throw new Error(`ensureProduct(${opts.title}) items: ${itemErr.message}`)
      }
    }
    // item_products child (1:1, PK = item_id) — upsert-safe via ignore.
    const { error: prodErr } = await sb.from('item_products').insert({
      item_id: itemId,
      price_cents: opts.priceCents,
      price_unit: opts.priceUnit,
    })
    if (prodErr && !isUniqueViolation(prodErr.message)) {
      throw new Error(`ensureProduct(${opts.title}) item_products: ${prodErr.message}`)
    }
    if (opts.pickupLocationId) {
      const { error: locErr } = await sb.from('item_locations').insert({
        item_id: itemId,
        location_id: opts.pickupLocationId,
        schedule_kind: 'ongoing', // 'permanent' maps to 'ongoing' per T077 deviation
        status: 'approved',
      })
      if (locErr && !isUniqueViolation(locErr.message)) {
        throw new Error(`ensureProduct(${opts.title}) item_locations: ${locErr.message}`)
      }
    }
  }

  const slug = `${toSlug(opts.title)}-${itemId.slice(0, 8)}`
  const url = opts.groupId
    ? `${SHOP.placePath}/g/${SHOP.slug}/p/${slug}`
    : `/m/${opts.founderHandle}/p/${slug}`
  return { itemId, title: opts.title, url }
}

/** Look up a seeded place id to anchor a Locally Made claim (positive control
 *  for the badge seam). Returns null if no place row exists. */
async function lookupPlaceId(slug: string): Promise<string | null> {
  const sb = adminClient()
  const { data } = await sb
    .from('places')
    .select('id')
    .eq('slug', slug)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

/** Seed Maya, her active Shop, an anchor pickup, and the five product Items.
 *  Call from `test.beforeAll`. Idempotent across reruns. */
export async function seedF038Fixture(): Promise<SeededF038Fixture> {
  const mayaId = await ensureIdentity(MAYA)
  // T095 — opt Maya into discoverability so the Member-attribution-link beat
  // (Sell-as-individual) renders the link rather than plain text. The default
  // is false; we explicitly opt in for the eval.
  await markMemberDiscoverable(adminClient(), mayaId)
  const anchorId = await ensureLocation({
    label: PICKUP_LABEL,
    founderMemberId: mayaId,
  })
  const groupId = await ensureBusinessGroup({
    founderMemberId: mayaId,
    anchorLocationId: anchorId,
  })
  const madeAtPlaceId = await lookupPlaceId('oak-park')

  const paidGroup = await ensureProduct({
    founderMemberId: mayaId,
    founderHandle: MAYA.handle,
    title: 'Country Sourdough Loaf',
    description: 'A naturally-leavened country loaf, baked fresh each Saturday.',
    priceCents: 800,
    priceUnit: 'loaf',
    groupId,
    brandLabel: SHOP.brandName,
    pickupLocationId: anchorId,
    madeAtPlaceId: null, // skip-provenance: no Locally Made badge
    state: 'published',
  })

  const freeGroup = await ensureProduct({
    founderMemberId: mayaId,
    founderHandle: MAYA.handle,
    title: 'Day-Old Bread Share',
    description: 'Yesterday’s loaves, free to neighbors. First come, first served.',
    priceCents: null, // → "Free"
    priceUnit: null,
    groupId,
    brandLabel: SHOP.brandName,
    pickupLocationId: anchorId,
    madeAtPlaceId: null,
    state: 'published',
  })

  const individual = await ensureProduct({
    founderMemberId: mayaId,
    founderHandle: MAYA.handle,
    title: 'Homemade Granola Jar',
    description: 'Sold as an individual — no shop filing.',
    priceCents: 600,
    priceUnit: 'jar',
    groupId: null, // sells as individual → /m/<handle>/p/<slug>
    brandLabel: null,
    pickupLocationId: anchorId,
    madeAtPlaceId: null,
    state: 'published',
  })

  const madeGroup = madeAtPlaceId
    ? await ensureProduct({
        founderMemberId: mayaId,
        founderHandle: MAYA.handle,
        title: 'Heritage Rye Loaf',
        description: 'A claimed-provenance loaf (positive control for the badge).',
        priceCents: 900,
        priceUnit: 'loaf',
        groupId,
        brandLabel: SHOP.brandName,
        pickupLocationId: anchorId,
        madeAtPlaceId, // → Locally Made badge present
        state: 'published',
      })
    : null

  const draftGroup = await ensureProduct({
    founderMemberId: mayaId,
    founderHandle: MAYA.handle,
    title: 'Unpublished Test Loaf',
    description: 'Draft — must not resolve publicly.',
    priceCents: 700,
    priceUnit: 'loaf',
    groupId,
    brandLabel: SHOP.brandName,
    pickupLocationId: anchorId,
    madeAtPlaceId: null,
    state: 'draft', // RLS items_select_published must hide this → 404
  })

  return {
    maya: { memberId: mayaId },
    groupId,
    paidGroup,
    freeGroup,
    individual,
    madeGroup,
    draftGroup,
  }
}
