import { test, expect } from '@playwright/test'
import { signIn } from '../helpers/auth'
import {
  seedF033Fixture,
  isFollowingVenue,
  oakParkHasCentroid,
  VIEWER,
  DRAKES,
  EMPTY,
  BARE,
  PRIVATE_VENUE,
  TRIVIA,
  RUNCLUB,
  BIRTHDAY,
  type SeededF033Fixture,
} from '../fixtures/F033-venue'

// F033: A viewer finds a venue page and sees what's happening there.
// Source: planning/next/scenario-F033-viewer-finds-venue-page.md
//
// One describe per Acceptance-Criteria beat. The page is read-mostly; the only
// write is the venue Follow / Unfollow (member_saved_searches via T102's
// followVenueAction). Written from the scenario alone.

let SEEDED: SeededF033Fixture
test.beforeAll(async () => {
  SEEDED = await seedF033Fixture()
})

// The "What's happening here" <section> (no testid wrapper on the component) —
// scoped by its heading so we can assert membership precisely against "nearby".
const hereSection = (page: import('@playwright/test').Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: /What's happening here/i }) })

test.describe('F033 — Viewer finds a venue page', () => {
  test.describe('Beat 1 — Anonymous visitor reads the venue page', () => {
    test('Given an anon visitor | When /p/[…place]/l/[slug] loads | Then header (name + address) and About render; no auth required', async ({
      page,
    }) => {
      const res = await page.goto(DRAKES.url)

      // Loop 3 (Land here): the venue page is a fully public read surface.
      expect(res?.status()).toBe(200)
      await expect(page.getByTestId('venue-name')).toHaveText(DRAKES.label)
      await expect(page.getByTestId('venue-about')).toBeVisible()
      // Why: the venue's kind tag + Member-authored description live in About
      // (scenario "About block"); both are part of the no-auth read surface.
      await expect(page.getByTestId('venue-about')).toContainText(DRAKES.description)
      await expect(page.getByText(DRAKES.streetAddress)).toBeVisible()
    })
  })

  test.describe('Beat 2 — Distance displays from the viewer\'s primary-home Place centroid', () => {
    test('Given an auth\'d Member with a primary_home Place | When they view the venue page | Then the header shows a distance line', async ({
      page,
    }) => {
      // Distance derives from the primary_home Place CENTROID, not a raw
      // Location coordinate (scenario Why). Skip only if the seeded Place has no
      // centroid yet (substrate gap, not an F033 regression).
      test.skip(!(await oakParkHasCentroid()), 'oak-park place has no centroid; distance cannot render')
      await signIn(page, VIEWER.email, VIEWER.password)
      await page.goto(DRAKES.url)
      // Why: the distance text reflects the Member's Place-level awareness scope.
      // Asserting presence + the "mi away" shape (not an exact mileage) keeps the
      // test robust to centroid coordinates while still proving the line renders.
      await expect(page.getByTestId('venue-distance')).toBeVisible()
      await expect(page.getByTestId('venue-distance')).toContainText(/mi away/)
    })
  })

  test.describe('Beat 3 — Anonymous visitor distance is omitted', () => {
    test('Given an anon visitor with no primary_home | When the venue page loads | Then no distance line renders; the rest of the page is intact', async ({
      page,
    }) => {
      await page.goto(DRAKES.url)
      // Why: the platform never requires location disclosure from anon visitors
      // (policy.md opt-out default) — omission, not a placeholder.
      await expect(page.getByTestId('venue-distance')).toHaveCount(0)
      await expect(page.getByTestId('venue-name')).toHaveText(DRAKES.label)
    })
  })

  test.describe('Beat 4 — "What\'s happening here" shows only venue-hosted Items', () => {
    test('Given Drake\'s hosts Trivia (own Group), Run Club (other host), and a private party | When the page loads | Then only Trivia is in "here"', async ({
      page,
    }) => {
      await page.goto(DRAKES.url)
      const here = hereSection(page)
      await expect(here).toBeVisible()
      // Why: the venue page is the venue's OWN storefront — scoped by Host
      // (items.group_id = owning Group), not by Venue attachment. Trivia is
      // hosted by Drake's Group; the Run Club is hosted by a different Group and
      // the birthday party by a Member — neither belongs in "here".
      await expect(here.getByText(TRIVIA.title)).toBeVisible()
      await expect(here.getByText(RUNCLUB.title)).toHaveCount(0)
      await expect(here.getByText(BIRTHDAY.title)).toHaveCount(0)
    })
  })

  test.describe('Beat 5 — "What\'s happening nearby" shows public non-venue-hosted Items', () => {
    test('Given public Items nearby hosted by others | When the viewer expands "nearby" | Then the Run Club appears; Trivia (owning Group) and the private party do not', async ({
      page,
    }) => {
      await page.goto(DRAKES.url)
      const nearby = page.getByTestId('venue-nearby')
      await expect(nearby).toBeVisible()
      // The section is a collapsed <details> by default (so it never competes
      // with "here") — expand it, matching the scenario's "When the viewer
      // expands the nearby section".
      await nearby.locator('summary').click()
      // Why: secondary discovery — Items near the venue hosted by SOMEONE ELSE.
      // The Run Club (different host, public, within 5 km) belongs here; the
      // owning Group's own Items are excluded so this never competes with "here".
      await expect(nearby.getByText(RUNCLUB.title)).toBeVisible()
      await expect(nearby.getByText(TRIVIA.title)).toHaveCount(0)
      await expect(nearby.getByText(BIRTHDAY.title)).toHaveCount(0)
    })
  })

  test.describe('Beat 6 — Private events at a venue surface nowhere', () => {
    test('Given a private (unpublished) party attached to Drake\'s | When the page loads | Then it appears in neither section', async ({
      page,
    }) => {
      await page.goto(DRAKES.url)
      // Why: private events live only on the Host's own page (policy.md opt-out).
      // At b1 "private" is modelled as an unpublished draft — it is absent from
      // the base-table "here" RPC and the published-only MV behind "nearby".
      await expect(page.getByText(BIRTHDAY.title)).toHaveCount(0)
    })
  })

  test.describe('Beat 7 — "Follow this venue" is the primary CTA (auth\'d write + reverse)', () => {
    test('Given the viewer logged in and not following | When they tap Follow | Then the CTA flips to Following and a member_saved_searches row exists; tapping again unfollows', async ({
      page,
    }) => {
      await signIn(page, VIEWER.email, VIEWER.password)
      await page.goto(DRAKES.url)

      const followBtn = page.getByTestId('follow-venue')
      await expect(followBtn).toBeVisible()

      // Tap Follow → optimistic flip + a persisted active saved-search row keyed
      // on location_id (the standing relationship that serves Loop 8).
      await followBtn.click()
      await expect(page.getByTestId('following-venue')).toBeVisible()
      await expect
        .poll(() => isFollowingVenue(SEEDED.viewerId, SEEDED.drakesLocationId), { timeout: 5000 })
        .toBe(true)

      // Tap again → Unfollow → back to "Follow this venue", soft-removed in the DB.
      await page.getByTestId('following-venue').click()
      await expect(page.getByTestId('follow-venue')).toBeVisible()
      await expect
        .poll(() => isFollowingVenue(SEEDED.viewerId, SEEDED.drakesLocationId), { timeout: 5000 })
        .toBe(false)
    })
  })

  test.describe('Beat 8 — Anonymous tap on "Follow this venue" routes to sign-in with a return URL', () => {
    test('Given an anon visitor | When they see the Follow CTA | Then it links to /auth/login with next set to this page', async ({
      page,
    }) => {
      await page.goto(DRAKES.url)
      const cta = page.getByTestId('follow-venue-signin')
      await expect(cta).toBeVisible()
      // Why: follow requires auth (writes a row); the return-URL pattern lands
      // the visitor back on the venue page with the follow active.
      await expect(cta).toHaveAttribute('href', `/auth/login?next=${DRAKES.url}`)
      await expect(page.getByTestId('follow-venue')).toHaveCount(0)
    })
  })

  test.describe('Beat 9 — "Host something here" opens the composer with the Location pre-attached', () => {
    test('Given the viewer logged in | When the page loads | Then the Host CTA targets the gathering composer with this location pre-attached', async ({
      page,
    }) => {
      await signIn(page, VIEWER.email, VIEWER.password)
      await page.goto(DRAKES.url)
      // Why: verb-first composer — the entry point is the venue, and the Location
      // is pre-attached (location=<id>) so the most natural use case is one tap.
      await expect(page.getByTestId('venue-host-cta')).toHaveAttribute(
        'href',
        `/you/sell?compose=gathering&location=${SEEDED.drakesLocationId}`,
      )
    })

    test('Given an anon visitor | When they see the Host CTA | Then it routes to sign-in with a return URL back to this venue', async ({
      page,
    }) => {
      await page.goto(DRAKES.url)
      // Why: hosting requires auth; the return URL preserves the venue context so
      // the composer opens with the Location still pre-attached after sign-in.
      const expectedNext = encodeURIComponent(`${DRAKES.url}?action=host`)
      await expect(page.getByTestId('venue-host-cta')).toHaveAttribute(
        'href',
        `/auth/login?next=${expectedNext}`,
      )
    })
  })

  test.describe('Beat 10 — Venue with an anchored Group but no Items shows an empty state', () => {
    test('Given a listed venue with a business Group but no published Items | When the page loads | Then "here" shows the empty state and Follow stays prominent', async ({
      page,
    }) => {
      const res = await page.goto(EMPTY.url)
      expect(res?.status()).toBe(200)
      // Why: the empty state must NOT nudge the viewer to host — the venue owner
      // creates their own content; the viewer's useful action is to follow.
      await expect(page.getByTestId('venue-here-empty')).toBeVisible()
      await expect(page.getByTestId('venue-here-empty')).toContainText('Nothing scheduled yet.')
      await expect(page.getByTestId('follow-venue-signin')).toBeVisible()
    })
  })

  test.describe('Beat 11 — Venue with no anchored business Group shows a minimal page', () => {
    test('Given a listed venue with no anchored business Group | When the page loads | Then "What\'s happening here" is absent but both CTAs render', async ({
      page,
    }) => {
      const res = await page.goto(BARE.url)
      expect(res?.status()).toBe(200)
      await expect(page.getByTestId('venue-name')).toHaveText(BARE.label)
      // Why: not every Location has an owning business Group (a park, a hall) —
      // the "here" section is scoped by owning Group, so it is omitted entirely
      // rather than rendered empty, but the page stays useful (Follow + Host).
      await expect(page.getByRole('heading', { name: /What's happening here/i })).toHaveCount(0)
      await expect(page.getByTestId('follow-venue-signin')).toBeVisible()
      await expect(page.getByTestId('venue-host-cta')).toBeVisible()
    })
  })

  test.describe('Beat 12 — A private venue 404s to non-owner viewers', () => {
    test('Given a discoverability=private Location | When an anon visitor opens its URL | Then 404 (existence not leaked)', async ({
      page,
    }) => {
      const res = await page.goto(PRIVATE_VENUE.url)
      // Why: a private venue is not a public discovery surface; RLS yields no row
      // → 404 to non-owners (edge case in the scenario).
      expect(res?.status()).toBe(404)
    })

    test('Given a venue slug that does not exist | When loaded | Then 404', async ({ page }) => {
      const res = await page.goto(`${PRIVATE_VENUE.url}-nope-does-not-exist`)
      expect(res?.status()).toBe(404)
    })
  })
})
