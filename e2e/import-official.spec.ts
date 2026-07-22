import { expect, test, type Page } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';
import { CAPTCHA_ANSWER, MockOfficialPortal } from './mock-official-portal';

// The app is launched with EPP_OFFICIAL_ORIGIN pointing at a local mock
// portal — these tests never touch the real government site.
test.describe('import from official application', () => {
  let portal: MockOfficialPortal;
  let ctx: TestApp;

  test.beforeAll(async () => {
    portal = new MockOfficialPortal();
    await portal.start();
  });

  test.afterAll(async () => {
    await portal.stop();
  });

  test.beforeEach(async () => {
    portal.setScenario('normal');
    ctx = await launchTestApp({ env: { EPP_OFFICIAL_ORIGIN: portal.origin } });
    await loginViaUI(ctx.page);
    await goTo(ctx.page, 'Clients');
    await expect(ctx.page.getByTestId('open-import-official')).toBeVisible({ timeout: 15000 });
  });

  test.afterEach(async () => {
    await ctx.cleanup();
  });

  // Opens the import dialog, clicks "Open official portal" and returns the
  // second Electron window (the locked-down portal window).
  async function openDialogAndPortal(): Promise<Page> {
    await ctx.page.getByTestId('open-import-official').click();
    await expect(ctx.page.getByTestId('import-official-dialog')).toBeVisible();
    const [portalPage] = await Promise.all([
      ctx.app.waitForEvent('window', { timeout: 30000 }),
      ctx.page.getByTestId('import-open-portal').click(),
    ]);
    await portalPage.waitForLoadState('domcontentloaded');
    await expect(portalPage.locator('#email')).toBeVisible();
    return portalPage;
  }

  async function fillAndSubmitLogin(portalPage: Page, captcha: string): Promise<void> {
    await portalPage.fill('#email', 'e2e@example.com');
    await portalPage.fill('#password', 'portal-password');
    await portalPage.fill('#captcha', captcha);
    await portalPage.click('button[type="submit"]');
  }

  async function signInOnPortal(portalPage: Page): Promise<void> {
    await fillAndSubmitLogin(portalPage, CAPTCHA_ANSWER);
    await expect(portalPage.getByText('Signed in to the official portal')).toBeVisible();
    // Opaque (non-JWT-shaped) token under the exact key `jwt` — this is the
    // whole point of the fix: no dot-separated JWT shape may be required.
    const token = await portalPage.evaluate(() => localStorage.getItem('jwt'));
    expect(token).toBeTruthy();
    expect(token).not.toContain('.');
  }

  test('happy path imports an application and creates a Fresh client', async () => {
    const portalPage = await openDialogAndPortal();

    // Wrong CAPTCHA keeps the user on the login page and sets no token.
    await fillAndSubmitLogin(portalPage, '9');
    await expect(portalPage.getByText('Incorrect CAPTCHA answer')).toBeVisible();
    expect(await portalPage.evaluate(() => localStorage.getItem('jwt'))).toBeNull();

    await signInOnPortal(portalPage);

    // Back in the main window: list the account's applications.
    await ctx.page.getByTestId('import-signed-in-continue').click();
    await expect(ctx.page.getByTestId('import-application-WPT-900001')).toBeVisible({
      timeout: 15000,
    });
    await expect(ctx.page.getByTestId('import-application-WPT-900002')).toBeVisible();

    await ctx.page.getByTestId('import-application-WPT-900001').check();
    await ctx.page.getByTestId('import-select-continue').click();

    // Review: mapped fields from the official JSON, edit one field.
    await expect(ctx.page.getByTestId('import-review')).toBeVisible({ timeout: 15000 });
    await expect(ctx.page.getByTestId('import-field-given_name')).toHaveValue('Maya');
    await expect(ctx.page.getByTestId('import-field-surname')).toHaveValue('Gurung');
    await ctx.page.getByTestId('import-field-phone').fill('+9779800000000');

    await ctx.page.getByTestId('import-confirm-create').click();
    await expect(ctx.page.getByTestId('import-success')).toBeVisible({ timeout: 15000 });
    await expect(ctx.page.getByTestId('import-success')).toContainText('Client created as Fresh');

    // Sanitization proof: the portal's detail JSON carries decoy
    // authToken/biometricImage keys; the mock Django preview 400s on such
    // keys — so reaching preview + confirm means main stripped them.
    expect(ctx.mock.importPreviewCalls).toBe(1);

    // Import finished → main closed the portal window and wiped its session.
    await expect.poll(() => ctx.app.windows().length, { timeout: 10000 }).toBe(1);

    await ctx.page.getByTestId('import-view-client').click();
    // Client detail drawer opens for the new client.
    await expect(ctx.page.getByRole('dialog').getByText('Maya Gurung')).toBeVisible({
      timeout: 15000,
    });
    // …and the client appears in the Clients list with the edited phone.
    await expect(ctx.page.locator('main').getByText('Maya Gurung')).toBeVisible();
    await expect(ctx.page.getByRole('dialog').getByText('+9779800000000')).toBeVisible();
    await expect(ctx.page.locator('main').getByText('incomplete').first()).toBeVisible();
  });

  test('session expired shows a path back to sign-in', async () => {
    const portalPage = await openDialogAndPortal();
    await signInOnPortal(portalPage);

    portal.setScenario('expired');
    await ctx.page.getByTestId('import-signed-in-continue').click();

    await expect(ctx.page.getByRole('alert')).toContainText(
      'Your official portal session was rejected or expired — please sign in again',
      { timeout: 15000 },
    );
    // Back on the sign-in step with the continue button available.
    await expect(ctx.page.getByText('Waiting for sign-in and CAPTCHA…')).toBeVisible();
    await expect(ctx.page.getByTestId('import-signed-in-continue')).toBeVisible();
  });

  test('HTML maintenance page reports an unexpected response, not a CAPTCHA blame', async () => {
    const portalPage = await openDialogAndPortal();
    await signInOnPortal(portalPage);

    portal.setScenario('html_error');
    await ctx.page.getByTestId('import-signed-in-continue').click();

    await expect(ctx.page.getByRole('alert')).toContainText('unexpected page', {
      timeout: 15000,
    });
    await expect(ctx.page.getByRole('alert')).not.toContainText('CAPTCHA failed');
  });

  test('cancel closes the dialog and the portal window', async () => {
    await openDialogAndPortal();
    expect(ctx.app.windows().length).toBe(2);

    await ctx.page.getByTestId('import-cancel').click();

    await expect(ctx.page.getByTestId('import-official-dialog')).toBeHidden();
    await expect.poll(() => ctx.app.windows().length, { timeout: 10000 }).toBe(1);
  });
});
