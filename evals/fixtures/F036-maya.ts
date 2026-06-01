// F036 — Maya + Baker Ruth fixture seed.
//
// The F036 spec (`evals/features/F036-member-creates-business-group-via-sell-walkthrough.spec.ts`)
// preamble names this file and says: "if absent at run time, the beforeEach
// setup escalates rather than stubs." This module is the seed.
//
// MAYA — first-time Seller:
//   - auth.users + members row (id = auth.users.id per ADR-15 / T047)
//   - one saved Location ("Maya's Kitchen") — anchor-Location picker source
//   - NO kind='business' Group memberships
//
// BAKER_RUTH — existing Seller (active business Group):
//   - auth.users + members row
//   - one active kind='business' Group ("Ruth's Bread Co") with Ruth as
//     founder + role='owner' + source='explicit'
//   - one anchor Location ("Ruth's Bakery")
//
// Why `auth.admin.createUser` instead of the existing
// `eval_seed_auth_user_only` RPC: the F036 spec drives the UI sign-in
// (page.goto('/auth/login') → fill password → submit). The SQL helper
// stamps a dummy encrypted_password ('eval-placeholder') that is NOT an
// argon2id hash — Supabase Auth rejects the password attempt and the spec
// never reaches /you. The admin createUser API hashes the password the
// way the password-grant flow expects.
//
// Idempotent: an existing user with the target email is treated as already
// seeded (no recreate, no error). Same for the Location and Group rows —
// upserts keyed on slug / display_name.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const MAYA = {
  email: 'maya@example.test',
  password: 'F036-test-password',
  handle: 'maya-test',
  displayName: 'Maya',
  savedLocationName: "Maya's Kitchen",
} as const

export const BAKER_RUTH = {
  email: 'ruth@example.test',
  password: 'F036-test-password',
  handle: 'ruth-test',
  displayName: 'Ruth',
  existingBusinessGroupName: "Ruth's Bread Co",
  existingLocationName: "Ruth's Bakery",
} as const

export interface SeededF036Fixture {
  maya: {
    memberId: string
    locationId: string
  }
  ruth: {
    memberId: string
    groupId: string
    locationId: string
  }
}

let admin: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'F036-maya fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars are required',
    )
  }
  if (!admin) {
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return admin
}

/** Find-or-create an auth user with a hashed password. Returns the user id. */
async function ensureAuthUser(opts: {
  email: string
  password: string
  displayName: string
}): Promise<string> {
  const sb = adminClient()
  // listUsers is paginated; for fixture seeds the test DB is small enough that
  // page 1 covers all eval users. If the project grows past 1k eval users, swap
  // for a direct query on auth.users via service role.
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (listErr) {
    throw new Error(`ensureAuthUser: listUsers failed: ${listErr.message}`)
  }
  const existing = list.users.find(
    (u: { email?: string | null }) => u.email === opts.email,
  )
  if (existing) return existing.id

  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    email_confirm: true,
    user_metadata: { display_name: opts.displayName },
  })
  if (createErr || !created.user) {
    throw new Error(
      `ensureAuthUser: createUser(${opts.email}) failed: ${createErr?.message ?? 'no user returned'}`,
    )
  }
  return created.user.id
}

/** Ensure a `members` row exists for the auth user. The signup hook normally
 *  drives `member.create` on signup; for already-existing auth users (re-seeds)
 *  the hook may have run before the helper rolled in — so we upsert. */
async function ensureMember(opts: {
  authUserId: string
  handle: string
  displayName: string
}): Promise<string> {
  const sb = adminClient()
  const { data: existing } = await sb
    .from('members')
    .select('id')
    .eq('id', opts.authUserId)
    .maybeSingle()
  if (existing) return existing.id

  const { data, error } = await sb
    .from('members')
    .insert({
      id: opts.authUserId,
      handle: opts.handle,
      display_name: opts.displayName,
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(
      `ensureMember(${opts.handle}): ${error?.message ?? 'no row returned'}`,
    )
  }
  return data.id
}

async function ensureLocation(opts: {
  label: string
  founderMemberId: string
}): Promise<string> {
  const sb = adminClient()
  // Locations are scoped under a member; lookup by (member_id, label) keeps
  // re-seeds idempotent without colliding on the global slug UNIQUE.
  const { data: existing } = await sb
    .from('locations')
    .select('id')
    .eq('member_id', opts.founderMemberId)
    .eq('label', opts.label)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id

  // Required columns per supabase/migrations/007_locations.sql:
  //   member_id, kind, label, slug (unique), geography (Point, 4326)
  // Service role bypasses RLS; the insert satisfies the NOT NULL set.
  // Geography: midtown-Sacramento default — F036 fixture isn't geo-sensitive.
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
    throw new Error(
      `ensureLocation(${opts.label}): ${error?.message ?? 'no row returned'}`,
    )
  }
  return data.id
}

