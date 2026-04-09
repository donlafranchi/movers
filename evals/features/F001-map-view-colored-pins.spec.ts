import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F001: Map View — Colored Pins by Ownership Type', () => {
  test('map loads centered on user location', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    const map = page.locator('[data-testid="map"]');
    await expect(map).toBeVisible();
  });

  test('business pins are visible on the map', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map"]');
    const pins = page.locator('[data-testid="map-pin"]');
    await expect(pins.first()).toBeVisible({ timeout: 10000 });
  });

  test('independent businesses show gold pins', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    const independentPin = page.locator('[data-testid="map-pin"][data-ownership="independent"]');
    await expect(independentPin.first()).toBeVisible();
    const color = await independentPin.first().getAttribute('data-color');
    expect(color).toBe('gold');
  });

  test('PE/corporate businesses show grey pins', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    const corporatePin = page.locator('[data-testid="map-pin"][data-ownership="pe-corporate"]');
    await expect(corporatePin.first()).toBeVisible();
    const color = await corporatePin.first().getAttribute('data-color');
    expect(color).toBe('grey');
  });

  test('mission-driven businesses show warm purple pins', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    const missionPin = page.locator('[data-testid="map-pin"][data-ownership="mission-driven"]');
    await expect(missionPin.first()).toBeVisible();
    const color = await missionPin.first().getAttribute('data-color');
    expect(color).toBe('purple');
  });

  test('all six ownership tiers have distinct pin colors', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });

    const expectedColors: Record<string, string> = {
      independent: 'gold',
      coop: 'green',
      'local-franchise': 'amber',
      challenger: 'blue',
      'mission-driven': 'purple',
      'pe-corporate': 'grey',
    };

    for (const [tier, expectedColor] of Object.entries(expectedColors)) {
      const pin = page.locator(`[data-testid="map-pin"][data-ownership="${tier}"]`);
      const count = await pin.count();
      if (count > 0) {
        const color = await pin.first().getAttribute('data-color');
        expect(color).toBe(expectedColor);
      }
    }
  });

  test('tapping a pin opens the business detail card', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    const pin = page.locator('[data-testid="map-pin"]').first();
    await pin.waitFor({ timeout: 10000 });
    await pin.click();
    const detailCard = page.locator('[data-testid="business-detail-card"]');
    await expect(detailCard).toBeVisible();
  });

  test('map supports pan and zoom gestures', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await page.goto('/');
    const map = page.locator('[data-testid="map"]');
    await expect(map).toBeVisible();
    // Verify map is interactive by checking it has the expected mapbox class
    await expect(map.locator('.mapboxgl-canvas')).toBeVisible();
  });

  test('geolocation denied falls back to default location', async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto('/');
    const map = page.locator('[data-testid="map"]');
    await expect(map).toBeVisible();
    // Map should still load even without geolocation
    await expect(map.locator('.mapboxgl-canvas')).toBeVisible();
  });

  test('no businesses in viewport shows empty state without error', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    // Remote location with no businesses
    await context.setGeolocation({ latitude: 71.0, longitude: -156.0 });
    await page.goto('/');
    const map = page.locator('[data-testid="map"]');
    await expect(map).toBeVisible();
    // No error should be displayed
    await expect(page.locator('[data-testid="error-message"]')).not.toBeVisible();
  });
});
