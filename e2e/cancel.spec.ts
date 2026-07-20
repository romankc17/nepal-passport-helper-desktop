import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('cancel flow', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);

    // Book one client through the real book-now path.
    ctx.mock.setScenario('booking_success');
    await ctx.page.evaluate(async () => {
      return window.desktop.queue.bookNow({
        provider_id: 501,
        district_id: '280',
        province_id: '226',
        provider_name: 'Rupandehi',
        client_ids: [101],
        idempotency_key: 'cancel-flow-book-1',
      });
    });
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  test('cancel moves the appointment to the Cancelled tab without a receipt button', async () => {
    await goTo(ctx.page, 'Appointments');
    await expect(ctx.page.getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });
    await expect(
      ctx.page.getByRole('button', { name: /Download receipt for RAM BAHADUR/ }),
    ).toBeVisible();

    await ctx.page.getByRole('button', { name: /Cancel appointment for RAM BAHADUR/ }).click();
    await ctx.page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
    await expect(ctx.page.getByText(/Appointment cancelled/)).toBeVisible({ timeout: 15000 });

    // Booked tab no longer lists it (the toast mentions the name — scope to main).
    await expect(ctx.page.locator('main').getByText('RAM BAHADUR')).toHaveCount(0, {
      timeout: 15000,
    });

    await ctx.page.getByRole('tab', { name: 'Cancelled' }).click();
    await expect(ctx.page.locator('main').getByText('RAM BAHADUR')).toBeVisible({
      timeout: 15000,
    });
    // Cancelled appointments must never offer receipts.
    await expect(ctx.page.getByRole('button', { name: /Download receipt/ })).toHaveCount(0);
  });

  test('receipt_unavailable surfaces a clean error via the API', async () => {
    ctx.mock.setScenario('receipt_unavailable');
    const error = await ctx.page.evaluate(async () => {
      try {
        await window.desktop.appointments.receipt(500);
        return null;
      } catch (err) {
        const candidate = err as { code?: string; message?: string };
        return { code: candidate.code ?? null, message: candidate.message ?? null };
      }
    });
    expect(error?.code).toBe('RECEIPT_UNAVAILABLE');
  });

  test('cancel_failure shows the server error as a toast', async () => {
    // Book a second client, then fail the cancellation.
    ctx.mock.setScenario('booking_success');
    await ctx.page.evaluate(async () => {
      return window.desktop.queue.bookNow({
        provider_id: 501,
        district_id: '280',
        province_id: '226',
        provider_name: 'Rupandehi',
        client_ids: [102],
        idempotency_key: 'cancel-flow-book-2',
      });
    });
    ctx.mock.setScenario('cancel_failure');

    await goTo(ctx.page, 'Appointments');
    await ctx.page.getByRole('tab', { name: 'Booked' }).click();
    await expect(ctx.page.getByText('SITA KUMARI')).toBeVisible({ timeout: 15000 });
    await ctx.page.getByRole('button', { name: /Cancel appointment for SITA KUMARI/ }).click();
    await ctx.page.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
    await expect(ctx.page.getByText(/office rejected the cancellation/i)).toBeVisible({
      timeout: 15000,
    });
  });
});
