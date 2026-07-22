import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { MockServer } from './mock-server';

export const PROJECT_ROOT = join(__dirname, '..');
export const ELECTRON_BIN = join(
  PROJECT_ROOT,
  process.platform === 'darwin'
    ? 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
    : process.platform === 'win32'
      ? 'node_modules/electron/dist/electron.exe'
      : 'node_modules/electron/dist/electron',
);

export interface TestApp {
  app: ElectronApplication;
  page: Page;
  mock: MockServer;
  port: number;
  userDataDir: string;
  consoleErrors: string[];
  cleanup: () => Promise<void>;
}

export async function launchTestApp(options?: {
  userDataDir?: string;
  portOverride?: number;
  /** Extra environment variables for the launched app (e.g. EPP_OFFICIAL_ORIGIN). */
  env?: Record<string, string>;
}): Promise<TestApp> {
  const mock = new MockServer();
  const port = options?.portOverride ?? (await mock.listen());
  const userDataDir = options?.userDataDir ?? mkdtempSync(join(tmpdir(), 'epp-e2e-userdata-'));
  const consoleErrors: string[] = [];

  const app = await _electron.launch({
    executablePath: ELECTRON_BIN,
    args: ['.'],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      EPP_E2E: '1',
      EPP_USER_DATA_DIR: userDataDir,
      EPP_DEV_API_URL: `http://127.0.0.1:${port}`,
      ...options?.env,
    },
    timeout: 30000,
  });

  const page = await app.firstWindow();
  page.on('pageerror', (error) => consoleErrors.push(`PAGEERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  return {
    app,
    page,
    mock,
    port,
    userDataDir,
    consoleErrors,
    cleanup: async () => {
      await app.close().catch(() => undefined);
      await mock.close().catch(() => undefined);
      if (!options?.userDataDir) rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

export async function loginViaUI(page: Page): Promise<void> {
  await page.waitForSelector('#username', { timeout: 20000 });
  await page.fill('#username', 'admin');
  await page.fill('#password', 'any-password-works');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=Active watchers', { timeout: 30000 });
}

export async function goTo(page: Page, label: string): Promise<void> {
  await page.click(`nav >> text="${label}"`);
}
