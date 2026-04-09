import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F003: Auth — Account Creation and Login', () => {
  const testEmail = `testuser+${Date.now()}@example.com`;
  const testPassword = 'securepass123';

  test('sign-up page is accessible', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('[data-testid="signup-form"]')).toBeVisible();
  });

  test('user can create an account with email and password', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('[data-testid="email-input"]').fill(testEmail);
    await page.locator('[data-testid="password-input"]').fill(testPassword);
    await page.locator('[data-testid="signup-submit"]').click();

    // Should be authenticated and redirected
    await expect(page).not.toHaveURL(/\/signup/, { timeout: 10000 });
  });

  test('authenticated user is redirected to map or registration form', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('[data-testid="email-input"]').fill(`redirect+${Date.now()}@example.com`);
    await page.locator('[data-testid="password-input"]').fill(testPassword);
    await page.locator('[data-testid="signup-submit"]').click();

    // Should redirect to map or business registration
    await expect(page).toHaveURL(/^\/(register-business)?$/, { timeout: 10000 });
  });

  test('existing user can log in', async ({ page }) => {
    await page.goto('/login');
    await page.locator('[data-testid="email-input"]').fill('existing@example.com');
    await page.locator('[data-testid="password-input"]').fill('password123');
    await page.locator('[data-testid="login-submit"]').click();

    await expect(page).toHaveURL('/', { timeout: 10000 });
  });

  test('session persists across page reloads', async ({ page }) => {
    await page.goto('/login');
    await page.locator('[data-testid="email-input"]').fill('existing@example.com');
    await page.locator('[data-testid="password-input"]').fill('password123');
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page).toHaveURL('/', { timeout: 10000 });

    await page.reload();
    // User should still be authenticated after reload
    const signOutBtn = page.locator('[data-testid="sign-out-button"]');
    await expect(signOutBtn).toBeVisible();
  });

  test('sign out clears session and returns to map', async ({ page }) => {
    await page.goto('/login');
    await page.locator('[data-testid="email-input"]').fill('existing@example.com');
    await page.locator('[data-testid="password-input"]').fill('password123');
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page).toHaveURL('/', { timeout: 10000 });

    await page.locator('[data-testid="sign-out-button"]').click();

    // Should show sign-in prompt on support buttons
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    const signInPrompt = page.locator('[data-testid="sign-in-to-support"]');
    await expect(signInPrompt).toBeVisible();
  });

  test('invalid email format shows validation error', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('[data-testid="email-input"]').fill('notanemail');
    await page.locator('[data-testid="password-input"]').fill(testPassword);
    await page.locator('[data-testid="signup-submit"]').click();

    const error = page.locator('[data-testid="email-error"]');
    await expect(error).toBeVisible();
  });

  test('password under 8 characters shows validation error', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('[data-testid="email-input"]').fill('short@example.com');
    await page.locator('[data-testid="password-input"]').fill('short');
    await page.locator('[data-testid="signup-submit"]').click();

    const error = page.locator('[data-testid="password-error"]');
    await expect(error).toBeVisible();
  });

  test('duplicate email shows error with link to login', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('[data-testid="email-input"]').fill('existing@example.com');
    await page.locator('[data-testid="password-input"]').fill(testPassword);
    await page.locator('[data-testid="signup-submit"]').click();

    const error = page.locator('[data-testid="duplicate-email-error"]');
    await expect(error).toBeVisible();
    const loginLink = error.locator('a');
    await expect(loginLink).toHaveAttribute('href', /\/login/);
  });
});
