// F040 — A producer lists a service fixture seed.
//
// Seeds the read-side state F040's service Item page verifies: a producer (Tomas)
// with an ACTIVE kind='business' Group ("Riverside Piano Studio"), an optional
// anchor Location, and a set of published kind='service' Items exercising every
// acceptance beat:
//   PAID_GROUP  — flat rate, filed under the Group, with a service area + anchor
//                 → brand resolve-up + owner + service-area section.
//   FREE_GROUP  — rate_cents NULL (model 'flat') → page renders "Free".
//   QUOTE_GROUP — rate_model 'quote' → page renders "Request a quote".
//   INDIVIDUAL  — no Group filing → /m/<handle>/s/<slug>, brand_label NULL.
//   DRAFT_GROUP — state='draft' → must 404 (RLS items_select_published gate).
//
// Mirrors the F038 product fixture exactly (identity / Group / Item helpers,
// idempotent lookup-or-create, race-safe under parallel-worker beforeAll). The
// key F040 differences: kind='service', the item_services child (rate_model /
// rate_cents / service_area_geography Polygon) instead of item_products, and the
// `/s/` URL segment instead of `/p/`. The shipped rate_model enum is
// hourly|flat|quote|membership (per the T081 SPEC-PATCHES deviation) — there is
// no 'free' value; a free service is rate_model='flat' with rate_cents NULL.
//
// Distinct *-f040-test identities from F035/F036/F038 on purpose — isolation
// under `fullyParallel: true`.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const TOMAS = {
  email: 'tomas-f040@example.test',
  password: 'F040-test-password',
  handle: 'tomas-f040-test',
  displayName: 'Tomas Reyes',
} as const

export const STUDIO = {
  brandName: 'Riverside Piano Studio',
  slug: 'riverside-piano-studio-f040',
  publicDescription: 'In-home and studio piano lessons across Sacramento.',
  // resolveService() resolves by group slug alone; the place segments before /g/
  // are illustrative. We use the scenario's canonical-shaped path.
  placePath: '/p/ca/sacramento/midtown',
} as const

const ANCHOR_LABEL = "Tomas's Midtown Studio"

// A small WGS84 polygon around midtown Sacramento — the service_area_geography
// column is geography(Polygon, 4326); its presence drives the area section.
const SERVICE_AREA_WKT =
  'SRID=4326;POLYGON((-121.50 38.55, -121.45 38.55, -121.45 38.60, -121.50 38.60, -121.50 38.55))'

// toSlug mirrors src/lib/slugify.ts exactly (the composer builds the URL slug
// the same way). Kept inline so the fixture pulls in no server-only modules.
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface SeededService {
  itemId: string
  title: string
  /** Public Item URL: place-scoped /g/<group>/s/<slug> or /m/<handle>/s/<slug>. */
  url: string
}

export interface SeededF040Fixture {
  tomas: { memberId: string }
  groupId: string
  paidGroup: SeededService
  freeGroup: SeededService
  quoteGroup: SeededService
  individual: SeededService
  draftGroup: SeededService
}

let admin: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'F040-service fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars are required',
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
 *  parallel-worker beforeAll (mirrors the F038 fixture). */
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
      geography: 'SRID=4326;POINT(-121.4750 38.5750)',
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
        .eq('group_businesses.display_name', STUDIO.brandName)
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
    name: STUDIO.brandName,
    slug: STUDIO.slug,
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
    display_name: STUDIO.brandName,
    public_description: STUDIO.publicDescription,
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

/** Lookup-or-create a kind='service' Item + item_services child + (optional)
 *  item_locations anchor. Idempotent by member + title. Builds the public URL
 *  the way the composer does: <scope>/s/<toSlug(title)>-<first 8 of id>. */
