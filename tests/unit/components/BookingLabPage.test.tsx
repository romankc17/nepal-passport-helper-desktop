// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BookingLabPage } from '../../../src/renderer/src/pages/BookingLabPage';
import { bridgeError, installDesktopMock, renderWithProviders } from './test-utils';

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Test Client',
    application_type: 'RENEW',
    status: 'submitted',
    owner: 'testuser',
    owner_id: 1,
    official_application_id: 'WPT-1',
    provider_id: 525,
    provider_name: 'Surkhet',
    district_name: 'Surkhet',
    booking_id: null,
    booking_status: null,
    appointment_date: null,
    start_time: null,
    can_book: true,
    can_cancel: false,
    can_delete: true,
    receipt_available: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeWatcher(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Lab booking 525',
    mode: 'book',
    province_id: '228',
    district_id: '297',
    provider_id: 525,
    provider_name: 'Surkhet',
    district_name: 'Surkhet',
    interval_seconds: 300,
    days_ahead: 14,
    desired_bookings: 5,
    notify: true,
    notification_email: '',
    active: true,
    last_checked_at: '2024-01-01T10:00:00Z',
    next_check_due_at: null,
    last_error: '',
    available_slots: [{ date: '2024-01-15', start_time: '10:00', end_time: '11:00' }],
    queued_count: 2,
    booked_count: 1,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function installDraftStorage(drafts: Record<string, unknown>[]) {
  let value = JSON.stringify(drafts);
  const storage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    removeItem: vi.fn(),
    clear: vi.fn(() => {
      value = '[]';
    }),
    length: 1,
    key: vi.fn(),
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return storage;
}

describe('BookingLabPage', () => {
  beforeEach(() => {
    installDesktopMock();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the generated tab by default', async () => {
    renderWithProviders(<BookingLabPage />, { withAuth: true });

    expect(screen.getByRole('heading', { name: 'Booking Lab' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Generated/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Submitted/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Booked/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Watchers/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /History/ })).toBeInTheDocument();
  });

  it('shows empty state when no generated clients', async () => {
    renderWithProviders(<BookingLabPage />, { withAuth: true });

    await waitFor(() => {
      expect(screen.getByText('No generated clients')).toBeInTheDocument();
    });
  });

  it('opens generate dialog when clicking generate button', async () => {
    const desktop = installDesktopMock();
    desktop.locations.list = vi.fn().mockResolvedValue([]);

    renderWithProviders(<BookingLabPage />, { withAuth: true });

    const generateButtons = screen.getAllByRole('button', { name: /Generate demo clients/ });
    await userEvent.click(generateButtons[0]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Province')).toBeInTheDocument();
    expect(screen.getByText('District')).toBeInTheDocument();
    expect(screen.getByText('Appointment office')).toBeInTheDocument();
    expect(screen.getByText('Application type')).toBeInTheDocument();
    expect(screen.getByText('Number of clients')).toBeInTheDocument();
  });

  it('removes only successfully submitted drafts and keeps failed or unselected drafts', async () => {
    const desktop = installDesktopMock();
    const drafts = [
      { given_name: 'Success', surname: 'Client', appointment_provider_name: 'Surkhet' },
      { given_name: 'Untouched', surname: 'Client', appointment_provider_name: 'Surkhet' },
      { given_name: 'Retry', surname: 'Client', appointment_provider_name: 'Surkhet' },
    ];
    installDraftStorage(drafts);
    desktop.lab.submit = vi.fn().mockResolvedValue({ batch_id: 'batch-1' });
    desktop.lab.job = vi.fn().mockResolvedValue({
      batch_id: 'batch-1',
      kind: 'submit',
      total: 2,
      completed: 2,
      failed: 1,
      finished: true,
      stages: { 0: 'done', 1: 'failed' },
      result: {
        submitted: [{ client_id: 10, applicant_id: 20, name: 'Success Client', official_application_id: 'WPT-1' }],
        failed: [{ client_id: 30, name: 'Retry Client', error: 'Official portal rejected the application' }],
      },
      error: null,
    });

    renderWithProviders(<BookingLabPage />, { withAuth: true });
    await userEvent.click(await screen.findByLabelText('Select Success'));
    await userEvent.click(screen.getByLabelText('Select Retry'));
    await userEvent.click(screen.getByRole('button', { name: 'Submit for appointment' }));

    await waitFor(() => {
      const remaining = JSON.parse(
        localStorage.getItem('booking-lab-drafts') ?? '[]',
      ) as { given_name: string }[];
      expect(remaining.map((draft) => draft.given_name)).toEqual(['Untouched', 'Retry']);
    });
    expect(desktop.lab.submit).toHaveBeenCalledWith(expect.objectContaining({
      clients: [drafts[0], drafts[2]],
    }));
  });

  it('shows generated drafts from localStorage', async () => {
    const drafts = [
      {
        given_name: 'Test',
        surname: 'Client',
        application_type: 'RENEW',
        appointment_provider_name: 'Surkhet',
      },
    ];
    installDraftStorage(drafts);

    renderWithProviders(<BookingLabPage />, { withAuth: true });

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument();
    });
    expect(screen.getByText('Not submitted')).toBeInTheDocument();
  });

  it('switches to submitted tab and shows clients', async () => {
    const desktop = installDesktopMock();
    desktop.lab.clients = vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'Test Client',
          application_type: 'RENEW',
          status: 'submitted',
          owner: 'testuser',
          owner_id: 1,
          official_application_id: 'WPT-1',
          provider_id: 525,
          provider_name: 'Surkhet',
          district_name: 'Surkhet',
          booking_id: null,
          booking_status: null,
          appointment_date: null,
          start_time: null,
          can_book: true,
          can_cancel: false,
          can_delete: true,
          receipt_available: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ],
      page: 1,
      page_size: 25,
      total: 1,
      is_staff: false,
    });

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=submitted',
    });

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument();
    });
    expect(screen.getByText('WPT-1')).toBeInTheDocument();
    expect(screen.getByText('Surkhet')).toBeInTheDocument();
  });

  it('refreshes the client list after deleting a client (invalidation regression)', async () => {
    const desktop = installDesktopMock();
    desktop.lab.clients = vi.fn().mockResolvedValue({
      items: [makeClient()],
      page: 1,
      page_size: 25,
      total: 1,
      is_staff: false,
    });
    desktop.lab.delete = vi.fn().mockResolvedValue({ deleted: true });

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=submitted',
    });

    await waitFor(() => expect(screen.getByText('Test Client')).toBeInTheDocument());
    const clientsMock = desktop.lab.clients as unknown as Mock;
    const callsBefore = clientsMock.mock.calls.length;

    await userEvent.click(screen.getByTitle('Delete client'));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(desktop.lab.delete).toHaveBeenCalledWith(1));
    // The live list query sits at ['lab-clients', listQuery] — invalidation
    // must refetch it (previously it silently missed).
    await waitFor(() => expect(clientsMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('shows booked clients with receipt and cancel actions', async () => {
    const desktop = installDesktopMock();
    desktop.lab.clients = vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'Test Client',
          application_type: 'RENEW',
          status: 'booked',
          owner: 'testuser',
          owner_id: 1,
          official_application_id: 'WPT-1',
          provider_id: 525,
          provider_name: 'Surkhet',
          district_name: 'Surkhet',
          booking_id: 100,
          booking_status: 'booked',
          appointment_date: '2024-01-15',
          start_time: '10:00',
          can_book: false,
          can_cancel: true,
          can_delete: false,
          receipt_available: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ],
      page: 1,
      page_size: 25,
      total: 1,
      is_staff: false,
    });

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=booked',
    });

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument();
    });
    expect(screen.getByText('2024-01-15 10:00')).toBeInTheDocument();
    expect(screen.getByTitle('Download receipt')).toBeInTheDocument();
    expect(screen.getByTitle('Cancel appointment')).toBeInTheDocument();
  });

  it('shows admin owner filter for staff users', async () => {
    const desktop = installDesktopMock();
    desktop.lab.clients = vi.fn().mockResolvedValue({
      items: [
        {
          id: 1,
          name: 'Other User Client',
          application_type: 'RENEW',
          status: 'submitted',
          owner: 'otheruser',
          owner_id: 2,
          official_application_id: 'WPT-2',
          provider_id: 525,
          provider_name: 'Surkhet',
          district_name: 'Surkhet',
          booking_id: null,
          booking_status: null,
          appointment_date: null,
          start_time: null,
          can_book: true,
          can_cancel: false,
          can_delete: true,
          receipt_available: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ],
      page: 1,
      page_size: 25,
      total: 1,
      is_staff: true,
    });

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=submitted',
    });

    await waitFor(() => {
      expect(screen.getByText('Other User Client')).toBeInTheDocument();
    });
    expect(screen.getByText('otheruser')).toBeInTheDocument();
    expect(screen.getByLabelText('Owner')).toBeInTheDocument();
  });

  it('shows a Failed badge for failed clients on the submitted tab', async () => {
    const desktop = installDesktopMock();
    desktop.lab.clients = vi.fn().mockResolvedValue({
      items: [makeClient({ status: 'failed', booking_status: 'failed' })],
      page: 1,
      page_size: 25,
      total: 1,
      is_staff: false,
    });

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=submitted',
    });

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument();
    });
    // One "Failed" is the summary-card label, the second is the row badge.
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    expect(desktop.lab.clients).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'submitted,queued,failed' }),
    );
  });

  it('surfaces the server error message and retries on the submitted tab', async () => {
    const desktop = installDesktopMock();
    desktop.lab.clients = vi
      .fn()
      .mockRejectedValue(bridgeError('NETWORK_ERROR', 'Cannot reach the server', true));

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=submitted',
    });

    await waitFor(() => {
      expect(screen.getByText('Could not load clients')).toBeInTheDocument();
    });
    expect(screen.getByText(/Cannot reach the server/)).toBeInTheDocument();

    const callsBefore = (desktop.lab.clients as ReturnType<typeof vi.fn>).mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect((desktop.lab.clients as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        callsBefore,
      );
    });
  });

  it('paginates submitted clients through the server', async () => {
    const desktop = installDesktopMock();
    desktop.lab.clients = vi.fn().mockResolvedValue({
      items: [makeClient()],
      page: 1,
      page_size: 25,
      total: 30,
      is_staff: false,
    });

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=submitted',
    });

    await waitFor(() => {
      expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(desktop.lab.clients).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  it('lists only lab watchers on the watchers tab', async () => {
    const desktop = installDesktopMock();
    desktop.watchers.list = vi.fn().mockResolvedValue([
      makeWatcher(),
      makeWatcher({ id: 2, name: 'Kathmandu regular', mode: 'notify', active: false }),
    ]);

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=watchers',
    });

    await waitFor(() => {
      expect(screen.getByText('Lab booking 525')).toBeInTheDocument();
    });
    expect(screen.queryByText('Kathmandu regular')).not.toBeInTheDocument();
    expect(screen.getByText('Auto-book')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Surkhet, Surkhet')).toBeInTheDocument();
  });

  it('shows an empty state when there are no lab watchers', async () => {
    installDesktopMock();

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=watchers',
    });

    await waitFor(() => {
      expect(screen.getByText('No lab watchers')).toBeInTheDocument();
    });
  });

  it('shows a retryable error state on the watchers tab', async () => {
    const desktop = installDesktopMock();
    desktop.watchers.list = vi
      .fn()
      .mockRejectedValue(bridgeError('SERVER_ERROR', 'Watcher backend exploded'));

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=watchers',
    });

    await waitFor(() => {
      expect(screen.getByText('Could not load watchers')).toBeInTheDocument();
    });
    expect(screen.getByText(/Watcher backend exploded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders history rows with booking statuses on the history tab', async () => {
    const desktop = installDesktopMock();
    desktop.lab.history = vi.fn().mockResolvedValue({
      items: [
        {
          id: 10,
          client_id: 1,
          client_name: 'Test Client',
          owner: 'testuser',
          status: 'pending',
          monitor_name: 'Lab booking 525',
          appointment_date: null,
          start_time: null,
          error: 'No slot available',
          created_at: '2024-01-02T00:00:00Z',
          booked_at: null,
          cancelled_at: null,
        },
      ],
      page: 1,
      page_size: 25,
      total: 1,
    });

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=history',
    });

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument();
    });
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Lab booking 525')).toBeInTheDocument();
    expect(screen.getByText('No slot available')).toBeInTheDocument();
  });

  it('shows a retryable error state on the history tab', async () => {
    const desktop = installDesktopMock();
    desktop.lab.history = vi
      .fn()
      .mockRejectedValue(bridgeError('SERVER_ERROR', 'History backend exploded'));

    renderWithProviders(<BookingLabPage />, {
      withAuth: true,
      route: '/booking-lab?tab=history',
    });

    await waitFor(() => {
      expect(screen.getByText('Could not load history')).toBeInTheDocument();
    });
    expect(screen.getByText(/History backend exploded/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
