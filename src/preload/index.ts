import { contextBridge, ipcRenderer } from 'electron';
import { channels, eventChannels, type EventChannel, type IpcResult } from '../shared/ipc-contract';
import type {
  ActivityQuery,
  AppSettingsPatch,
  AppointmentListQuery,
  BookNowInput,
  ClientListQuery,
  LabBookInput,
  LabGenerateInput,
  LabListQuery,
  LabSubmitInput,
  LocationKind,
  PreferencesPatch,
  QueueAddInput,
  WatcherCreateInput,
  WatcherSettingsPatch,
} from '../shared/types';

export class DesktopApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DesktopApiError';
  }
}

async function call<Result>(channel: string, ...args: unknown[]): Promise<Result> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<Result>;
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new DesktopApiError('IPC_PROTOCOL_ERROR', 'Malformed IPC response from main', false);
  }
  if (result.ok) return result.value;
  // Thrown Errors lose custom properties at the contextBridge boundary, so
  // reject with a plain tagged object instead — the renderer wraps it back
  // into a DesktopApiError (see renderer api.ts).
  return Promise.reject({ __desktopError: true, ...result.error });
}

type EventCallback = (payload: unknown) => void;

function on(channel: EventChannel, callback: EventCallback): () => void {
  if (!eventChannels.includes(channel)) {
    throw new DesktopApiError('IPC_CHANNEL_DENIED', `Event channel not allowed: ${channel}`, false);
  }
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const desktopApi = {
  auth: {
    login: (input: { username: string; password: string; serverUrl?: string }) =>
      call(channels.authLogin, input),
    logout: () => call(channels.authLogout),
    getSession: () => call(channels.authGetSession),
  },
  overview: {
    get: () => call(channels.overviewGet),
  },
  locations: {
    list: (query: { kind: LocationKind; parent?: number | string }) =>
      call(channels.locationsList, query),
  },
  clients: {
    list: (query?: ClientListQuery) => call(channels.clientsList, query),
    get: (id: number) => call(channels.clientsGet, id),
    readyByLocation: () => call(channels.clientsReadyByLocation),
    importPreview: (input: { application: Record<string, unknown> }) =>
      call(channels.clientsImportPreview, input),
    importConfirm: (input: {
      fields: Record<string, unknown>;
      allow_duplicate?: boolean;
      idempotency_key: string;
    }) => call(channels.clientsImportConfirm, input),
  },
  officialImport: {
    open: () => call(channels.officialImportOpen),
    list: () => call(channels.officialImportList),
    get: (applicationId: string) => call(channels.officialImportGet, applicationId),
    close: () => call(channels.officialImportClose),
  },
  queue: {
    add: (input: QueueAddInput) => call(channels.queueAdd, input),
    remove: (bookingIds: number[]) => call(channels.queueRemove, bookingIds),
    bookNow: (input: BookNowInput) => call(channels.queueBookNow, input),
    progress: (bookingIds: number[]) => call(channels.queueProgress, bookingIds),
  },
  watchers: {
    list: () => call(channels.watchersList),
    get: (id: number) => call(channels.watchersGet, id),
    create: (input: WatcherCreateInput) => call(channels.watchersCreate, input),
    updateSettings: (id: number, patch: WatcherSettingsPatch) =>
      call(channels.watchersUpdateSettings, id, patch),
    pause: (id: number) => call(channels.watchersPause, id),
    resume: (id: number) => call(channels.watchersResume, id),
    check: (id: number, opts?: { force?: boolean; slots?: string[] }) =>
      call(channels.watchersCheck, id, opts),
    delete: (id: number) => call(channels.watchersDelete, id),
    reorder: (id: number, bookingIds: number[]) => call(channels.watchersReorder, id, bookingIds),
    history: (id: number, page?: number) => call(channels.watchersHistory, id, page),
  },
  appointments: {
    list: (query?: AppointmentListQuery) => call(channels.appointmentsList, query),
    cancel: (bookingId: number) => call(channels.appointmentsCancel, bookingId),
    receipt: (bookingId: number) => call(channels.appointmentsReceipt, bookingId),
    reconcile: (clientIds?: number[]) => call(channels.appointmentsReconcile, clientIds),
    saveReceipt: (bookingId: number, filename: string) =>
      call(channels.appointmentsSaveReceipt, bookingId, filename),
  },
  account: {
    me: () => call(channels.accountMe),
  },
  devices: {
    revoke: (deviceId: number) => call(channels.devicesRevoke, deviceId),
  },
  activity: {
    list: (query?: ActivityQuery) => call(channels.activityList, query),
  },
  preferences: {
    get: () => call(channels.preferencesGet),
    update: (patch: PreferencesPatch) => call(channels.preferencesUpdate, patch),
  },
  scheduler: {
    checkNow: (watcherId: number) => call(channels.schedulerCheckNow, watcherId),
    pause: (watcherId: number) => call(channels.schedulerPause, watcherId),
    resume: (watcherId: number) => call(channels.schedulerResume, watcherId),
    getRuntime: () => call(channels.schedulerGetRuntime),
    sync: () => call(channels.schedulerSync),
  },
  settings: {
    get: () => call(channels.settingsGet),
    update: (patch: AppSettingsPatch) => call(channels.settingsUpdate, patch),
  },
  window: {
    minimizeToTray: () => call(channels.windowMinimizeToTray),
    quit: () => call(channels.windowQuit),
  },
  app: {
    version: () => call(channels.appVersion),
  },
  updater: {
    check: () => call(channels.updateCheck),
    status: () => call(channels.updateGetStatus),
    install: () => call(channels.updateInstall),
  },
  lab: {
    summary: () => call(channels.labSummary),
    clients: (query?: LabListQuery) => call(channels.labClients, query),
    detail: (id: number) => call(channels.labClientDetail, id),
    generate: (input: LabGenerateInput) => call(channels.labGenerate, input),
    submit: (input: LabSubmitInput) => call(channels.labSubmit, input),
    book: (input: LabBookInput) => call(channels.labBook, input),
    job: (batchId: string) => call(channels.labJob, batchId),
    reconcile: (input?: { client_ids?: number[] }) => call(channels.labReconcile, input),
    history: (query?: LabListQuery) => call(channels.labHistory, query),
    cancel: (bookingId: number) => call(channels.labCancel, bookingId),
    receipt: (bookingId: number) => call(channels.labReceipt, bookingId),
    delete: (id: number) => call(channels.labDelete, id),
  },
  on,
};

contextBridge.exposeInMainWorld('desktop', desktopApi);
