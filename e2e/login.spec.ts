import { expect, test } from '@playwright/test';
import { launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('login', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    ctx = await launchTestApp();
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  test('login success renders the Overview stats', async () => {
    await loginViaUI(ctx.page);
    await expect(ctx.page.getByText('Active watchers')).toBeVisible();
    await expect(ctx.page.getByText('Queued clients')).toBeVisible();
    await expect(ctx.page.getByText('Booked today')).toBeVisible();
    // Mock has one active watcher.
    await expect(ctx.page.locator('main').getByText('1', { exact: true }).first()).toBeVisible();
  });

  test('login failure shows the server error', async () => {
    // Signed in from the previous test — sign out first.
    await ctx.page.getByRole('button', { name: 'Sign out' }).click();
    await ctx.page.waitForSelector('#username', { timeout: 10000 });
    await ctx.page.fill('#username', 'admin');
    await ctx.page.fill('#password', 'wrong');
    await ctx.page.click('button[type="submit"]');
    await expect(ctx.page.getByRole('alert')).toContainText('Invalid username or password', {
      timeout: 15000,
    });
  });
});
