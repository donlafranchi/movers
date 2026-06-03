// F035 — Rosa finds Maya's Shop fixture seed.
//
// Seeds the read-side state F035 verifies: an ACTIVE kind='business' Group
// ("Oak Park Sourdough") with a founder Member, plus a sibling DRAFT Group for
// beat 6, plus a separate logged-in viewer (Rosa) who is NOT the owner.
//
// Distinct identities from F036-maya.ts on purpose: F036's `resetMayaDrafts`
// deletes ALL of maya-test's business Groups between tests. With
// `fullyParallel: true`, an F036 run would wipe a shared Maya's F035 Shop
// mid-test. So F035 uses its own `*-f035-test` handles — isolation, not reuse.
//
// Auth users get a real bcrypt-hashed password via the
// `eval_seed_auth_user_with_password` RPC so the UI sign-in flow
// (helpers/auth.ts → /auth/login) can grant a session — same rationale as
// the F036 fixture.
//
// Idempotent across re-runs: identities resolve by stable handle; Groups and
// the Location resolve lookup-or-create by founder + brand / label.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { markMemberDiscoverable } from './_member-privacy'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const MAYA = {
  email: 'maya-f035@example.test',
  password: 'F035-test-password',
  handle: 'maya-f035-test',
  displayName: 'Maya Okafor',
} as const

export const ROSA = {
  email: 'rosa-f035@example.test',
  password: 'F035-test-password',
  handle: 'rosa-f035-test',
  displayName: 'Rosa Mendez',
} as const

// Brand + slugs are fixed so the spec can build the public URL deterministically.
// The slug is globally UNIQUE; re-runs reuse the existing row (lookup by
// founder + brand), so the fixed slug never collides on a second run.
export const SHOP = {
  brandName: 'Oak Park Sourdough',
  slug: 'oak-park-sourdough-f035',
  publicDescription: 'Naturally-leavened sourdough baked at home in Oak Park.',
  // The place path is illustrative: resolveShop() resolves by group slug alone
  // (src ignores the place segments before /g/), so any valid /p/.../g/<slug>
  // path renders. We use the scenario's canonical path for readability.
  url: '/p/ca/sacramento/oak-park/g/oak-park-sourdough-f035',
} as const

export const DRAFT_SHOP = {
  brandName: 'Twelfth Street Pies',
  slug: 'twelfth-street-pies-f035-draft',
  publicDescription: 'Coming soon.',
  url: '/p/ca/sacramento/oak-park/g/twelfth-street-pies-f035-draft',
} as const

export interface SeededF035Fixture {
  maya: { memberId: string }
  rosa: { memberId: string }
  activeGroupId: string
  draftGroupId: string
}

let admin: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'F035-shop fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars are required',
    )
  }
  if (!admin) {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return admin
}

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

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const isUniqueViolation = (msg: string) =>
  /duplicate key|already exists|unique constraint/i.test(msg)

/** Find-or-create an auth user + members row with a hashed password.
 *  Resolves by stable handle so eval re-runs survive partial cleanups.
 *
 *  Race-safe: with `fullyParallel: true`, each worker runs `beforeAll`, so on a
 *  clean DB two workers can seed the same identity at once. Whichever loses the
 *  email/handle unique race backs off and re-resolves the winner's row by handle
 *  rather than throwing. After the first run the rows persist, so the idempotent
 *  handle-lookup path wins immediately. */
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
      // Ensure auth.users still has a row with this id (cleanup may have wiped it).
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
      // Concurrent worker took the email first — back off and re-resolve by handle.
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
      // Concurrent worker inserted the members row first — re-resolve.
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
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`ensureLocation(${opts.label}): ${error?.message ?? 'no row'}`)
  }
  return data.id
}

/** Lookup-or-create a kind='business' Group + group_businesses + founder
 *  owner membership at a given lifecycle_state. Idempotent by founder + brand. */
async function ensureBusinessGroup(opts: {
  brandName: string
  slug: string
  publicDescription: string
  founderMemberId: string
  anchorLocationId: string
  lifecycleState: 'active' | 'draft'
}): Promise<string> {
  const sb = adminClient()
  const lookup = async () =>
    (
      await sb
        .from('groups')
        .select('id, group_businesses!inner(display_name)')
        .eq('founder_member_id', opts.founderMemberId)
        .eq('kind', 'business')
        .eq('group_businesses.display_name', opts.brandName)
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
    name: opts.brandName,
    slug: opts.slug,
    description: '',
    // Business defaults to 'listed' (trg_groups_default_discoverability); set
    // explicitly so the public-read RLS (active + listed) is unambiguous.
    discoverability: 'listed',
    lifecycle_state: opts.lifecycleState,
  })
  if (groupErr) {
    // Concurrent worker created this Shop (slug unique) — re-resolve its id.
    if (isUniqueViolation(groupErr.message)) {
      await delay(200)
      const won = await lookup()
      if (won) return won.id
    }
    throw new Error(`ensureBusinessGroup(${opts.brandName}) groups: ${groupErr.message}`)
  }
  const { error: bizErr } = await sb.from('group_businesses').insert({
    group_id: id,
    display_name: opts.brandName,
    public_description: opts.publicDescription,
  })
  if (bizErr) {
    throw new Error(`ensureBusinessGroup(${opts.brandName}) group_businesses: ${bizErr.message}`)
  }
  const { error: memErr } = await sb.from('group_memberships').insert({
    group_id: id,
    member_id: opts.founderMemberId,
    role: 'owner',
    source: 'explicit',
  })
  if (memErr) {
    throw new Error(`ensureBusinessGroup(${opts.brandName}) membership: ${memErr.message}`)
  }
  return id
}

/** Seed Maya (founder) + Rosa (viewer) + Maya's active and draft Shops.
 *  Call from `test.beforeAll`. Idempotent across reruns. */
export async function seedF035Fixture(): Promise<SeededF035Fixture> {
  const mayaId = await ensureIdentity(MAYA)
  const rosaId = await ensureIdentity(ROSA)
  // T095 — opt Maya into discoverability so the "Founded by Maya" line renders
  // a link to /m/<handle> instead of plain text (post-T095 default is false).
  await markMemberDiscoverable(adminClient(), mayaId)

  const anchorId = await ensureLocation({
    label: "Maya's Oak Park Kitchen",
    founderMemberId: mayaId,
  })

  const activeGroupId = await ensureBusinessGroup({
    brandName: SHOP.brandName,
    slug: SHOP.slug,
    publicDescription: SHOP.publicDescription,
    founderMemberId: mayaId,
    anchorLocationId: anchorId,
    lifecycleState: 'active',
  })

  const draftGroupId = await ensureBusinessGroup({
    brandName: DRAFT_SHOP.brandName,
    slug: DRAFT_SHOP.slug,
    publicDescription: DRAFT_SHOP.publicDescription,
    founderMemberId: mayaId,
    anchorLocationId: anchorId,
    lifecycleState: 'draft',
  })

  return {
    maya: { memberId: mayaId },
    rosa: { memberId: rosaId },
    activeGroupId,
    draftGroupId,
  }
}
