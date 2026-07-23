// "Import from official portal" session: opens a maximally locked-down
// BrowserWindow on https://online.nepalpassport.gov.np, lets the user sign in
// manually (credentials and CAPTCHA are typed only into the official page),
// and then drives the official same-origin JSON API from the main process via
// webContents.executeJavaScript. The portal token is read from localStorage
// INSIDE the page and never crosses into main-process variables, logs, or IPC.
import { BrowserWindow, app, shell } from 'electron';
import type { Session } from 'electron';
import { ValidationError } from '../shared/ipc-contract';
import type {
  OfficialApplicationSummary,
  OfficialImportStateEvent,
  SupportingDocument,
} from '../shared/types';
import { ApiError } from './api-client';
import { isE2E } from './e2e';

export const OFFICIAL_ORIGIN = 'https://online.nepalpassport.gov.np';

const LOGIN_PATH = '/account/login';
const LIST_PATH =
  '/process-state-controller/public/applications/search' +
  '?pageNumber=1&pageSize=20&sortDirection=1&sortProperty=status';
// Criteria body mirroring the portal's own my-applications call; the page
// script adds the account context (accountId cookie) on top.
const LIST_BODY = {
  status: null,
  pageNumber: 1,
  pageSize: 20,
  sortProperty: 'applicationId',
  sortDirection: 1,
};
const DETAIL_BASE = '/process-state-controller/public/applications';
const PAGE_FETCH_TIMEOUT_MS = 15000;
// Hard ceiling around executeJavaScript itself: if the page is mid-navigation
// (e.g. a blocked post-login redirect leaves the renderer busy), the call can
// stay pending forever — never let it hang the IPC handler.
const EXECUTE_TIMEOUT_MS = PAGE_FETCH_TIMEOUT_MS + 10000;
const PAGE_SETTLE_TIMEOUT_MS = 10000;
const LOAD_TIMEOUT_MS = 30000;
// If first paint takes too long (slow network), show the window anyway so the
// user can see what the portal is doing instead of a silent spinner.
const SHOW_FALLBACK_MS = 5000;

// The e2e suite points the window at a local mock portal; production never
// sets EPP_E2E, so the override cannot be abused there.
export function officialOrigin(): string {
  if (isE2E && process.env.EPP_OFFICIAL_ORIGIN) return process.env.EPP_OFFICIAL_ORIGIN;
  return OFFICIAL_ORIGIN;
}

export interface OfficialImportDeps {
  getWindow: () => BrowserWindow | null;
}

// Shape of the only data the page-context fetch is allowed to return. `body`
// is parsed JSON (never raw text); no headers, cookies, or tokens.
export interface PageFetchResult {
  status: number;
  contentType?: string;
  body?: unknown;
  error?: 'timeout' | 'network';
  // Whether a `jwt` value was found (localStorage or cookie) — a boolean
  // only, used to distinguish "not signed in" from "session expired".
  hadToken?: boolean;
}

export interface PageFetchInit {
  method: 'GET' | 'POST';
  body?: unknown;
  /**
   * When true, the page script merges the portal's account context (the
   * `accountId` cookie) into the POST body — the portal's own my-applications
   * search does this, and the backend 401s without it. The values stay inside
   * the page; they never reach main-process variables or IPC.
   */
  accountContext?: boolean;
}

export interface OfficialSlot {
  date: string;
  start_time: string;
  end_time: string;
}

