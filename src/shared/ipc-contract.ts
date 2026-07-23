// IPC channel names, event channels and hand-rolled argument validators.
// Pure module — no Electron imports so it is unit-testable in plain node.

import type {
  ActivityQuery,
  AppSettingsPatch,
  AppointmentListQuery,
  BookNowInput,
  ClientListQuery,
  ClientSubmitInput,
  LabBookInput,
  LabGenerateInput,
  LabListQuery,
  LabSubmitInput,
  LocationKind,
  PreferencesPatch,
  FavoriteLocation,
  QueueAddInput,
  SupportingDocument,
  WatcherCreateInput,
  WatcherMode,
  WatcherSettingsPatch,
} from './types';
import { COUNTRY_NEPAL_ID } from './types';

export const channels = {
  authLogin: 'auth:login',
  authLogout: 'auth:logout',
  authGetSession: 'auth:get-session',
  overviewGet: 'overview:get',
  locationsList: 'locations:list',
  clientsList: 'clients:list',
  clientsGet: 'clients:get',
  clientsReadyByLocation: 'clients:ready-by-location',
  clientsSubmit: 'clients:submit',
  queueAdd: 'queue:add',
  queueGet: 'queue:get',
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
  officialSessionRefresh: 'official-session:refresh',
  windowMinimizeToTray: 'window:minimize-to-tray',
  windowQuit: 'window:quit',
  appVersion: 'app:version',
  updateCheck: 'update:check',
  updateGetStatus: 'update:get-status',
  updateInstall: 'update:install',
  labSummary: 'lab:summary',
  labClients: 'lab:clients',
  labClientDetail: 'lab:client-detail',
  labGenerate: 'lab:generate',
  labSubmit: 'lab:submit',
  labBook: 'lab:book',
  labJob: 'lab:job',
  labReconcile: 'lab:reconcile',
  labHistory: 'lab:history',
  labCancel: 'lab:cancel',
  labReceipt: 'lab:receipt',
  labDelete: 'lab:delete',
  officialImportOpen: 'official-import:open-login',
  officialImportList: 'official-import:list-applications',
  officialImportGet: 'official-import:get-application',
  officialImportClose: 'official-import:close-session',
  clientsImportPreview: 'clients:import-official-preview',
  clientsImportConfirm: 'clients:import-official-confirm',
} as const;

export type ChannelName = (typeof channels)[keyof typeof channels];

