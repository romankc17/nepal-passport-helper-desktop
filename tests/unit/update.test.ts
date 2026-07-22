import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updater = vi.hoisted(() => {
  const listeners = new Map<string, (...args: any[]) => void>();
  return {
    listeners,
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        listeners.set(event, listener);
      }),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      quitAndInstall: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('electron-updater', () => ({ autoUpdater: updater.autoUpdater }));

import { createUpdateManager } from '../../src/main/update';

describe('update manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updater.autoUpdater.checkForUpdates.mockClear();
    updater.autoUpdater.quitAndInstall.mockClear();
  });

  afterEach(() => vi.useRealTimers());

  it('retains downloaded status and keeps checking every four hours', async () => {
    const manager = createUpdateManager({ getWindow: () => null });

    expect(updater.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.listeners.get('update-downloaded')?.({ version: '0.1.2' });
    expect(manager.getStatus()).toEqual({ type: 'downloaded', version: '0.1.2' });

    manager.installUpdate();
    expect(updater.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(updater.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(3);
  });
});
