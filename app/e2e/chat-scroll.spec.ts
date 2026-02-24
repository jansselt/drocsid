import { test, expect } from '@playwright/test';

/**
 * Chat scrolling E2E tests.
 *
 * These describe the DESIRED scrolling experience:
 * 1. When you load a channel, you should see the most recent messages
 * 2. You should be able to scroll up freely without being yanked back
 * 3. New messages from others should NOT pull you away from reading history
 * 4. Your own sent messages SHOULD scroll you to the bottom
 * 5. When at the bottom, new messages should keep you at the bottom
 *
 * These tests require a running backend with auth + a channel with messages.
 * Configure via environment or use test fixtures.
 */

test.describe('Chat Scrolling', () => {
  // These tests need a logged-in user and a channel with messages.
  // Skip if no test server is configured.
  test.skip(
    !process.env.TEST_EMAIL || !process.env.TEST_PASSWORD,
    'Requires TEST_EMAIL and TEST_PASSWORD env vars',
  );

  test.beforeEach(async ({ page }) => {
    // Log in
    await page.goto('/');
    await page.waitForSelector('input[type="email"], .channel-list', { timeout: 10_000 });

    // If we see login form, authenticate
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.isVisible()) {
      await emailInput.fill(process.env.TEST_EMAIL!);
      await page.locator('input[type="password"]').fill(process.env.TEST_PASSWORD!);
      await page.locator('button[type="submit"]').click();
      await page.waitForSelector('.channel-list', { timeout: 10_000 });
    }
  });

  test('should land on the most recent messages when opening a channel', async ({ page }) => {
    // Click the first text channel
    await page.locator('.channel-item').first().click();
    await page.waitForSelector('.message', { timeout: 5_000 });

    // The scroll-to-bottom button should NOT be visible (we should be at the bottom)
    await expect(page.locator('.scroll-to-bottom-btn')).not.toBeVisible();
  });

  test('should allow scrolling up without bouncing back', async ({ page }) => {
    await page.locator('.channel-item').first().click();
    await page.waitForSelector('.message', { timeout: 5_000 });

    // Scroll up significantly
    const messageList = page.locator('.message-list');
    await messageList.evaluate((el) => {
      el.scrollTop = 0;
    });

    // Wait a moment for any bounce-back to occur
    await page.waitForTimeout(500);

    // Should NOT be at the bottom — scroll button should appear
    await expect(page.locator('.scroll-to-bottom-btn')).toBeVisible();

    // Scroll position should stay near the top, not snap back
    const scrollTop = await messageList.evaluate((el) => el.scrollTop);
    const scrollHeight = await messageList.evaluate((el) => el.scrollHeight);
    expect(scrollTop).toBeLessThan(scrollHeight * 0.3);
  });

  test('scroll-to-bottom button should work', async ({ page }) => {
    await page.locator('.channel-item').first().click();
    await page.waitForSelector('.message', { timeout: 5_000 });

    // Scroll up
    const messageList = page.locator('.message-list');
    await messageList.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(300);

    // Click the scroll-to-bottom button
    await page.locator('.scroll-to-bottom-btn').click();
    await page.waitForTimeout(500);

    // Should now be at the bottom
    await expect(page.locator('.scroll-to-bottom-btn')).not.toBeVisible();
  });

  test('switching channels should always land at the most recent messages', async ({ page }) => {
    const channels = page.locator('.channel-item');
    const channelCount = await channels.count();

    if (channelCount < 2) {
      test.skip(true, 'Need at least 2 channels');
      return;
    }

    // Visit first channel
    await channels.first().click();
    await page.waitForSelector('.message', { timeout: 5_000 });
    await expect(page.locator('.scroll-to-bottom-btn')).not.toBeVisible();

    // Switch to second channel
    await channels.nth(1).click();
    await page.waitForTimeout(500);

    // Should be at the bottom of the new channel too
    await expect(page.locator('.scroll-to-bottom-btn')).not.toBeVisible();
  });
});
