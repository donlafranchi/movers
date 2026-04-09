import { Page } from '@playwright/test';

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('[data-testid="email-input"]').fill(email);
  await page.locator('[data-testid="password-input"]').fill(password);
  await page.locator('[data-testid="login-submit"]').click();
  await page.waitForURL(/^\/$/, { timeout: 10000 });
}
