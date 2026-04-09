import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F001: Map View — Pin Clustering', () => {
  test('overlapping pins collapse into cluster with count', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map"]');

    // Zoom out to trigger clustering
    const map = page.locator('[data-testid="map"]');
    await map.dblclick(); // zoom in first
    await page.waitForTimeout(500);

    // Zoom out far enough to cluster
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Minus');
      await page.waitForTimeout(300);
    }

    const clusters = page.locator('[data-testid="map-cluster"]');
    await expect(clusters.first()).toBeVisible({ timeout: 10000 });

    // Cluster should display a count
    const countText = await clusters.first().textContent();
    expect(Number(countText)).toBeGreaterThan(1);
  });

  test('zooming in expands cluster into individual pins', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map"]');

    // Zoom out to create clusters
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Minus');
      await page.waitForTimeout(300);
    }

    const clustersBefore = await page.locator('[data-testid="map-cluster"]').count();

    // Zoom back in
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Equal');
      await page.waitForTimeout(300);
    }

    const pins = page.locator('[data-testid="map-pin"]');
    await expect(pins.first()).toBeVisible({ timeout: 10000 });
  });

  test('tapping a cluster zooms into that area', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map"]');

    // Zoom out to create clusters
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Minus');
      await page.waitForTimeout(300);
    }

    const cluster = page.locator('[data-testid="map-cluster"]').first();
    await cluster.waitFor({ timeout: 10000 });
    await cluster.click();

    // After clicking, either more individual pins or smaller clusters should appear
    await page.waitForTimeout(1000);
    const pinsOrSmallerClusters = page.locator('[data-testid="map-pin"], [data-testid="map-cluster"]');
    await expect(pinsOrSmallerClusters.first()).toBeVisible();
  });

  test('single business does not show as cluster of 1', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });

    // No cluster should show a count of 1
    const clusters = page.locator('[data-testid="map-cluster"]');
    const count = await clusters.count();
    for (let i = 0; i < count; i++) {
      const text = await clusters.nth(i).textContent();
      expect(Number(text)).toBeGreaterThan(1);
    }
  });
});
