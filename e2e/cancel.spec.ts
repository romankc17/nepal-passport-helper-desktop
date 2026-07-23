import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('appointment actions', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);

    // Book one client through the real book-now path.
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
        idempotency_key: 'cancel-flow-book-1',
      }),
    });
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  test('offers the web Delete booking & Edit flow instead of direct cancellation', async () => {
    await goTo(ctx.page, 'Appointments');
    await expect(ctx.page.getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });
    await expect(
      ctx.page.getByRole('button', { name: /Download receipt for RAM BAHADUR/ }),
    ).toBeVisible();
    await expect(ctx.page.getByRole('button', { name: /Cancel appointment/ })).toHaveCount(0);
    await expect(
      ctx.page.getByRole('link', { name: /Delete booking and edit RAM BAHADUR/ }),
    ).toHaveAttribute('href', 'https://example.test/clients/101/edit/?delete_booking=1');
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

});
