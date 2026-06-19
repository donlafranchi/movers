// F033 — "Viewer finds a venue page" fixture seed.
//
// Seeds the read+follow state F033 verifies for a venue (Location) public page
// at /p/[…place]/l/[slug]. `locations.slug` is globally unique (migration 007),
// so the page resolves by slug alone — the place segments are URL/breadcrumb
// context, not an FK.
//
// Entities:
//   VIEWER  — auth'd Member with a primary_home place-interest (Oak Park) so the
//             distance line renders, and who follows / hosts. Starts NOT
//             following (the seed clears any prior venue saved-search).
//   DRAKE   — owns Drake's venue + the anchored kind='business' Group.
//   RUNNER  — owns the Run Club interest Group (a DIFFERENT host).
//   DRAKES  — listed permanent venue (street address + accessibility + About).
//   EMPTY   — listed venue WITH an anchored business Group but NO published Items
//             → "What's happening here" empty state.
//   BARE    — listed venue with NO anchored business Group → "here" section absent.
//   PRIVATE — discoverability='private' venue → 404 to non-owners.
//
// Items at Drake's (all attached via item_locations to DRAKES):
//   TRIVIA   — gathering, group_id = Drake's business Group → "What's happening
//              here" (Host == Venue).
//   RUNCLUB  — gathering, group_id = Run Club interest Group → "What's happening
//              nearby" only (Host ≠ Venue; public, within radius).
//   BIRTHDAY — gathering, member-hosted (group_id NULL), state='draft' → surfaces
//              NOWHERE. b1 has no item-level discoverability column (per
//              STAGE-LEDGER F033 note), so "private event" is modelled as an
//              unpublished draft — the only b1 mechanism that keeps it out of both
//              the base-table "here" RPC and the published-only discoverable_items
//              MV that backs "nearby".
//
// "What's happening here" reads base tables (venue_hosted_items, security
// invoker + items_select_published RLS) — no MV refresh needed. "What's happening
// nearby" reads the discoverable_items MV, refreshed by the item.published
// trigger on item_events — so the seed fires item.published for each published
// Item to force the synchronous CONCURRENTLY refresh.
//
// Distinct *-f033-test identities/slugs for isolation under fullyParallel.
// Idempotent across reruns: identities resolve by stable handle; Groups, venues,
// and Items are lookup-or-create.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Oak Park, Sacramento — the venues sit within a few hundred metres of each other
// and well inside the 5 km "nearby" radius. The URL place path is /p/ca/sacramento/oak-park.
export const PLACE_PATH = '/p/ca/sacramento/oak-park'
const OAK_PARK_SLUG = 'oak-park'
const VENUE_GEOG = 'SRID=4326;POINT(-121.4675 38.5530)'

export const VIEWER = {
  email: 'vince-f033@example.test',
  password: 'F033-test-password',
  handle: 'vince-f033-test',
  displayName: 'Vince Viewer',
} as const

export const DRAKE = {
  email: 'drake-f033@example.test',
  password: 'F033-test-password',
  handle: 'drake-f033-test',
  displayName: 'Drake Owner',
} as const

export const RUNNER = {
  email: 'runner-f033@example.test',
  password: 'F033-test-password',
  handle: 'runner-f033-test',
  displayName: 'Rena Runner',
} as const

export const DRAKES = {
  slug: 'drakes-f033-test',
  label: "Drake's",
  description: 'A neighborhood pub with a back patio and a weekly trivia tradition.',
  streetAddress: '1828 Oak Park Blvd',
  accessibilityNotes: 'Step-free entrance; accessible restroom.',
  url: `${PLACE_PATH}/l/drakes-f033-test`,
} as const

export const EMPTY = {
  slug: 'quiet-hall-f033-test',
  label: 'Quiet Hall',
  url: `${PLACE_PATH}/l/quiet-hall-f033-test`,
} as const

export const BARE = {
  slug: 'public-park-f033-test',
  label: 'Oak Park Commons',
  url: `${PLACE_PATH}/l/public-park-f033-test`,
} as const

export const PRIVATE_VENUE = {
  slug: 'private-kitchen-f033-test',
  label: 'Private Kitchen',
  url: `${PLACE_PATH}/l/private-kitchen-f033-test`,
} as const

export const DRAKES_GROUP = {
  name: "Drake's",
  slug: 'drakes-pub-f033',
} as const

export const RUNCLUB_GROUP = {
  name: 'Riverside Runners',
  slug: 'riverside-runners-f033',
} as const