// Builds the async IIFE executed inside the official page. It reads the
// portal's opaque `jwt` token (localStorage first, cookie fallback — the same
// keys the portal's own client uses), attaches it as a Bearer header to a
// same-origin fetch with a 15s AbortController timeout, and returns only
// {status, contentType, body, hadToken} — parse failures yield body: null and
// fetch failures yield {status: 0, error: 'timeout'|'network'}. The token
// itself never leaves the page.
// The portal is a Next.js app on a Spring backend: its own axios client
// echoes the XSRF-TOKEN cookie as an X-XSRF-TOKEN header, so the script does
// the same — POSTs get a 403 ("session expired") without it.
export function buildPageFetchScript(path: string, init: PageFetchInit): string {
  return `(async () => {
  const path = ${JSON.stringify(path)};
  const method = ${JSON.stringify(init.method)};
  const payload = ${JSON.stringify(init.body ?? null)};
  const withAccountContext = ${JSON.stringify(init.accountContext === true)};
  // The portal's auth token is an OPAQUE value stored under the exact name
  // "jwt" (its own client reads the same key) — it is not necessarily a
  // dot-separated JWT, so no shape test. Only the exact key is read; nothing
  // else in localStorage/cookies is touched.
  const normalizeToken = (value) => {
    if (typeof value !== 'string' || value.length === 0) return null;
    let token = value.trim();
    if (token.length > 1 && token.startsWith('"') && token.endsWith('"')) {
      token = token.slice(1, -1);
    }
    try {
      token = decodeURIComponent(token);
    } catch (error) {
      // Keep the original value.
    }
    token = token.trim().replace(/^Bearer\\s+/i, '');
    if (!token || token.length > 8192 || /[\\r\\n]/.test(token)) return null;
    return token;
  };
  const readCookie = (name) => {
    try {
      const entries = document.cookie.split(';');
      for (const entry of entries) {
        const eq = entry.indexOf('=');
        if (eq === -1) continue;
        if (entry.slice(0, eq).trim() !== name) continue;
        let value = entry.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        try { value = decodeURIComponent(value); } catch (error) { /* keep raw value */ }
        return value;
      }
    } catch (error) {
      // document.cookie unavailable — fall through to null.
    }
    return null;
  };
  let token = null;
  try {
    token = normalizeToken(localStorage.getItem('jwt'));
  } catch (error) {
    token = null;
  }
  if (!token) {
    token = normalizeToken(readCookie('jwt'));
  }
  const xsrfToken = readCookie('XSRF-TOKEN');
  // The portal's own my-applications search posts a criteria body carrying
  // the accountId cookie; the backend rejects bare empty bodies with 401.
  let payloadOut = payload;
  if (withAccountContext) {
    payloadOut = Object.assign({}, payload, {
      accountId: readCookie('accountId'),
      createdBy: null,
      originId: 'WP',
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ${PAGE_FETCH_TIMEOUT_MS});
  try {
    const headers = { 'X-Requested-With': 'XMLHttpRequest' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (xsrfToken) headers['X-XSRF-TOKEN'] = xsrfToken;
    if (payloadOut !== null) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: payloadOut !== null ? JSON.stringify(payloadOut) : undefined,
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    let parsed = null;
    try {
      parsed = await response.json();
    } catch (error) {
      parsed = null;
    }
    return { status: response.status, contentType, body: parsed, hadToken: token !== null };
  } catch (error) {
    const aborted = error && error.name === 'AbortError';
    return { status: 0, error: aborted ? 'timeout' : 'network', hadToken: token !== null };
  } finally {
    clearTimeout(timer);
  }
})()`;
}

// --- Sanitizer ----------------------------------------------------------------

// Keys that must never leave the main process: auth material, biometrics,
// photos/scans, documents, receipts and payments.
const BLOCKED_KEY_PATTERN =
  /token|jwt|authori[sz]ation|cookie|password|captcha|secret|credential|session|finger|biometric|face|signature|photo|image|portrait|document|receipt|payment|transaction|account/i;

// The broad `document` blocklist would also nuke mappable application fields;
// these exact keys (and snake_case variants) are needed for the import mapping.
const SANITIZER_ALLOWED_KEYS = new Set([
  'documentSubtype',
  'documentType',
  'previousDocumentType',
  'previousDocumentNumber',
  'ordinaryType',
  'passportType',
  'document_subtype',
  'document_type',
  'previous_document_type',
  'previous_document_number',
  'ordinary_type',
  'passport_type',
]);

const MAX_SANITIZE_DEPTH = 8;
const MAX_SANITIZE_ARRAY = 100;
const MAX_SANITIZE_STRING = 4000;
const MAX_SANITIZE_JSON_BYTES = 256 * 1024;

