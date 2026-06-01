import { Page } from '@playwright/test'

/**
 * Drive the UI sign-in flow for evals.
 *
 * Stale-path fix (2026-06-01):
 *   - Goes to /auth/login (was /login → 404; left over from a pre-rebuild
 *     route layout). Confirmed in src/app/auth/login/page.tsx.
 *   - Form defaults to magic-link mode (src/components/AuthMethods.tsx
 *     line 17 — `showPassword=false`). The password field only renders
 *     after the "Use email + password instead" toggle is clicked.
 *   - Submit button's testid is `submit-button` (not `login-submit`).
 *
 * The helper waits for the post-login navigation (`onPasswordSuccess` in
 * login/page.tsx routes to `/` or the `?next=` target).
 */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/login')
  // Form opens in magic-link mode; click into password mode so the
  // password field mounts.
  await page.getByRole('button', { name: /Use email \+ password/i }).click()
  await page.locator('[data-testid="email-input"]').fill(email)
  await page.locator('[data-testid="password-input"]').fill(password)
  await page.locator('[data-testid="submit-button"]').click()
  // Login page redirects to `/` (or `?next=` target) on success.
  await page.waitForURL(
    (url) => url.pathname === '/' || url.pathname.startsWith('/you'),
    { timeout: 10000 },
  )
}
