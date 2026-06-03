// F032 — "Viewer finds member page and follows" fixture seed.
//
// Seeds the read+follow state F032 verifies:
//   - NADIA (target Member): bio/pronouns/avatar, ≥1 published Item, a LISTED
//     interest Group she stewards (grants standing-presence AND a listed
//     membership that must surface), plus an UNLISTED Group she's in that must
//     NOT surface.
//   - THEO (viewer Member): hashed password so the UI sign-in flow grants a
//     session. Starts NOT following Nadia (the seed clears any prior follow).
//   - GHOST (soft-deleted Member): deleted_at set → /m/[handle] must 404.
//
// Distinct *-f032-test handles for isolation (same rationale as F035-shop.ts).
// Idempotent across reruns: identities resolve by stable handle; Groups, the
// Item, and memberships are lookup-or-create.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const NADIA = {
  email: 'nadia-f032@example.test',
  password: 'F032-test-password',
  handle: 'nadia-f032-test',
  displayName: 'Nadia Okonkwo',
  bio: 'Naturally-leavened sourdough, baked in Oak Park.',
  pronouns: 'she/her',
  avatarUrl: 'https://example.test/nadia.png',
} as const

export const THEO = {
  email: 'theo-f032@example.test',
  password: 'F032-test-password',
  handle: 'theo-f032-test',
  displayName: 'Theo Park',
} as const

export const GHOST = {
  email: 'ghost-f032@example.test',
  password: 'F032-test-password',
  handle: 'ghost-f032-test',
  displayName: 'Ghost Member',
} as const

// T095 gating members. CONSUMER keeps the new b1 default (members_only,
// is_discoverable=false): anon → 404, a signed-in viewer with the URL → renders.
// VAULT is fully private: a signed-in non-self viewer → tombstone, anon → 404.
export const CONSUMER = {
  email: 'cory-f032@example.test',
  password: 'F032-test-password',
  handle: 'cory-f032-test',
  displayName: 'Cory Consumer',
} as const

export const VAULT = {
  email: 'vera-f032@example.test',
  password: 'F032-test-password',
  handle: 'vera-f032-test',
  displayName: 'Vera Vault',
} as const

export const LISTED_GROUP = {
  name: 'Oak Park Bakers',
  slug: 'oak-park-bakers-f032',
} as const

export const UNLISTED_GROUP = {
  name: 'Secret Supper Club',
  slug: 'secret-supper-f032',
} as const

export const ITEM = {
  title: 'Country Sourdough Loaf',
} as const

export interface SeededF032Fixture {
  nadiaId: string
  theoId: string
  consumerId: string
  vaultId: string
}

