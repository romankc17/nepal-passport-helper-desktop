// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSummary } from '../../../src/shared/types';
import { ClientsPage } from '../../../src/renderer/src/pages/ClientsPage';
import { installDesktopMock, renderWithProviders } from './test-utils';

const readyClient: ClientSummary = {
  id: 1,
  full_name: 'Ready Client',
  application_type: 'First issuance (new)',
  status: 'fresh',
  desktop_status: 'fresh',
  can_book: true,
  official_application_id: '',
  provider_id: 525,
  provider_name: 'Surkhet',
  district_name: 'Surkhet',
  phone: '9800000000',
  email: '',
  missing_document_count: 0,
  queued_booking_id: null,
  appointment: null,
  created_by: 'tester',
  created_at: '2026-07-01T00:00:00Z',
};

describe('ClientsPage', () => {
  afterEach(cleanup);

  it('defaults to unbooked and switches between booking filters', async () => {
    const desktop = installDesktopMock();
    desktop.clients.list = vi.fn().mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0 });
    desktop.clients.readyByLocation = vi.fn().mockResolvedValue([]);
    renderWithProviders(<ClientsPage />, { route: '/clients' });

    await waitFor(() => expect(desktop.clients.list).toHaveBeenLastCalledWith(expect.objectContaining({ booked: false })));
    await userEvent.click(screen.getByRole('tab', { name: 'Booked' }));
    await waitFor(() => expect(desktop.clients.list).toHaveBeenLastCalledWith(expect.objectContaining({ booked: true })));
    await userEvent.click(screen.getByRole('tab', { name: 'All' }));
    await waitFor(() => expect(desktop.clients.list).toHaveBeenLastCalledWith(expect.objectContaining({ booked: undefined })));
  });

  it('makes a docs-complete client ready via the row action', async () => {
    const desktop = installDesktopMock();
    desktop.clients.list = vi.fn().mockResolvedValue({
      items: [readyClient], page: 1, page_size: 25, total: 1, providers: [],
    });
    desktop.clients.readyByLocation = vi.fn().mockResolvedValue([]);
    desktop.clients.submit = vi.fn().mockResolvedValue({
      submitted: [{ client_id: 1, name: 'Ready Client', official_application_id: 'APP-1' }],
      failed: [],
    });
    renderWithProviders(<ClientsPage />, { route: '/clients' });

    await waitFor(() => expect(screen.getByText('Ready Client')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Make ready' }));

    await waitFor(() =>
      expect(desktop.clients.submit).toHaveBeenCalledWith({ client_ids: [1] }),
    );
    await waitFor(() => expect(screen.getByText('Made ready: 1 client')).toBeInTheDocument());
  });

  it('bulk makes ready only the selected, eligible clients', async () => {
    const desktop = installDesktopMock();
    const notReady: ClientSummary = {
      ...readyClient, id: 2, full_name: 'Incomplete Client', desktop_status: 'incomplete',
      can_book: false, missing_document_count: 1,
    };
    desktop.clients.list = vi.fn().mockResolvedValue({
      items: [readyClient, notReady], page: 1, page_size: 25, total: 2, providers: [],
    });
    desktop.clients.readyByLocation = vi.fn().mockResolvedValue([]);
    desktop.clients.submit = vi.fn().mockResolvedValue({
      submitted: [{ client_id: 1, name: 'Ready Client', official_application_id: 'APP-1' }],
      failed: [],
    });
    renderWithProviders(<ClientsPage />, { route: '/clients' });

    await waitFor(() => expect(screen.getByText('Ready Client')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all clients on this page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make ready (1)' }));

    await waitFor(() =>
      expect(desktop.clients.submit).toHaveBeenCalledWith({ client_ids: [1] }),
    );
  });
});
