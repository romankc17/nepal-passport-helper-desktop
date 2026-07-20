import { net } from 'electron';
import type {
  ActivityItem,
  ActivityQuery,
  ApiEnvelope,
  Appointment,
  AppointmentListQuery,
  BookNowInput,
  BookNowResult,
  ClientDetail,
  ClientListQuery,
  ClientSummary,
  LocationItem,
  LocationKind,
  LoginResult,
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
  WatcherSettingsPatch,
} from '../shared/types';
import type { Vault } from './vault';

const API_PREFIX = '/api/desktop/v1';
const REQUEST_TIMEOUT_MS = 30000;

// Error codes that mean "do not retry this watcher until a human intervenes".
export const PERMANENT_ERROR_CODES = new Set([
  'PERMISSION_DENIED',
  'LOCATION_NOT_PERMITTED',
  'CLIENT_NOT_READY',
  'VALIDATION_ERROR',
  'NOT_FOUND',
]);

export const AUTH_EXPIRED_CODES = new Set(['TOKEN_EXPIRED', 'DEVICE_REVOKED', 'AUTH_FAILED']);

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  getBaseUrl: () => string;
  vault: Vault;
  deviceId: string;
  deviceName: string;
  onAuthExpired: () => void;
}

export class ApiClient {
  private refreshPromise: Promise<boolean> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  // --- Auth ---

  async login(username: string, password: string): Promise<LoginResult> {
    const result = await this.request<LoginResult>('POST', '/auth/login/', {
      username,
      password,
      device_id: this.options.deviceId,
      device_name: this.options.deviceName,
    });
    this.persistTokens(result.token);
    return result;
  }

  async refresh(): Promise<boolean> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<boolean> {
    const tokens = this.options.vault.loadTokens();
    if (!tokens) return false;
    try {
      const result = await this.request<LoginResult>(
        'POST',
        '/auth/refresh/',
        { refresh_token: tokens.refreshToken },
        { skipAuth: true, skipRefreshRetry: true },
      );
      this.persistTokens(result.token);
      return true;
    } catch (error) {
      if (error instanceof ApiError && AUTH_EXPIRED_CODES.has(error.code)) {
        this.options.vault.clear();
        this.options.onAuthExpired();
      }
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.request('POST', '/auth/logout/', {});
    } finally {
      this.options.vault.clear();
    }
  }

  async getSession(): Promise<SessionInfo | null> {
    const tokens = this.options.vault.loadTokens();
    if (!tokens) return null;
    const me = await this.me();
    return { user: me.user, access: me.access, defaults: me.defaults, offline: false };
  }

  async me(): Promise<MeResult> {
    return this.request<MeResult>('GET', '/me/');
  }

  async devicesRevoke(id: number): Promise<void> {
    await this.request('POST', `/devices/${id}/revoke/`, {});
  }

  // --- Locations ---

  async locations(kind: LocationKind, parent?: number | string): Promise<LocationItem[]> {
    const params = new URLSearchParams({ kind });
    if (parent !== undefined) params.set('parent', String(parent));
    const data = await this.request<{ items: LocationItem[] }>('GET', `/locations/?${params}`);
    return data.items;
  }

  // --- Clients ---

  async clientsList(query: ClientListQuery): Promise<Paged<ClientSummary>> {
    return this.request<Paged<ClientSummary>>('GET', `/clients/${queryString(query)}`);
  }

  async clientsGet(id: number): Promise<ClientDetail> {
    const data = await this.request<{ client: ClientDetail }>('GET', `/clients/${id}/`);
    return data.client;
  }

  async clientsReadyByLocation(): Promise<ReadyByLocationGroup[]> {
    const data = await this.request<{ locations: ReadyByLocationGroup[] }>(
      'GET',
      '/clients/ready-by-location/',
    );
    return data.locations;
  }

  // --- Queue & booking ---

  async queueAdd(input: QueueAddInput): Promise<QueueAddResult> {
    return this.request<QueueAddResult>('POST', '/queue/', input);
  }

  async queueRemove(bookingIds: number[]): Promise<QueueRemoveResult> {
    return this.request<QueueRemoveResult>('POST', '/queue/remove/', { booking_ids: bookingIds });
  }

  async bookNow(input: BookNowInput): Promise<BookNowResult> {
    return this.request<BookNowResult>('POST', '/book-now/', input);
  }

  async progress(bookingIds: number[]): Promise<ProgressItem[]> {
    const data = await this.request<{ items: ProgressItem[] }>(
      'GET',
      `/progress/?booking_ids=${bookingIds.join(',')}`,
    );
    return data.items;
  }

  // --- Watchers ---

  async watchersList(): Promise<Watcher[]> {
    const data = await this.request<{ items: Watcher[] }>('GET', '/watchers/');
    return data.items;
  }

  async watchersGet(id: number): Promise<WatcherDetail> {
    return this.request<WatcherDetail>('GET', `/watchers/${id}/`);
  }

