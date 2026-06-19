// F042 — "Member follows a producer, a group, and a venue" fixture seed.
//
// Seeds the read+manage state F042 verifies across three follow substrates:
//   - member_follows           (Member follow — F032 owns the write; read here)
//   - group_memberships        (Group follow/join — F035 owns the write; read here)
//   - member_saved_searches    (Venue follow — F033 owns the write; read here)
//
// Two distinct viewers keep the read beats and the mutate beat from racing
// under fullyParallel:true:
//   - READER:  has all three follows ACTIVE and is NEVER mutated. The /you and
//              /you/following list beats read against READER.
//   - MUTATOR: has its own three follows; the Unfollow/Leave beat reactivates
//              them at test start, then soft-deletes — so re-runs and
//              cross-worker ordering never leave it in a torn state.
//   - EMPTY:   no follows at all → exercises the empty-state beat.
//
// Shared targets (one followed Member, one Group, one Venue/Location) carry
// per-member rows, so READER and MUTATOR don't collide.
//
// Distinct *-f042-test handles for isolation (same rationale as F032/F035).
// Idempotent across reruns: identities resolve by stable handle; the Group,
// Location, and every edge are lookup-or-create / reactivate.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { markMemberDiscoverable } from './_member-privacy'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const READER = {
  email: 'reed-f042@example.test',
  password: 'F042-test-password',
  handle: 'reed-f042-test',
  displayName: 'Reed Halloran',
} as const

export const MUTATOR = {
  email: 'mona-f042@example.test',
  password: 'F042-test-password',
  handle: 'mona-f042-test',
  displayName: 'Mona Vale',
} as const

export const EMPTY = {
  email: 'evan-f042@example.test',
  password: 'F042-test-password',
  handle: 'evan-f042-test',
  displayName: 'Evan Quiet',
} as const

// The followed Member (the "producer" a viewer follows).
export const FOLLOWED_MEMBER = {
  email: 'bea-f042@example.test',
  password: 'F042-test-password',
  handle: 'bea-f042-test',
  displayName: 'Bea Levin',
} as const

// The community-kind Group both viewers join (the "Run Club").
export const GROUP = {
  name: 'Oak Park Run Club',
  slug: 'oak-park-run-club-f042',
} as const

// Extra Group members used by the count-privacy beat. One is active (counts);
// one has LEFT (soft-deleted — must NOT count). The public Group page counts
// active explicit memberships in a *listed* Group only (migration 029).
export const GROUP_EXTRA_ACTIVE = {
  email: 'gabe-f042@example.test',
  password: 'F042-test-password',
  handle: 'gabe-f042-test',
  displayName: 'Gabe Active',
} as const

export const GROUP_EXTRA_LEFT = {
  email: 'lena-f042@example.test',
  password: 'F042-test-password',
  handle: 'lena-f042-test',
  displayName: 'Lena Left',
} as const

// The followed Venue (a Location row; saved-search with location_id populated).
export const VENUE = {
  label: 'Sunset Pavilion',
  ownerEmail: 'vic-f042@example.test',
  ownerPassword: 'F042-test-password',
  ownerHandle: 'vic-f042-test',
  ownerDisplayName: 'Vic Venue',
} as const

export interface SeededF042Fixture {
  readerId: string
  mutatorId: string
  emptyId: string
  followedMemberId: string
  groupId: string
  venueLocationId: string
  /** Active explicit memberships in the (listed) Group — the public count. */
  groupActiveListedCount: number
}

