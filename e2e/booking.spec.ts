import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

// Each test gets a fresh app + mock so bookings don't leak between scenarios.
test.describe('booking flow', () => {
  let ctx: TestApp;

  test.beforeEach(async () => {
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);
    await goTo(ctx.page, 'Booking Queue');
    await expect(ctx.page.getByText('Ready to book')).toBeVisible();
    await expect(ctx.page.getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });
  });

  test.afterEach(async () => {
    await ctx.cleanup();
  });

  async function selectRupandehiClients(names: string[]): Promise<void> {
    for (const name of names) {
      await ctx.page.getByRole('checkbox', { name: `Select ${name}` }).check();
    }
  }

  test('booking_success books both clients and lists them under Appointments', async () => {
    ctx.mock.setScenario('booking_success');
    await selectRupandehiClients(['RAM BAHADUR', 'SITA KUMARI']);
    await ctx.page.getByRole('button', { name: /Check & book now/ }).first().click();

    const panel = ctx.page.locator('aside[aria-label="Background operations"]');
    await expect(panel.getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText('Booked').first()).toBeVisible({ timeout: 20000 });
    await expect(ctx.page.getByText('Booked 2 · queued 0 · failed 0')).toBeVisible({
      timeout: 20000,
    });
    expect(ctx.mock.bookedCount()).toBe(2);

    await goTo(ctx.page, 'Appointments');
    await expect(ctx.page.locator('main').getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });
    await expect(ctx.page.locator('main').getByText('SITA KUMARI')).toBeVisible();
    await expect(
      ctx.page.getByRole('button', { name: /Download receipt for RAM BAHADUR/ }),
    ).toBeVisible();
  });

  test('partial_success shows one booked and one failed with a readable error', async () => {
    ctx.mock.setScenario('partial_success');
    await selectRupandehiClients(['RAM BAHADUR', 'SITA KUMARI']);
    await ctx.page.getByRole('button', { name: /Check & book now/ }).first().click();

    const panel = ctx.page.locator('aside[aria-label="Background operations"]');
    await expect(panel.getByText('Booked').first()).toBeVisible({ timeout: 20000 });
    await expect(panel.getByText('Failed').first()).toBeVisible();
    await expect(
      panel.getByText(/TIME_SLOT_NOT_AVAILABLE/).first(),
    ).toBeVisible();
  });

  test('no_slots leaves clients queued with an explanation', async () => {
    ctx.mock.setScenario('no_slots');
    await selectRupandehiClients(['Bikash Thapa']);
    await ctx.page.getByRole('button', { name: /Check & book now/ }).first().click();

    await expect(
      ctx.page.getByText('No slot available — clients stay queued and watchers keep trying.'),
    ).toBeVisible({ timeout: 20000 });

    const panel = ctx.page.locator('aside[aria-label="Background operations"]');
    await expect(panel.getByText('Queued').first()).toBeVisible();
    await expect(
      panel.getByText(/stays queued and the watcher keeps trying/i).first(),
    ).toBeVisible();
  });
});
