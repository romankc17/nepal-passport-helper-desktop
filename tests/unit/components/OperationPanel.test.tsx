// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookNowResult } from '../../../src/shared/types';
import { OperationPanel } from '../../../src/renderer/src/components/OperationPanel';
import { OperationsProvider, useOperations } from '../../../src/renderer/src/operations';
import { installDesktopMock, renderWithProviders } from './test-utils';

const input = {
  provider_id: 501,
  district_id: '280',
  province_id: '226',
  provider_name: 'Rupandehi',
  client_ids: [101],
  idempotency_key: 'test-key',
};

const names = new Map([[101, 'RAM BAHADUR']]);

function RunButton() {
  const { startBookNow } = useOperations();
  return (
    <button
      onClick={() => {
        void startBookNow(input, names).catch(() => undefined);
      }}
    >
      run
    </button>
  );
}

function renderPanel() {
  return renderWithProviders(
    <OperationsProvider>
      <RunButton />
      <OperationPanel />
    </OperationsProvider>,
    { withAuth: false },
  );
}

function mockBookNowResults(results: BookNowResult['results']) {
  const desktop = installDesktopMock();
  desktop.queue.add = vi.fn().mockResolvedValue({
    watcher: {},
    queued: [{ client_id: 101, booking_id: 500 }],
    skipped: [],
  });
  desktop.queue.bookNow = vi.fn().mockResolvedValue({ watcher: {}, results });
  desktop.queue.progress = vi.fn().mockResolvedValue([]);
  return desktop;
}

describe('OperationPanel', () => {
  beforeEach(() => {
    installDesktopMock();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the booked stage for a successful book-now', async () => {
    mockBookNowResults([
      { client_id: 101, booking_id: 500, outcome: 'booked', appointment: { date: '2026-08-01', start_time: '10:00' } },
    ]);
    renderPanel();
    await userEvent.click(screen.getByText('run'));
    expect(await screen.findByText('RAM BAHADUR')).toBeInTheDocument();
    expect(await screen.findByText('Booked')).toBeInTheDocument();
  });

  it('shows the queued stage with the stay-queued explanation', async () => {
    mockBookNowResults([
      { client_id: 101, booking_id: 500, outcome: 'queued', error: 'No slot is currently available.' },
    ]);
    renderPanel();
    await userEvent.click(screen.getByText('run'));
    expect(await screen.findByText('Queued')).toBeInTheDocument();
    expect(
      screen.getByText(/stays queued and the watcher keeps trying/i),
    ).toBeInTheDocument();
  });

  it('shows the failed stage with the server error', async () => {
    mockBookNowResults([
      { client_id: 101, booking_id: 500, outcome: 'failed', error: 'Passport service returned HTTP 422 (TIME_SLOT_NOT_AVAILABLE)' },
    ]);
    renderPanel();
    await userEvent.click(screen.getByText('run'));
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/TIME_SLOT_NOT_AVAILABLE/)).toBeInTheDocument();
  });
});
