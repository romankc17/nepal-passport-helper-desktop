import { expect, test } from '@playwright/test';
import { launchTestApp, type TestApp } from './helpers';
import { MockServer } from './mock-server';

test.describe('backend offline', () => {
  let ctx: TestApp;

  test.afterAll(async () => {
    await ctx?.cleanup();
  });

  test('app renders a clean error instead of crashing', async () => {
    // Grab a free port, then immediately release it — nothing listens there.
    const probe = new MockServer();
    const deadPort = await probe.listen();
    await probe.close();

    ctx = await launchTestApp({ portOverride: deadPort });

    // Login page renders fine without a backend.
    await ctx.page.waitForSelector('#username', { timeout: 20000 });
    await ctx.page.fill('#username', 'admin');
    await ctx.page.fill('#password', 'any-password-works');
    await ctx.page.click('button[type="submit"]');

    await expect(ctx.page.getByRole('alert')).toContainText(/Cannot reach the server/, {
      timeout: 20000,
    });
    // Still alive and interactive — no crash.
    await expect(ctx.page.locator('#username')).toBeVisible();
  });
});