// Event channels the preload `on()` helper is allowed to subscribe to.
export const eventChannels = [
  'watcher-state',
  'net-status',
  'notification-click',
  'play-sound',
  'auth-expired',
  'update-status',
  'official-import-state',
  'local-queue-state',
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

// Like asLocationId but tolerates ''/null/undefined (normalized to ''), for
// province/district on foreign-mission watchers which have neither.
function asOptionalLocationId(value: unknown, name: string): number | string {
  if (value === undefined || value === null || value === '') return '';
  return asLocationId(value, name);
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

const locationKinds: readonly LocationKind[] = ['countries', 'provinces', 'districts', 'providers'];

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
  country_id?: number | string;
  country_name?: string;
} {
  const countryId =
    input.country_id === undefined || input.country_id === null || input.country_id === ''
      ? undefined
      : asLocationId(input.country_id, 'country_id');
  const countryName = asOptionalString(input.country_name, 'country_name', 200);
  // Foreign missions (any country other than Nepal) have no province/district.
  const foreign = countryId !== undefined && String(countryId) !== COUNTRY_NEPAL_ID;
  return {
    provider_id: asLocationId(input.provider_id, 'provider_id'),
    district_id: foreign
      ? asOptionalLocationId(input.district_id, 'district_id')
      : asLocationId(input.district_id, 'district_id'),
    province_id: foreign
      ? asOptionalLocationId(input.province_id, 'province_id')
      : asLocationId(input.province_id, 'province_id'),
    provider_name: asString(input.provider_name, 'provider_name', 200),
    ...(countryId !== undefined ? { country_id: countryId } : {}),
    ...(countryName ? { country_name: countryName } : {}),
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
    notification_email: asOptionalString(input.notification_email, 'notification_email', 254),
  };
}

export function validateWatcherSettingsPatch(raw: unknown): WatcherSettingsPatch {
  const input = asRecord(raw, 'watcherSettings');
  return {
    interval_seconds: asOptionalPositiveInt(input.interval_seconds, 'interval_seconds', 86400),
    days_ahead: asOptionalPositiveInt(input.days_ahead, 'days_ahead', 90),
    desired_bookings: asOptionalPositiveInt(input.desired_bookings, 'desired_bookings', 500),
    notify: asOptionalBool(input.notify, 'notify'),
    notification_email: asOptionalString(input.notification_email, 'notification_email', 254),
  };
}

export function validateWatcherCheckInput(raw: unknown): {
  force?: boolean;
  slots?: string[];
  client_ids?: number[];
} {
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
  const clientIds = input.client_ids;
  if (clientIds !== undefined) {
    if (!Array.isArray(clientIds) || clientIds.length > 50) {
      fail('client_ids', 'an array of at most 50 client ids');
    }
    for (const clientId of clientIds) {
      if (typeof clientId !== 'number' || !Number.isInteger(clientId)) {
        fail('client_ids', 'entries must be integer client ids');
      }
    }
  }
  return {
    force: asOptionalBool(input.force, 'force'),
    slots: slots as string[] | undefined,
    client_ids: clientIds as number[] | undefined,
  };
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

const MAX_FAVORITES = 20;

function asFavoriteLocations(value: unknown): FavoriteLocation[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) fail('favorite_locations', 'an array');
  if (value.length > MAX_FAVORITES) fail('favorite_locations', `an array of at most ${MAX_FAVORITES} items`);
  return value.map((item, index) => {
    const entry = asRecord(item, `favorite_locations[${index}]`);
    const favorite: FavoriteLocation = {
      provider_id: asLocationId(entry.provider_id, `favorite_locations[${index}].provider_id`),
      provider_name: asString(entry.provider_name, `favorite_locations[${index}].provider_name`, 200),
      district_id: asLocationId(entry.district_id, `favorite_locations[${index}].district_id`),
      province_id: asLocationId(entry.province_id, `favorite_locations[${index}].province_id`),
    };
    const districtName = asOptionalString(entry.district_name, `favorite_locations[${index}].district_name`, 200);
    if (districtName) favorite.district_name = districtName;
    return favorite;
  });
}

export function validatePreferencesPatch(raw: unknown): PreferencesPatch {
  const input = asRecord(raw, 'preferencesPatch');
  return {
    notifications_enabled: asOptionalBool(input.notifications_enabled, 'notifications_enabled'),
    sound_enabled: asOptionalBool(input.sound_enabled, 'sound_enabled'),
    email_on_booking: asOptionalBool(input.email_on_booking, 'email_on_booking'),
    email_address: asOptionalString(input.email_address, 'email_address', 320),
    favorite_locations: asFavoriteLocations(input.favorite_locations),
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

export function validateClientSubmitInput(raw: unknown): ClientSubmitInput {
  const input = asRecord(raw, 'clientSubmit');
  return { client_ids: asIdArray(input.client_ids, 'client_ids') };
}

// --- Booking Lab validators ---------------------------------------------------

export function validateLabListQuery(raw: unknown): LabListQuery {
  if (raw === undefined || raw === null) return {};
  const input = asRecord(raw, 'labListQuery');
  return {
    status: asOptionalString(input.status, 'status', 50),
    q: asOptionalString(input.q, 'q', 200),
    owner: asOptionalString(input.owner, 'owner', 50),
    provider_id: asOptionalId(input.provider_id, 'provider_id'),
    page: asOptionalPositiveInt(input.page, 'page', 100000),
    page_size: asOptionalPositiveInt(input.page_size, 'page_size', 100),
  };
}

export function validateLabGenerateInput(raw: unknown): LabGenerateInput {
  const input = asRecord(raw, 'labGenerate');
  return {
    province_id: asLocationId(input.province_id, 'province_id'),
    district_id: asLocationId(input.district_id, 'district_id'),
    provider_id: asId(input.provider_id, 'provider_id'),
    application_type: asString(input.application_type, 'application_type', 50),
    count: asPositiveInt(input.count, 'count', 50),
    idempotency_key: asString(input.idempotency_key, 'idempotency_key', 100),
  };
}

export function validateLabSubmitInput(raw: unknown): LabSubmitInput {
  const input = asRecord(raw, 'labSubmit');
  const clients = input.clients;
  if (!Array.isArray(clients) || clients.length === 0) fail('clients', 'a non-empty array');
  return {
    clients: clients as Record<string, unknown>[],
    idempotency_key: asString(input.idempotency_key, 'idempotency_key', 100),
  };
}

export function validateLabJobBatchId(raw: unknown): string {
  return asString(raw, 'batchId', 36);
}

export function validateLabBookInput(raw: unknown): LabBookInput {
  const input = asRecord(raw, 'labBook');
  return {
    client_ids: asIdArray(input.client_ids, 'client_ids'),
    idempotency_key: asString(input.idempotency_key, 'idempotency_key', 100),
  };
}

// --- Official import validators -------------------------------------------------

// Keys that must never travel over IPC: authentication material of the
// official portal. Anything matching is rejected outright.
export const FORBIDDEN_KEY_PATTERN =
  /token|jwt|authori[sz]ation|cookie|password|captcha|secret|credential|session/i;

const MAX_IMPORT_DEPTH = 8;
const MAX_IMPORT_KEYS = 2000;
const MAX_IMPORT_JSON_BYTES = 256 * 1024;

// Recursively assert no forbidden keys and bound size/depth. Returns the value
// unchanged for chaining.
export function assertSanitizedPayload(value: unknown, name: string): void {
  let keys = 0;
  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_IMPORT_DEPTH) fail(name, `an object nested at most ${MAX_IMPORT_DEPTH} levels`);
    if (Array.isArray(node)) {
      if (node.length > MAX_ARRAY) fail(name, `arrays of at most ${MAX_ARRAY} items`);
      node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        keys += 1;
        if (keys > MAX_IMPORT_KEYS) fail(name, `an object with at most ${MAX_IMPORT_KEYS} keys`);
        if (FORBIDDEN_KEY_PATTERN.test(key)) {
          fail(name, `no authentication or session fields (found "${path}.${key}")`);
        }
        walk(child, `${path}.${key}`, depth + 1);
      }
      return;
    }
    if (typeof node === 'string' && node.length > 20000) {
      fail(name, 'string values of at most 20000 characters');
    }
  };
  walk(value, name, 0);
  let size = 0;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    fail(name, 'a JSON-serializable object');
  }
  if (size > MAX_IMPORT_JSON_BYTES) {
    fail(name, `a payload of at most ${MAX_IMPORT_JSON_BYTES} bytes`);
  }
}