let admin: SupabaseClient | null = null
function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('F042 fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
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

/** Find-or-create an auth user + members row with a hashed password. Race-safe;
 *  mirrors F032/F035 ensureIdentity. */
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

/** Lookup-or-create a listed interest Group founded by `founderMemberId`. */
async function ensureInterestGroup(opts: {
  name: string
  slug: string
  founderMemberId: string
}): Promise<string> {
  const sb = adminClient()
  const lookup = async () =>
    (await sb.from('groups').select('id').eq('slug', opts.slug).maybeSingle()).data
  const existing = await lookup()
  if (existing) return existing.id as string

  const id = randomUUID()
  const { error } = await sb.from('groups').insert({
    id,
    kind: 'interest',
    founder_member_id: opts.founderMemberId,
    name: opts.name,
    slug: opts.slug,
    description: '',
    discoverability: 'listed',
    lifecycle_state: 'active',
  })
  if (error) {
    if (isUniqueViolation(error.message)) {
      const won = await lookup()
      if (won) return won.id as string
    }
    throw new Error(`ensureInterestGroup(${opts.slug}): ${error.message}`)
  }
  return id
}

/** Upsert an ACTIVE explicit membership (clears any prior left_at). */
async function ensureActiveMembership(opts: {
  groupId: string
  memberId: string
  role: string
}): Promise<void> {
  const { error } = await adminClient()
    .from('group_memberships')
    .upsert(
      {
        group_id: opts.groupId,
        member_id: opts.memberId,
        role: opts.role,
        source: 'explicit',
        left_at: null,
      },
      { onConflict: 'group_id,member_id' },
    )
  if (error) throw new Error(`ensureActiveMembership(${opts.memberId}): ${error.message}`)
}

/** Upsert a LEFT (soft-deleted) explicit membership — must not count. */
async function ensureLeftMembership(opts: {
  groupId: string
  memberId: string
}): Promise<void> {
  const { error } = await adminClient()
    .from('group_memberships')
    .upsert(
      {
        group_id: opts.groupId,
        member_id: opts.memberId,
        role: 'member',
        source: 'explicit',
        left_at: new Date().toISOString(),
      },
      { onConflict: 'group_id,member_id' },
    )
  if (error) throw new Error(`ensureLeftMembership(${opts.memberId}): ${error.message}`)
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
  if (error || !data) throw new Error(`ensureLocation(${opts.label}): ${error?.message ?? 'no row'}`)
  return data.id
}

/** Upsert an ACTIVE member→member follow (clears any prior unfollowed_at). */
async function ensureActiveFollow(opts: {
  followerId: string
  followedId: string
}): Promise<void> {
  const { error } = await adminClient()
    .from('member_follows')
    .upsert(
      {
        follower_member_id: opts.followerId,
        followed_member_id: opts.followedId,
        unfollowed_at: null,
      },
      { onConflict: 'follower_member_id,followed_member_id' },
    )
  if (error) throw new Error(`ensureActiveFollow(${opts.followerId}): ${error.message}`)
}

/** Converge to exactly ONE active venue saved-search for (member, location).
 *  member_saved_searches has no unique constraint on (member_id, location_id),
 *  so naive lookup-or-create accumulates duplicates across re-runs (a stale row
 *  plus an inserted one renders the venue twice on /you/following). Keep the
 *  oldest row (reactivated), hard-delete the surplus — the table is a leaf with
 *  no dependents, so deletion is safe. */
async function ensureActiveVenueSavedSearch(opts: {
  memberId: string
  locationId: string
  label: string
}): Promise<void> {
  const sb = adminClient()
  const { data: rows } = await sb
    .from('member_saved_searches')
    .select('id')
    .eq('member_id', opts.memberId)
    .eq('location_id', opts.locationId)
    .order('created_at', { ascending: true })
  const existing = (rows ?? []) as { id: string }[]
  if (existing.length > 0) {
    const surplus = existing.slice(1).map((r) => r.id)
    if (surplus.length > 0) {
      await sb.from('member_saved_searches').delete().in('id', surplus)
    }
    const { error } = await sb
      .from('member_saved_searches')
      .update({ removed_at: null, label: opts.label })
      .eq('id', existing[0].id)
    if (error) throw new Error(`ensureActiveVenueSavedSearch update: ${error.message}`)
    return
  }
  const { error } = await sb.from('member_saved_searches').insert({
    member_id: opts.memberId,
    location_id: opts.locationId,
    label: opts.label,
  })
  if (error) throw new Error(`ensureActiveVenueSavedSearch insert: ${error.message}`)
}

/** Targeted reactivations — each mutate beat reactivates ONLY the substrate it
 *  will soft-delete. Reactivating all three (below) would let concurrent beats
 *  clobber each other's soft-delete (e.g. the venue beat's removed_at cleared by
 *  the people beat's reactivation), so the mutate beats use these instead. */
export async function reactivateMemberFollow(followerId: string, followedId: string): Promise<void> {
  await ensureActiveFollow({ followerId, followedId })
}
export async function reactivateGroupMembership(groupId: string, memberId: string): Promise<void> {
  await ensureActiveMembership({ groupId, memberId, role: 'member' })
}
export async function reactivateVenueFollow(
  memberId: string,
  locationId: string,
  label: string,
): Promise<void> {
  await ensureActiveVenueSavedSearch({ memberId, locationId, label })
}

/** Bring all three of a viewer's follows back to ACTIVE (seed-time only). */
export async function reactivateAllFollows(opts: {
  memberId: string
  followedMemberId: string
  groupId: string
  venueLocationId: string
  venueLabel: string
}): Promise<void> {
  await ensureActiveFollow({ followerId: opts.memberId, followedId: opts.followedMemberId })
  await ensureActiveMembership({ groupId: opts.groupId, memberId: opts.memberId, role: 'member' })
  await ensureActiveVenueSavedSearch({
    memberId: opts.memberId,
    locationId: opts.venueLocationId,
    label: opts.venueLabel,
  })
}

export async function seedF042Fixture(): Promise<SeededF042Fixture> {
  const readerId = await ensureIdentity(READER)
  const mutatorId = await ensureIdentity(MUTATOR)
  const emptyId = await ensureIdentity(EMPTY)
  const followedMemberId = await ensureIdentity(FOLLOWED_MEMBER)
  const venueOwnerId = await ensureIdentity({
    email: VENUE.ownerEmail,
    password: VENUE.ownerPassword,
    handle: VENUE.ownerHandle,
    displayName: VENUE.ownerDisplayName,
  })
  const extraActiveId = await ensureIdentity(GROUP_EXTRA_ACTIVE)
  const extraLeftId = await ensureIdentity(GROUP_EXTRA_LEFT)

  // Followed Member must be discoverable so the /you list can render a link +
  // public name (post-T095 default is private).
  await markMemberDiscoverable(adminClient(), followedMemberId)

  const groupId = await ensureInterestGroup({
    name: GROUP.name,
    slug: GROUP.slug,
    founderMemberId: followedMemberId, // founder is unrelated to the viewers
  })
  const venueLocationId = await ensureLocation({
    label: VENUE.label,
    founderMemberId: venueOwnerId,
  })

  // READER — all three follows ACTIVE. Never mutated.
  await ensureActiveFollow({ followerId: readerId, followedId: followedMemberId })
  await ensureActiveMembership({ groupId, memberId: readerId, role: 'member' })
  await ensureActiveVenueSavedSearch({
    memberId: readerId,
    locationId: venueLocationId,
    label: VENUE.label,
  })

  // MUTATOR — its own three follows, reactivated here; the mutate beat
  // reactivates again at test start for re-run safety.
  await reactivateAllFollows({
    memberId: mutatorId,
    followedMemberId,
    groupId,
    venueLocationId,
    venueLabel: VENUE.label,
  })

  // EMPTY — ensure it has NO active follows (clear any leftovers from prior runs).
  await adminClient()
    .from('member_follows')
    .update({ unfollowed_at: new Date().toISOString() })
    .eq('follower_member_id', emptyId)
    .is('unfollowed_at', null)
  await adminClient()
    .from('group_memberships')
    .update({ left_at: new Date().toISOString() })
    .eq('member_id', emptyId)
    .is('left_at', null)
  await adminClient()
    .from('member_saved_searches')
    .update({ removed_at: new Date().toISOString() })
    .eq('member_id', emptyId)
    .is('removed_at', null)

  // Count-privacy: the founder + READER + MUTATOR + one extra-active are active
  // listed memberships; the extra-left member has left and must NOT count.
  await ensureActiveMembership({ groupId, memberId: followedMemberId, role: 'steward' })
  await ensureActiveMembership({ groupId, memberId: extraActiveId, role: 'member' })
  await ensureLeftMembership({ groupId, memberId: extraLeftId })

  const { count } = await adminClient()
    .from('group_memberships')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('source', 'explicit')
    .is('left_at', null)

  return {
    readerId,
    mutatorId,
    emptyId,
    followedMemberId,
    groupId,
    venueLocationId,
    groupActiveListedCount: count ?? 0,
  }
}

// ---- Admin read helpers (verify the soft-delete writes the scenario names) ----

export async function followIsActive(followerId: string, followedId: string): Promise<boolean> {
  const { data } = await adminClient()
    .from('member_follows')
    .select('unfollowed_at')
    .eq('follower_member_id', followerId)
    .eq('followed_member_id', followedId)
    .maybeSingle()
  return !!data && data.unfollowed_at === null
}

export async function membershipIsActive(groupId: string, memberId: string): Promise<boolean> {
  const { data } = await adminClient()
    .from('group_memberships')
    .select('left_at')
    .eq('group_id', groupId)
    .eq('member_id', memberId)
    .maybeSingle()
  return !!data && data.left_at === null
}

export async function venueSavedSearchIsActive(
  memberId: string,
  locationId: string,
): Promise<boolean> {
  const { data } = await adminClient()
    .from('member_saved_searches')
    .select('removed_at')
    .eq('member_id', memberId)
    .eq('location_id', locationId)
    .maybeSingle()
  return !!data && data.removed_at === null
}

/** True iff a member_events row of `kind` referencing `memberId` exists. */
export async function memberEventExists(memberId: string, kind: string): Promise<boolean> {
  const { count } = await adminClient()
    .from('member_events')
    .select('*', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('event_kind', kind)
  return (count ?? 0) > 0
}

/** True iff a group_events row of `kind` for `groupId` exists. */
export async function groupEventExists(groupId: string, kind: string): Promise<boolean> {
  const { count } = await adminClient()
    .from('group_events')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('event_kind', kind)
  return (count ?? 0) > 0
}
