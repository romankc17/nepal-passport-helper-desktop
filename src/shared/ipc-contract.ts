// IPC channel names, event channels and hand-rolled argument validators.
// Pure module — no Electron imports so it is unit-testable in plain node.

import type {
  ActivityQuery,
  AppSettingsPatch,
  AppointmentListQuery,
  BookNowInput,
  ClientListQuery,
  LocationKind,
  PreferencesPatch,
  QueueAddInput,
  WatcherCreateInput,
  WatcherMode,
  WatcherSettingsPatch,
} from './types';

export const channels = {
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authGetSession: 'auth:get-session',
  overviewGet: 'overview:get',
  locationsList: 'locations:list',
  clientsList: 'clients:list',
  clientsGet: 'clients:get',
  clientsReadyByLocation: 'clients:ready-by-location',
  queueAdd: 'queue:add',
  queueRemove: 'queue:remove',
  queueBookNow: 'queue:book-now',
  queueProgress: 'queue:progress',
  watchersList: 'watchers:list',
  watchersGet: 'watchers:get',
  watchersCreate: 'watchers:create',
  watchersUpdateSettings: 'watchers:update-settings',
  watchersPause: 'watchers:pause',
  watchersResume: 'watchers:resume',
  watchersCheck: 'watchers:check',
  watchersDelete: 'watchers:delete',
  watchersReorder: 'watchers:reorder',
  watchersHistory: 'watchers:history',
  appointmentsList: 'appointments:list',
  appointmentsCancel: 'appointments:cancel',
  appointmentsReceipt: 'appointments:receipt',
  appointmentsReconcile: 'appointments:reconcile',
  appointmentsSaveReceipt: 'appointments:save-receipt',
  accountMe: 'account:me',
  devicesRevoke: 'devices:revoke',
  activityList: 'activity:list',
  preferencesGet: 'preferences:get',
  preferencesUpdate: 'preferences:update',
  schedulerCheckNow: 'scheduler:check-now',
  schedulerPause: 'scheduler:pause',
  schedulerResume: 'scheduler:resume',
  schedulerGetRuntime: 'scheduler:get-runtime',
  schedulerSync: 'scheduler:sync',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  windowMinimizeToTray: 'window:minimize-to-tray',
  windowQuit: 'window:quit',
  appVersion: 'app:version',
} as const;

export type ChannelName = (typeof channels)[keyof typeof channels];

// Event channels the preload `on()` helper is allowed to subscribe to.
export const eventChannels = [
  'watcher-state',
  'net-status',
  'notification-click',
  'play-sound',
  'auth-expired',
] as const;

export type EventChannel = (typeof eventChannels)[number];

// Result envelope: handlers never throw across IPC, they return this shape so
// typed error codes survive the contextBridge boundary.
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

// --- Validators ---------------------------------------------------------------

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MAX_STRING = 2000;
const MAX_ID = Number.MAX_SAFE_INTEGER;
const MAX_ARRAY = 500;

function fail(name: string, expected: string): never {
  throw new ValidationError(`Invalid argument "${name}": expected ${expected}`);
}

export function asString(value: unknown, name: string, maxLength = MAX_STRING): string {
  if (typeof value !== 'string') fail(name, 'a string');
  if (value.length === 0) fail(name, 'a non-empty string');
  if (value.length > maxLength) fail(name, `a string of at most ${maxLength} characters`);
  return value;
}

export function asOptionalString(value: unknown, name: string, maxLength = MAX_STRING): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return asString(value, name, maxLength);
}

export function asId(value: unknown, name = 'id'): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(name, 'an integer');
  if (value <= 0 || value > MAX_ID) fail(name, `an integer between 1 and ${MAX_ID}`);
  return value;
}

export function asBool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') fail(name, 'a boolean');
  return value;
}