export const EMPTY_GROUP = {
  name: 'Quiet Hall Events',
  slug: 'quiet-hall-events-f033',
} as const

export const TRIVIA = { title: "Trivia Night at Drake's" } as const
export const RUNCLUB = { title: 'Thursday Run Club' } as const
export const BIRTHDAY = { title: 'Private Birthday Party' } as const

export interface SeededF033Fixture {
  viewerId: string
  drakeId: string
  runnerId: string
  drakesLocationId: string
  emptyLocationId: string
  bareLocationId: string
  privateLocationId: string
  drakesGroupId: string
}

let admin: SupabaseClient | null = null
function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('F033 fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required')
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

// A future Thursday at 18:00 UTC + weekly recurrence, so the MV's starts_at
// filter (migration 034 — drops past gatherings, sorts by next occurrence)
// keeps these gatherings present and future-dated regardless of run time.
function futureThursdayISO(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 35)
  // Step forward to the next Thursday (getUTCDay() === 4).
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCHours(18, 0, 0, 0)
  return d.toISOString()
}
const WEEKLY_RRULE = 'FREQ=WEEKLY;BYDAY=TH'

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

/** Lookup-or-create a venue Location (spine) by slug, plus its permanent child
 *  (street address + accessibility notes). Idempotent by globally-unique slug. */
async function ensureVenue(opts: {
  ownerId: string
  slug: string
  label: string
  description?: string
  discoverability: 'listed' | 'private'
  streetAddress?: string
  accessibilityNotes?: string
}): Promise<string> {
  const sb = adminClient()
  const lookup = async () =>
    (await sb.from('locations').select('id').eq('slug', opts.slug).maybeSingle()).data
  const existing = await lookup()
  let locationId = existing?.id as string | undefined

  if (!locationId) {
    const id = randomUUID()
    const { error } = await sb.from('locations').insert({
      id,
      member_id: opts.ownerId,
      kind: 'permanent',
      label: opts.label,
      slug: opts.slug,
      description: opts.description ?? null,
      discoverability: opts.discoverability,
      geography: VENUE_GEOG,
    })
    if (error) {
      if (isUniqueViolation(error.message)) {
        const won = await lookup()
        if (won) locationId = won.id as string
      } else {
        throw new Error(`ensureVenue(${opts.slug}): ${error.message}`)
      }
    } else {
      locationId = id
    }
  }
  if (!locationId) throw new Error(`ensureVenue(${opts.slug}): no location id`)

  // Keep mutable fields converged on reruns.
  await sb
    .from('locations')
    .update({
      label: opts.label,
      description: opts.description ?? null,
      discoverability: opts.discoverability,
      geography: VENUE_GEOG,
      deleted_at: null,
    })
    .eq('id', locationId)

  if (opts.streetAddress || opts.accessibilityNotes) {
    const { error: childErr } = await sb.from('location_permanent').upsert(
      {
        location_id: locationId,
        street_address: opts.streetAddress ?? null,
        accessibility_notes: opts.accessibilityNotes ?? null,
      },
      { onConflict: 'location_id' },
    )
    if (childErr) throw new Error(`ensureVenue(${opts.slug}) permanent child: ${childErr.message}`)
  }
  return locationId
}

/** Lookup-or-create an active kind='business' Group anchored at a venue. */
async function ensureBusinessGroup(opts: {
  founderMemberId: string
  anchorLocationId: string
  name: string
  slug: string
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
      kind: 'business',
      founder_member_id: opts.founderMemberId,
      anchor_location_id: opts.anchorLocationId,
      name: opts.name,
      slug: opts.slug,
      description: '',
      discoverability: 'listed',
      lifecycle_state: 'active',
    })
    if (error) {
      if (isUniqueViolation(error.message)) {
        const won = await lookup()
        if (won) groupId = won.id as string
      } else {
        throw new Error(`ensureBusinessGroup(${opts.slug}): ${error.message}`)
      }
    } else {
      groupId = id
    }
  }
  if (!groupId) throw new Error(`ensureBusinessGroup(${opts.slug}): no group id`)

  await sb.from('groups').update({
    anchor_location_id: opts.anchorLocationId,
    lifecycle_state: 'active',
    discoverability: 'listed',
  }).eq('id', groupId)

  const { error: bizErr } = await sb
    .from('group_businesses')
    .upsert({ group_id: groupId, display_name: opts.name, public_description: '' }, { onConflict: 'group_id' })
  if (bizErr) throw new Error(`ensureBusinessGroup(${opts.slug}) group_businesses: ${bizErr.message}`)

  const { error: memErr } = await sb.from('group_memberships').upsert(
    { group_id: groupId, member_id: opts.founderMemberId, role: 'owner', source: 'explicit', left_at: null },
    { onConflict: 'group_id,member_id' },
  )
  if (memErr) throw new Error(`ensureBusinessGroup(${opts.slug}) membership: ${memErr.message}`)
  return groupId
}