  async watchersCreate(input: WatcherCreateInput): Promise<Watcher> {
    const data = await this.request<{ watcher: Watcher }>('POST', '/watchers/', input);
    return data.watcher;
  }

  async watchersUpdateSettings(id: number, patch: WatcherSettingsPatch): Promise<Watcher> {
    const data = await this.request<{ watcher: Watcher }>(
      'POST',
      `/watchers/${id}/settings/`,
      patch,
    );
    return data.watcher;
  }

  async watchersPause(id: number): Promise<Watcher> {
    const data = await this.request<{ watcher: Watcher }>('POST', `/watchers/${id}/pause/`, {});
    return data.watcher;
  }

  async watchersResume(id: number): Promise<Watcher> {
    const data = await this.request<{ watcher: Watcher }>('POST', `/watchers/${id}/resume/`, {});
    return data.watcher;
  }

  async watchersCheck(
    id: number,
    opts: { force?: boolean; slots?: string[] },
  ): Promise<WatcherCheckResult> {
    return this.request<WatcherCheckResult>('POST', `/watchers/${id}/check/`, opts);
  }

  async watchersDelete(id: number): Promise<void> {
    await this.request('DELETE', `/watchers/${id}/`);
  }

  async watchersReorder(id: number, bookingIds: number[]): Promise<void> {
    await this.request('POST', `/watchers/${id}/reorder-priority/`, { booking_ids: bookingIds });
  }

  async watchersHistory(id: number, page?: number): Promise<Paged<WatcherHistoryItem>> {
    const params = page !== undefined ? `?page=${page}` : '';
    return this.request<Paged<WatcherHistoryItem>>('GET', `/watchers/${id}/history/${params}`);
  }

  // --- Appointments ---

  async appointmentsList(query: AppointmentListQuery): Promise<Paged<Appointment>> {
    return this.request<Paged<Appointment>>('GET', `/appointments/${queryString(query)}`);
  }

  async appointmentsCancel(bookingId: number): Promise<void> {
    await this.request('POST', `/appointments/${bookingId}/cancel/`, {});
  }

  async appointmentsReceipt(bookingId: number): Promise<ReceiptResult> {
    return this.request<ReceiptResult>('GET', `/appointments/${bookingId}/receipt/`);
  }

  async appointmentsReconcile(clientIds?: number[]): Promise<ReconcileResult> {
    return this.request<ReconcileResult>('POST', '/appointments/reconcile/', {
      client_ids: clientIds,
    });
  }

  // --- Activity ---

  async activityList(query: ActivityQuery): Promise<Paged<ActivityItem>> {
    return this.request<Paged<ActivityItem>>('GET', `/activity/${queryString(query)}`);
  }

  // --- Preferences ---

  async preferencesGet(): Promise<Preferences> {
    return this.request<Preferences>('GET', '/preferences/');
  }

  async preferencesUpdate(patch: PreferencesPatch): Promise<Preferences> {
    return this.request<Preferences>('POST', '/preferences/', patch);
  }

  // --- Overview ---

  async overview(): Promise<Overview> {
    return this.request<Overview>('GET', '/overview/');
  }

  // --- Transport ---

  private persistTokens(token: LoginResult['token']): void {
    const now = Date.now();
    this.options.vault.saveTokens({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessExpiresAt: now + token.access_expires_in * 1000,
      refreshExpiresAt: now + token.refresh_expires_in * 1000,
    });
  }

  private buildUrl(path: string): string {
    const base = this.options.getBaseUrl().replace(/\/+$/, '');
    return `${base}${API_PREFIX}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { skipAuth?: boolean; skipRefreshRetry?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (!opts.skipAuth) {
      const tokens = this.options.vault.loadTokens();
      if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
    }

    let response: Response;
    try {
      response = await net.fetch(this.buildUrl(path), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Never include request headers here — Authorization must not leak.
      const detail = error instanceof Error ? error.message : 'network failure';
      throw new ApiError('NETWORK_ERROR', `Cannot reach the server (${detail})`, true, 0);
    }

    let envelope: ApiEnvelope<T> | null = null;
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      envelope = null;
    }

    if (response.ok && envelope?.ok && envelope.data !== null) {
      return envelope.data;
    }

    const shape = envelope?.error;
    const code = shape?.code ?? (response.status >= 500 ? 'SERVER_ERROR' : 'UNKNOWN_ERROR');
    const message = shape?.message ?? `Request failed with HTTP ${response.status}`;
    const retryable = shape?.retryable ?? response.status >= 500;

    if (
      response.status === 401 &&
      !opts.skipAuth &&
      !opts.skipRefreshRetry &&
      AUTH_EXPIRED_CODES.has(code)
    ) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return this.request<T>(method, path, body, { ...opts, skipRefreshRetry: true });
      }
      this.options.onAuthExpired();
      throw new ApiError(code, message, false, response.status);
    }

    throw new ApiError(code, message, retryable, response.status);
  }
}

function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : '';
}
