import { test, expect } from '@playwright/test'

// F003 (rebuilt for F030): email-first signup/login.
//
// The pre-rebuild version of this spec targeted `/signup`, `/login`, map pins,
// and `/register-business` — all removed in the primitives rebuild. Rewritten
// against the current email-first signup page (/auth/signup, T090): a single
// "enter email" step that detects new vs returning users. Local dev
// auto-confirms (config.toml enable_confirmations=false), so a fresh signup
// yields a live session immediately.

test.use({ viewport: { width: 390, height: 844 } })

test.describe('F003 — Email-first account creation and login', () => {
  test('the signup page opens on a single email step', async ({ page }) => {
    await page.goto('/auth/signup')
    await expect(page.getByTestId('signup-form')).toBeVisible()
    await expect(page.getByTestId('email-input')).toBeVisible()
    // Password is not requested until the email is classified.
    await expect(page.getByTestId('password-input')).toHaveCount(0)
  })

  test('a malformed email is rejected before any account lookup', async ({ page }) => {
    await page.goto('/auth/signup')
    await page.getByTestId('email-input').fill('a@b') // passes native type=email, fails our regex
    await page.getByTestId('submit-button').click()
    await expect(page.getByTestId('auth-error')).toBeVisible()
  })

  test('an unknown email advances to "set a password"', async ({ page }) => {
    await page.goto('/auth/signup')
    await page.getByTestId('email-input').fill(`unknown+${Date.now()}@example.test`)
    await page.getByTestId('submit-button').click()
    await expect(page.getByTestId('set-password-heading')).toBeVisible()
    await expect(page.getByTestId('password-input')).toBeVisible()
    // Magic-link is offered as a secondary option below the password field.
    await expect(page.getByTestId('magic-link-secondary')).toBeVisible()
  })

  test('a password under 8 characters is rejected on the set-password step', async ({ page }) => {
    await page.goto('/auth/signup')
    await page.getByTestId('email-input').fill(`weak+${Date.now()}@example.test`)
    await page.getByTestId('submit-button').click()
    await expect(page.getByTestId('set-password-heading')).toBeVisible()
    await page.getByTestId('password-input').fill('short')
    await page.getByTestId('submit-button').click()
    await expect(page.getByTestId('auth-error')).toBeVisible()
  })

  test('a new email/password account is created and the session lands authenticated', async ({
    page,
  }) => {
    const email = `create+${Date.now()}@example.test`
    await page.goto('/auth/signup')
    await page.getByTestId('email-input').fill(email)
    await page.getByTestId('submit-button').click()
    await expect(page.getByTestId('set-password-heading')).toBeVisible()
    await page.getByTestId('password-input').fill('F003-strong-pass')
    await page.getByTestId('submit-button').click()
    // Auto-confirm → live session → redirected off the signup page (to onboarding).
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/signup'), { timeout: 10000 })
  })

  test('a returning email is detected and routed to "enter password"', async ({ page }) => {
    // Create an account, then re-enter the same email: detection must now flip
    // to the returning (enter-password) phase rather than set-password.
    const email = `returning+${Date.now()}@example.test`
    await page.goto('/auth/signup')
    await page.getByTestId('email-input').fill(email)
    await page.getByTestId('submit-button').click()
    await expect(page.getByTestId('set-password-heading')).toBeVisible()
    await page.getByTestId('password-input').fill('F003-strong-pass')
    await page.getByTestId('submit-button').click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/signup'), { timeout: 10000 })

    // Re-enter the same email — now registered.
    await page.goto('/auth/signup')
    await page.getByTestId('email-input').fill(email)
    await page.getByTestId('submit-button').click()
    await expect(page.getByTestId('enter-password-heading')).toBeVisible()
    await expect(page.getByTestId('set-password-heading')).toHaveCount(0)
  })
})
