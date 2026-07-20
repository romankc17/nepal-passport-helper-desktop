import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { goTo, launchTestApp, loginViaUI, type TestApp } from './helpers';

const RECEIPT_DIR = join(tmpdir(), 'epp-e2e-receipts');

test.describe('receipt download', () => {
  let ctx: TestApp;

  test.beforeAll(async () => {
    rmSync(RECEIPT_DIR, { recursive: true, force: true });
    ctx = await launchTestApp();
    await loginViaUI(ctx.page);

    ctx.mock.setScenario('booking_success');
    await ctx.page.evaluate(async () => {
      return window.desktop.queue.bookNow({
        provider_id: 501,
        district_id: '280',
        province_id: '226',
        provider_name: 'Rupandehi',
        client_ids: [101],
        idempotency_key: 'receipt-flow-book-1',
      });
    });
  });

  test.afterAll(async () => {
    await ctx.cleanup();
  });

  test('receipt button saves the PDF (dialog skipped in EPP_E2E mode)', async () => {
    await goTo(ctx.page, 'Appointments');
    await expect(ctx.page.getByText('RAM BAHADUR')).toBeVisible({ timeout: 15000 });

    await ctx.page.getByRole('button', { name: /Download receipt for RAM BAHADUR/ }).click();
    await expect(ctx.page.getByText(/Receipt saved to/)).toBeVisible({ timeout: 15000 });

    const files = readdirSync(RECEIPT_DIR).filter((file) => file.endsWith('.pdf'));
    expect(files.length).toBeGreaterThan(0);
    const saved = readFileSync(join(RECEIPT_DIR, files[0]));
    expect(saved.subarray(0, 4).toString()).toBe('%PDF');
    expect(existsSync(join(RECEIPT_DIR, files[0]))).toBe(true);
  });
});
