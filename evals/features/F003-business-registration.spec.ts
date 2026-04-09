import { test, expect } from '@playwright/test';
import { signIn } from '../helpers/auth';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('F003: Business Registration', () => {
  test('registration form is accessible from registration page', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');
    const form = page.locator('[data-testid="registration-form"]');
    await expect(form).toBeVisible();
  });

  test('form has all required fields', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');

    await expect(page.locator('[data-testid="field-business-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="field-street-address"]')).toBeVisible();
    await expect(page.locator('[data-testid="field-city"]')).toBeVisible();
    await expect(page.locator('[data-testid="field-state"]')).toBeVisible();
    await expect(page.locator('[data-testid="field-zip"]')).toBeVisible();
    await expect(page.locator('[data-testid="field-category"]')).toBeVisible();
    await expect(page.locator('[data-testid="field-ownership-type"]')).toBeVisible();
  });

  test('story field is optional', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');
    const storyField = page.locator('[data-testid="field-story"]');
    await expect(storyField).toBeVisible();
    // Should not have required attribute
    await expect(storyField.locator('textarea, input')).not.toHaveAttribute('required', '');
  });

  test('ownership type selector shows all 6 tiers with descriptions', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');

    const ownershipSelector = page.locator('[data-testid="field-ownership-type"]');
    await ownershipSelector.click();

    const options = page.locator('[data-testid="ownership-option"]');
    await expect(options).toHaveCount(6);

    // Each option should have a description
    for (let i = 0; i < 6; i++) {
      const description = options.nth(i).locator('[data-testid="ownership-description"]');
      await expect(description).toBeVisible();
    }
  });

  test('successful submission creates listing and redirects to detail page', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');

    await page.locator('[data-testid="field-business-name"] input').fill('Test Business');
    await page.locator('[data-testid="field-street-address"] input').fill('123 Main St');
    await page.locator('[data-testid="field-city"] input').fill('Austin');
    await page.locator('[data-testid="field-state"] input').fill('TX');
    await page.locator('[data-testid="field-zip"] input').fill('78701');
    await page.locator('[data-testid="field-category"] input').fill('Restaurant');
    await page.locator('[data-testid="ownership-option"]').first().click();

    await page.locator('[data-testid="submit-registration"]').click();

    // Should redirect to the new listing's detail page
    await expect(page).toHaveURL(/\/business\//, { timeout: 10000 });
    await expect(page.locator('[data-testid="business-name"]')).toContainText('Test Business');
  });

  test('category field accepts open text input', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');

    const categoryInput = page.locator('[data-testid="field-category"] input');
    await categoryInput.fill('Artisanal Goat Cheese Farm');
    await expect(categoryInput).toHaveValue('Artisanal Goat Cheese Farm');
  });

  test('invalid address shows geocoding error', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');

    await page.locator('[data-testid="field-business-name"] input').fill('Bad Address Biz');
    await page.locator('[data-testid="field-street-address"] input').fill('99999 Nonexistent Blvd');
    await page.locator('[data-testid="field-city"] input').fill('Faketown');
    await page.locator('[data-testid="field-state"] input').fill('ZZ');
    await page.locator('[data-testid="field-zip"] input').fill('00000');
    await page.locator('[data-testid="field-category"] input').fill('Test');
    await page.locator('[data-testid="ownership-option"]').first().click();

    await page.locator('[data-testid="submit-registration"]').click();

    const error = page.locator('[data-testid="geocoding-error"]');
    await expect(error).toBeVisible({ timeout: 10000 });
  });

  test('mission-driven selection shows certification field', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');

    const ownershipSelector = page.locator('[data-testid="field-ownership-type"]');
    await ownershipSelector.click();
    await page.locator('[data-testid="ownership-option"][data-value="mission-driven"]').click();

    const certField = page.locator('[data-testid="field-certification"]');
    await expect(certField).toBeVisible();
  });

  test('missing required fields prevents submission', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');

    // Submit without filling anything
    await page.locator('[data-testid="submit-registration"]').click();

    // Should show validation errors, not navigate away
    await expect(page).toHaveURL(/\/register-business/);
    const errors = page.locator('[data-testid="field-error"]');
    await expect(errors.first()).toBeVisible();
  });

  test('listing without story is valid', async ({ page }) => {
    await signIn(page, 'newowner@example.com', 'password123');
    await page.goto('/register-business');

    await page.locator('[data-testid="field-business-name"] input').fill('No Story Biz');
    await page.locator('[data-testid="field-street-address"] input').fill('456 Oak Ave');
    await page.locator('[data-testid="field-city"] input').fill('Austin');
    await page.locator('[data-testid="field-state"] input').fill('TX');
    await page.locator('[data-testid="field-zip"] input').fill('78702');
    await page.locator('[data-testid="field-category"] input').fill('Bakery');
    await page.locator('[data-testid="ownership-option"]').first().click();
    // Do NOT fill story field

    await page.locator('[data-testid="submit-registration"]').click();
    await expect(page).toHaveURL(/\/business\//, { timeout: 10000 });
  });
});
