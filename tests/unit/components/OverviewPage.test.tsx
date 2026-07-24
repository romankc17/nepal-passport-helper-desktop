// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverviewPage } from '../../../src/renderer/src/pages/OverviewPage';
import { WatcherRuntimeProvider } from '../../../src/renderer/src/runtime';
import { installDesktopMock, renderWithProviders } from './test-utils';

describe('OverviewPage', () => {
  afterEach(cleanup);

  it('charts today outcomes and the live queue breakdown', async () => {
    const desktop = installDesktopMock();
    desktop.auth.getSession = vi.fn().mockResolvedValue({
      user: { id: 1, username: 'admin', is_staff: true },
      access: { mode: 'providers', providers: [], booking_lab: true },
      defaults: { interval_seconds: 300 },
      offline: false,
    });
    desktop.overview.get = vi.fn().mockResolvedValue({
      active_watchers: 2,
      queued_clients: 5,
      slots_found_today: 8,
      booked_today: 3,
      failed_today: 1,
      recent_activity: [],
      upcoming_checks: [],
    });
    desktop.queue.get = vi.fn().mockResolvedValue({
      items: [
        { client_id: 1, status: 'queued' },
        { client_id: 2, status: 'queued' },
        { client_id: 3, status: 'booking' },
        { client_id: 4, status: 'booked' },
        { client_id: 5, status: 'failed' },
      ],
    });
    desktop.preferences.get = vi.fn().mockResolvedValue({
      notifications_enabled: true,
      sound_enabled: true,
      email_on_booking: false,
      email_address: '',
      favorite_locations: [],
    });

    renderWithProviders(
      <WatcherRuntimeProvider>
        <OverviewPage />
      </WatcherRuntimeProvider>,
    );

    expect(await screen.findByText("Today's outcomes")).toBeInTheDocument();
    expect(await screen.findByRole('meter', { name: 'Slots found: 8' })).toHaveAttribute(
      'aria-valuenow',
      '8',
    );
    expect(screen.getByRole('meter', { name: 'Waiting: 2' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'In progress: 1' })).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Booked: 1' })).toBeInTheDocument();
    expect(screen.getAllByRole('meter', { name: 'Failed: 1' })).toHaveLength(2);
  });
});
