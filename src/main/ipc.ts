import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';
import type { IpcResult } from '../shared/ipc-contract';
import {
  ValidationError,
  asId,
  asIdArray,
  asOptionalPositiveInt,
  asSafeFilename,
  validateOptionalIdArray,
  channels,
  validateActivityQuery,
  validateAppSettingsPatch,
  validateAppointmentListQuery,
  validateBookNowInput,
  validateClientListQuery,
  validateLocationsQuery,
  validateLoginInput,
  validatePreferencesPatch,
  validateQueueAddInput,
  validateWatcherCheckInput,
  validateWatcherCreateInput,
  validateWatcherSettingsPatch,
} from '../shared/ipc-contract';
import type { AppSettings, SessionInfo, WatcherRuntime } from '../shared/types';
import { ApiClient, ApiError, AUTH_EXPIRED_CODES } from './api-client';
import { WatcherScheduler } from './scheduler';
import { SettingsManager, StoredConfig } from './settings';
import { JsonStore } from './store';
import { Vault, VaultUnavailableError } from './vault';
import { isE2E } from './e2e';
import { isTrustedRendererFrame } from './window';

interface ErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}

export interface IpcDeps {
  api: ApiClient;
  scheduler: WatcherScheduler;
  settings: SettingsManager;
  store: JsonStore<StoredConfig>;
  vault: Vault;
  isDev: boolean;
  getWindow: () => BrowserWindow | null;
  onQuit: () => void;
  // Fetches the server watcher list and reconciles scheduler loops.
  startWatchers: () => Promise<void>;
  stopWatchers: () => void;
  resyncWatchers: () => Promise<void>;
}

function toErrorShape(error: unknown): ErrorShape {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof ValidationError) {
    return { code: 'VALIDATION_ERROR', message: error.message, retryable: false };
  }
  if (error instanceof VaultUnavailableError) {
    return { code: 'VAULT_UNAVAILABLE', message: error.message, retryable: false };
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return { code: 'UNKNOWN_ERROR', message, retryable: false };
}

function handle<Args extends unknown[], Result>(
  channel: string,
  fn: (...args: Args) => Promise<Result> | Result,
): void {
  ipcMain.handle(channel, async (event, ...rawArgs): Promise<IpcResult<Result>> => {
    try {
      if (!isTrustedRendererFrame(event.senderFrame?.url ?? '')) {
        throw new ValidationError('Untrusted IPC sender');
      }
      const value = await fn(...(rawArgs as Args));
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: toErrorShape(error) };
    }
  });
}