let admin: SupabaseClient | null = null
function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('F032 fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
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
 *  mirrors F035-shop.ts ensureIdentity. */
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

/** Lookup-or-create a non-business Group at a given discoverability + the
 *  founder's membership at a given role. Idempotent by slug. */
async function ensureInterestGroup(opts: {
  name: string
  slug: string
  discoverability: 'listed' | 'unlisted'
  founderMemberId: string
  role: string
}): Promise<string> {
  const sb = adminClient()
  const lookup = async () =>
    (await sb.from('groups').select('id').eq('slug', opts.slug).maybeSingle()).data
  const existing = await lookup()
  let groupId = existing?.id as string | undefined

  if (!groupId) {
    const id = randomUUID()
    const { error } = await sb.from('groups').insert({
      id,
      kind: 'interest',
      founder_member_id: opts.founderMemberId,
      name: opts.name,
      slug: opts.slug,
      description: '',
      discoverability: opts.discoverability,
      lifecycle_state: 'active',
    })
    if (error) {
      if (isUniqueViolation(error.message)) {
        const won = await lookup()
        if (won) groupId = won.id as string
      } else {
        throw new Error(`ensureInterestGroup(${opts.slug}): ${error.message}`)
      }
    } else {
      groupId = id
    }
  }
  if (!groupId) throw new Error(`ensureInterestGroup(${opts.slug}): no group id`)

  const { error: memErr } = await sb
    .from('group_memberships')
    .upsert(
      {
        group_id: groupId,
        member_id: opts.founderMemberId,
        role: opts.role,
        source: 'explicit',
        left_at: null,
      },
      { onConflict: 'group_id,member_id' },
    )
  if (memErr) throw new Error(`ensureInterestGroup(${opts.slug}) membership: ${memErr.message}`)
  return groupId
}

async function ensurePublishedItem(opts: {
  memberId: string
  title: string
}): Promise<string> {
  const sb = adminClient()
  // Converge to exactly ONE active item. (Prior fixture used .maybeSingle() for
  // the lookup, which *errors* on >1 match rather than returning a row — so it
  // re-inserted on every run once a duplicate existed, accumulating dupes that
  // broke the strict-mode `member-item` assertion. Soft-delete surplus rows
  // instead of hard-deleting — the resolver already filters `deleted_at`, and
  // soft-delete avoids item_locations / item_events FK cascades.)
  const { data: rows } = await sb
    .from('items')
    .select('id')
    .eq('member_id', opts.memberId)
    .eq('title', opts.title)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  const existing = (rows ?? []) as { id: string }[]
  if (existing.length > 0) {
    const surplus = existing.slice(1).map((r) => r.id)
    if (surplus.length > 0) {
      await sb.from('items').update({ deleted_at: new Date().toISOString() }).in('id', surplus)
    }
    return existing[0].id
  }
  const { data, error } = await sb
    .from('items')
    .insert({
      member_id: opts.memberId,
      kind: 'product',
      title: opts.title,
      description: 'Real bread, baked local.',
      state: 'published',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`ensurePublishedItem(${opts.title}): ${error?.message}`)
  return data.id as string
}

/** Set a Member's T095 privacy gate directly (service-role bypasses the
 *  action-layer-only write convention — acceptable for eval seeds). */
async function setPrivacy(
  memberId: string,
  opts: { isDiscoverable: boolean; profileVisibility: 'public' | 'unlisted' | 'members_only' | 'private' },
): Promise<void> {
  const { error } = await adminClient()
    .from('member_privacy')
    .update({ is_discoverable: opts.isDiscoverable, profile_visibility: opts.profileVisibility })
    .eq('member_id', memberId)
  if (error) throw new Error(`setPrivacy(${memberId}): ${error.message}`)
}

/** Seed Nadia + Theo + Ghost (+ T095 gating members), Nadia's listed/unlisted
 *  Groups + Item, and clear any prior Theo→Nadia follow so the toggle starts
 *  from "not following". */
export async function seedF032Fixture(): Promise<SeededF032Fixture> {
  const sb = adminClient()
  const nadiaId = await ensureIdentity(NADIA)
  const theoId = await ensureIdentity(THEO)
  const ghostId = await ensureIdentity(GHOST)
  const consumerId = await ensureIdentity(CONSUMER)
  const vaultId = await ensureIdentity(VAULT)

  // Nadia's profile fields (ensureIdentity only sets handle + display_name).
  await sb
    .from('members')
    .update({ bio: NADIA.bio, pronouns: NADIA.pronouns, avatar_url: NADIA.avatarUrl })
    .eq('id', nadiaId)

  // T095 privacy gates. Nadia is the F032 "findable producer" — she opted into
  // discoverability (a public, indexable profile), so the find+follow beats hold.
  // CONSUMER keeps the new private-by-default (members_only); VAULT is private.
  await setPrivacy(nadiaId, { isDiscoverable: true, profileVisibility: 'public' })
  await setPrivacy(consumerId, { isDiscoverable: false, profileVisibility: 'members_only' })
  await setPrivacy(vaultId, { isDiscoverable: false, profileVisibility: 'private' })

  // Ghost is soft-deleted → her page must 404.
  await sb.from('members').update({ deleted_at: new Date().toISOString() }).eq('id', ghostId)

  await ensureInterestGroup({
    ...LISTED_GROUP,
    discoverability: 'listed',
    founderMemberId: nadiaId,
    role: 'steward', // steward of a non-business Group ⇒ standing presence
  })
  await ensureInterestGroup({
    ...UNLISTED_GROUP,
    discoverability: 'unlisted',
    founderMemberId: nadiaId,
    role: 'member',
  })

  await ensurePublishedItem({ memberId: nadiaId, title: ITEM.title })

  // Reset the follow edge so each run starts "not following".
  await sb
    .from('member_follows')
    .delete()
    .eq('follower_member_id', theoId)
    .eq('followed_member_id', nadiaId)

  return { nadiaId, theoId, consumerId, vaultId }
}

/** True iff Theo currently has an ACTIVE follow on Nadia (admin read). */
export async function isFollowing(theoId: string, nadiaId: string): Promise<boolean> {
  const { data } = await adminClient()
    .from('member_follows')
    .select('unfollowed_at')
    .eq('follower_member_id', theoId)
    .eq('followed_member_id', nadiaId)
    .maybeSingle()
  return !!data && data.unfollowed_at === null
}
