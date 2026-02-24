import { test, expect } from '@playwright/test';

/**
 * Settings E2E tests.
 *
 * These describe the DESIRED settings experience:
 * 1. Device selections should appear in dropdowns and persist
 * 2. Theme changes should apply immediately and persist across sessions
 * 3. User profile changes should save and reflect everywhere
 */

test.describe('User Settings', () => {
  test.skip(
    !process.env.TEST_EMAIL || !process.env.TEST_PASSWORD,
    'Requires TEST_EMAIL and TEST_PASSWORD env vars',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('input[type="email"], .channel-list', { timeout: 10_000 });

    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible()) {
      await emailInput.fill(process.env.TEST_EMAIL!);
      await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD!);
      await page.locator('button[type="submit"]').click();
      await page.waitForSelector('.channel-list', { timeout: 10_000 });
    }
  });

  test.describe('Voice & Video Settings', () => {
    test('should show audio devices in dropdowns', async ({ page }) => {
      // Grant microphone permission
      await page.context().grantPermissions(['microphone', 'camera']);

      // Open settings → Voice tab
      await page.locator('[title="User Settings"], .user-settings-btn').click();
      await page.locator('text=Voice & Video').click();

      // Microphone dropdown should have at least the Default option
      const micSelect = page.locator('select').first();
      await expect(micSelect).toBeVisible();
      const micOptions = micSelect.locator('option');
      expect(await micOptions.count()).toBeGreaterThanOrEqual(1);
    });

    test('device selection should persist after closing and reopening settings', async ({ page }) => {
      await page.context().grantPermissions(['microphone', 'camera']);

      // Open settings → Voice tab
      await page.locator('[title="User Settings"], .user-settings-btn').click();
      await page.locator('text=Voice & Video').click();
      await page.waitForTimeout(500);

      // Select a non-default device if available
      const micSelect = page.locator('select').first();
      const options = micSelect.locator('option');
      const optionCount = await options.count();

      if (optionCount > 1) {
        // Select the second option (first non-default device)
        const value = await options.nth(1).getAttribute('value');
        if (value) {
          await micSelect.selectOption(value);

          // Close settings
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);

          // Reopen settings → Voice tab
          await page.locator('[title="User Settings"], .user-settings-btn').click();
          await page.locator('text=Voice & Video').click();
          await page.waitForTimeout(500);

          // The selection should persist
          const currentValue = await micSelect.inputValue();
          expect(currentValue).toBe(value);
        }
      }
    });
  });

  test.describe('Appearance Settings', () => {
    test('theme changes should apply immediately', async ({ page }) => {
      // Open settings → Appearance tab
      await page.locator('[title="User Settings"], .user-settings-btn').click();
      await page.locator('text=Appearance').click();

      // Get initial background color
      const initialBg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim(),
      );

      // Click a different theme swatch (e.g., Nord)
      await page.locator('.theme-swatch').nth(10).click(); // Nord is ~10th
      await page.waitForTimeout(200);

      // Background should have changed
      const newBg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim(),
      );
      expect(newBg).not.toBe(initialBg);
    });
  });
});
