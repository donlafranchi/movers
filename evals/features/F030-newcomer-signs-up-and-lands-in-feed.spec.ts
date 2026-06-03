import { test, expect } from '@playwright/test'
import { signUpWithPassword, signInViaEmailFirst } from '../helpers/auth'
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
//   2. Signup (email/password, new user) → profile → locality → interests.
//   3. Feed re-renders against the chosen scope.
//   4. Empty-state widen-locality when no Items match.
//
// Auth-method note (b1): email/password is the primary method via the
// email-first signup page (/auth/signup) — a single email step that detects
// new vs returning users. Local dev auto-confirms (config.toml
// enable_confirmations=false) so signUp yields a live session. Magic-link is a
// secondary option (not exercised headless — a link can't be clicked).

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

  test.describe('AC2 + AC3 — Email/password signup → onboarding → feed re-renders against the chosen scope', () => {
    test('Given a new visitor signs up with email + password | When they finish the three-step onboarding | Then each step writes and they land on a feed scoped to their chosen locality', async ({
      page,
    }) => {
      // A genuinely new email → the signup page routes to "set a password",
      // creates the account, and (local auto-confirm) lands us on /onboarding.
      const email = `newcomer+${Date.now()}@example.test`
      await signUpWithPassword(page, email, 'F030-newcomer-pass')
      await page.waitForURL((url) => url.pathname === '/onboarding')

      // Step 1 — Profile. Name + handle required.
      await expect(page.getByText('Tell us who you are')).toBeVisible()
      await page.getByTestId('onboarding-name').fill('New Comer')
      await page.getByTestId('onboarding-handle').fill(`newcomer-${Date.now().toString().slice(-6)}`)
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

      // Idempotent re-entry: now onboarded, revisiting /onboarding → /.
      await page.goto('/onboarding')
      await page.waitForURL((url) => url.pathname === '/')
      await expect(page.getByTestId('locality-feed')).toBeVisible()
    })

    test('Given a returning member enters their email | When the page detects the account | Then it shows "enter password" and signs them in', async ({
      page,
    }) => {
      // NADIA is seeded (a registered auth user) → the email-first page must
      // detect her and show the enter-password (returning) phase, then log in.
      await signInViaEmailFirst(page, NADIA.email, NADIA.password)
      // Signed in. NADIA has no primary_home → routed to onboarding (next=/onboarding).
      await expect(page).toHaveURL(/\/onboarding|\/$/)
    })
  })
})
