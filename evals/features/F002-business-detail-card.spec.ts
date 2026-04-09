import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/auth';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F002: Business Detail Card', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
  });

  test('tapping a pin slides up detail card', async ({ page }) => {
    await page.locator('[data-testid="map-pin"]').first().click();
    const card = page.locator('[data-testid="business-detail-card"]');
    await expect(card).toBeVisible();
  });

  test('detail card shows business name', async ({ page }) => {
    await page.locator('[data-testid="map-pin"]').first().click();
    const name = page.locator('[data-testid="business-name"]');
    await expect(name).toBeVisible();
    await expect(name).not.toBeEmpty();
  });

  test('detail card shows address', async ({ page }) => {
    await page.locator('[data-testid="map-pin"]').first().click();
    const address = page.locator('[data-testid="business-address"]');
    await expect(address).toBeVisible();
    await expect(address).not.toBeEmpty();
  });

  test('detail card shows category', async ({ page }) => {
    await page.locator('[data-testid="map-pin"]').first().click();
    const category = page.locator('[data-testid="business-category"]');
    await expect(category).toBeVisible();
  });

  test('detail card shows ownership tier badge with color and label', async ({ page }) => {
    await page.locator('[data-testid="map-pin"]').first().click();
    const badge = page.locator('[data-testid="ownership-badge"]');
    await expect(badge).toBeVisible();
    // Badge should contain both a colored indicator and text label
    await expect(badge.locator('[data-testid="badge-color"]')).toBeVisible();
    await expect(badge.locator('[data-testid="badge-label"]')).toBeVisible();
  });

  test('detail card shows support count', async ({ page }) => {
    await page.locator('[data-testid="map-pin"]').first().click();
    const supportCount = page.locator('[data-testid="support-count"]');
    await expect(supportCount).toBeVisible();
  });

  test('detail card shows share button', async ({ page }) => {
    await page.locator('[data-testid="map-pin"]').first().click();
    const shareBtn = page.locator('[data-testid="share-button"]');
    await expect(shareBtn).toBeVisible();
  });

  test('authenticated user sees support button', async ({ page }) => {
    await signIn(page, 'test@example.com', 'password123');
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    const supportBtn = page.locator('[data-testid="support-button"]');
    await expect(supportBtn).toBeVisible();
  });

  test('authenticated user sees report concern button', async ({ page }) => {
    await signIn(page, 'test@example.com', 'password123');
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    const reportBtn = page.locator('[data-testid="report-concern-button"]');
    await expect(reportBtn).toBeVisible();
  });

  test('unauthenticated user sees sign-in prompt instead of support button', async ({ page }) => {
    await page.locator('[data-testid="map-pin"]').first().click();
    const signInPrompt = page.locator('[data-testid="sign-in-to-support"]');
    await expect(signInPrompt).toBeVisible();
  });

  test('PE/corporate listing shows parent company and location count', async ({ page }) => {
    // Find and tap a PE/corporate pin
    const corporatePin = page.locator('[data-testid="map-pin"][data-ownership="pe-corporate"]');
    await corporatePin.first().click();
    const parentCompany = page.locator('[data-testid="parent-company"]');
    await expect(parentCompany).toBeVisible();
    const locationCount = page.locator('[data-testid="location-count"]');
    await expect(locationCount).toBeVisible();
  });

  test('mission-driven listing shows certification type', async ({ page }) => {
    const missionPin = page.locator('[data-testid="map-pin"][data-ownership="mission-driven"]');
    await missionPin.first().click();
    const certification = page.locator('[data-testid="certification-type"]');
    await expect(certification).toBeVisible();
  });

  test('business with no story hides story section entirely', async ({ page }) => {
    // Navigate to a business known to have no story via direct URL
    await page.goto('/business/no-story-test-business');
    const story = page.locator('[data-testid="business-story"]');
    await expect(story).not.toBeVisible();
  });

  test('long story is truncated with read more link', async ({ page }) => {
    await page.goto('/business/long-story-test-business');
    const readMore = page.locator('[data-testid="read-more"]');
    await expect(readMore).toBeVisible();
  });
});
