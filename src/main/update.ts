import { BrowserWindow, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';

export type { UpdateStatus };

export interface UpdateManager {
  checkForUpdates: () => Promise<void>;
  installUpdate: () => void;
  getStatus: () => UpdateStatus;
  isSupported: () => boolean;
}

interface UpdateManagerDeps {
  getWindow: () => BrowserWindow | null;
}

const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function createUpdateManager(deps: UpdateManagerDeps): UpdateManager {
  let currentStatus: UpdateStatus = { type: 'idle' };
  let autoCheckTimer: NodeJS.Timeout | null = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const isSupported = (): boolean => {
    // Auto-updater only works for packaged macOS and Windows builds.
    if (!app.isPackaged) return false;
    const platform = process.platform;
    return platform === 'darwin' || platform === 'win32';
  };

  const broadcast = (status: UpdateStatus): void => {
    currentStatus = status;
    const window = deps.getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('update-status', status);
    }
    console.log('[updater]', status.type, status);
  };

  autoUpdater.on('checking-for-update', () => {
    broadcast({ type: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    broadcast({
      type: 'available',
      version: info.version,
      releaseNotes: info.releaseNotes as string | undefined | null,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    broadcast({ type: 'up-to-date', version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      type: 'downloading',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    broadcast({ type: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (error) => {
    console.error('[updater] error:', error);
    broadcast({ type: 'error', message: error.message });
  });

  const scheduleNextAutoCheck = (): void => {
    if (autoCheckTimer) {
      clearTimeout(autoCheckTimer);
      autoCheckTimer = null;
    }
    if (!isSupported()) return;
    autoCheckTimer = setTimeout(() => {
      void checkForUpdates().finally(scheduleNextAutoCheck);
    }, AUTO_CHECK_INTERVAL_MS);
  };

  const checkForUpdates = async (): Promise<void> => {
    if (!isSupported()) {
      broadcast({ type: 'error', message: 'Automatic updates are not supported in this build.' });
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update check failed';
      broadcast({ type: 'error', message });
    }
  };

  const installUpdate = (): void => {
    if (!isSupported()) return;
    if (currentStatus.type !== 'downloaded') {
      console.warn('[updater] installUpdate() called but no update is downloaded');
      return;
    }
    autoUpdater.quitAndInstall(true, true);
  };

  // Start automatic background checks in production packaged builds.
  if (isSupported()) {
    void checkForUpdates();
    scheduleNextAutoCheck();
  } else {
    console.log('[updater] auto-update disabled (dev or unsupported platform)');
  }

  return {
    checkForUpdates,
    installUpdate,
    getStatus: () => currentStatus,
    isSupported,
  };
}
