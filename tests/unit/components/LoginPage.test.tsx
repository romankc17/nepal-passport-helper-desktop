// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../../../src/renderer/src/pages/LoginPage';
import { bridgeError, installDesktopMock, renderWithProviders } from './test-utils';

describe('LoginPage', () => {
  beforeEach(() => {
    installDesktopMock();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the sign-in form once session restore finishes', async () => {
    renderWithProviders(<LoginPage />);
    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText(/Server URL/)).toBeInTheDocument(); // dev build
  });

  it('shows the server error message when login fails', async () => {
    const desktop = installDesktopMock();
    desktop.auth.login = vi
      .fn()
      .mockRejectedValue(bridgeError('AUTH_FAILED', 'Invalid username or password.'));

    renderWithProviders(<LoginPage />);
    await screen.findByLabelText('Username');

    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid username or password.');
    });
  });

  it('shows a clean network error when the backend is offline', async () => {
    const desktop = installDesktopMock();
    desktop.auth.login = vi
      .fn()
      .mockRejectedValue(bridgeError('NETWORK_ERROR', 'Cannot reach the server', true));

    renderWithProviders(<LoginPage />);
    await screen.findByLabelText('Username');

    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the server');
    });
  });
});
