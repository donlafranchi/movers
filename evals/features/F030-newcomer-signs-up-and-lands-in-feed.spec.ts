import { test, expect } from '@playwright/test'
import { signIn } from '../helpers/auth'
import {
  seedF030Fixture,
  NADIA,
  OAK_PARK_F030,
  BARREN_F030,
  PRODUCT,
  GATHERING,
  type SeededF030Fixture,
} from '../fixtures/F030-newcomer'

// F030: A newcomer signs up and lands in the awareness feed.
// Source: planning/now/scenario-F030-newcomer-signs-up-and-lands-in-feed.md
//
// One test per acceptance criterion:
//   1. Anonymous visitor sees a locality-defaulted feed + "Make this yours" CTA.
//   2. Signup → profile → locality → interests onboarding (each step writes).
//   3. Feed re-renders against the chosen scope.
//   4. Empty-state widen-locality when no Items match.
//
// Auth-method note (b1 ratified): magic-link is the primary method; the eval
// signs in with the password path (helpers/auth.ts) for determinism — a magic
// link can't be clicked headless. The post-auth onboarding flow is identical.

let SEEDED: SeededF030Fixture
test.beforeAll(async () => {
  SEEDED = await seedF030Fixture()
})
void (() => SEEDED)

test.describe('F030 — A newcomer signs up and lands in the feed', () => {
  test.describe('AC1 — Anonymous visitor sees a locality-defaulted feed', () => {
    test('Given an anonymous visitor opens / scoped to the seeded locality | When the page loads | Then the feed shows nearby Items with a "Make this yours" CTA and a scope picker', async ({
      page,
    }) => {
      const res = await page.goto(`/?place=${OAK_PARK_F030.slug}`)
      expect(res?.status()).toBe(200)

      // The locality feed renders, anon.
      await expect(page.getByTestId('locality-feed')).toBeVisible()
      // "Make this yours" signup CTA above the feed (anon only).
      await expect(page.getByTestId('signup-cta')).toBeVisible()
      // Inline scope picker to change locality before signing up.
      await expect(page.getByTestId('scope-picker')).toBeVisible()
      // Nearby Items appear.
      const cards = page.getByTestId('feed-item-card')
      await expect(cards.first()).toBeVisible()
      await expect(page.getByText(PRODUCT.title)).toBeVisible()
      await expect(page.getByText(GATHERING.title)).toBeVisible()
    })
  })

  test.describe('AC4 — Empty-state widen-locality when nothing matches', () => {
    test('Given a locality with no Items | When the visitor lands there | Then a friendly empty-state offers a one-tap widen-the-locality affordance', async ({
      page,
    }) => {
      await page.goto(`/?place=${BARREN_F030.slug}`)
      await expect(page.getByTestId('feed-empty-state')).toBeVisible()
      await expect(page.getByTestId('widen-locality')).toBeVisible()
    })
  })

  test.describe('AC2 + AC3 — Signup → onboarding → feed re-renders against the chosen scope', () => {
    test('Given a newcomer completes auth | When they finish the three-step onboarding | Then each step writes and they land on a feed scoped to their chosen locality', async ({
      page,
    }) => {
      // Sign in as the seeded newcomer (no primary_home yet → routes to onboarding).
      await signIn(page, NADIA.email, NADIA.password)
      await page.goto('/onboarding')

      // Step 1 — Profile. Name + handle required.
      await expect(page.getByText('Tell us who you are')).toBeVisible()
      await page.getByTestId('onboarding-name').fill(NADIA.displayName)
      await page.getByTestId('onboarding-handle').fill(NADIA.handle)
      await page.getByRole('button', { name: /Continue/i }).click()

      // Step 2 — Home locality (required). Pick the seeded Oak Park place.
      await expect(page.getByText('Where’s home?')).toBeVisible()
      await page
        .getByTestId('onboarding-locality')
        .selectOption({ label: OAK_PARK_F030.displayName })
      await page.getByRole('button', { name: /Continue/i }).click()

      // Step 3 — Interests (skippable). Pick two, finish.
      await expect(page.getByTestId('onboarding-interests')).toBeVisible()
      await page.getByRole('button', { name: 'Food & drink' }).click()
      await page.getByRole('button', { name: 'Crafts & makers' }).click()
      await page.getByRole('button', { name: /Show me my feed/i }).click()

      // Lands on / — the feed re-renders against the chosen primary_home scope.
      await page.waitForURL((url) => url.pathname === '/')
      await expect(page.getByTestId('locality-feed')).toBeVisible()
      // The signup CTA is gone now they're authenticated.
      await expect(page.getByTestId('signup-cta')).toHaveCount(0)
      // The Items near their chosen locality are present.
      await expect(page.getByText(PRODUCT.title)).toBeVisible()
      await expect(page.getByText(GATHERING.title)).toBeVisible()
    })

    test('Given the newcomer already onboarded | When they revisit /onboarding | Then they are redirected to the feed (idempotent re-entry)', async ({
      page,
    }) => {
      await signIn(page, NADIA.email, NADIA.password)
      await page.goto('/onboarding')
      // Nadia now has a primary_home from the prior test → redirect to /.
      await page.waitForURL((url) => url.pathname === '/')
      await expect(page.getByTestId('locality-feed')).toBeVisible()
    })
  })
})
