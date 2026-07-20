import { hostname } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, app, powerMonitor } from 'electron';
import type { CheckOutcome, Watcher } from '../shared/types';
import {
  ApiClient,
  ApiError,
  AUTH_EXPIRED_CODES,
  PERMANENT_ERROR_CODES,
} from './api-client';
import { registerIpc } from './ipc';
import { NetStatus } from './net-status';
import { Notifications } from './notifications';
import { WatcherScheduler } from './scheduler';
import { SettingsManager, defaultStoredConfig, type StoredConfig } from './settings';
import { JsonStore } from './store';
import { createTray } from './tray';
import { Vault } from './vault';
import { isE2E } from './e2e';
import { applySessionSecurity, createMainWindow, focusOrCreateWindow } from './window';

const isDev = !app.isPackaged;
let isQuitting = false;
let mainWindow: BrowserWindow | null = null;

// Isolate userData per e2e run so the vault/config start clean (see e2e.ts).
if (isE2E && process.env.EPP_USER_DATA_DIR) {
  app.setPath('userData', process.env.EPP_USER_DATA_DIR);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(bootstrap);
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData');
  const store = new JsonStore<StoredConfig>(join(userData, 'config.json'), defaultStoredConfig);
  const settings = new SettingsManager(store, app, isDev);
  const vault = new Vault(join(userData, 'vault.bin'));

  const api = new ApiClient({
    getBaseUrl: () => settings.resolveApiUrl(),
    vault,
    deviceId: settings.getDeviceId(),
    deviceName: hostname(),
    onAuthExpired: () => {
      mainWindow?.webContents.send('auth-expired');
    },
  });

  const notificationsRef: { current: Notifications | null } = { current: null };

  const scheduler = new WatcherScheduler({
    checkNow: (watcherId) => runServerCheck(api, watcherId),
    onEvent: (event) => {
      if (event.type === 'watcher-state') {
        mainWindow?.webContents.send('watcher-state', event);
        if (event.state === 'scheduled' && (event.lastResult?.bookedCount ?? 0) > 0) {
          notificationsRef.current?.show({
            title: 'Appointment booked',
            body: `${event.lastResult?.bookedCount} appointment(s) booked automatically.`,
            route: '/appointments',
          });
        }
      } else {
        mainWindow?.webContents.send('auth-expired');
      }
    },
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    random: () => Math.random(),
    maxConcurrent: 3,
  });

  const windowDeps = {
    isDev,
    isMinimizeToTrayEnabled: () => settings.get().minimizeToTray,
    isQuitting: () => isQuitting,
    getAllowedExternalOrigin: () => {
      try {
        return new URL(settings.resolveApiUrl()).origin;
      } catch {
        return null;
      }
    },
  };

  applySessionSecurity(windowDeps);
  mainWindow = createMainWindow(windowDeps);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const notifications = new Notifications({
    getWindow: () => mainWindow,
    isSoundEnabled: () => settings.get().soundEnabled,
    isNotificationsEnabled: () => settings.get().notificationsEnabled,
  });
  notificationsRef.current = notifications;

  const onQuit = (): void => {
    isQuitting = true;
    app.quit();
  };

  createTray({ getWindow: () => mainWindow, onQuit });

  const netStatus = new NetStatus(() => {
    try {
      return new URL(settings.resolveApiUrl()).origin;
    } catch {
      return 'http://localhost:8000';
    }
  });
  netStatus.on('online', () => {
    scheduler.setOffline(false);
    mainWindow?.webContents.send('net-status', { online: true });
  });
  netStatus.on('offline', () => {
    scheduler.setOffline(true);
    mainWindow?.webContents.send('net-status', { online: false });
  });
  netStatus.start();

  powerMonitor.on('resume', () => scheduler.onWake());

  const toSyncItems = (watchers: Watcher[]) =>
    watchers.map((watcher) => ({
      id: watcher.id,
      intervalSeconds: watcher.interval_seconds,
      active: watcher.active,
    }));

  registerIpc({
    api,
    scheduler,
    settings,
    store,
    vault,
    isDev,
    getWindow: () => mainWindow,
    onQuit,
    startWatchers: async () => {
      const watchers = await api.watchersList();
      scheduler.syncFromServer(toSyncItems(watchers));
    },
    stopWatchers: () => scheduler.syncFromServer([]),
    resyncWatchers: async () => {
      try {
        const watchers = await api.watchersList();
        scheduler.syncFromServer(toSyncItems(watchers));
      } catch (error) {
        // The mutation itself already succeeded; a resync failure is logged
        // and retried on the next mutation or app start.
        console.error('Failed to resync watchers after mutation:', error);
      }
    },
  });

  if (settings.get().startOnLogin) {
    settings.applyLoginItem(true);
  }

  app.on('activate', () => {
    mainWindow = focusOrCreateWindow(windowDeps, mainWindow);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    netStatus.stop();
  });
}

// Translates the contract check endpoint into scheduler outcomes, mapping
// ApiError codes onto captcha / auth-expired / permanent / retryable states.
async function runServerCheck(api: ApiClient, watcherId: number): Promise<CheckOutcome> {
  try {
    const result = await api.watchersCheck(watcherId, { force: true });
    const captcha = result.errors.some((error) => error.code === 'CAPTCHA_REQUIRED');
    if (captcha) {
      return { status: 'captcha', message: 'CAPTCHA required — resume manually after solving' };
    }
    return {
      status: 'ok',
      slotsFound: result.slots_found,
      bookedCount: result.booked.length,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      if (AUTH_EXPIRED_CODES.has(error.code)) {
        return { status: 'auth-expired', errorCode: error.code, message: error.message };
      }
      if (error.code === 'CAPTCHA_REQUIRED') {
        return { status: 'captcha', errorCode: error.code, message: error.message };
      }
      if (PERMANENT_ERROR_CODES.has(error.code) || !error.retryable) {
        return { status: 'permanent-error', errorCode: error.code, message: error.message };
      }
      return { status: 'retryable-error', errorCode: error.code, message: error.message };
    }
    return {
      status: 'retryable-error',
      message: error instanceof Error ? error.message : 'Unknown check failure',
    };
  }
}
