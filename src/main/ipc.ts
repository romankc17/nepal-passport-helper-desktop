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
  validateLabBookInput,
  validateLabGenerateInput,
  validateLabJobBatchId,
  validateLabListQuery,
  validateLabSubmitInput,
  validateLocationsQuery,
  validateLoginInput,
  validatePreferencesPatch,
  validateQueueAddInput,
  validateWatcherCheckInput,
  validateWatcherCreateInput,
  validateWatcherSettingsPatch,
  validateImportConfirmInput,
  validateImportPreviewInput,
  validateWptId,
} from '../shared/ipc-contract';
import type { AppSettings, SessionInfo, WatcherRuntime } from '../shared/types';
import { ApiClient, ApiError, AUTH_EXPIRED_CODES } from './api-client';
import { WatcherScheduler } from './scheduler';
import { SettingsManager, StoredConfig } from './settings';
import { JsonStore } from './store';
import { Vault, VaultUnavailableError } from './vault';
import { isE2E } from './e2e';
import type { OfficialImportSession } from './official-import';
import type { OfficialWorker } from './official-worker';
import { isTrustedRendererFrame } from './window';
import type { UpdateManager } from './update';

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
  updateManager: UpdateManager;
  officialImport: OfficialImportSession;
  officialWorker: OfficialWorker;
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
  handle(channels.clientsImportPreview, (raw: unknown) =>
    api.clientsImportPreview(validateImportPreviewInput(raw)),
  );
  handle(channels.clientsImportConfirm, (raw: unknown) =>
    api.clientsImportConfirm(validateImportConfirmInput(raw)),
  );

  // --- Official portal import ---

  handle(channels.officialImportOpen, () => deps.officialImport.open());
  handle(channels.officialImportList, () => deps.officialImport.listApplications());
  handle(channels.officialImportGet, (raw: unknown) =>
    deps.officialImport.getApplication(validateWptId(raw)),
  );
  handle(channels.officialImportClose, () => deps.officialImport.close());

  // --- Queue & booking ---

  handle(channels.queueAdd, async (raw: unknown) => {
    const result = await api.queueAdd(validateQueueAddInput(raw));
    await deps.resyncWatchers();
    return result;
  });
  handle(channels.queueRemove, (raw: unknown) => api.queueRemove(asIdArray(raw, 'bookingIds')));
  handle(channels.queueBookNow, async (raw: unknown) => {
    const input = validateBookNowInput(raw);
    // The E2E server is an in-memory UI fixture; production always executes
    // the official calls locally through OfficialWorker below.
    if (isE2E) return api.bookNow(input);
    const queued = await api.queueAdd(input);
    const check = await deps.officialWorker.checkWatcher(queued.watcher.id, true, input.slots);
    const detail = await api.watchersGet(queued.watcher.id);
    const byClient = new Map(detail.recent_bookings.map((item) => [item.client_id, item]));
    const results = input.client_ids.map((clientId) => {
      const booking = byClient.get(clientId);
      const skipped = queued.skipped.find((item) => item.client_id === clientId);
      if (booking?.status === 'booked') {
        return {
          client_id: clientId,
          booking_id: booking.id,
          outcome: 'booked' as const,
          appointment: { date: booking.date!, start_time: booking.start_time! },
        };
      }
      if (booking?.status === 'failed') {
        return {
          client_id: clientId,
          booking_id: booking.id,
          outcome: 'failed' as const,
          error: booking.error ?? 'Official booking failed',
        };
      }
      return {
        client_id: clientId,
        booking_id: booking?.id ?? null,
        outcome: 'queued' as const,
        error: skipped?.reason,
      };
    });
    await deps.resyncWatchers();
    return { watcher: check.watcher, results };
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
  handle(channels.watchersCheck, (rawId: unknown, rawOpts: unknown) => {
    const opts = validateWatcherCheckInput(rawOpts);
    if (isE2E) return api.watchersCheck(asId(rawId), opts);
    return deps.officialWorker.checkWatcher(asId(rawId), opts.force ?? false, opts.slots);
  });
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
    if (isE2E) {
      await api.appointmentsCancel(asId(raw, 'bookingId'));
      return { cancelled: true };
    }
    await deps.officialWorker.cancelBooking(asId(raw, 'bookingId'));
    return { cancelled: true };
  });
  handle(channels.appointmentsReceipt, (raw: unknown) =>
    api.appointmentsReceipt(asId(raw, 'bookingId')),
  );
  handle(channels.appointmentsReconcile, (raw: unknown) => {
    const clientIds = validateOptionalIdArray(raw, 'clientIds');
    return isE2E ? api.appointmentsReconcile(clientIds) : deps.officialWorker.reconcile(clientIds);
  });

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
    const result = scheduler.checkNow(asId(raw));
    return { requested: result.accepted, reason: result.reason ?? null };
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

  // --- Updater ---

  handle(channels.updateCheck, async () => {
    await deps.updateManager.checkForUpdates();
    return { requested: true };
  });
  handle(channels.updateGetStatus, () => deps.updateManager.getStatus());
  handle(channels.updateInstall, () => {
    deps.updateManager.installUpdate();
    return { requested: true };
  });

  // --- Booking Lab ---

  handle(channels.labSummary, () => api.labSummary());
  handle(channels.labClients, (raw: unknown) => api.labClients(validateLabListQuery(raw)));
  handle(channels.labClientDetail, (raw: unknown) => api.labClientDetail(asId(raw)));
  handle(channels.labGenerate, (raw: unknown) => api.labGenerate(validateLabGenerateInput(raw)));
  handle(channels.labSubmit, (raw: unknown) =>
    deps.officialWorker.submitLab(validateLabSubmitInput(raw)),
  );
  handle(channels.labBook, (raw: unknown) =>
    deps.officialWorker.bookLab(validateLabBookInput(raw)),
  );
  handle(channels.labJob, (raw: unknown) => api.labJob(validateLabJobBatchId(raw)));
  handle(channels.labReconcile, (raw: unknown) => {
    const clientIds = validateOptionalIdArray(raw, 'client_ids');
    return deps.officialWorker.reconcile(clientIds, true);
  });
  handle(channels.labHistory, (raw: unknown) => api.labHistory(validateLabListQuery(raw)));
  handle(channels.labCancel, (raw: unknown) =>
    deps.officialWorker.cancelBooking(asId(raw, 'bookingId')),
  );
  handle(channels.labReceipt, (raw: unknown) => api.labReceipt(asId(raw, 'bookingId')));
  handle(channels.labDelete, (raw: unknown) => api.labDelete(asId(raw)));
}
