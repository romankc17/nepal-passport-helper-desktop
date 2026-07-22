// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  notification_email: 'test@example.com',
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

  it('check now asks the scheduler for a manual run', async () => {
    const desktop = mockSignedIn([{ watcherId: 88, state: 'scheduled' }]);
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Check Rupandehi now' }));
    await waitFor(() => {
      expect(desktop.scheduler.checkNow).toHaveBeenCalledWith(88);
    });
  });

  it('explains why a manual check did not start instead of staying silent', async () => {
    const desktop = mockSignedIn([{ watcherId: 88, state: 'scheduled' }]);
    desktop.scheduler.checkNow = vi
      .fn()
      .mockResolvedValue({ requested: false, reason: 'already-running' });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Check Rupandehi now' }));
    expect(
      await screen.findByText('A check is already running for this watcher'),
    ).toBeInTheDocument();
  });

  it('shows an in-progress indicator in the history while a check runs', async () => {
    const desktop = mockSignedIn([{ watcherId: 88, state: 'checking' }]);
    desktop.watchers.history = vi
      .fn()
      .mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0 });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'History for Rupandehi' }));
    expect(await screen.findByText(/Checking now/)).toBeInTheDocument();
  });

  it('refreshes the history when a check finishes', async () => {
    const desktop = mockSignedIn([]);
    let listener: ((event: unknown) => void) | null = null;
    (desktop.on as ReturnType<typeof vi.fn>).mockImplementation(
      (channel: string, callback: (event: unknown) => void) => {
        if (channel === 'watcher-state') listener = callback;
        return () => undefined;
      },
    );
    desktop.watchers.history = vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          started_at: '2026-07-21T09:59:00Z',
          finished_at: '2026-07-21T10:00:00Z',
          success: true,
          error: null,
          slots_found: 3,
          request: {},
          response: {},
        },
      ],
      page: 1,
      page_size: 25,
      total: 1,
    });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'History for Rupandehi' }));
    await waitFor(() => expect(desktop.watchers.history).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('3 slots')).toBeInTheDocument();

    act(() => {
      listener?.({ type: 'watcher-state', watcherId: 88, state: 'checking' });
    });
    act(() => {
      listener?.({
        type: 'watcher-state',
        watcherId: 88,
        state: 'scheduled',
        lastResult: { status: 'ok', slotsFound: 3, bookedCount: 0 },
      });
    });
    await waitFor(() => expect(desktop.watchers.history).toHaveBeenCalledTimes(2));
  });
});
