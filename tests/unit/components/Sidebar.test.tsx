// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../../src/renderer/src/components/Sidebar';
import { installDesktopMock, renderWithProviders } from './test-utils';

function renderSidebar(bookingLab: boolean) {
  const desktop = installDesktopMock();
  desktop.auth.getSession = vi.fn().mockResolvedValue({
    user: { id: 1, username: 'user', is_staff: false },
    access: { mode: 'all', providers: [], booking_lab: bookingLab },
    defaults: { interval_seconds: 300 },
    offline: false,
  });
  renderWithProviders(<Sidebar />);
}

describe('Sidebar', () => {
  afterEach(cleanup);

  it('shows Booking Lab only when the account has access', async () => {
    renderSidebar(false);
    await screen.findByText('Overview');
    expect(screen.queryByText('Booking Lab')).not.toBeInTheDocument();

    cleanup();
    renderSidebar(true);
    expect(await screen.findByText('Booking Lab')).toBeInTheDocument();
  });
});
