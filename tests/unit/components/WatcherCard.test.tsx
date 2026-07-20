// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Watcher } from '../../../src/shared/types';
import { WatcherCard } from '../../../src/renderer/src/components/WatcherCard';
import { WatcherRuntimeProvider } from '../../../src/renderer/src/runtime';
import { installDesktopMock, renderWithProviders } from './test-utils';

const watcher: Watcher = {
  id: 88,
  name: 'Rupandehi',
  mode: 'book',
  province_id: '226',
  district_id: '280',
  provider_id: 501,
  provider_name: 'Rupandehi',
  district_name: 'Rupandehi/रुपन्देही',
  interval_seconds: 300,
  days_ahead: 7,
  desired_bookings: 5,
  notify: true,
  active: true,
  last_checked_at: null,
  next_check_due_at: null,
  last_error: '',
  available_slots: [],
  queued_count: 2,
  booked_count: 1,
  created_at: '2026-07-20T00:00:00Z',
};

function mockSignedIn(runtimeEntries: { watcherId: number; state: string }[]) {
  const desktop = installDesktopMock();
  desktop.auth.getSession = vi.fn().mockResolvedValue({
    user: { id: 1, username: 'admin', is_staff: true },
    access: { mode: 'providers', providers: [] },
    defaults: { interval_seconds: 300 },
    offline: false,
  });
  desktop.scheduler.getRuntime = vi.fn().mockResolvedValue(runtimeEntries);
  return desktop;
}

function renderCard() {
  return renderWithProviders(
    <WatcherRuntimeProvider>
      <WatcherCard watcher={watcher} />
    </WatcherRuntimeProvider>,
  );
}

describe('WatcherCard', () => {
  beforeEach(() => {
    mockSignedIn([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the checking state with a pulse while a check runs', async () => {
    mockSignedIn([{ watcherId: 88, state: 'checking' }]);
    const { container } = renderCard();
    expect(await screen.findByText('Checking')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the CAPTCHA banner with an actionable explanation', async () => {
    mockSignedIn([{ watcherId: 88, state: 'captcha' }]);
    renderCard();
    expect(await screen.findByText('CAPTCHA required')).toBeInTheDocument();
    expect(screen.getByText(/government site asked for a CAPTCHA/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Resume Rupandehi/ })).toBeInTheDocument();
  });

  it('shows the paused badge when the watcher is inactive', async () => {
    mockSignedIn([]);
    renderWithProviders(
      <WatcherRuntimeProvider>
        <WatcherCard watcher={{ ...watcher, active: false }} />
      </WatcherRuntimeProvider>,
    );
    expect(await screen.findByText('Paused')).toBeInTheDocument();
  });

  it('shows queued and booked counts', async () => {
    mockSignedIn([{ watcherId: 88, state: 'scheduled' }]);
    renderCard();
    expect(await screen.findByText('2 clients')).toBeInTheDocument();
    expect(screen.getByText('every 5 min')).toBeInTheDocument();
  });
});
