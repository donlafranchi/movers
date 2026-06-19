import { test, expect } from '@playwright/test'
import { signIn } from '../helpers/auth'
import {
  seedF042Fixture,
  reactivateMemberFollow,
  reactivateGroupMembership,
  reactivateVenueFollow,
  followIsActive,
  membershipIsActive,
  venueSavedSearchIsActive,
  memberEventExists,
  groupEventExists,
  READER,
  MUTATOR,
  EMPTY,
  FOLLOWED_MEMBER,
  GROUP,
  VENUE,
  type SeededF042Fixture,
} from '../fixtures/F042-following'

// F042: A member follows a producer, a group, and a venue.
// Source: planning/next/scenario-F042-member-follows-producer-group-venue.md
//
// The three follow substrates (member_follows / group_memberships /
// member_saved_searches) are written by F032 / F035 / F033 respectively; this
// scenario verifies the *unified* read surface (/you "Following" summary +
// /you/following management page) and the Unfollow / Leave soft-deletes.
//
// Two viewers keep reads and mutations from racing under fullyParallel:true —
// READER's three follows are never mutated; MUTATOR's are reactivated at the
// top of each mutate beat (re-run safe).

let SEEDED: SeededF042Fixture
test.beforeAll(async () => {
  SEEDED = await seedF042Fixture()
})

// Resilient row locators: a row is the nearest list item / card containing the
// entity's display name. Buttons are matched by their user-facing label, which
// the scenario fixes ("Unfollow" for People + Venues, "Leave" for Groups).
function rowByName(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('listitem').filter({ hasText: name })
}

