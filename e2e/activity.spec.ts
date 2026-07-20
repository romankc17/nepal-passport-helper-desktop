import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('activity feed', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);

    ctx.mock.setScenario('booking_success');
    await ctx.page.evaluate(async () => {
      await window.desktop.queue.bookNow({
        provider_id: 501,
        district_id: '280',
        province_id: '226',
        provider_name: 'Rupandehi',
        client_ids: [101],
        idempotency_key: 'activity-flow-book-1',
      });
      return window.desktop.appointments.cancel(500);
    });
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  test('booking and cancellation appear in the feed', async () => {
    await goTo(ctx.page, 'Activity');
    await expect(ctx.page.getByText('Clear filters')).toBeVisible();
    await expect(ctx.page.getByText(/Booked RAM BAHADUR/)).toBeVisible({ timeout: 15000 });
    await expect(ctx.page.getByText(/Appointment cancelled for RAM BAHADUR/)).toBeVisible();
    await expect(ctx.page.getByText('booking').first()).toBeVisible();
    await expect(ctx.page.getByText('cancel').first()).toBeVisible();
  });
});
