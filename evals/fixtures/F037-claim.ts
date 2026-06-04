// F037 — Maya claims Locally Owned fixture seed.
//
// Seeds the owner-management state F037 verifies: an ACTIVE kind='business'
// Group ("Oak Park Sourdough — F037") owned by Maya, anchored to a Location
// whose `place_id` resolves to the `oak-park` neighborhood Place (msa_code
// 40900 per migration 025/026). That anchor is the key delta from F035 — the
// proximity function joins locations.place_id → places.msa_code, so without a
// stamped place_id the badge could never light. Rosa is a separate logged-in
// NON-owner for beat 6.
//
// Maya starts with NO jurisdiction row (empty-state entry for beat 2). Tests
// drive set/edit/remove through the UI; `resetJurisdiction` restores the empty
// state between tests (the suite runs serial — all beats mutate the one
// (member, group) active row guarded by ux_jurisdiction_member_group_active).
//
// Auth users get a real bcrypt-hashed password via the
// `eval_seed_auth_user_with_password` RPC so helpers/auth.ts → /auth/login can
// grant a session. Idempotent across reruns (resolve by stable handle / slug).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const MAYA = {
  email: 'maya-f037@example.test',
  password: 'F037-test-password',
  handle: 'maya-f037-test',
  displayName: 'Maya Okafor',
} as const

export const ROSA = {
  email: 'rosa-f037@example.test',
  password: 'F037-test-password',
  handle: 'rosa-f037-test',
  displayName: 'Rosa Mendez',
} as const

export const SHOP = {
  brandName: 'Oak Park Sourdough — F037',
  slug: 'oak-park-sourdough-f037',
  publicDescription: 'Naturally-leavened sourdough baked at home in Oak Park.',
  url: '/p/ca/sacramento/oak-park/g/oak-park-sourdough-f037',
} as const

// ZIPs from the migration-025 Sacramento crosswalk (MSA 40900) — proximal to the
// oak-park anchor. 90210 (Beverly Hills) is NOT seeded → null-safe-false.
export const PROXIMAL_ZIP = '95817'
export const PROXIMAL_ZIP_2 = '95816'
export const NON_PROXIMAL_ZIP = '90210'

export interface SeededF037Fixture {
  maya: { memberId: string }
  rosa: { memberId: string }
  groupId: string
}

let admin: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'F037-claim fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars are required',
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
  const { data, error } = await sb.from('members').select('id').eq('handle', handle).maybeSingle()
  if (error) throw new Error(`lookupMemberByHandle(${handle}): ${error.message}`)
  return data?.id ?? null
}

/** Find-or-create an auth user + members row with a hashed password, race-safe. */
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

/** Resolve the oak-park neighborhood Place id (msa_code 40900). The anchor
 *  Location's place_id points here so zip_is_proximal_to_location can derive
 *  the Shop's MSA. */
async function oakParkPlaceId(): Promise<string> {
  const sb = adminClient()
  const { data, error } = await sb
    .from('places')
    .select('id')
    .eq('slug', 'oak-park')
    .eq('kind', 'neighborhood')
    .limit(1)
    .maybeSingle()
  if (error || !data) {
    throw new Error(`oakParkPlaceId: oak-park neighborhood Place not found (${error?.message ?? 'no row'})`)
  }
  return data.id
}

/** Find-or-create the anchor Location with place_id set (idempotent by label). */
async function ensureAnchorLocation(opts: {
  label: string
  founderMemberId: string
  placeId: string
}): Promise<string> {
  const sb = adminClient()
  const { data: existing } = await sb
    .from('locations')
    .select('id, place_id')
    .eq('member_id', opts.founderMemberId)
    .eq('label', opts.label)
    .limit(1)
    .maybeSingle()
  if (existing) {
    // Ensure place_id is stamped on a row from a pre-place_id run.
    if (!existing.place_id) {
      await sb.from('locations').update({ place_id: opts.placeId }).eq('id', existing.id)
    }
    return existing.id
  }

  const slug = `${opts.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${randomUUID().slice(0, 8)}`
  const { data, error } = await sb
    .from('locations')
    .insert({
      member_id: opts.founderMemberId,
      kind: 'permanent',
      label: opts.label,
      slug,
      geography: 'SRID=4326;POINT(-121.4944 38.5816)',
      place_id: opts.placeId,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`ensureAnchorLocation(${opts.label}): ${error?.message ?? 'no row'}`)
  }
  return data.id
}

/** Lookup-or-create the active kind='business' Group + business row + Maya
 *  owner membership. Idempotent by founder + brand. */
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
    discoverability: 'listed',
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

/** Restore the empty-state precondition: hard-delete Maya's jurisdiction rows
 *  for the Group (service role bypasses RLS). Call in `beforeEach`. */
export async function resetJurisdiction(memberId: string, groupId: string): Promise<void> {
  const sb = adminClient()
  const { error } = await sb
    .from('member_business_jurisdictions')
    .delete()
    .eq('member_id', memberId)
    .eq('group_id', groupId)
  if (error) throw new Error(`resetJurisdiction: ${error.message}`)
}

/** Seed Maya (owner) + Rosa (non-owner) + Maya's active, place-anchored Shop.
 *  Call from `test.beforeAll`. Idempotent across reruns. */
export async function seedF037Fixture(): Promise<SeededF037Fixture> {
  const mayaId = await ensureIdentity(MAYA)
  const rosaId = await ensureIdentity(ROSA)
  const placeId = await oakParkPlaceId()
  const anchorId = await ensureAnchorLocation({
    label: "Maya's Oak Park Kitchen — F037",
    founderMemberId: mayaId,
    placeId,
  })
  const groupId = await ensureBusinessGroup({
    founderMemberId: mayaId,
    anchorLocationId: anchorId,
  })
  await resetJurisdiction(mayaId, groupId)
  return { maya: { memberId: mayaId }, rosa: { memberId: rosaId }, groupId }
}
