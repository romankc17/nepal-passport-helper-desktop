import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PROJECT_ROOT, goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

const SCREENSHOT_DIR = join(PROJECT_ROOT, 'docs/screenshots');

// Captures docs/screenshots/*.png against the mock backend (deterministic
// data). Runs as part of test:e2e; also directly via `npm run screenshots`.
test.describe('documentation screenshots', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);

    // Deterministic rich state: one booked appointment + queued clients.
    ctx.mock.setScenario('booking_success');
    await ctx.page.evaluate(async () => {
      return window.desktop.queue.bookNow({
        provider_id: 501,
        district_id: '280',
        province_id: '226',
        provider_name: 'Rupandehi',
        client_ids: [101],
        idempotency_key: 'screenshots-book-1',
      });
    });
    ctx.mock.setScenario('multi_slot');
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  const shot = (name: string) => ctx.page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });

  test('capture all pages', async () => {
    await goTo(ctx.page, 'Overview');
    await expect(ctx.page.getByText('Upcoming checks')).toBeVisible();
    await ctx.page.waitForTimeout(1000);
    await shot('overview');

    await goTo(ctx.page, 'Slot Watchers');
    await expect(ctx.page.getByText('Add watcher')).toBeVisible();
    await ctx.page.waitForTimeout(1000);
    await shot('watchers');

    await goTo(ctx.page, 'Booking Queue');
    await expect(ctx.page.getByText('Ready to book')).toBeVisible();
    await expect(ctx.page.getByText('SITA KUMARI')).toBeVisible({ timeout: 15000 });
    await shot('queue');

    await goTo(ctx.page, 'Clients');
    await expect(ctx.page.getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });
    await shot('clients');

    await goTo(ctx.page, 'Appointments');
    await expect(ctx.page.getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });
    await shot('appointments');

    await goTo(ctx.page, 'Activity');
    await expect(ctx.page.getByText(/Booked RAM BAHADUR/)).toBeVisible({ timeout: 15000 });
    await shot('activity');

    await goTo(ctx.page, 'Settings');
    await expect(ctx.page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await ctx.page.waitForTimeout(500);
    await shot('settings');
  });
});
