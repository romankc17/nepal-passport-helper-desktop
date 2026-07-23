import type {
  ActivityItem,
  ActivityQuery,
  AppSettings,
  AppSettingsPatch,
  Appointment,
  AppointmentListQuery,
  BookNowInput,
  BookNowResult,
  CheckNowRejection,
  ClientDetail,
  ClientListQuery,
  ClientListResult,
  ClientSubmitInput,
  ClientSubmitResult,
  ClientSummary,
  ImportConfirmResult,
  ImportPreviewResult,
  OfficialApplicationSummary,
  OfficialImportStateEvent,
  LabBookInput,
  LabBookResult,
  LabClient,
  LabClientDetail,
  LabJob,
  LabGenerateInput,
  LabGenerateResult,
  LabHistoryItem,
  LabListQuery,
  LabReconcileResult,
  LabSubmitInput,
  LabSubmitResult,
  LocalQueueItem,
  LabSummary,
  LocationItem,
  LocationKind,
  MeResult,
  SupportingDocument,
  Overview,
  Paged,
  Preferences,
  PreferencesPatch,
  ProgressItem,
  QueueAddInput,
  QueueAddResult,
  QueueRemoveResult,
  ReadyByLocationGroup,
  ReceiptResult,
  ReconcileResult,
  SessionInfo,
  UpdateStatus,
  Watcher,
  WatcherCheckResult,
  WatcherCreateInput,
  WatcherDetail,
  WatcherHistoryItem,
  WatcherRuntime,
  WatcherSettingsPatch,
  WatcherStateEvent,
} from '../shared/types';

export interface DesktopApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
}

export type EventChannel =
  | 'watcher-state'
  | 'net-status'
  | 'notification-click'
  | 'play-sound'
  | 'auth-expired'
  | 'update-status'
  | 'official-import-state'
  | 'local-queue-state';

export interface DesktopApi {
  auth: {
    login(input: { username: string; password: string; serverUrl?: string }): Promise<SessionInfo>;
    logout(): Promise<{ signedOut: true }>;
    getSession(): Promise<SessionInfo | null>;
  };
  overview: {
    get(): Promise<Overview>;
  };
  locations: {
    list(query: { kind: LocationKind; parent?: number | string }): Promise<LocationItem[]>;
  };
  clients: {
    list(query?: ClientListQuery): Promise<ClientListResult>;
    get(id: number): Promise<ClientDetail>;
    readyByLocation(): Promise<ReadyByLocationGroup[]>;
    submit(input: ClientSubmitInput): Promise<ClientSubmitResult>;
    importPreview(input: { application: Record<string, unknown> }): Promise<ImportPreviewResult>;
    importConfirm(input: {
      fields: Record<string, unknown>;
      allow_duplicate?: boolean;
      idempotency_key: string;
      supporting_documents?: SupportingDocument[];
    }): Promise<ImportConfirmResult>;
  };
  officialImport: {
    open(): Promise<{ opened: true }>;
    list(): Promise<OfficialApplicationSummary[]>;
    get(applicationId: string): Promise<Record<string, unknown>>;
    close(): Promise<{ closed: true }>;
  };
  queue: {
    get(): Promise<{ items: LocalQueueItem[] }>;
    add(input: QueueAddInput): Promise<QueueAddResult>;
    remove(bookingIds: number[]): Promise<QueueRemoveResult>;
    bookNow(input: BookNowInput): Promise<BookNowResult>;
    progress(bookingIds: number[]): Promise<ProgressItem[]>;
  };
  watchers: {
    list(): Promise<Watcher[]>;
    get(id: number): Promise<WatcherDetail>;
    create(input: WatcherCreateInput): Promise<Watcher>;
    updateSettings(id: number, patch: WatcherSettingsPatch): Promise<Watcher>;
    pause(id: number): Promise<Watcher>;
    resume(id: number): Promise<Watcher>;
    check(id: number, opts?: { force?: boolean; slots?: string[] }): Promise<WatcherCheckResult>;
    delete(id: number): Promise<{ deleted: true }>;
    reorder(id: number, bookingIds: number[]): Promise<void>;
    history(id: number, page?: number): Promise<Paged<WatcherHistoryItem>>;
  };
  appointments: {
    list(query?: AppointmentListQuery): Promise<Paged<Appointment>>;
    receipt(bookingId: number): Promise<ReceiptResult>;
    reconcile(clientIds?: number[]): Promise<ReconcileResult>;
    saveReceipt(bookingId: number, filename: string): Promise<{ saved: boolean; path: string | null }>;
  };
  account: {
    me(): Promise<MeResult>;
  };
  devices: {
    revoke(deviceId: number): Promise<{ revoked: true }>;
  };
  activity: {
    list(query?: ActivityQuery): Promise<Paged<ActivityItem>>;
  };
  preferences: {
    get(): Promise<Preferences>;
    update(patch: PreferencesPatch): Promise<Preferences>;
  };
  scheduler: {
    checkNow(
      watcherId: number,
    ): Promise<{ requested: boolean; reason: CheckNowRejection | null }>;
    pause(watcherId: number): Promise<{ paused: true }>;
    resume(watcherId: number): Promise<{ resumed: true }>;
    getRuntime(): Promise<WatcherRuntime[]>;
    sync(): Promise<{ synced: true }>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsPatch): Promise<AppSettings>;
    refreshOfficialSession(): Promise<{ refreshed: true }>;
  };
  window: {
    minimizeToTray(): Promise<{ hidden: true }>;
    quit(): Promise<{ quitting: true }>;
  };
  app: {
    version(): Promise<string>;
  };
  updater: {
    check(): Promise<{ requested: true }>;
    status(): Promise<UpdateStatus>;
    install(): Promise<{ requested: true }>;
  };
  lab: {
    summary(): Promise<LabSummary>;
    clients(query?: LabListQuery): Promise<Paged<LabClient> & { is_staff: boolean }>;
    detail(id: number): Promise<LabClientDetail>;
    generate(input: LabGenerateInput): Promise<LabGenerateResult>;
    submit(input: LabSubmitInput): Promise<{ batch_id: string }>;
    book(input: LabBookInput): Promise<{ batch_id: string }>;
    job(batchId: string): Promise<LabJob>;
    reconcile(input?: { client_ids?: number[] }): Promise<LabReconcileResult>;
    history(query?: LabListQuery): Promise<Paged<LabHistoryItem>>;
    cancel(bookingId: number): Promise<{ cancelled: true; application_id: string }>;
    receipt(bookingId: number): Promise<ReceiptResult>;
    delete(id: number): Promise<{ deleted: true }>;
  };
  on(channel: 'watcher-state', callback: (payload: WatcherStateEvent) => void): () => void;
  on(channel: 'net-status', callback: (payload: { online: boolean }) => void): () => void;
  on(channel: 'notification-click', callback: (payload: { route: string }) => void): () => void;
  on(channel: 'play-sound' | 'auth-expired', callback: (payload: undefined) => void): () => void;
  on(channel: 'update-status', callback: (payload: UpdateStatus) => void): () => void;
  on(
    channel: 'official-import-state',
    callback: (payload: OfficialImportStateEvent) => void,
  ): () => void;
  on(channel: EventChannel, callback: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
