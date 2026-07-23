// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appointment } from '../../../src/shared/types';
import { AppointmentsPage } from '../../../src/renderer/src/pages/AppointmentsPage';
import { installDesktopMock, renderWithProviders } from './test-utils';

const baseAppointment: Appointment = {
  booking_id: 500,
  client_id: 101,
  client_name: 'RAM BAHADUR',
  official_application_id: 'WPT100000500',
  appointment_code: 99500,
  provider_id: 501,
  provider_name: 'Rupandehi',
  date: '2026-08-01',
  start_time: '10:00:00',
  status: 'booked',
  booked_at: '2026-07-20T10:00:00Z',
  cancelled_at: null,
  booked_by_system: true,
  receipt_available: true,
  edit_url: 'https://example.test/clients/101/edit/?delete_booking=1',
};

function mockAppointments(items: Appointment[]) {
  const desktop = installDesktopMock();
  desktop.appointments.list = vi.fn().mockResolvedValue({
    items,
    page: 1,
    page_size: 25,
    total: items.length,
  });
  return desktop;
}

describe('AppointmentsPage', () => {
  beforeEach(() => {
    installDesktopMock();
  });

  afterEach(() => {
    cleanup();
  });

  it('offers a receipt button for booked appointments with receipts', async () => {
    mockAppointments([baseAppointment]);
    renderWithProviders(<AppointmentsPage />, { route: '/appointments?tab=booked' });
    expect(
      await screen.findByRole('button', { name: /Download receipt for RAM BAHADUR/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel appointment for/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Delete booking and edit RAM BAHADUR/ })).toHaveAttribute(
      'href',
      baseAppointment.edit_url,
    );
  });

  it('never offers a receipt button on the cancelled tab', async () => {
    mockAppointments([
      { ...baseAppointment, status: 'cancelled', receipt_available: false, cancelled_at: '2026-07-20T11:00:00Z' },
    ]);
    renderWithProviders(<AppointmentsPage />, { route: '/appointments?tab=cancelled' });
    expect(await screen.findByText('RAM BAHADUR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download receipt/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Delete booking and edit/ })).toBeNull();
  });
});
