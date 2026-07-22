import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('watchers', () => {
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

  test('watcher card renders with live state', async () => {
    const card = ctx.page.locator('main >> text=Rupandehi').first();
    await expect(card).toBeVisible();
    await expect(ctx.page.getByText('every 1 h')).toBeVisible();
    // The login-time sync ran one check; the card settled into a live state.
    await expect(ctx.page.getByText(/Active|Checking/).first()).toBeVisible({ timeout: 15000 });
  });

  test('check now finds slots in the one_slot scenario', async () => {
    ctx.mock.setScenario('one_slot');
    await ctx.page.getByRole('button', { name: 'Check Rupandehi now' }).click();
    // The card reports the live result: "last checked · N slots".
    await expect(ctx.page.getByText(/· 1 slot(?!s)/).first()).toBeVisible({ timeout: 15000 });
    await expect(ctx.page.getByText(/Active|Checking/).first()).toBeVisible();
  });

  test('pause and resume toggle the state badge', async () => {
    ctx.mock.setScenario('normal');
    await ctx.page.getByRole('button', { name: 'Pause Rupandehi' }).click();
    await expect(ctx.page.getByText('Paused').first()).toBeVisible({ timeout: 15000 });

    await ctx.page.getByRole('button', { name: 'Resume Rupandehi' }).click();
    await expect(ctx.page.getByText(/Active|Checking/).first()).toBeVisible({ timeout: 15000 });
  });

  test('captcha scenario shows the actionable banner', async () => {
    ctx.mock.setScenario('captcha_421');
    await ctx.page.getByRole('button', { name: 'Check Rupandehi now' }).click();
    await expect(ctx.page.getByText('CAPTCHA required').first()).toBeVisible({ timeout: 15000 });
    await expect(
      ctx.page.getByText(/government site asked for a CAPTCHA/i).first(),
    ).toBeVisible();
    // Manual resume clears the captcha state.
    ctx.mock.setScenario('normal');
    await ctx.page.getByRole('button', { name: 'Resume Rupandehi' }).click();
    await expect(ctx.page.getByText(/Active|Checking/).first()).toBeVisible({ timeout: 15000 });
  });

  test('expired auth ends the session cleanly', async () => {
    ctx.mock.setScenario('expired_auth');
    // The background watcher may observe the expired token before the click.
    await ctx.page
      .getByRole('button', { name: 'Check Rupandehi now' })
      .click({ timeout: 2000 })
      .catch(() => undefined);
    // 401 + failed refresh → vault cleared → back to the login page.
    await ctx.page.waitForSelector('#username', { timeout: 20000 });
  });
});
