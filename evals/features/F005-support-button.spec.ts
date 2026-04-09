import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/auth';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F005: Support Button', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
  });

  test('authenticated user can support a business', async ({ page }) => {
    await signIn(page, 'test@example.com', 'password123');
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();

    const countBefore = await page.locator('[data-testid="support-count"]').textContent();
    await page.locator('[data-testid="support-button"]').click();

    // Heart should toggle to active
    const heart = page.locator('[data-testid="support-button"]');
    await expect(heart).toHaveAttribute('data-active', 'true');

    // Count should increment
    const countAfter = await page.locator('[data-testid="support-count"]').textContent();
    expect(Number(countAfter)).toBe(Number(countBefore) + 1);
  });

  test('tapping again removes support and decrements count', async ({ page }) => {
    await signIn(page, 'test@example.com', 'password123');
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();

    // Support the business
    await page.locator('[data-testid="support-button"]').click();
    await expect(page.locator('[data-testid="support-button"]')).toHaveAttribute('data-active', 'true');
    const countAfterSupport = await page.locator('[data-testid="support-count"]').textContent();

    // Remove support
    await page.locator('[data-testid="support-button"]').click();
    await expect(page.locator('[data-testid="support-button"]')).toHaveAttribute('data-active', 'false');
    const countAfterRemove = await page.locator('[data-testid="support-count"]').textContent();
    expect(Number(countAfterRemove)).toBe(Number(countAfterSupport) - 1);
  });

  test('support state persists across sessions', async ({ page }) => {
    await signIn(page, 'persistent@example.com', 'password123');
    await page.goto('/business/test-business');

    // Support the business
    await page.locator('[data-testid="support-button"]').click();
    await expect(page.locator('[data-testid="support-button"]')).toHaveAttribute('data-active', 'true');

    // Reload the page
    await page.reload();
    await expect(page.locator('[data-testid="support-button"]')).toHaveAttribute('data-active', 'true');
  });

  test('unauthenticated user is prompted to sign in', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();

    const signInPrompt = page.locator('[data-testid="sign-in-to-support"]');
    await expect(signInPrompt).toBeVisible();
  });

  test('rapid toggling only persists final state', async ({ page }) => {
    await signIn(page, 'rapid@example.com', 'password123');
    await page.goto('/business/test-business');

    const button = page.locator('[data-testid="support-button"]');

    // Rapid toggle: on, off, on, off, on
    for (let i = 0; i < 5; i++) {
      await button.click();
    }

    // Wait for debounce to settle
    await page.waitForTimeout(1000);

    // Final state should be active (odd number of clicks)
    await expect(button).toHaveAttribute('data-active', 'true');

    // Reload to verify persisted state
    await page.reload();
    await expect(button).toHaveAttribute('data-active', 'true');
  });
});
