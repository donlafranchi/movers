// F034 — A member hosts a recurring gathering fixture seed.
//
// Seeds the read-side state F034's gathering Item page verifies: a host (Jordan),
// an anchor venue Location, an optional business Group (for the brand resolve-up
// + catch-all `/e/` dispatch path), and a set of published kind='gathering'
// Items exercising the acceptance beats:
//   GROUP_GATHERING  — recurring weekly, filed under a Group with a venue anchor,
//                      free → title + next-occurrence + recurrence ("Every
//                      Thursday") + location + "Free" cost + brand + owner +
//                      Share-link. Resolves via the `/p/…/g/<group>/e/<slug>`
//                      catch-all dispatch.
//   MEMBER_GATHERING — recurring, hosted by the Member (group_id NULL) → the
//                      scenario-canonical b1 shape; URL /m/<handle>/e/<slug>,
//                      no brand resolve-up.
//   PAID_GATHERING   — cost_cents set → cost renders "$10.00".
//   DRAFT_GATHERING  — state='draft' → must 404 (RLS items_select_published).
//
// Mirrors the F038/F040 fixtures (identity / Group / Item helpers, idempotent
// lookup-or-create, race-safe under parallel-worker beforeAll). The F034
// specifics: kind='gathering', the item_gatherings child (starts_at /
// recurrence_rule RRULE / capacity / cost_cents), and the `/e/` URL segment.
//
// The recurring start is anchored to a Thursday so the weekly RRULE
// (FREQ=WEEKLY;BYDAY=TH) advances to a future Thursday via nextOccurrence()'s
// whole-week stepping — the recurrence label "Every Thursday" stays
// deterministic regardless of the wall clock at run time.
//
// Distinct *-f034-test identities from F035/F036/F038/F040 on purpose —
// isolation under `fullyParallel: true`.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { markMemberDiscoverable } from './_member-privacy'

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const JORDAN = {
  email: 'jordan-f034@example.test',
  password: 'F034-test-password',
  handle: 'jordan-f034-test',
  displayName: 'Jordan Avery',
} as const

export const CREW = {
  brandName: 'Riverside Run Crew',
  slug: 'riverside-run-crew-f034',
  publicDescription: 'A weekly social run along the river. All paces welcome.',
  placePath: '/p/ca/sacramento/midtown',
} as const

const VENUE_LABEL = "Drake's at the River"

// A Thursday at 18:00 UTC. The weekly RRULE advances this in whole-week steps to
// a future Thursday, keeping describeRecurrence() → "Every Thursday" stable.
const THURSDAY_START = '2025-01-02T18:00:00Z'
const WEEKLY_RRULE = 'FREQ=WEEKLY;BYDAY=TH'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface SeededGathering {
  itemId: string
  title: string
  /** Public Item URL: place-scoped /g/<group>/e/<slug> or /m/<handle>/e/<slug>. */
  url: string
}

export interface SeededF034Fixture {
  jordan: { memberId: string }
  groupId: string
  groupGathering: SeededGathering
  memberGathering: SeededGathering
  paidGathering: SeededGathering
  draftGathering: SeededGathering
}

let admin: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'F034-gathering fixture: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars are required',
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
        .eq('group_businesses.display_name', CREW.brandName)
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
    name: CREW.brandName,
    slug: CREW.slug,
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
    display_name: CREW.brandName,
    public_description: CREW.publicDescription,
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

/** Lookup-or-create a kind='gathering' Item + item_gatherings child + (optional)
 *  item_locations venue. Idempotent by member + title. Builds the public URL the
 *  way the composer does: <scope>/e/<toSlug(title)>-<first 8 of id>. */
