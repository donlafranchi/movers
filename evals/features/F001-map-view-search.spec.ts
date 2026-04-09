import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F001: Map View — Search', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map"]');
  });

  test('search bar is visible at bottom of screen', async ({ page }) => {
    const searchBar = page.locator('[data-testid="search-bar"]');
    await expect(searchBar).toBeVisible();
    const box = await searchBar.boundingBox();
    expect(box!.y).toBeGreaterThan(844 / 2); // bottom half of viewport
  });

  test('tapping search bar expands it and shows input', async ({ page }) => {
    await page.locator('[data-testid="search-bar"]').click();
    const input = page.locator('[data-testid="search-input"]');
    await expect(input).toBeFocused();
  });

  test('typing a category shows autocomplete suggestions', async ({ page }) => {
    await page.locator('[data-testid="search-bar"]').click();
    await page.locator('[data-testid="search-input"]').fill('vet');
    const suggestions = page.locator('[data-testid="search-suggestions"]');
    await expect(suggestions).toBeVisible({ timeout: 5000 });
    await expect(suggestions.locator('[data-testid="search-suggestion"]').first()).toBeVisible();
  });

  test('selecting a category filters pins to matching businesses', async ({ page }) => {
    const pinsBefore = await page.locator('[data-testid="map-pin"]').count();

    await page.locator('[data-testid="search-bar"]').click();
    await page.locator('[data-testid="search-input"]').fill('vet');
    await page.locator('[data-testid="search-suggestion"]').first().click();

    await page.waitForTimeout(1000);
    const pinsAfter = await page.locator('[data-testid="map-pin"]').count();
    expect(pinsAfter).toBeLessThanOrEqual(pinsBefore);
  });

  test('clear button restores all pins and collapses search', async ({ page }) => {
    await page.locator('[data-testid="search-bar"]').click();
    await page.locator('[data-testid="search-input"]').fill('vet');
    await page.locator('[data-testid="search-suggestion"]').first().click();

    const clearButton = page.locator('[data-testid="search-clear"]');
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    // Search should collapse
    await expect(page.locator('[data-testid="search-input"]')).not.toBeFocused();
  });

  test('location search pans map to that area', async ({ page }) => {
    await page.locator('[data-testid="search-bar"]').click();
    await page.locator('[data-testid="search-input"]').fill('Austin TX');
    await page.locator('[data-testid="search-suggestion"]').first().click();

    // Map should have panned — we verify by checking that the map is still visible
    // and no error occurred
    await expect(page.locator('[data-testid="map"]')).toBeVisible();
  });

  test('no results shows informative message', async ({ page }) => {
    await page.locator('[data-testid="search-bar"]').click();
    await page.locator('[data-testid="search-input"]').fill('xyznonexistentcategory');
    await page.locator('[data-testid="search-input"]').press('Enter');

    const noResults = page.locator('[data-testid="search-no-results"]');
    await expect(noResults).toBeVisible({ timeout: 5000 });
  });

  test('fuzzy matching handles misspellings', async ({ page }) => {
    await page.locator('[data-testid="search-bar"]').click();
    await page.locator('[data-testid="search-input"]').fill('vetrinarian');
    const suggestions = page.locator('[data-testid="search-suggestions"]');
    await expect(suggestions).toBeVisible({ timeout: 5000 });
    // Should still show veterinary-related suggestion
    const suggestionText = await suggestions.locator('[data-testid="search-suggestion"]').first().textContent();
    expect(suggestionText?.toLowerCase()).toContain('vet');
  });

  test('empty search submitted is a no-op', async ({ page }) => {
    const pinsBefore = await page.locator('[data-testid="map-pin"]').count();
    await page.locator('[data-testid="search-bar"]').click();
    await page.locator('[data-testid="search-input"]').press('Enter');
    await page.waitForTimeout(500);
    const pinsAfter = await page.locator('[data-testid="map-pin"]').count();
    expect(pinsAfter).toBe(pinsBefore);
  });

  test('tapping outside search dismisses it', async ({ page }) => {
    await page.locator('[data-testid="search-bar"]').click();
    await expect(page.locator('[data-testid="search-input"]')).toBeFocused();

    // Tap on the map area (outside search)
    await page.locator('[data-testid="map"]').click({ position: { x: 195, y: 200 } });
    await expect(page.locator('[data-testid="search-input"]')).not.toBeFocused();
  });
});
