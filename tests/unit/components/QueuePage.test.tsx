// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSummary, LocalQueueItem, Watcher } from '../../../src/shared/types';
import { OperationsProvider } from '../../../src/renderer/src/operations';
import { QueuePage } from '../../../src/renderer/src/pages/QueuePage';
import { WatcherRuntimeProvider } from '../../../src/renderer/src/runtime';
import { installDesktopMock, renderWithProviders } from './test-utils';

const watcher: Watcher = {
  id: 88,
  name: 'DAO Kathmandu',
  mode: 'book',
  province_id: 3,
  district_id: 27,
  provider_id: 525,
  provider_name: 'DAO Kathmandu',
  district_name: 'Kathmandu/काठमाडौं',
  interval_seconds: 300,
  days_ahead: 7,
  desired_bookings: 20,
  notify: true,
  notification_email: 'admin@example.com',
  active: true,
  last_checked_at: new Date(Date.now() - 65_000).toISOString(),
  next_check_due_at: new Date(Date.now() + 70_000).toISOString(),
  last_error: null,
  available_slots: [],
  queued_count: 2,
  booked_count: 0,
  created_at: '2026-07-20T00:00:00Z',
};

const queueItems: LocalQueueItem[] = ['Ram Client', 'Sita Client'].map((client_name, index) => ({
  client_id: index + 1,
  client_name,
  official_application_id: `WPT-${index + 1}`,
  phone: '9800000000',
  email: `client-${index + 1}@example.com`,
  location: {
    provider_id: 525,
    provider_name: 'DAO Kathmandu',
    district_id: 27,
    province_id: 3,
  },
  added_at: Date.now() + index,
  status: 'queued',
}));

const clients: ClientSummary[] = ([
  {
    id: 1,
    full_name: 'Ram Client',
    status: 'ready',
    desktop_status: 'ready',
    official_application_id: 'WPT-1',
    missing_document_count: 0,
    can_book: true,
  },
  {
    id: 3,
    full_name: 'Fresh Client',
    status: 'fresh',
    desktop_status: 'fresh',
    official_application_id: '',
    missing_document_count: 0,
    can_book: true,
  },
  {
    id: 4,
    full_name: 'Incomplete Client',
    status: 'fresh',
    desktop_status: 'incomplete',
    official_application_id: '',
    missing_document_count: 1,
    can_book: false,
  },
] as const).map((client) => ({
  application_type: 'First issuance (new)',
  provider_id: 525,
  provider_name: 'DAO Kathmandu',
  district_name: 'Kathmandu',
  phone: '9800000000',
  email: '',
  queued_booking_id: null,
  appointment: null,
  created_by: 'admin',
  created_at: '2026-07-24T00:00:00Z',
  ...client,
}));

describe('QueuePage', () => {
  beforeEach(() => {
    const desktop = installDesktopMock();
    desktop.auth.getSession = vi.fn().mockResolvedValue({
      user: { id: 1, username: 'admin', is_staff: true },
      access: { mode: 'providers', providers: [], booking_lab: true },
      defaults: { interval_seconds: 300 },
      offline: false,
    });
    desktop.clients.readyByLocation = vi.fn().mockResolvedValue([
      {
        provider_id: 525,
        provider_name: 'DAO Kathmandu',
        district_name: 'Kathmandu',
        clients,
      },
    ]);
    desktop.queue.get = vi.fn().mockResolvedValue({ items: queueItems });
    desktop.watchers.list = vi.fn().mockResolvedValue([watcher]);
    desktop.scheduler.getRuntime = vi.fn().mockResolvedValue([
      { watcherId: 88, state: 'scheduled', nextRunAt: Date.now() + 70_000 },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows compact queue groups with live check times and an expandable client grid', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(
      <WatcherRuntimeProvider>
        <OperationsProvider>
          <QueuePage />
        </OperationsProvider>
      </WatcherRuntimeProvider>,
      { route: '/queue' },
    );

    expect(await screen.findByText('DAO Kathmandu')).toBeInTheDocument();
    expect(screen.getByText('2 clients queued')).toBeInTheDocument();
    expect(screen.getByText(/ago$/)).toBeInTheDocument();
    expect(screen.getByText(/^in /)).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(screen.getByText('fresh')).toBeInTheDocument();
    expect(screen.getByText('incomplete')).toBeInTheDocument();
    expect(screen.getByLabelText('Ram Client is queued')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Incomplete Client' })).toBeDisabled();

    const group = container.querySelector('details');
    const summary = group?.querySelector('summary');
    expect(group?.open).toBe(false);
    await user.click(summary!);
    expect(group?.open).toBe(true);
    expect(screen.getAllByText('Ram Client')).toHaveLength(2);
    expect(screen.getByText('Sita Client')).toBeInTheDocument();
  });
});