async function ensureGathering(opts: {
  founderMemberId: string
  founderHandle: string
  title: string
  description: string
  startsAt: string | null
  recurrenceRule: string | null
  capacity: number | null
  costCents: number | null
  whatToBring: string | null
  groupId: string | null
  brandLabel: string | null
  venueLocationId: string | null
  state: 'draft' | 'published'
}): Promise<SeededGathering> {
  const sb = adminClient()

  let itemId: string
  const { data: existing } = await sb
    .from('items')
    .select('id')
    .eq('member_id', opts.founderMemberId)
    .eq('kind', 'gathering')
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
      kind: 'gathering',
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
          .eq('kind', 'gathering')
          .eq('title', opts.title)
          .limit(1)
          .maybeSingle()
        if (won) itemId = won.id
        else throw new Error(`ensureGathering(${opts.title}) items: ${itemErr.message}`)
      } else {
        throw new Error(`ensureGathering(${opts.title}) items: ${itemErr.message}`)
      }
    }
    const { error: gErr } = await sb.from('item_gatherings').insert({
      item_id: itemId,
      starts_at: opts.startsAt,
      recurrence_rule: opts.recurrenceRule,
      capacity: opts.capacity,
      cost_cents: opts.costCents,
      what_to_bring: opts.whatToBring,
      host_member_id: opts.founderMemberId,
    })
    if (gErr && !isUniqueViolation(gErr.message)) {
      throw new Error(`ensureGathering(${opts.title}) item_gatherings: ${gErr.message}`)
    }
    if (opts.venueLocationId) {
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

  const slug = `${toSlug(opts.title)}-${itemId.slice(0, 8)}`
  const url = opts.groupId
    ? `${CREW.placePath}/g/${CREW.slug}/e/${slug}`
    : `/m/${opts.founderHandle}/e/${slug}`
  return { itemId, title: opts.title, url }
}

/** Seed Jordan, the venue, an active Crew Group, and the gathering Items.
 *  Call from `test.beforeAll`. Idempotent across reruns. */
export async function seedF034Fixture(): Promise<SeededF034Fixture> {
  const jordanId = await ensureIdentity(JORDAN)
  // T095 — opt Jordan into discoverability so the "Hosted by Jordan" line on
  // the Member-hosted gathering page renders a link (post-T095 default is false).
  await markMemberDiscoverable(adminClient(), jordanId)
  const venueId = await ensureLocation({
    label: VENUE_LABEL,
    founderMemberId: jordanId,
  })
  const groupId = await ensureBusinessGroup({
    founderMemberId: jordanId,
    anchorLocationId: venueId,
  })

  const groupGathering = await ensureGathering({
    founderMemberId: jordanId,
    founderHandle: JORDAN.handle,
    title: 'Thursday River Run',
    description: 'A weekly social run. Meet at the patio, out and back along the river.',
    startsAt: THURSDAY_START,
    recurrenceRule: WEEKLY_RRULE,
    capacity: 30,
    costCents: null, // → "Free"
    whatToBring: 'Water and a headlamp for the winter months.',
    groupId,
    brandLabel: CREW.brandName,
    venueLocationId: venueId,
    state: 'published',
  })

  const memberGathering = await ensureGathering({
    founderMemberId: jordanId,
    founderHandle: JORDAN.handle,
    title: 'Sunday Long Run',
    description: 'Hosted as an individual — no group filing. Longer, slower miles.',
    startsAt: THURSDAY_START,
    recurrenceRule: WEEKLY_RRULE,
    capacity: null,
    costCents: null,
    whatToBring: null,
    groupId: null, // member-hosted (scenario-canonical b1 shape) → /m/<handle>/e/<slug>
    brandLabel: null,
    venueLocationId: venueId,
    state: 'published',
  })

  const paidGathering = await ensureGathering({
    founderMemberId: jordanId,
    founderHandle: JORDAN.handle,
    title: 'Track Workout Series',
    description: 'Coached intervals. Ten-dollar drop-in covers the track rental.',
    startsAt: THURSDAY_START,
    recurrenceRule: WEEKLY_RRULE,
    capacity: 20,
    costCents: 1000, // → "$10.00"
    whatToBring: null,
    groupId,
    brandLabel: CREW.brandName,
    venueLocationId: venueId,
    state: 'published',
  })

  const draftGathering = await ensureGathering({
    founderMemberId: jordanId,
    founderHandle: JORDAN.handle,
    title: 'Unpublished Test Gathering',
    description: 'Draft — must not resolve publicly.',
    startsAt: THURSDAY_START,
    recurrenceRule: WEEKLY_RRULE,
    capacity: null,
    costCents: null,
    whatToBring: null,
    groupId,
    brandLabel: CREW.brandName,
    venueLocationId: venueId,
    state: 'draft', // RLS items_select_published must hide this → 404
  })

  return {
    jordan: { memberId: jordanId },
    groupId,
    groupGathering,
    memberGathering,
    paidGathering,
    draftGathering,
  }
}