export function registerIpc(deps: IpcDeps): void {
  const { api, scheduler, settings, store, vault } = deps;

  // --- Auth ---

  handle(channels.authLogin, async (raw: unknown): Promise<SessionInfo> => {
    const input = validateLoginInput(raw);
    if (input.serverUrl && deps.isDev) {
      settings.update({ apiUrl: input.serverUrl });
    }
    const result = await api.login(input.username, input.password);
    store.update({
      sessionSnapshot: {
        user: result.user,
        access: result.access,
        defaults: result.defaults,
      },
    });
    await deps.startWatchers();
    return { user: result.user, access: result.access, defaults: result.defaults, offline: false };
  });

  handle(channels.authLogout, async (): Promise<{ signedOut: true }> => {
    deps.stopWatchers();
    store.update({ sessionSnapshot: null });
    try {
      await api.logout();
    } catch (error) {
      // The local session is already gone; a failed remote revoke is only
      // worth surfacing when it is not an auth error (tokens already invalid).
      if (!(error instanceof ApiError && AUTH_EXPIRED_CODES.has(error.code))) {
        throw error;
      }
    }
    return { signedOut: true };
  });

  handle(channels.authGetSession, async (): Promise<SessionInfo | null> => {
    if (!vault.loadTokens()) return null;
    try {
      const me = await api.me();
      store.update({
        sessionSnapshot: { user: me.user, access: me.access, defaults: me.defaults },
      });
      await deps.startWatchers();
      return { user: me.user, access: me.access, defaults: me.defaults, offline: false };
    } catch (error) {
      if (error instanceof ApiError && AUTH_EXPIRED_CODES.has(error.code)) {
        vault.clear();
        store.update({ sessionSnapshot: null });
        return null;
      }
      if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
        const snapshot = store.get().sessionSnapshot;
        if (snapshot) return { ...snapshot, offline: true };
      }
      throw error;
    }
  });

  // --- Overview ---

  handle(channels.overviewGet, () => api.overview());

  // --- Locations ---

  handle(channels.locationsList, (raw: unknown) => {
    const query = validateLocationsQuery(raw);
    return api.locations(query.kind, query.parent);
  });

  // --- Clients ---

  handle(channels.clientsList, (raw: unknown) => api.clientsList(validateClientListQuery(raw)));
  handle(channels.clientsGet, (raw: unknown) => api.clientsGet(asId(raw)));
  handle(channels.clientsReadyByLocation, () => api.clientsReadyByLocation());

  // --- Queue & booking ---

  handle(channels.queueAdd, async (raw: unknown) => {
    const result = await api.queueAdd(validateQueueAddInput(raw));
    await deps.resyncWatchers();
    return result;
  });
  handle(channels.queueRemove, (raw: unknown) => api.queueRemove(asIdArray(raw, 'bookingIds')));
  handle(channels.queueBookNow, async (raw: unknown) => {
    const result = await api.bookNow(validateBookNowInput(raw));
    await deps.resyncWatchers();
    return result;
  });
  handle(channels.queueProgress, (raw: unknown) => api.progress(asIdArray(raw, 'bookingIds')));

  // --- Watchers ---

  handle(channels.watchersList, () => api.watchersList());
  handle(channels.watchersGet, (raw: unknown) => api.watchersGet(asId(raw)));
  handle(channels.watchersCreate, async (raw: unknown) => {
    const watcher = await api.watchersCreate(validateWatcherCreateInput(raw));
    await deps.resyncWatchers();
    return watcher;
  });
  handle(channels.watchersUpdateSettings, async (rawId: unknown, rawPatch: unknown) => {
    const watcher = await api.watchersUpdateSettings(
      asId(rawId),
      validateWatcherSettingsPatch(rawPatch),
    );
    await deps.resyncWatchers();
    return watcher;
  });
  handle(channels.watchersPause, async (raw: unknown) => {
    const watcher = await api.watchersPause(asId(raw));
    scheduler.pause(watcher.id);
    return watcher;
  });
  handle(channels.watchersResume, async (raw: unknown) => {
    const watcher = await api.watchersResume(asId(raw));
    scheduler.resume(watcher.id);
    return watcher;
  });
  handle(channels.watchersCheck, (rawId: unknown, rawOpts: unknown) =>
    api.watchersCheck(asId(rawId), validateWatcherCheckInput(rawOpts)),
  );
  handle(channels.watchersDelete, async (raw: unknown) => {
    const id = asId(raw);
    await api.watchersDelete(id);
    await deps.resyncWatchers();
    return { deleted: true };
  });
  handle(channels.watchersReorder, (rawId: unknown, rawIds: unknown) =>
    api.watchersReorder(asId(rawId), asIdArray(rawIds, 'bookingIds')),
  );
  handle(channels.watchersHistory, (rawId: unknown, rawPage: unknown) =>
    api.watchersHistory(asId(rawId), asOptionalPositiveInt(rawPage, 'page', 100000)),
  );

  // --- Appointments ---

  handle(channels.appointmentsList, (raw: unknown) =>
    api.appointmentsList(validateAppointmentListQuery(raw)),
  );
  handle(channels.appointmentsCancel, async (raw: unknown) => {
    await api.appointmentsCancel(asId(raw, 'bookingId'));
    return { cancelled: true };
  });
  handle(channels.appointmentsReceipt, (raw: unknown) =>
    api.appointmentsReceipt(asId(raw, 'bookingId')),
  );
  handle(channels.appointmentsReconcile, (raw: unknown) =>
    api.appointmentsReconcile(validateOptionalIdArray(raw, 'clientIds')),
  );

  // Receipts: fetched in main, saved via native dialog, written to disk.
  handle(
    channels.appointmentsSaveReceipt,
    async (
      rawBookingId: unknown,
      rawFilename: unknown,
    ): Promise<{ saved: boolean; path: string | null }> => {
      const bookingId = asId(rawBookingId, 'bookingId');
      const filename = asSafeFilename(rawFilename, 'filename');
      const receipt = await api.appointmentsReceipt(bookingId);
      if (isE2E) {
        // E2E mode: no native dialog — save to a deterministic temp location.
        const dir = join(tmpdir(), 'epp-e2e-receipts');
        await mkdir(dir, { recursive: true });
        const target = join(dir, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
        await writeFile(target, Buffer.from(receipt.data, 'base64'));
        return { saved: true, path: target };
      }
      const win = deps.getWindow();
      const options = {
        title: 'Save receipt',
        defaultPath: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { saved: false, path: null };
      await writeFile(result.filePath, Buffer.from(receipt.data, 'base64'));
      return { saved: true, path: result.filePath };
    },
  );

  // --- Account & devices ---

  handle(channels.accountMe, () => api.me());
  handle(channels.devicesRevoke, async (raw: unknown) => {
    await api.devicesRevoke(asId(raw, 'deviceId'));
    return { revoked: true };
  });

  // --- Activity ---

  handle(channels.activityList, (raw: unknown) => api.activityList(validateActivityQuery(raw)));

  // --- Preferences ---

  handle(channels.preferencesGet, () => api.preferencesGet());
  handle(channels.preferencesUpdate, (raw: unknown) =>
    api.preferencesUpdate(validatePreferencesPatch(raw)),
  );

  // --- Scheduler runtime ---

  handle(channels.schedulerCheckNow, (raw: unknown) => {
    scheduler.checkNow(asId(raw));
    return { requested: true };
  });
  handle(channels.schedulerPause, (raw: unknown) => {
    scheduler.pause(asId(raw));
    return { paused: true };
  });
  handle(channels.schedulerResume, (raw: unknown) => {
    scheduler.resume(asId(raw));
    return { resumed: true };
  });
  handle(channels.schedulerGetRuntime, (): WatcherRuntime[] => scheduler.getRuntime());
  handle(channels.schedulerSync, async () => {
    await deps.resyncWatchers();
    return { synced: true };
  });

  // --- Local settings ---

  handle(channels.settingsGet, (): AppSettings => settings.get());
  handle(channels.settingsUpdate, (raw: unknown): AppSettings =>
    settings.update(validateAppSettingsPatch(raw)),
  );

  // --- Window & app ---

  handle(channels.windowMinimizeToTray, () => {
    deps.getWindow()?.hide();
    return { hidden: true };
  });
  handle(channels.windowQuit, () => {
    deps.onQuit();
    return { quitting: true };
  });
  handle(channels.appVersion, () => app.getVersion());
}
