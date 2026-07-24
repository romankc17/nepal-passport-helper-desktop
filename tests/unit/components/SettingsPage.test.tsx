// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../../../src/renderer/src/pages/SettingsPage';
import { installDesktopMock, renderWithProviders } from './test-utils';

describe('SettingsPage', () => {
  beforeEach(() => {
    const desktop = installDesktopMock();
    desktop.auth.getSession = vi.fn().mockResolvedValue({
      user: { id: 1, username: 'admin', is_staff: true },
      access: { mode: 'providers', providers: [], booking_lab: true },
      defaults: { interval_seconds: 300 },
      offline: false,
    });
    desktop.account.me = vi.fn().mockResolvedValue({ devices: [] });

    let preferences = {
      notifications_enabled: true,
      sound_enabled: true,
      email_on_booking: false,
      email_address: '',
      favorite_locations: [],
    };
    desktop.preferences.get = vi.fn(() => Promise.resolve(preferences));
    desktop.preferences.update = vi.fn((patch) => {
      preferences = { ...preferences, ...patch };
      return Promise.resolve(preferences);
    });
  });

  afterEach(cleanup);

  it('enables the email address only after email alerts are turned on', async () => {
    const desktop = window.desktop;
    renderWithProviders(<SettingsPage />);

    const emailAddress = await screen.findByLabelText('Email address');
    expect(emailAddress).toBeDisabled();
    expect(screen.getByText('Turn on email alerts to edit this address')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Email on booking'));

    await waitFor(() => expect(emailAddress).toBeEnabled());
    expect(desktop.preferences.update).toHaveBeenCalledWith({ email_on_booking: true });
  });
});