async function ensureService(opts: {
  founderMemberId: string
  founderHandle: string
  title: string
  description: string
  rateModel: 'hourly' | 'flat' | 'quote' | 'membership'
  rateCents: number | null
  serviceAreaWkt: string | null
  groupId: string | null
  brandLabel: string | null
  anchorLocationId: string | null
  state: 'draft' | 'published'
}): Promise<SeededService> {
  const sb = adminClient()

  let itemId: string
  const { data: existing } = await sb
    .from('items')
    .select('id')
    .eq('member_id', opts.founderMemberId)
    .eq('kind', 'service')
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
      kind: 'service',
      group_id: opts.groupId,
      title: opts.title,
      description: opts.description,
      state: opts.state,
      brand_label: opts.brandLabel,
    })
    if (itemErr) {
      if (isUniqueViolation(itemErr.message)) {
        const { data: won } = await sb
          .from('items')
          .select('id')
          .eq('member_id', opts.founderMemberId)
          .eq('kind', 'service')
          .eq('title', opts.title)
          .limit(1)
          .maybeSingle()
        if (won) itemId = won.id
        else throw new Error(`ensureService(${opts.title}) items: ${itemErr.message}`)
      } else {
        throw new Error(`ensureService(${opts.title}) items: ${itemErr.message}`)
      }
    }
    // item_services child (1:1, PK = item_id).
    const { error: svcErr } = await sb.from('item_services').insert({
      item_id: itemId,
      rate_model: opts.rateModel,
      rate_cents: opts.rateCents,
      service_area_geography: opts.serviceAreaWkt,
    })
    if (svcErr && !isUniqueViolation(svcErr.message)) {
      throw new Error(`ensureService(${opts.title}) item_services: ${svcErr.message}`)
    }
    if (opts.anchorLocationId) {
      const { error: locErr } = await sb.from('item_locations').insert({
        item_id: itemId,
        location_id: opts.anchorLocationId,
        schedule_kind: 'ongoing', // 'permanent' maps to 'ongoing' per T077 deviation
        status: 'approved',
      })
      if (locErr && !isUniqueViolation(locErr.message)) {
        throw new Error(`ensureService(${opts.title}) item_locations: ${locErr.message}`)
      }
    }
  }

  const slug = `${toSlug(opts.title)}-${itemId.slice(0, 8)}`
  const url = opts.groupId
    ? `${STUDIO.placePath}/g/${STUDIO.slug}/s/${slug}`
    : `/m/${opts.founderHandle}/s/${slug}`
  return { itemId, title: opts.title, url }
}

/** Seed Tomas, his active Studio, an anchor Location, and the five service Items.
 *  Call from `test.beforeAll`. Idempotent across reruns. */
export async function seedF040Fixture(): Promise<SeededF040Fixture> {
  const tomasId = await ensureIdentity(TOMAS)
  const anchorId = await ensureLocation({
    label: ANCHOR_LABEL,
    founderMemberId: tomasId,
  })
  const groupId = await ensureBusinessGroup({
    founderMemberId: tomasId,
    anchorLocationId: anchorId,
  })

  const paidGroup = await ensureService({
    founderMemberId: tomasId,
    founderHandle: TOMAS.handle,
    title: 'Piano Lessons — 30 min',
    description: 'Beginner-to-intermediate piano lessons, in-home or at the studio.',
    rateModel: 'flat',
    rateCents: 5000,
    serviceAreaWkt: SERVICE_AREA_WKT,
    groupId,
    brandLabel: STUDIO.brandName,
    anchorLocationId: anchorId,
    state: 'published',
  })

  const freeGroup = await ensureService({
    founderMemberId: tomasId,
    founderHandle: TOMAS.handle,
    title: 'Free Intro Consultation',
    description: 'A free 15-minute consult to assess goals and fit.',
    rateModel: 'flat',
    rateCents: null, // → "Free"
    serviceAreaWkt: SERVICE_AREA_WKT,
    groupId,
    brandLabel: STUDIO.brandName,
    anchorLocationId: anchorId,
    state: 'published',
  })

  const quoteGroup = await ensureService({
    founderMemberId: tomasId,
    founderHandle: TOMAS.handle,
    title: 'Recital Accompaniment',
    description: 'Custom accompaniment for recitals and events — priced per engagement.',
    rateModel: 'quote', // → "Request a quote"
    rateCents: null,
    serviceAreaWkt: SERVICE_AREA_WKT,
    groupId,
    brandLabel: STUDIO.brandName,
    anchorLocationId: null,
    state: 'published',
  })

  const individual = await ensureService({
    founderMemberId: tomasId,
    founderHandle: TOMAS.handle,
    title: 'Music Theory Tutoring',
    description: 'Sold as an individual — no studio filing.',
    rateModel: 'hourly',
    rateCents: 4000,
    serviceAreaWkt: SERVICE_AREA_WKT,
    groupId: null, // sells as individual → /m/<handle>/s/<slug>
    brandLabel: null,
    anchorLocationId: null,
    state: 'published',
  })

  const draftGroup = await ensureService({
    founderMemberId: tomasId,
    founderHandle: TOMAS.handle,
    title: 'Unpublished Test Service',
    description: 'Draft — must not resolve publicly.',
    rateModel: 'flat',
    rateCents: 3000,
    serviceAreaWkt: SERVICE_AREA_WKT,
    groupId,
    brandLabel: STUDIO.brandName,
    anchorLocationId: anchorId,
    state: 'draft', // RLS items_select_published must hide this → 404
  })

  return {
    tomas: { memberId: tomasId },
    groupId,
    paidGroup,
    freeGroup,
    quoteGroup,
    individual,
    draftGroup,
  }
}
