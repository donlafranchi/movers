import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/auth';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F005: Report a Concern', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 30.2672, longitude: -97.7431 });
    await signIn(page, 'test@example.com', 'password123');
  });

  test('report concern button opens report form', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    const form = page.locator('[data-testid="report-form"]');
    await expect(form).toBeVisible();
  });

  test('report form has pillar selector with 4 options', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    const pillars = page.locator('[data-testid="pillar-option"]');
    await expect(pillars).toHaveCount(4);

    // Verify each pillar has a description
    for (let i = 0; i < 4; i++) {
      await expect(pillars.nth(i).locator('[data-testid="pillar-description"]')).toBeVisible();
    }
  });

  test('report form has required description field', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    const descField = page.locator('[data-testid="report-description"]');
    await expect(descField).toBeVisible();
  });

  test('report form has optional source link field', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    const sourceField = page.locator('[data-testid="report-source-url"]');
    await expect(sourceField).toBeVisible();
  });

  test('report form has personal witness checkbox', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    const checkbox = page.locator('[data-testid="personal-witness-checkbox"]');
    await expect(checkbox).toBeVisible();
  });

  test('successful report submission shows confirmation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    // Fill the form
    await page.locator('[data-testid="pillar-option"]').first().click();
    await page.locator('[data-testid="report-description"] textarea').fill('Observed concerning behavior during recent visit.');
    await page.locator('[data-testid="report-submit"]').click();

    const confirmation = page.locator('[data-testid="report-confirmation"]');
    await expect(confirmation).toBeVisible({ timeout: 5000 });
    await expect(confirmation).toContainText('Thank you');
  });

  test('report is not visible on the business listing', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    await page.locator('[data-testid="pillar-option"]').first().click();
    await page.locator('[data-testid="report-description"] textarea').fill('This should not appear publicly.');
    await page.locator('[data-testid="report-submit"]').click();
    await page.locator('[data-testid="report-confirmation"]').waitFor();

    // Go back to the business detail — no report content should be visible
    await page.goBack();
    await expect(page.locator('[data-testid="report-content"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="report-count"]')).not.toBeVisible();
  });

  test('empty description prevents submission', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    await page.locator('[data-testid="pillar-option"]').first().click();
    // Do NOT fill description
    await page.locator('[data-testid="report-submit"]').click();

    const error = page.locator('[data-testid="description-error"]');
    await expect(error).toBeVisible();
  });

  test('description has 500 character limit with counter', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    const charCounter = page.locator('[data-testid="char-counter"]');
    await expect(charCounter).toBeVisible();

    // Type a long string
    const longText = 'A'.repeat(501);
    await page.locator('[data-testid="report-description"] textarea').fill(longText);

    // Should be truncated or show error
    const textarea = page.locator('[data-testid="report-description"] textarea');
    const value = await textarea.inputValue();
    expect(value.length).toBeLessThanOrEqual(500);
  });

  test('missing pillar selection prevents submission', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="map-pin"]', { timeout: 10000 });
    await page.locator('[data-testid="map-pin"]').first().click();
    await page.locator('[data-testid="report-concern-button"]').click();

    // Fill description but skip pillar
    await page.locator('[data-testid="report-description"] textarea').fill('Some concern text.');
    await page.locator('[data-testid="report-submit"]').click();

    const error = page.locator('[data-testid="pillar-error"]');
    await expect(error).toBeVisible();
  });
});
