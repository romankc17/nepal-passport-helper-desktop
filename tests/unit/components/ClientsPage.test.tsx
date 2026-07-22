// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientsPage } from '../../../src/renderer/src/pages/ClientsPage';
import { installDesktopMock, renderWithProviders } from './test-utils';

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
});
