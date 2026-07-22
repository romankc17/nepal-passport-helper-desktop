// Packaged-app smoke test for the official-import feature.
// Not a Playwright spec — bundle + run against `npm run package:mac` output:
//   node_modules/.bin/esbuild e2e/packaged-smoke.ts --bundle --platform=node \
//     --format=cjs --external:playwright --outfile=/tmp/packaged-smoke.cjs \
//   && node /tmp/packaged-smoke.cjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright';
import { MockServer } from './mock-server';
import { MockOfficialPortal, CAPTCHA_ANSWER } from './mock-official-portal';

const PACKAGED_BIN =
  process.env.EPP_PACKAGED_BIN ??
  join(
    __dirname,
    '../release/mac-arm64/Nepal Passport Helper.app/Contents/MacOS/Nepal Passport Helper',
  );

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
  console.log(`  ok - ${msg}`);
}

async function main(): Promise<void> {
  const mock = new MockServer();
  const apiPort = await mock.listen();
  const portal = new MockOfficialPortal();
  await portal.start();
  const userDataDir = mkdtempSync(join(tmpdir(), 'epp-packaged-smoke-'));
  console.log(`mock api :${apiPort}, portal ${portal.origin}`);

  const app = await _electron.launch({
    executablePath: PACKAGED_BIN,
    env: {
      ...process.env,
      EPP_E2E: '1',
      EPP_USER_DATA_DIR: userDataDir,
      EPP_DEV_API_URL: `http://127.0.0.1:${apiPort}`,
      EPP_OFFICIAL_ORIGIN: portal.origin,
    },
    timeout: 30000,
  });

  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#username', { timeout: 20000 });
    assert(true, 'packaged app boots to login');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'any-password-works');
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Active watchers', { timeout: 30000 });
    assert(true, 'login against mock api works');

    await page.click('nav >> text="Clients"');
    await page.getByTestId('open-import-official').click();
    const [portalPage] = await Promise.all([
      app.waitForEvent('window', { timeout: 15000 }),
      page.getByTestId('import-open-portal').click(),
    ]);
    await portalPage.waitForSelector('#email', { timeout: 15000 });
    assert(portalPage.url().startsWith(portal.origin), 'import window opened on official origin only');

    // Navigation lock: try to escape the origin from inside the page.
    await portalPage.evaluate(() => {
      window.location.href = 'https://evil.example.com/steal';
    });
    await portalPage.waitForTimeout(1500);
    assert(
      portalPage.url().startsWith(portal.origin),
      `navigation outside official origin blocked (url: ${portalPage.url()})`,
    );
    // The aborted navigation leaves the loader pending; reload cleanly.
    await portalPage.reload({ waitUntil: 'domcontentloaded' });
    await portalPage.waitForSelector('#email', { timeout: 15000 });

    // Manual login incl. CAPTCHA on the (mock) official page.
    await portalPage.fill('#email', 'user@example.com');
    await portalPage.fill('#password', 'secret-stays-here');
    await portalPage.fill('#captcha', CAPTCHA_ANSWER);
    await portalPage.click('button[type="submit"]');
    await portalPage.waitForFunction(() => !!window.localStorage.getItem('jwt'), {
      timeout: 10000,
    });
    assert(true, 'signed in on official portal (token stays in page localStorage)');

    await page.getByTestId('import-signed-in-continue').click();
    await page.getByTestId('import-application-WPT-900001').waitFor({ timeout: 15000 });
    assert(true, 'applications listed');
    await page.getByTestId('import-application-WPT-900001').check();
    await page.getByTestId('import-select-continue').click();
    await page.getByTestId('import-review').waitFor({ timeout: 15000 });
    const givenName = await page.getByTestId('import-field-given_name').inputValue();
    assert(givenName.length > 0, `review shows mapped fields (given_name="${givenName}")`);
    await page.getByTestId('import-confirm-create').click();
    await page.getByTestId('import-success').waitFor({ timeout: 15000 });
    assert(true, 'client created as Fresh in packaged build');

    // Portal window closed + session wiped after success.
    const deadline = Date.now() + 10000;
    while (app.windows().length > 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    assert(app.windows().length === 1, 'portal window closed after import');

    // The mock api 400s on any auth/session key, so one accepted preview call
    // proves the sanitizer stripped the portal's decoy token/biometric keys.
    assert(mock.importPreviewCalls === 1, 'sanitized payload accepted by api (no auth keys)');
    console.log('PACKAGED SMOKE: PASS');
  } finally {
    await app.close().catch(() => undefined);
    await mock.close().catch(() => undefined);
    await portal.stop().catch(() => undefined);
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