// Recursively strips dangerous keys, overlong strings, deep nesting and long
// arrays from official-portal JSON before it is returned over IPC. Throws a
// ValidationError when the sanitized result still exceeds the size cap.
export function sanitizeOfficialJson(value: unknown): unknown {
  const cleaned = sanitizeNode(value, 0);
  let size = 0;
  try {
    size = JSON.stringify(cleaned)?.length ?? 0;
  } catch {
    size = 0;
  }
  if (size > MAX_SANITIZE_JSON_BYTES) {
    throw new ValidationError('Sanitized official payload exceeds the 256KB limit');
  }
  return cleaned;
}

function sanitizeNode(node: unknown, depth: number): unknown {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return node.length > MAX_SANITIZE_STRING ? undefined : node;
  if (typeof node === 'number' || typeof node === 'boolean') return node;
  if (depth >= MAX_SANITIZE_DEPTH) return undefined;
  if (Array.isArray(node)) {
    return node
      .slice(0, MAX_SANITIZE_ARRAY)
      .map((item) => sanitizeNode(item, depth + 1) ?? null);
  }
  if (typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (BLOCKED_KEY_PATTERN.test(key) && !SANITIZER_ALLOWED_KEYS.has(key)) continue;
      const cleaned = sanitizeNode(child, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  return undefined;
}

// --- Supporting documents ---------------------------------------------------

// The generic sanitizer above deliberately guts anything matching
// `document|photo|image` and caps strings at 4000 chars — right, for noise,
// but too small for real base64 scan data. Supporting documents get their own
// narrow, separately-capped path instead of loosening the generic blocklist:
// pulled straight from the raw (pre-sanitizer) body, validated as base64, and
// reattached to the sanitized result under the same key.
const MAX_DOCUMENT_ENTRIES = 30;
const MAX_IMAGES_PER_DOCUMENT = 5;
const MAX_IMAGE_BASE64_CHARS = 15_000_000; // ~11MB decoded; generous for scanned photos
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_SEARCH_DEPTH = 8; // matches the generic sanitizer's own depth cap

// The portal's detail response wraps its DTOs inconsistently (see PERSON_PATH
// above) and `supportingDocumentsData` isn't reliably at the top level — so
// this searches for the key instead of assuming one fixed path.
function findSupportingDocumentsData(node: unknown, depth: number): unknown {
  if (depth > MAX_SEARCH_DEPTH || typeof node !== 'object' || node === null) return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findSupportingDocumentsData(item, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if ('supportingDocumentsData' in record) return record.supportingDocumentsData;
  for (const value of Object.values(record)) {
    const found = findSupportingDocumentsData(value, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function extractSupportingDocuments(body: unknown): SupportingDocument[] {
  const raw = findSupportingDocumentsData(body, 0);
  if (!Array.isArray(raw)) return [];
  const out: SupportingDocument[] = [];
  for (const entry of raw.slice(0, MAX_DOCUMENT_ENTRIES)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const documentType = record.documentType;
    if (typeof documentType !== 'string' || !documentType || documentType.length > 100) continue;
    const rawImages = record.documents;
    if (!Array.isArray(rawImages)) continue;
    const documents = rawImages
      .filter(
        (image): image is string =>
          typeof image === 'string' &&
          image.length > 0 &&
          image.length <= MAX_IMAGE_BASE64_CHARS &&
          BASE64_PATTERN.test(image),
      )
      .slice(0, MAX_IMAGES_PER_DOCUMENT);
    // Skip document types the applicant never actually scanned.
    if (documents.length > 0) out.push({ documentType, documents });
  }
  return out;
}

// --- Official search-response mapping -------------------------------------------

const LIST_WRAPPER_KEYS = ['data', 'content', 'items', 'results', 'applications', 'pagedResults'];

// The official search endpoint's envelope is not documented; tolerate a bare
// array or a wrapper object (possibly nested once more, e.g. data.content).
export function extractApplicationList(body: unknown): Record<string, unknown>[] {
  let node: unknown = body;
  for (let depth = 0; depth < 3; depth += 1) {
    if (Array.isArray(node)) {
      return node.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      );
    }
    if (typeof node !== 'object' || node === null) return [];
    const record = node as Record<string, unknown>;
    const next = LIST_WRAPPER_KEYS.map((key) => record[key]).find(
      (value) => value !== undefined && value !== null,
    );
    if (next === undefined) return [];
    node = next;
  }
  return [];
}

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

// Walks a nested path (numeric segments index arrays); '' counts as absent.
function dig(value: unknown, path: (string | number)[]): unknown {
  let node: unknown = value;
  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(node)) return undefined;
      node = node[key];
    } else {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined;
      node = (node as Record<string, unknown>)[key];
    }
  }
  return node === '' ? undefined : node;
}

function summaryString(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).slice(0, 200);
}

// The live search response nests everything under applicationMetaDataDTO /
// applicantsDTO DTOs; the flat keys cover simpler shapes (mock, older API).
const PERSON_PATH = [
  'applicantsDTO',
  'applicantDTOList',
  0,
  'demographicDataDTO',
  'personDataDTO',
] as const;

export function toApplicationSummary(
  record: Record<string, unknown>,
): OfficialApplicationSummary {
  const meta = dig(record, ['applicationMetaDataDTO']);
  const metaRecord =
    typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {};
  const givenName =
    pick(record, ['givenName', 'given_name', 'firstName']) ??
    dig(record, [...PERSON_PATH, 'givenName']);
  const surname =
    pick(record, ['surname', 'lastName']) ?? dig(record, [...PERSON_PATH, 'surname']);
  const joined =
    givenName !== undefined || surname !== undefined
      ? [givenName, surname].filter((part) => part !== undefined && part !== null).join(' ')
      : undefined;
  return {
    id: summaryString(
      pick(record, ['id', 'applicationId', 'application_id', 'requestId']) ??
        pick(metaRecord, ['applicationID', 'applicationId', 'id']),
    ),
    applicant_name: summaryString(
      joined ?? pick(record, ['applicantName', 'applicant_name', 'fullName', 'name']),
    ),
    application_type: summaryString(
      pick(record, ['applicationType', 'application_type', 'type']) ??
        pick(metaRecord, ['useCase', 'applicationType', 'type']),
    ),
    submitted_at: summaryString(
      pick(record, ['submittedDate', 'submissionDate', 'createdDate', 'createdAt', 'appliedDate']) ??
        pick(metaRecord, ['submittedDate', 'submissionDate', 'createdDate', 'createdAt']),
    ),
    status: summaryString(
      pick(record, ['status', 'applicationStatus']) ??
        pick(metaRecord, ['applicationState', 'status']),
    ),
  };
}

// Maps the page-fetch envelope onto typed IPC errors (ApiError flows through
// toErrorShape in ipc.ts). Never includes response bodies in messages.
export function pageResultError(result: PageFetchResult): ApiError | null {
  if (result.status === 0) {
    if (result.error === 'timeout') {
      return new ApiError('TIMEOUT', 'The official portal did not respond in time', true, 0);
    }
    return new ApiError('OFFICIAL_UNAVAILABLE', 'Could not reach the official portal', true, 0);
  }
  if (result.status === 401 || result.status === 403) {
    if (result.hadToken === false) {
      // No `jwt` value anywhere the portal keeps it — the user simply has
      // not signed in (or signed in somewhere else).
      return new ApiError(
        'NOT_SIGNED_IN',
        'You are not signed in on the official portal yet',
        false,
        result.status,
      );
    }
    return new ApiError(
      'SESSION_EXPIRED',
      'Your official portal session was rejected or expired. Please sign in again.',
      false,
      result.status,
    );
  }
  if (result.status === 404) {
    return new ApiError('NOT_FOUND', 'Application not found on the official portal', false, 404);
  }
  if (result.status === 421 || result.status === 429) {
    return new ApiError(
      'RATE_LIMITED',
      'The official portal is rate limiting requests — retry shortly',
      true,
      result.status,
    );
  }
  if (result.status === 500 || result.status === 503) {
    return new ApiError(
      'OFFICIAL_UNAVAILABLE',
      `The official portal is unavailable (HTTP ${result.status})`,
      true,
      result.status,
    );
  }
  if (result.status >= 200 && result.status < 300) {
    const isJson =
      (result.contentType ?? '').toLowerCase().includes('json') &&
      result.body !== null &&
      result.body !== undefined;
    if (!isJson) {
      return new ApiError(
        'UNEXPECTED_RESPONSE',
        'The official portal returned an unexpected page — it may be showing a CAPTCHA or maintenance notice',
        false,
        result.status,
      );
    }
    return null;
  }
  return new ApiError(
    'UNEXPECTED_RESPONSE',
    `Unexpected response from the official portal (HTTP ${result.status})`,
    false,
    result.status,
  );
}

function isOfficialUrl(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

// --- Session --------------------------------------------------------------------

export class OfficialImportSession {
  private window: BrowserWindow | null = null;

  constructor(private readonly deps: OfficialImportDeps) {}

  async open(): Promise<{ opened: true }> {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus();
      return { opened: true };
    }
    const origin = officialOrigin();
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      show: false,
      title: 'Official Passport Portal',
      webPreferences: {
        // No preload: nothing of ours runs inside official content.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        // In-memory only — never persist:. Storage is wiped on close/quit.
        partition: `official-import-${Date.now()}`,
      },
    });
    this.window = win;

    // Show on first paint, but never leave the user staring at a spinner if
    // the portal is slow — show the window anyway after a short fallback.
    let shown = false;
    const showWindow = (): void => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      clearTimeout(showFallback);
      win.show();
    };
    const showFallback = setTimeout(showWindow, SHOW_FALLBACK_MS);
    win.on('ready-to-show', showWindow);

    const guardNavigation = (event: { preventDefault(): void }, url: string): void => {
      if (isOfficialUrl(url, origin)) return;
      event.preventDefault();
      // Surface blocked navigations — the portal may legitimately try to
      // redirect elsewhere after login, and a silent block looks like a hang.
      let host = url.slice(0, 100);
      try {
        host = new URL(url).host;
      } catch {
        // keep the truncated raw url
      }
      this.notify('blocked-navigation', host);
    };
    win.webContents.on('will-navigate', guardNavigation);
    win.webContents.on('will-redirect', guardNavigation);

    win.webContents.setWindowOpenHandler(({ url }) => {
      // Popups are always denied; genuine external https links open in the
      // system browser instead (never official-origin pages).
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' && parsed.origin !== origin) {
          void shell.openExternal(url);
        }
      } catch {
        // Unparseable URL — deny below.
      }
      return { action: 'deny' as const };
    });

    const ses = win.webContents.session;
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    ses.setPermissionCheckHandler(() => false);

    win.on('closed', () => {
      this.window = null;
      void this.clearSession(ses);
      this.notify('closed');
    });

    try {
      await Promise.race([
        win.loadURL(`${origin}${LOGIN_PATH}`),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('load timeout')), LOAD_TIMEOUT_MS);
        }),
      ]);
    } catch {
      if (!win.isDestroyed()) win.destroy();
      this.window = null;
      throw new ApiError(
        'OFFICIAL_UNAVAILABLE',
        'Could not load the official portal login page',
        true,
        0,
      );
    }
    this.notify('opened');
    return { opened: true };
  }

  async listApplications(): Promise<OfficialApplicationSummary[]> {
    const body = await this.requestInPage(LIST_PATH, {
      method: 'POST',
      body: LIST_BODY,
      accountContext: true,
    });
    // Project each entry onto a small allowlisted summary in main — the raw
    // body never crosses IPC, and the nested DTO shape sits deeper than the
    // sanitizer's depth cap, so mapping must happen before sanitizing.
    const summaries = extractApplicationList(body)
      .map(toApplicationSummary)
      .filter((summary) => summary.id !== '');
    return sanitizeOfficialJson(summaries) as OfficialApplicationSummary[];
  }

  async getApplication(id: string): Promise<Record<string, unknown>> {
    const body = await this.requestInPage(
      `${DETAIL_BASE}/${encodeURIComponent(id)}`,
      { method: 'GET' },
    );
    const supportingDocumentsData = extractSupportingDocuments(body);
    const sanitized = sanitizeOfficialJson(body);
    if (typeof sanitized !== 'object' || sanitized === null || Array.isArray(sanitized)) {
      throw new ApiError(
        'UNEXPECTED_RESPONSE',
        'The official portal returned an unexpected application payload',
        false,
        0,
      );
    }
    return { ...(sanitized as Record<string, unknown>), supportingDocumentsData };
  }

  async findSlots(
    serviceId: number,
    providerId: number | string,
    startDate: string,
    daysAhead: number,
  ): Promise<OfficialSlot[]> {
    const daysBody = await this.requestInPage(
      `/appointment-management-service/external/public/findNonWorkingDays?${new URLSearchParams({
        serviceID: String(serviceId),
        providerID: String(providerId),
        startDate,
      })}`,
      { method: 'GET' },
    );
    const data = record(record(daysBody).data);
    const unavailable = new Set(array(data.localDates).map(String));
    const start = new Date(`${startDate}T00:00:00Z`);
    const maxEnd = typeof data.maxEndDate === 'string' ? data.maxEndDate : null;
    const days: string[] = [];
    for (let offset = 0; offset < daysAhead; offset += 1) {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + offset);
      const rendered = day.toISOString().slice(0, 10);
      if (maxEnd && rendered > maxEnd) break;
      if (!unavailable.has(rendered)) days.push(rendered);
    }
    const responses = await Promise.all(
      days.map(async (day) => {
        const body = await this.requestInPage(
          `/appointment-management-service/external/public/freeTimeSlots?${new URLSearchParams({
            serviceID: String(serviceId),
            providerID: String(providerId),
            startDate: day,
          })}`,
          { method: 'GET' },
        );
        return array(record(body).data).map((slot) => ({ day, slot: record(slot) }));
      }),
    );
    return responses.flat().flatMap(({ day, slot }) =>
      typeof slot.startTime === 'string' && typeof slot.endTime === 'string'
        ? [{ date: day, start_time: slot.startTime, end_time: slot.endTime }]
        : [],
    );
  }

  async reserveApplicationId(): Promise<string> {
    const body = record(
      await this.requestInPage('/process-state-controller/enrolment/sequences', { method: 'GET' }),
    );
    if (typeof body.applicationId !== 'string' || !body.applicationId) {
      throw new ApiError('UNEXPECTED_RESPONSE', 'The official portal did not return an application ID', false, 0);
    }
    return body.applicationId;
  }

  async submitApplication(payload: Record<string, unknown>): Promise<string> {
    const receipt = await this.requestInPage('/interface-adapter/reports/summary', {
      method: 'POST',
      body: payload,
    });
    await this.requestInPage('/process-state-controller/public/applications', {
      method: 'POST',
      body: payload,
    });
    if (typeof receipt !== 'string') {
      throw new ApiError('UNEXPECTED_RESPONSE', 'The official portal did not return a receipt', false, 0);
    }
    return receipt;
  }

  async refreshReceipt(payload: Record<string, unknown>): Promise<string> {
    const receipt = await this.requestInPage('/interface-adapter/reports/summary', {
      method: 'POST',
      body: payload,
    });
    if (typeof receipt !== 'string') {
      throw new ApiError('UNEXPECTED_RESPONSE', 'The official portal did not return a receipt', false, 0);
    }
    return receipt;
  }

  async bookAppointment(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return record(
      await this.requestInPage('/appointment-management-service/v1/external/public', {
        method: 'POST',
        body: payload,
      }),
    );
  }

  async appointmentRecords(applicationId: string): Promise<Record<string, unknown>[]> {
    const body = await this.requestInPage(
      `/appointment-management-service/v1/external/public/search?${new URLSearchParams({
        applicationId,
        page: '1',
        sizePerPage: '20',
        sortName: 'date',
        ascending: 'false',
      })}`,
      { method: 'GET' },
    );
    const value = record(body).data ?? body;
    return array(value).map(record);
  }

  async cancelAppointment(applicationId: string): Promise<Record<string, unknown>> {
    return record(
      await this.requestInPage(
        '/appointment-management-service/v1/external/public/cancelAppointment',
        { method: 'POST', body: { appointmentId: applicationId } },
      ),
    );
  }

  async close(): Promise<{ closed: true }> {
    const win = this.window;
    this.window = null;
    if (win && !win.isDestroyed()) {
      await this.clearSession(win.webContents.session);
      // 'closed' fires here and wipes again — harmless (best-effort).
      win.close();
    }
    return { closed: true };
  }

  private async requestInPage(path: string, init: PageFetchInit): Promise<unknown> {
    const win = this.window;
    if (!win || win.isDestroyed()) {
      throw new ApiError(
        'OFFICIAL_WINDOW_CLOSED',
        'The official portal window is closed — open it again to continue',
        false,
        0,
      );
    }
    let result: PageFetchResult | undefined;
    try {
      // If the page is mid-navigation (e.g. a redirect right after login),
      // executeJavaScript can stay pending indefinitely — wait for the page
      // to settle, then cap the execution with a hard timeout.
      const settleDeadline = Date.now() + PAGE_SETTLE_TIMEOUT_MS;
      while (!win.isDestroyed() && win.webContents.isLoading()) {
        if (Date.now() > settleDeadline) {
          throw new ApiError(
            'TIMEOUT',
            'The official portal page did not finish loading in time',
            true,
            0,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (win.isDestroyed()) {
        throw new ApiError(
          'OFFICIAL_WINDOW_CLOSED',
          'The official portal window is closed — open it again to continue',
          false,
          0,
        );
      }
      result = (await Promise.race([
        win.webContents.executeJavaScript(buildPageFetchScript(path, init), true),
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () =>
              reject(
                new ApiError(
                  'TIMEOUT',
                  'The official portal did not respond in time',
                  true,
                  0,
                ),
              ),
            EXECUTE_TIMEOUT_MS,
          );
        }),
      ])) as PageFetchResult | undefined;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // The page context vanished mid-request (navigation or crash).
      throw new ApiError(
        'UNEXPECTED_RESPONSE',
        'The official portal page became unavailable — retry',
        true,
        0,
      );
    }
    const error = pageResultError(result ?? { status: 0, error: 'network' });
    if (error) throw error;
    return result?.body;
  }

  // Best-effort wipe of everything the throwaway partition stored.
  private async clearSession(ses: Session | null): Promise<void> {
    if (!ses) return;
    try {
      await ses.clearStorageData();
    } catch {
      // best effort
    }
    try {
      await ses.clearCache();
    } catch {
      // best effort
    }
    try {
      await ses.clearAuthCache();
    } catch {
      // best effort
    }
  }

  private notify(state: OfficialImportStateEvent['state'], host?: string): void {
    const mainWindow = this.deps.getWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const contents = mainWindow.webContents;
    // The renderer frame can be gone even when the window object is not
    // (renderer crash, reload, GPU/network-service failure). Sending then
    // throws "Render frame was disposed" — a state notification must never
    // take down the main process.
    if (contents.isDestroyed() || contents.isCrashed()) return;
    const event: OfficialImportStateEvent = { type: 'official-import-state', state };
    if (host !== undefined) event.host = host;
    try {
      contents.send('official-import-state', event);
    } catch {
      // Frame disposed mid-send — state events are best-effort.
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Single shared session, mirroring how index.ts owns the main window. The
// before-quit wipe is registered once, the first time the session is needed.
let sharedSession: OfficialImportSession | null = null;
let quitWipeRegistered = false;

export function getOfficialImportSession(deps: OfficialImportDeps): OfficialImportSession {
  if (!sharedSession) sharedSession = new OfficialImportSession(deps);
  if (!quitWipeRegistered) {
    quitWipeRegistered = true;
    app.on('before-quit', () => {
      void sharedSession?.close();
    });
  }
  return sharedSession;
}