export function asEnum<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(name, `one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

// Location ids: providers use integers, provinces/districts use numeric
// strings on the government side — accept both and pass through unchanged.
export function asLocationId(value: unknown, name: string): number | string {
  if (typeof value === 'number') return asId(value, name);
  if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)) return value;
  fail(name, 'a positive integer or numeric string');
}

export function asSafeFilename(value: unknown, name: string): string {
  const filename = asString(value, name, 200);
  if (/[/\\\0]/.test(filename) || filename.startsWith('.')) {
    fail(name, 'a plain filename without path separators');
  }
  return filename;
}

export function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(name, 'an object');
  return value as Record<string, unknown>;
}

export function asIdArray(value: unknown, name: string): number[] {
  if (!Array.isArray(value)) fail(name, 'an array of integers');
  if (value.length === 0) fail(name, 'a non-empty array');
  if (value.length > MAX_ARRAY) fail(name, `an array of at most ${MAX_ARRAY} items`);
  return value.map((item, index) => asId(item, `${name}[${index}]`));
}

export function asOptionalId(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asId(value, name);
}

export function asOptionalBool(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return asBool(value, name);
}

export function asPositiveInt(value: unknown, name: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) fail(name, 'an integer');
  if (value <= 0 || value > max) fail(name, `an integer between 1 and ${max}`);
  return value;
}

export function asOptionalPositiveInt(value: unknown, name: string, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  return asPositiveInt(value, name, max);
}

// --- Per-channel input validators ----------------------------------------------

export interface LoginInput {
  username: string;
  password: string;
  serverUrl?: string;
}

export function validateLoginInput(raw: unknown): LoginInput {
  const input = asRecord(raw, 'login');
  const username = asString(input.username, 'username', 200);
  const password = asString(input.password, 'password', 500);
  const serverUrl = asOptionalString(input.serverUrl, 'serverUrl', 500);
  if (serverUrl !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(serverUrl);
    } catch {
      fail('serverUrl', 'a valid URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      fail('serverUrl', 'an http(s) URL');
    }
  }
  return { username, password, serverUrl };
}

const locationKinds: readonly LocationKind[] = ['provinces', 'districts', 'providers'];

export function validateLocationsQuery(raw: unknown): {
  kind: LocationKind;
  parent?: number | string;
} {
  const input = asRecord(raw, 'locationsQuery');
  const parent =
    input.parent === undefined || input.parent === null
      ? undefined
      : asLocationId(input.parent, 'parent');
  return {
    kind: asEnum(input.kind, 'kind', locationKinds),
    parent,
  };
}

export function validateClientListQuery(raw: unknown): ClientListQuery {
  if (raw === undefined || raw === null) return {};
  const input = asRecord(raw, 'clientListQuery');
  return {
    page: asOptionalPositiveInt(input.page, 'page', 100000),
    page_size: asOptionalPositiveInt(input.page_size, 'page_size', 100),
    q: asOptionalString(input.q, 'q', 200),
    status: asOptionalString(input.status, 'status', 50),
    application_type: asOptionalString(input.application_type, 'application_type', 50),
    provider_id: asOptionalId(input.provider_id, 'provider_id'),
    booked: asOptionalBool(input.booked, 'booked'),
    sort: asOptionalString(input.sort, 'sort', 50),
  };
}

function validateLocationIds(input: Record<string, unknown>): {
  provider_id: number | string;
  district_id: number | string;
  province_id: number | string;
  provider_name: string;
} {
  return {
    provider_id: asLocationId(input.provider_id, 'provider_id'),
    district_id: asLocationId(input.district_id, 'district_id'),
    province_id: asLocationId(input.province_id, 'province_id'),
    provider_name: asString(input.provider_name, 'provider_name', 200),
  };
}

export function validateQueueAddInput(raw: unknown): QueueAddInput {
  const input = asRecord(raw, 'queueAdd');
  return {
    ...validateLocationIds(input),
    client_ids: asIdArray(input.client_ids, 'client_ids'),
    idempotency_key: asString(input.idempotency_key, 'idempotency_key', 100),
  };
}

const slotPattern = /^\d{4}-\d{2}-\d{2}\|\d{2}:\d{2}$/;

export function validateBookNowInput(raw: unknown): BookNowInput {
  const input = asRecord(raw, 'bookNow');
  const slots = input.slots;
  if (slots !== undefined) {
      if (!Array.isArray(slots) || slots.length > 50) fail('slots', 'an array of at most 50 slots');
    for (const slot of slots) {
      if (typeof slot !== 'string' || !slotPattern.test(slot)) {
        fail('slots', 'entries formatted as YYYY-MM-DD|HH:MM');
      }
    }
  }
  return {
    ...validateLocationIds(input),
    client_ids: asIdArray(input.client_ids, 'client_ids'),
    idempotency_key: asString(input.idempotency_key, 'idempotency_key', 100),
    slots: slots as string[] | undefined,
  };
}

const watcherModes: readonly WatcherMode[] = ['notify', 'book'];

export function validateWatcherCreateInput(raw: unknown): WatcherCreateInput {
  const input = asRecord(raw, 'watcherCreate');
  return {
    ...validateLocationIds(input),
    mode: asEnum(input.mode, 'mode', watcherModes),
    interval_seconds: asOptionalPositiveInt(input.interval_seconds, 'interval_seconds', 86400),
    days_ahead: asOptionalPositiveInt(input.days_ahead, 'days_ahead', 90),
    desired_bookings: asOptionalPositiveInt(input.desired_bookings, 'desired_bookings', 500),
    notify: asOptionalBool(input.notify, 'notify'),
  };
}

export function validateWatcherSettingsPatch(raw: unknown): WatcherSettingsPatch {
  const input = asRecord(raw, 'watcherSettings');
  return {
    interval_seconds: asOptionalPositiveInt(input.interval_seconds, 'interval_seconds', 86400),
    days_ahead: asOptionalPositiveInt(input.days_ahead, 'days_ahead', 90),
    desired_bookings: asOptionalPositiveInt(input.desired_bookings, 'desired_bookings', 500),
    notify: asOptionalBool(input.notify, 'notify'),
  };
}

export function validateWatcherCheckInput(raw: unknown): { force?: boolean; slots?: string[] } {
  if (raw === undefined || raw === null) return {};
  const input = asRecord(raw, 'watcherCheck');
  const slots = input.slots;
  if (slots !== undefined) {
    if (!Array.isArray(slots) || slots.length > 50) fail('slots', 'an array of at most 50 slots');
    for (const slot of slots) {
      if (typeof slot !== 'string' || !slotPattern.test(slot)) {
        fail('slots', 'entries formatted as YYYY-MM-DD|HH:MM');
      }
    }
  }
  return { force: asOptionalBool(input.force, 'force'), slots: slots as string[] | undefined };
}

const appointmentStatuses = ['booked', 'cancelled'] as const;

export function validateAppointmentListQuery(raw: unknown): AppointmentListQuery {
  if (raw === undefined || raw === null) return {};
  const input = asRecord(raw, 'appointmentListQuery');
  return {
    status:
      input.status === undefined || input.status === null
        ? undefined
        : asEnum(input.status, 'status', appointmentStatuses),
    q: asOptionalString(input.q, 'q', 200),
    provider_id: asOptionalId(input.provider_id, 'provider_id'),
    page: asOptionalPositiveInt(input.page, 'page', 100000),
  };
}

export function validateActivityQuery(raw: unknown): ActivityQuery {
  if (raw === undefined || raw === null) return {};
  const input = asRecord(raw, 'activityQuery');
  return {
    type: asOptionalString(input.type, 'type', 50),
    provider_id: asOptionalId(input.provider_id, 'provider_id'),
    status: asOptionalString(input.status, 'status', 50),
    client_id: asOptionalId(input.client_id, 'client_id'),
    from: asOptionalString(input.from, 'from', 40),
    to: asOptionalString(input.to, 'to', 40),
    page: asOptionalPositiveInt(input.page, 'page', 100000),
  };
}

export function validatePreferencesPatch(raw: unknown): PreferencesPatch {
  const input = asRecord(raw, 'preferencesPatch');
  return {
    notifications_enabled: asOptionalBool(input.notifications_enabled, 'notifications_enabled'),
    sound_enabled: asOptionalBool(input.sound_enabled, 'sound_enabled'),
    email_on_booking: asOptionalBool(input.email_on_booking, 'email_on_booking'),
    email_address: asOptionalString(input.email_address, 'email_address', 320),
  };
}

const themes = ['light', 'system'] as const;

export function validateAppSettingsPatch(raw: unknown): AppSettingsPatch {
  const input = asRecord(raw, 'settingsPatch');
  const patch: AppSettingsPatch = {
    notificationsEnabled: asOptionalBool(input.notificationsEnabled, 'notificationsEnabled'),
    soundEnabled: asOptionalBool(input.soundEnabled, 'soundEnabled'),
    minimizeToTray: asOptionalBool(input.minimizeToTray, 'minimizeToTray'),
    startOnLogin: asOptionalBool(input.startOnLogin, 'startOnLogin'),
    defaultIntervalSeconds: asOptionalPositiveInt(
      input.defaultIntervalSeconds,
      'defaultIntervalSeconds',
      86400,
    ),
    defaultDaysAhead: asOptionalPositiveInt(input.defaultDaysAhead, 'defaultDaysAhead', 90),
  };
  if (input.theme !== undefined && input.theme !== null) {
    patch.theme = asEnum(input.theme, 'theme', themes);
  }
  if (input.apiUrl !== undefined) {
    if (input.apiUrl === null) {
      patch.apiUrl = null;
    } else {
      const url = asString(input.apiUrl, 'apiUrl', 500);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        fail('apiUrl', 'a valid URL');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        fail('apiUrl', 'an http(s) URL');
      }
      patch.apiUrl = url;
    }
  }
  return patch;
}

export function validateOptionalIdArray(raw: unknown, name: string): number[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  return asIdArray(raw, name);
}