// Official application ids ("WPT…"). Strict so the fallback manual entry can
// never be used to probe arbitrary endpoints.
export function validateWptId(raw: unknown): string {
  const id = asString(raw, 'applicationId', 40);
  if (!/^WPT[A-Z0-9-]{3,32}$/i.test(id)) {
    fail('applicationId', 'an official application id like WPT100000500');
  }
  return id.toUpperCase();
}

export interface ImportPreviewInput {
  application: Record<string, unknown>;
}

export function validateImportPreviewInput(raw: unknown): ImportPreviewInput {
  const input = asRecord(raw, 'importPreview');
  const application = asRecord(input.application, 'application');
  assertSanitizedPayload(application, 'application');
  return { application };
}

export interface ImportConfirmInput {
  fields: Record<string, unknown>;
  allow_duplicate: boolean;
  idempotency_key: string;
  supporting_documents: SupportingDocument[];
}

// Supporting-document images run through their own validator rather than
// `assertSanitizedPayload`: that helper caps strings at 20000 chars and the
// whole payload at 256KB, both far too small for real base64 scan data.
const MAX_SUPPORTING_DOCUMENTS = 30;
const MAX_IMAGES_PER_DOCUMENT = 5;
const MAX_IMAGE_BASE64_CHARS = 15_000_000; // ~11MB decoded; generous for scanned photos
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function asSupportingDocuments(raw: unknown): SupportingDocument[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail('supporting_documents', 'an array');
  if (raw.length > MAX_SUPPORTING_DOCUMENTS) {
    fail('supporting_documents', `at most ${MAX_SUPPORTING_DOCUMENTS} documents`);
  }
  return raw.map((entry, index) => {
    const item = asRecord(entry, `supporting_documents[${index}]`);
    const documentType = asString(item.documentType, `supporting_documents[${index}].documentType`, 100);
    if (FORBIDDEN_KEY_PATTERN.test(documentType)) {
      fail(`supporting_documents[${index}].documentType`, 'a document type, not authentication material');
    }
    const rawImages = item.documents;
    if (!Array.isArray(rawImages)) {
      fail(`supporting_documents[${index}].documents`, 'an array of base64-encoded images');
    }
    if (rawImages.length > MAX_IMAGES_PER_DOCUMENT) {
      fail(`supporting_documents[${index}].documents`, `at most ${MAX_IMAGES_PER_DOCUMENT} images`);
    }
    const documents = rawImages.map((image, imageIndex) => {
      const value = asString(
        image,
        `supporting_documents[${index}].documents[${imageIndex}]`,
        MAX_IMAGE_BASE64_CHARS,
      );
      if (!BASE64_PATTERN.test(value)) {
        fail(`supporting_documents[${index}].documents[${imageIndex}]`, 'base64-encoded image data');
      }
      return value;
    });
    return { documentType, documents };
  });
}

export function validateImportConfirmInput(raw: unknown): ImportConfirmInput {
  const input = asRecord(raw, 'importConfirm');
  const fields = asRecord(input.fields, 'fields');
  assertSanitizedPayload(fields, 'fields');
  return {
    fields,
    allow_duplicate: input.allow_duplicate === undefined ? false : asBool(input.allow_duplicate, 'allow_duplicate'),
    idempotency_key: asString(input.idempotency_key, 'idempotency_key', 100),
    supporting_documents: asSupportingDocuments(input.supporting_documents),
  };
}
