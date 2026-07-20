import { expect, test } from '@playwright/test';
import { launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('duplicate booking protection', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  test('the same idempotency key produces exactly one booking', async () => {
    ctx.mock.setScenario('booking_success');

    const input = {
      provider_id: 501,
      district_id: '280',
      province_id: '226',
      provider_name: 'Rupandehi',
      client_ids: [101],
      idempotency_key: 'dup-key-0001',
    };

    const first = await ctx.page.evaluate(async (payload) => {
      return window.desktop.queue.bookNow(payload);
    }, input);
    const second = await ctx.page.evaluate(async (payload) => {
      return window.desktop.queue.bookNow(payload);
    }, input);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(ctx.mock.bookingCount()).toBe(1);
    expect(ctx.mock.idempotencyKeysSeen.filter((key) => key === 'dup-key-0001')).toHaveLength(1);
  });
});
