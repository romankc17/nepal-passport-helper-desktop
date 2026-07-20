import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('filter preservation', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  test('clients search survives navigation via history', async () => {
    await goTo(ctx.page, 'Clients');
    const search = ctx.page.getByLabel('Search clients');
    await expect(search).toBeVisible();
    await expect(ctx.page.getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });

    await search.fill('ram');
    // Debounced query kicks in — only RAM matches.
    await expect(ctx.page.locator('tbody tr')).toHaveCount(1, { timeout: 15000 });
    await expect(ctx.page.getByText('SITA KUMARI')).toHaveCount(0);

    await goTo(ctx.page, 'Overview');
    await expect(ctx.page.getByText('Upcoming checks')).toBeVisible();

    await ctx.page.goBack();
    await expect(ctx.page.getByLabel('Search clients')).toHaveValue('ram');
    await expect(ctx.page.locator('tbody tr')).toHaveCount(1, { timeout: 15000 });
    await expect(ctx.page.getByText('RAM BAHADUR')).toBeVisible();
  });
});