async function ensureActiveBusinessGroup(opts: {
  brandName: string
  founderMemberId: string
  anchorLocationId: string
}): Promise<string> {
  const sb = adminClient()
  // Look up by founder + brand to make re-seeds idempotent.
  const { data: existing } = await sb
    .from('groups')
    .select('id, group_businesses!inner(display_name)')
    .eq('founder_member_id', opts.founderMemberId)
    .eq('kind', 'business')
    .eq('lifecycle_state', 'active')
    .eq('group_businesses.display_name', opts.brandName)
    .maybeSingle()
  if (existing) return existing.id

  const id = randomUUID()
  const slug = opts.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const { error: groupErr } = await sb.from('groups').insert({
    id,
    kind: 'business',
    founder_member_id: opts.founderMemberId,
    anchor_location_id: opts.anchorLocationId,
    name: opts.brandName,
    slug: `${slug}-${randomUUID().slice(0, 8)}`,
    description: '',
    lifecycle_state: 'active',
  })
  if (groupErr) {
    throw new Error(`ensureActiveBusinessGroup: groups insert: ${groupErr.message}`)
  }

  const { error: bizErr } = await sb.from('group_businesses').insert({
    group_id: id,
    display_name: opts.brandName,
  })
  if (bizErr) {
    throw new Error(
      `ensureActiveBusinessGroup: group_businesses insert: ${bizErr.message}`,
    )
  }

  const { error: memErr } = await sb.from('group_memberships').insert({
    group_id: id,
    member_id: opts.founderMemberId,
    role: 'owner',
    source: 'explicit',
  })
  if (memErr) {
    throw new Error(
      `ensureActiveBusinessGroup: group_memberships insert: ${memErr.message}`,
    )
  }
  return id
}

/** Seed Maya + Ruth + their Locations + Ruth's active business Group.
 *  Call from `test.beforeAll` in F036.spec.ts. Idempotent across reruns. */
export async function seedF036Fixture(): Promise<SeededF036Fixture> {
  // Maya — fresh Seller.
  const mayaId = await ensureAuthUser({
    email: MAYA.email,
    password: MAYA.password,
    displayName: MAYA.displayName,
  })
  await ensureMember({
    authUserId: mayaId,
    handle: MAYA.handle,
    displayName: MAYA.displayName,
  })
  const mayaLocId = await ensureLocation({
    label: MAYA.savedLocationName,
    founderMemberId: mayaId,
  })

  // Ruth — existing Seller with one active business Group.
  const ruthId = await ensureAuthUser({
    email: BAKER_RUTH.email,
    password: BAKER_RUTH.password,
    displayName: BAKER_RUTH.displayName,
  })
  await ensureMember({
    authUserId: ruthId,
    handle: BAKER_RUTH.handle,
    displayName: BAKER_RUTH.displayName,
  })
  const ruthLocId = await ensureLocation({
    label: BAKER_RUTH.existingLocationName,
    founderMemberId: ruthId,
  })
  const ruthGroupId = await ensureActiveBusinessGroup({
    brandName: BAKER_RUTH.existingBusinessGroupName,
    founderMemberId: ruthId,
    anchorLocationId: ruthLocId,
  })

  return {
    maya: { memberId: mayaId, locationId: mayaLocId },
    ruth: { memberId: ruthId, groupId: ruthGroupId, locationId: ruthLocId },
  }
}

/** Tear down Maya's draft Groups between tests so the resume-branch tests
 *  start clean. Does NOT delete the auth users or seeded Locations / Ruth's
 *  active Group — those are seed state, not per-test state. */
export async function resetMayaDrafts(mayaMemberId: string): Promise<void> {
  const sb = adminClient()
  // Cascade-delete via the Group spine — group_businesses + group_memberships
  // ride FK ON DELETE CASCADE (per 014_groups.sql).
  const { error } = await sb
    .from('groups')
    .delete()
    .eq('founder_member_id', mayaMemberId)
    .eq('kind', 'business')
    .eq('lifecycle_state', 'draft')
  if (error) {
    throw new Error(`resetMayaDrafts: ${error.message}`)
  }
}
