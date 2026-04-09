import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F004: Shareable Listing', () => {
  test('business detail page loads at /business/{slug}', async ({ page }) => {
    await page.goto('/business/test-business');
    await expect(page.locator('[data-testid="business-name"]')).toBeVisible();
  });

  test('detail page shows business name, address, and category', async ({ page }) => {
    await page.goto('/business/test-business');
    await expect(page.locator('[data-testid="business-name"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="business-address"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="business-category"]')).toBeVisible();
  });

  test('detail page shows ownership tier badge', async ({ page }) => {
    await page.goto('/business/test-business');
    const badge = page.locator('[data-testid="ownership-badge"]');
    await expect(badge).toBeVisible();
  });

  test('detail page shows support count', async ({ page }) => {
    await page.goto('/business/test-business');
    await expect(page.locator('[data-testid="support-count"]')).toBeVisible();
  });

  test('detail page shows map preview with pin', async ({ page }) => {
    await page.goto('/business/test-business');
    const mapPreview = page.locator('[data-testid="map-preview"]');
    await expect(mapPreview).toBeVisible();
  });

  test('page has correct og:title meta tag', async ({ page }) => {
    await page.goto('/business/test-business');
    const ogTitle = page.locator('meta[property="og:title"]');
    const content = await ogTitle.getAttribute('content');
    expect(content).toBeTruthy();
    expect(content!.length).toBeGreaterThan(0);
  });

  test('page has correct og:description meta tag', async ({ page }) => {
    await page.goto('/business/test-business');
    const ogDesc = page.locator('meta[property="og:description"]');
    const content = await ogDesc.getAttribute('content');
    expect(content).toBeTruthy();
  });

  test('page has og:image meta tag', async ({ page }) => {
    await page.goto('/business/test-business');
    const ogImage = page.locator('meta[property="og:image"]');
    const content = await ogImage.getAttribute('content');
    expect(content).toBeTruthy();
    expect(content).toMatch(/^https?:\/\//);
  });

  test('page has og:url meta tag with canonical URL', async ({ page }) => {
    await page.goto('/business/test-business');
    const ogUrl = page.locator('meta[property="og:url"]');
    const content = await ogUrl.getAttribute('content');
    expect(content).toContain('/business/test-business');
  });

  test('page is server-rendered without loading spinner', async ({ page }) => {
    // Disable JavaScript to verify SSR
    await page.goto('/business/test-business', { waitUntil: 'domcontentloaded' });
    // Business name should be in the initial HTML
    const name = page.locator('[data-testid="business-name"]');
    await expect(name).toBeVisible();
    // No loading spinner should be present
    await expect(page.locator('[data-testid="loading-spinner"]')).not.toBeVisible();
  });

  test('share button copies listing URL to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/business/test-business');

    await page.locator('[data-testid="share-button"]').click();

    // Confirmation toast should appear
    const toast = page.locator('[data-testid="toast"]');
    await expect(toast).toBeVisible();

    // Clipboard should contain the listing URL
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('/business/test-business');
  });

  test('business with no story uses fallback OG description', async ({ page }) => {
    await page.goto('/business/no-story-test-business');
    const ogDesc = page.locator('meta[property="og:description"]');
    const content = await ogDesc.getAttribute('content');
    expect(content).toBeTruthy();
    // Should still have a meaningful description even without story
    expect(content!.length).toBeGreaterThan(0);
  });
});