test.describe('F042 — Member follows a producer, a group, and a venue', () => {
  test.describe('Beat 1 — Following summary on /you', () => {
    test('Given a Member with follows across People, Groups, Venues | When they load /you | Then a "Following" section shows the entities and a "More" link to /you/following', async ({
      page,
    }) => {
      await signIn(page, READER.email, READER.password)
      await page.goto('/you')

      // Why: F042 surfaces all three substrates in ONE "Following" section
      // without leaking the substrate distinction (scenario "The Person").
      await expect(page.getByRole('heading', { name: /Following/i })).toBeVisible()

      // Mixed entities render by display name (Member), name (Group), label (Venue).
      await expect(page.getByText(FOLLOWED_MEMBER.displayName)).toBeVisible()
      await expect(page.getByText(GROUP.name)).toBeVisible()
      await expect(page.getByText(VENUE.label)).toBeVisible()

      // Why: the summary is a glance; full management lives one tap away at
      // /you/following (scenario Surfaces → "More" link).
      const more = page.getByRole('link', { name: /More/i })
      await expect(more).toHaveAttribute('href', /\/you\/following$/)
    })
  })

  test.describe('Beat 2 — Full follows list at /you/following', () => {
    test('Given a Member with follows across People, Groups, Venues | When they load /you/following | Then three sections (People / Groups / Venues) list each entity with the right affordance', async ({
      page,
    }) => {
      await signIn(page, READER.email, READER.password)
      await page.goto('/you/following')

      // Three flat sections, each a heading (scenario "Full follows list").
      await expect(page.getByRole('heading', { name: /^People$/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: /^Groups$/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: /^Venues$/i })).toBeVisible()

      // People row → display name + Unfollow.
      // Why: People are member_follows; the affordance is "Unfollow" (not "Leave")
      // — Leave is reserved for Groups (scenario "The Story").
      const peopleRow = rowByName(page, FOLLOWED_MEMBER.displayName)
      await expect(peopleRow).toBeVisible()
      await expect(peopleRow.getByRole('button', { name: /Unfollow/i })).toBeVisible()

      // Group row → name + Leave (a membership, not a follow).
      const groupRow = rowByName(page, GROUP.name)
      await expect(groupRow).toBeVisible()
      await expect(groupRow.getByRole('button', { name: /Leave/i })).toBeVisible()

      // Venue row → label + Unfollow.
      const venueRow = rowByName(page, VENUE.label)
      await expect(venueRow).toBeVisible()
      await expect(venueRow.getByRole('button', { name: /Unfollow/i })).toBeVisible()
    })
  })

  test.describe('Beat 3 — Unfollow a People row writes member_follows.unfollowed_at + event', () => {
    test('Given the Member on /you/following | When they Unfollow a person | Then unfollowed_at writes, member.unfollowed logs, and the row leaves the list', async ({
      page,
    }) => {
      await reactivateMemberFollow(SEEDED.mutatorId, SEEDED.followedMemberId)
      await signIn(page, MUTATOR.email, MUTATOR.password)
      await page.goto('/you/following')

      const peopleRow = rowByName(page, FOLLOWED_MEMBER.displayName)
      await peopleRow.getByRole('button', { name: /Unfollow/i }).click()

      // Soft-delete is the scenario's exact "Then" — assert the column flips.
      await expect
        .poll(() => followIsActive(SEEDED.mutatorId, SEEDED.followedMemberId), { timeout: 5000 })
        .toBe(false)
      // Why: every soft-delete logs an audit event per substrate (scenario
      // "Data Captured" → implicit event log; member_events kind = member.unfollowed).
      // The event is logged against the FOLLOWER (the actor performing the
      // unfollow), not the followed member — confirmed against the live event log.
      await expect
        .poll(() => memberEventExists(SEEDED.mutatorId, 'member.unfollowed'), {
          timeout: 5000,
        })
        .toBe(true)

      // Scenario allows "row disappears (or shows an Undo affordance)" — the
      // implementation keeps the row and flips the action to Undo. Assert the
      // Undo affordance so a re-follow path stays reachable for a few seconds.
      await expect(
        rowByName(page, FOLLOWED_MEMBER.displayName).getByRole('button', { name: /Undo/i }),
      ).toBeVisible()
    })
  })

  test.describe('Beat 4 — Leave a Group row writes group_memberships.left_at + event', () => {
    test('Given the Member on /you/following | When they Leave a group | Then left_at writes, group.member_left logs, and the row leaves the list', async ({
      page,
    }) => {
      await reactivateGroupMembership(SEEDED.groupId, SEEDED.mutatorId)
      await signIn(page, MUTATOR.email, MUTATOR.password)
      await page.goto('/you/following')

      const groupRow = rowByName(page, GROUP.name)
      await groupRow.getByRole('button', { name: /Leave/i }).click()

      await expect
        .poll(() => membershipIsActive(SEEDED.groupId, SEEDED.mutatorId), { timeout: 5000 })
        .toBe(false)
      // Why: group exit logs group.member_left (group_events) — distinct kind
      // from the People/Venue substrates (scenario "Unfollow / Leave writes…").
      await expect
        .poll(() => groupEventExists(SEEDED.groupId, 'group.member_left'), { timeout: 5000 })
        .toBe(true)

      // Row stays; Leave flips to Undo (scenario "or shows an Undo affordance").
      await expect(
        rowByName(page, GROUP.name).getByRole('button', { name: /Undo/i }),
      ).toBeVisible()
    })
  })

  test.describe('Beat 5 — Unfollow a Venue row writes member_saved_searches.removed_at + event', () => {
    test('Given the Member on /you/following | When they Unfollow a venue | Then removed_at writes, member.saved_search.removed logs, and the row leaves the list', async ({
      page,
    }) => {
      await reactivateVenueFollow(SEEDED.mutatorId, SEEDED.venueLocationId, VENUE.label)
      await signIn(page, MUTATOR.email, MUTATOR.password)
      await page.goto('/you/following')

      const venueRow = rowByName(page, VENUE.label)
      await venueRow.getByRole('button', { name: /Unfollow/i }).click()

      await expect
        .poll(() => venueSavedSearchIsActive(SEEDED.mutatorId, SEEDED.venueLocationId), {
          timeout: 5000,
        })
        .toBe(false)
      // Why: venue-follow is the saved-search substrate; its soft-delete logs
      // member.saved_search.removed (member_events) — scenario "Unfollow / Leave…".
      await expect
        .poll(() => memberEventExists(SEEDED.mutatorId, 'member.saved_search.removed'), {
          timeout: 5000,
        })
        .toBe(true)

      // Row stays; Unfollow flips to Undo (scenario "or shows an Undo affordance").
      await expect(
        rowByName(page, VENUE.label).getByRole('button', { name: /Undo/i }),
      ).toBeVisible()
    })
  })

  test.describe('Beat 6 — Empty state when nothing is followed', () => {
    test('Given a Member with no follows | When they load /you/following | Then an empty-state with a CTA back to explore renders', async ({
      page,
    }) => {
      await signIn(page, EMPTY.email, EMPTY.password)
      await page.goto('/you/following')

      // Why: the empty state must invite re-engagement, not dead-end (scenario
      // Edge Cases → "Nothing followed yet — start exploring.").
      await expect(page.getByText(/Nothing followed yet/i)).toBeVisible()
      const cta = page.getByRole('link', { name: /explor/i })
      await expect(cta.first()).toHaveAttribute('href', /\/(explore)?$/)
    })
  })

  test.describe('Beat 7 — Group counts respect the public privacy gate', () => {
    test('Given a followed Group with a listed-vs-left member split | When /you/following surfaces a member count | Then it counts active listed memberships only', async ({
      page,
    }) => {
      await signIn(page, READER.email, READER.password)
      await page.goto('/you/following')

      const groupRow = rowByName(page, GROUP.name)
      await expect(groupRow).toBeVisible()

      // The scenario's "When … surfaces 'follower count'" is conditional: assert
      // ONLY if the row renders a count. The soft-left member must be excluded.
      // Why: the public Group page counts active explicit memberships in a
      // *listed* Group (migration 029); /you/following must not leak a raw count
      // that includes departed members (scenario "Counts respect privacy gates").
      const expected = SEEDED.groupActiveListedCount
      const countText = groupRow.getByText(/\b\d+\b/)
      if (await countText.count()) {
        await expect(countText.first()).toHaveText(new RegExp(`\\b${expected}\\b`))
      }
    })
  })
})