/** Lookup-or-create a listed kind='interest' Group (the Run Club host — a
 *  different host than the venue, so its Items belong in "nearby"). */
async function ensureInterestGroup(opts: {
  founderMemberId: string
  name: string
  slug: string
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
      discoverability: 'listed',
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
  await sb.from('group_memberships').upsert(
    { group_id: groupId, member_id: opts.founderMemberId, role: 'steward', source: 'explicit', left_at: null },
    { onConflict: 'group_id,member_id' },
  )
  return groupId
}

/** Lookup-or-create a kind='gathering' Item + item_gatherings child + an
 *  item_locations attachment to the venue. Fires item.published for published
 *  Items so the discoverable_items MV picks them up. Idempotent by host + title. */
async function ensureGathering(opts: {
  hostMemberId: string
  title: string
  groupId: string | null
  venueLocationId: string
  state: 'draft' | 'published'
}): Promise<string> {
  const sb = adminClient()
  // Converge to exactly ONE active item. Parallel-worker beforeAll seeds race
  // and can insert duplicate (member, kind, title) rows; soft-delete the surplus
  // (the RPCs + MV filter deleted_at) so each section renders a single card.
  const lookup = async (): Promise<string | undefined> => {
    const { data: rows } = await sb
      .from('items')
      .select('id')
      .eq('member_id', opts.hostMemberId)
      .eq('kind', 'gathering')
      .eq('title', opts.title)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    const ids = (rows ?? []).map((r) => r.id as string)
    if (ids.length > 1) {
      await sb
        .from('items')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', ids.slice(1))
    }
    return ids[0]
  }
  let itemId = await lookup()

  if (!itemId) {
    itemId = randomUUID()
    const { error: itemErr } = await sb.from('items').insert({
      id: itemId,
      member_id: opts.hostMemberId,
      kind: 'gathering',
      group_id: opts.groupId,
      title: opts.title,
      description: 'Seeded F033 gathering.',
      state: opts.state,
    })
    if (itemErr) {
      if (isUniqueViolation(itemErr.message)) {
        const won = await lookup()
        if (won) itemId = won
        else throw new Error(`ensureGathering(${opts.title}): ${itemErr.message}`)
      } else {
        throw new Error(`ensureGathering(${opts.title}): ${itemErr.message}`)
      }
    } else {
      const { error: gErr } = await sb.from('item_gatherings').insert({
        item_id: itemId,
        starts_at: futureThursdayISO(),
        recurrence_rule: WEEKLY_RRULE,
        host_member_id: opts.hostMemberId,
      })
      if (gErr && !isUniqueViolation(gErr.message)) {
        throw new Error(`ensureGathering(${opts.title}) item_gatherings: ${gErr.message}`)
      }
      const { error: locErr } = await sb.from('item_locations').insert({
        item_id: itemId,
        location_id: opts.venueLocationId,
        schedule_kind: 'recurring',
        status: 'approved',
      })
      if (locErr && !isUniqueViolation(locErr.message)) {
        throw new Error(`ensureGathering(${opts.title}) item_locations: ${locErr.message}`)
      }
    }
  }

  // Converge state + fire item.published so the MV refreshes for published Items.
  await sb.from('items').update({ state: opts.state }).eq('id', itemId)
  if (opts.state === 'published') {
    await sb.from('item_events').insert({
      item_id: itemId,
      event_kind: 'item.published',
      acting_member_id: opts.hostMemberId,
    })
  }
  return itemId
}

/** Set the viewer's primary_home place-interest to Oak Park so the venue page
 *  renders a distance line (distance derives from the place centroid). */
async function ensurePrimaryHome(memberId: string): Promise<void> {
  const sb = adminClient()
  const { data: place } = await sb
    .from('places')
    .select('id')
    .eq('slug', OAK_PARK_SLUG)
    .is('deleted_at', null)
    .single()
  if (!place) throw new Error('ensurePrimaryHome: oak-park place not seeded')
  const { data: existing } = await sb
    .from('member_place_interests')
    .select('place_id, removed_at')
    .eq('member_id', memberId)
    .eq('scope_kind', 'primary_home')
    .is('removed_at', null)
    .maybeSingle()
  if (existing) return // already has an active primary_home
  const { error } = await sb.from('member_place_interests').insert({
    member_id: memberId,
    place_id: place.id,
    scope_kind: 'primary_home',
  })
  if (error && !isUniqueViolation(error.message)) {
    throw new Error(`ensurePrimaryHome: ${error.message}`)
  }
}

export async function seedF033Fixture(): Promise<SeededF033Fixture> {
  const sb = adminClient()
  const viewerId = await ensureIdentity(VIEWER)
  const drakeId = await ensureIdentity(DRAKE)
  const runnerId = await ensureIdentity(RUNNER)

  await ensurePrimaryHome(viewerId)

  const drakesLocationId = await ensureVenue({
    ownerId: drakeId,
    slug: DRAKES.slug,
    label: DRAKES.label,
    description: DRAKES.description,
    discoverability: 'listed',
    streetAddress: DRAKES.streetAddress,
    accessibilityNotes: DRAKES.accessibilityNotes,
  })
  const emptyLocationId = await ensureVenue({
    ownerId: drakeId,
    slug: EMPTY.slug,
    label: EMPTY.label,
    discoverability: 'listed',
  })
  const bareLocationId = await ensureVenue({
    ownerId: drakeId,
    slug: BARE.slug,
    label: BARE.label,
    discoverability: 'listed',
  })
  const privateLocationId = await ensureVenue({
    ownerId: drakeId,
    slug: PRIVATE_VENUE.slug,
    label: PRIVATE_VENUE.label,
    discoverability: 'private',
  })

  const drakesGroupId = await ensureBusinessGroup({
    founderMemberId: drakeId,
    anchorLocationId: drakesLocationId,
    name: DRAKES_GROUP.name,
    slug: DRAKES_GROUP.slug,
  })
  // Quiet Hall has an anchored business Group but no Items → empty-state beat.
  await ensureBusinessGroup({
    founderMemberId: drakeId,
    anchorLocationId: emptyLocationId,
    name: EMPTY_GROUP.name,
    slug: EMPTY_GROUP.slug,
  })
  const runclubGroupId = await ensureInterestGroup({
    founderMemberId: runnerId,
    name: RUNCLUB_GROUP.name,
    slug: RUNCLUB_GROUP.slug,
  })

  // Trivia (venue's own Group) → "here". Run Club (other host) → "nearby".
  await ensureGathering({
    hostMemberId: drakeId,
    title: TRIVIA.title,
    groupId: drakesGroupId,
    venueLocationId: drakesLocationId,
    state: 'published',
  })
  await ensureGathering({
    hostMemberId: runnerId,
    title: RUNCLUB.title,
    groupId: runclubGroupId,
    venueLocationId: drakesLocationId,
    state: 'published',
  })
  // Private birthday party — member-hosted draft → surfaces nowhere.
  await ensureGathering({
    hostMemberId: viewerId,
    title: BIRTHDAY.title,
    groupId: null,
    venueLocationId: drakesLocationId,
    state: 'draft',
  })

  // Reset the viewer's venue follow so the toggle starts "not following".
  await sb
    .from('member_saved_searches')
    .delete()
    .eq('member_id', viewerId)
    .eq('location_id', drakesLocationId)

  return {
    viewerId,
    drakeId,
    runnerId,
    drakesLocationId,
    emptyLocationId,
    bareLocationId,
    privateLocationId,
    drakesGroupId,
  }
}

/** True iff the viewer currently has an ACTIVE venue saved-search (follow). */
export async function isFollowingVenue(memberId: string, locationId: string): Promise<boolean> {
  const { data } = await adminClient()
    .from('member_saved_searches')
    .select('removed_at')
    .eq('member_id', memberId)
    .eq('location_id', locationId)
    .is('removed_at', null)
    .maybeSingle()
  return !!data
}

/** Whether the Oak Park place has a centroid (gates the distance assertion). */
export async function oakParkHasCentroid(): Promise<boolean> {
  const { data } = await adminClient()
    .from('places')
    .select('centroid')
    .eq('slug', OAK_PARK_SLUG)
    .is('deleted_at', null)
    .single()
  return !!data?.centroid
}
