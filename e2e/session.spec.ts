import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchTestApp, loginViaUI, type TestApp } from './helpers';

test.describe('restart recovery', () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'epp-e2e-session-'));
  let first: TestApp;
  let second: TestApp;

  test.afterAll(async () => {
    await first?.cleanup();
    await second?.cleanup();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test('session is restored from the vault after a restart', async () => {
    first = await launchTestApp({ userDataDir });
    await loginViaUI(first.page);
    await expect(first.page.getByText('Active watchers')).toBeVisible();
    const port = first.port;
    await first.app.close();

    second = await launchTestApp({ userDataDir, portOverride: port, });
    // Lands on Overview without a login form, and watchers re-sync.
    await expect(second.page.getByText('Active watchers')).toBeVisible({ timeout: 30000 });
    await expect(second.page.locator('#username')).toHaveCount(0);
    const runtime = await second.page.evaluate(() => window.desktop.scheduler.getRuntime());
    expect(runtime.length).toBeGreaterThan(0);
  });
});
