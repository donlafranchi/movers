import { test, expect } from '@playwright/test'
import { signIn } from '../helpers/auth'
import {
  seedF032Fixture,
  isFollowing,
  NADIA,
  THEO,
  GHOST,
  LISTED_GROUP,
  UNLISTED_GROUP,
  ITEM,
  type SeededF032Fixture,
} from '../fixtures/F032-member-page'

// F032: A viewer finds a member's public page and follows them.
// Source: planning/now/scenario-F032-viewer-finds-member-page-and-follows.md
//
// One describe per Given/When/Then beat. The page is read-mostly; the only
// write is the real member→member Follow / Unfollow (T091 handlers) — F032 is
// where member_follows lights up end-to-end (unlike F035's deferred group-follow).

let SEEDED: SeededF032Fixture
test.beforeAll(async () => {
  SEEDED = await seedF032Fixture()
})

const NADIA_URL = `/m/${NADIA.handle}`

test.describe('F032 — Viewer finds a member page and follows', () => {
  test.describe('Beat 1 — Anonymous visitor can read the Member page', () => {
    test('Given an anon visitor | When /m/[handle] loads | Then header, items, listed groups, and standing badge render; unlisted groups + place-interests do not', async ({
      page,
    }) => {
      const res = await page.goto(NADIA_URL)

      // Public read surface — no auth gate.
      expect(res?.status()).toBe(200)
      await expect(page.getByTestId('member-name')).toHaveText(NADIA.displayName)
      await expect(page.getByTestId('member-handle')).toContainText(`@${NADIA.handle}`)
      await expect(page.getByTestId('member-handle')).toContainText(NADIA.pronouns)
      await expect(page.getByTestId('member-bio')).toContainText(NADIA.bio)

      // Standing badge — Nadia stewards a non-business Group (member.md / groups.md).
      await expect(page.getByTestId('member-standing-badge')).toBeVisible()

      // Authored published Item surfaces.
      await expect(page.getByTestId('member-item')).toContainText(ITEM.title)

      // Privacy gate: only LISTED group memberships surface; the unlisted one
      // (and place-interests, which have no surface at all) must NOT appear.
      await expect(page.getByTestId('member-group')).toContainText(LISTED_GROUP.name)
      await expect(page.getByText(UNLISTED_GROUP.name)).toHaveCount(0)
    })
  })

  test.describe('Beat 2 — Anonymous follow tap routes to sign-in with a return URL', () => {
    test('Given an anon visitor | When they see the Follow CTA | Then it links to /auth/login with next set to this page', async ({
      page,
    }) => {
      await page.goto(NADIA_URL)
      const cta = page.getByTestId('follow-member-signin')
      await expect(cta).toBeVisible()
      await expect(cta).toHaveAttribute('href', `/auth/login?next=${NADIA_URL}`)
      // The logged-in follow button must NOT be present for anon.
      await expect(page.getByTestId('follow-member')).toHaveCount(0)
    })
  })

  test.describe('Beat 3 — Authenticated follow writes a row + event, and unfollow reverses it', () => {
    test('Given Theo logged in and not following | When he taps Follow | Then the CTA flips to Following and a member_follows row exists; tapping again unfollows', async ({
      page,
    }) => {
      await signIn(page, THEO.email, THEO.password)
      await page.goto(NADIA_URL)

      // Starts "not following" (the seed cleared any prior edge).
      const followBtn = page.getByTestId('follow-member')
      await expect(followBtn).toBeVisible()

      // Tap Follow → optimistic flip to "Following" + a persisted active row.
      await followBtn.click()
      await expect(page.getByTestId('following-member')).toBeVisible()
      await expect
        .poll(() => isFollowing(SEEDED.theoId, SEEDED.nadiaId), { timeout: 5000 })
        .toBe(true)

      // Tap again → Unfollow → back to "Follow", soft-unfollowed in the DB.
      await page.getByTestId('following-member').click()
      await expect(page.getByTestId('follow-member')).toBeVisible()
      await expect
        .poll(() => isFollowing(SEEDED.theoId, SEEDED.nadiaId), { timeout: 5000 })
        .toBe(false)
    })
  })

  test.describe('Beat 4 — Self-view shows Edit profile, not Follow', () => {
    test('Given Nadia viewing her own page | When it loads | Then Edit profile shows and no Follow CTA renders', async ({
      page,
    }) => {
      await signIn(page, NADIA.email, NADIA.password)
      await page.goto(NADIA_URL)
      await expect(page.getByTestId('member-edit-profile')).toHaveAttribute('href', '/you')
      await expect(page.getByTestId('follow-member')).toHaveCount(0)
      await expect(page.getByTestId('follow-member-signin')).toHaveCount(0)
    })
  })

  test.describe('Beat 5 — Soft-deleted or nonexistent Member returns 404', () => {
    test('Given a soft-deleted Member | When any viewer loads her page | Then 404', async ({
      page,
    }) => {
      const res = await page.goto(`/m/${GHOST.handle}`)
      expect(res?.status()).toBe(404)
    })

    test('Given a handle that does not exist | When loaded | Then 404', async ({ page }) => {
      const res = await page.goto('/m/nobody-f032-does-not-exist')
      expect(res?.status()).toBe(404)
    })
  })
})
