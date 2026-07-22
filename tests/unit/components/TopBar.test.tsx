// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../../../src/renderer/src/components/TopBar';
import { installDesktopMock } from './desktop-mock';

describe('TopBar', () => {
  afterEach(cleanup);

  it('offers to install a downloaded update', async () => {
    const desktop = installDesktopMock();
    desktop.updater.status = vi.fn().mockResolvedValue({ type: 'downloaded', version: '0.1.9' });

    render(
      <TopBar
        userName="admin"
        sessionOffline={false}
        onSignOut={() => undefined}
        signingOut={false}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Update app to version 0.1.9' }));
    expect(desktop.updater.install).toHaveBeenCalledOnce();
  });
});
