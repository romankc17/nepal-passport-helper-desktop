import type {
  ActivityItem,
  ActivityQuery,
  AppSettings,
  AppSettingsPatch,
  Appointment,
  AppointmentListQuery,
  BookNowInput,
  BookNowResult,
  ClientDetail,
  ClientListQuery,
  ClientSummary,
  LocationItem,
  MeResult,
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
  | 'auth-expired';

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
    list(query: {
      kind: 'provinces' | 'districts' | 'providers';
      parent?: number | string;
    }): Promise<LocationItem[]>;
  };
  clients: {
    list(query?: ClientListQuery): Promise<Paged<ClientSummary>>;
    get(id: number): Promise<ClientDetail>;
    readyByLocation(): Promise<ReadyByLocationGroup[]>;
  };
  queue: {
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
    cancel(bookingId: number): Promise<{ cancelled: true }>;
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
    checkNow(watcherId: number): Promise<{ requested: true }>;
    pause(watcherId: number): Promise<{ paused: true }>;
    resume(watcherId: number): Promise<{ resumed: true }>;
    getRuntime(): Promise<WatcherRuntime[]>;
    sync(): Promise<{ synced: true }>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsPatch): Promise<AppSettings>;
  };
  window: {
    minimizeToTray(): Promise<{ hidden: true }>;
    quit(): Promise<{ quitting: true }>;
  };
  app: {
    version(): Promise<string>;
  };
  on(channel: 'watcher-state', callback: (payload: WatcherStateEvent) => void): () => void;
  on(channel: 'net-status', callback: (payload: { online: boolean }) => void): () => void;
  on(channel: 'notification-click', callback: (payload: { route: string }) => void): () => void;
  on(channel: 'play-sound' | 'auth-expired', callback: (payload: undefined) => void): () => void;
  on(channel: EventChannel, callback: (payload: unknown) => void): () => void;
}

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}
