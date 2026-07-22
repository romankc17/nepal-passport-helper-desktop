import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('foreign mission watchers', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);
    await goTo(ctx.page, 'Slot Watchers');
    await expect(ctx.page.getByText('Add watcher')).toBeVisible();
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  test('creates a watcher for a foreign mission without province/district', async () => {
    await ctx.page.getByRole('button', { name: 'Add watcher' }).first().click();

    // Country defaults to Nepal — switch to "Other" to see foreign missions.
    await ctx.page.getByLabel('Country').click();
    await ctx.page.getByRole('option', { name: 'Other' }).click();

    // Province/district cascade is replaced by a single Mission select.
    await expect(ctx.page.getByLabel('Province')).toHaveCount(0);
    await ctx.page.getByLabel('Mission').click();
    await ctx.page.getByRole('option', { name: 'NE, Doha' }).click();

    await ctx.page.getByRole('button', { name: 'Create watcher' }).click();

    // The new card shows the mission name and its country badge.
    await expect(ctx.page.locator('main').getByText('NE, Doha').first()).toBeVisible({
      timeout: 15000,
    });
    await expect(ctx.page.locator('main').getByText('Other').first()).toBeVisible();
  });
});
