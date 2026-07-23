import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('activity feed', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);

    ctx.mock.setScenario('booking_success');
    await fetch(`http://127.0.0.1:${ctx.port}/api/desktop/v1/book-now/`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mock-access-test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider_id: 501,
        district_id: '280',
        province_id: '226',
        provider_name: 'Rupandehi',
        client_ids: [101],
        idempotency_key: 'activity-flow-book-1',
      }),
    });
    await fetch(`http://127.0.0.1:${ctx.port}/api/desktop/v1/appointments/500/cancel/`, {
      method: 'POST',
      headers: { Authorization: 'Bearer mock-access-test' },
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
