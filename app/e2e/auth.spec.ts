import { test, expect } from '@playwright/test';

/**
 * Authentication E2E tests.
 *
 * These describe the DESIRED auth experience:
 * 1. Users should be able to log in with valid credentials
 * 2. Invalid credentials should show a clear error
 * 3. Logging out should return to login screen
 * 4. The app should stay logged in across page reloads (token persistence)
 */

test.describe('Authentication', () => {
  test('should show login page when not authenticated', async ({ page }) => {
    // Clear any stored tokens
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });
    await page.reload();

    // Should see a login/register form
    await expect(
      page.locator('input[type="email"], input[type="text"][placeholder*="email" i]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });
    await page.reload();

    await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await page.locator('input[type="email"]').fill('nonexistent@test.com');
    await page.locator('input[type="password"]').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();

    // Should show an error message, not crash or hang
    await expect(
      page.locator('.auth-error, .error-message, [role="alert"]'),
    ).toBeVisible({ timeout: 5_000 });
  });

  test.describe('Authenticated flows', () => {
    test.skip(
      !process.env.TEST_EMAIL || !process.env.TEST_PASSWORD,
      'Requires TEST_EMAIL and TEST_PASSWORD env vars',
    );

    test('should persist session across page reload', async ({ page }) => {
      // Log in
      await page.goto('/');
      await page.waitForSelector('input[type="email"], .channel-list', { timeout: 10_000 });

      const emailInput = page.locator('input[type="email"]');
      if (await emailInput.isVisible()) {
        await emailInput.fill(process.env.TEST_EMAIL!);
        await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD!);
        await page.locator('button[type="submit"]').click();
        await page.waitForSelector('.channel-list', { timeout: 10_000 });
      }

      // Reload page
      await page.reload();

      // Should still be authenticated (no login form)
      await expect(page.locator('.channel-list')).toBeVisible({ timeout: 10_000 });
    });
  });
});
