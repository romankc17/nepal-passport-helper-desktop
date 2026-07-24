// TypeScript port of the backend's appointments/passport_api.py slot-check and
// booking calls. All requests use the official portal's anonymous "free"
// access token — no user credential is ever involved. Pure module (no Electron
// imports): index.ts wires electron.net.fetch in, tests inject a mock.

export type OfficialErrorKind = 'captcha' | 'gateway' | 'http' | 'transport' | 'not-confirmed';

export class OfficialApiError extends Error {
  constructor(
    readonly kind: OfficialErrorKind,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'OfficialApiError';
  }
}

export interface OfficialSlot {
  startTime: string;
  endTime?: string;
  [key: string]: unknown;
}

export interface FoundOfficialSlot {
  date: string;
  start_time: string;
  end_time: string;
}

export interface BookAppointmentInput {
  applicationId: string;
  providerId: number | string;
  providerName: string;
  /** District id, or the foreign-mission location id ("307"). */
  locationId: number | string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  startTime: string;
  phone: string;
  email: string;
  applicantName: string;
  serviceId: number | string;
  serviceName: string;
}

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<Response>;

export interface OfficialApiOptions {
  fetchFn: FetchLike;
  /** Official portal origin. Defaults to the production portal. */
  origin?: string;
  /** Free-token cache lifetime in seconds (backend uses 300; we renew a bit earlier). */
  sessionSeconds?: number;
  now?: () => number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ORIGIN = 'https://online.nepalpassport.gov.np';
const USER_AGENT = 'Local-Nepal-Passport-Appointment-Helper/0.1';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 120_000;
const SLOT_CHECK_CONCURRENCY = 3;

export class OfficialApi {
  private token: string | null = null;
  private tokenFetchedAt = 0;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly options: OfficialApiOptions) {}

  private get origin(): string {
    return (this.options.origin ?? DEFAULT_ORIGIN).replace(/\/+$/, '');
  }

  private get amsBase(): string {
    return `${this.origin}/appointment-management-service`;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private sleep(ms: number): Promise<void> {
    if (this.options.sleep) return this.options.sleep(ms);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Anonymous portal token, cached in memory only. Single-flight refresh. */
  async getFreeToken(force = false): Promise<string> {
    const sessionMs = (this.options.sessionSeconds ?? 280) * 1000;
    if (!force && this.token && this.now() - this.tokenFetchedAt < sessionMs) {
      return this.token;
    }
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.fetchFreeToken().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  async refreshToken(): Promise<void> {
    this.token = null;
    this.tokenFetchedAt = 0;
    await this.getFreeToken(true);
  }

  private async fetchFreeToken(): Promise<string> {
    const url = `${this.origin}/interface-adapter/get-free-access-token`;
    let response: Response;
    try {
      response = await this.options.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ATK: 'jwt', RTK: 'rtk', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new OfficialApiError(
        'transport',
        `Could not reach the passport service (${error instanceof Error ? error.message : 'network failure'})`,
      );
    }
    const content = await response.text();
    assertNotCaptcha(content);
    if (!response.ok) {
      throw new OfficialApiError(
        'http',
        `Could not obtain the official anonymous access token (HTTP ${response.status})`,
        response.status,
      );
    }
    try {
      const parsed = JSON.parse(content) as { token?: string };
      if (typeof parsed.token !== 'string' || !parsed.token) throw new Error('missing token');
      this.token = parsed.token;
      this.tokenFetchedAt = this.now();
      return parsed.token;
    } catch {
      throw new OfficialApiError('http', 'The passport service did not return an access token.');
    }
  }

  /** Working days between startDate (YYYY-MM-DD) and startDate + daysAhead - 1. */
  async candidateDates(
    serviceId: number | string,
    providerId: number | string,
    startDate: string,
    daysAhead: number,
  ): Promise<string[]> {
    const result = (await this.request('external/public/findNonWorkingDays', {
      base: 'ams',
      params: { serviceID: serviceId, providerID: providerId, startDate },
    })) as { data?: { localDates?: string[]; maxEndDate?: string } };
    const data = result?.data ?? {};
    const unavailable = new Set(data.localDates ?? []);
    const start = Date.parse(`${startDate}T00:00:00Z`);
    if (Number.isNaN(start)) throw new OfficialApiError('http', `Invalid start date "${startDate}".`);
    let end = start + (daysAhead - 1) * DAY_MS;
    if (data.maxEndDate) {
      const max = Date.parse(`${data.maxEndDate}T00:00:00Z`);
      if (!Number.isNaN(max)) end = Math.min(end, max);
    }
    const days: string[] = [];
    for (let day = start; day <= end; day += DAY_MS) {
      const iso = new Date(day).toISOString().slice(0, 10);
      if (!unavailable.has(iso)) days.push(iso);
    }
    return days;
  }

  async freeSlots(
    serviceId: number | string,
    providerId: number | string,
    day: string,
  ): Promise<OfficialSlot[]> {
    const result = (await this.request('external/public/freeTimeSlots', {
      base: 'ams',
      params: { serviceID: serviceId, providerID: providerId, startDate: day },
    })) as { data?: OfficialSlot[] };
    return Array.isArray(result?.data) ? result.data : [];
  }

  async findSlots(
    serviceId: number | string,
    providerId: number | string,
    startDate: string,
    daysAhead: number,
  ): Promise<FoundOfficialSlot[]> {
    const days = await this.candidateDates(serviceId, providerId, startDate, daysAhead);
    const slots: { day: string; slots: OfficialSlot[] }[] = [];
    for (let index = 0; index < days.length; index += SLOT_CHECK_CONCURRENCY) {
      slots.push(...await Promise.all(
        days.slice(index, index + SLOT_CHECK_CONCURRENCY).map(async (day) => ({
          day,
          slots: await this.freeSlots(serviceId, providerId, day),
        })),
      ));
    }
    return slots.flatMap(({ day, slots: daySlots }) =>
      daySlots.flatMap((slot) =>
        typeof slot.startTime === 'string' && typeof slot.endTime === 'string'
          ? [{ date: day, start_time: slot.startTime, end_time: slot.endTime }]
          : [],
      ),
    );
  }

  /**
   * Book one appointment. Never retried: a dropped POST may have landed
   * server-side, so callers recover via the backend reconcile endpoint
   * (which adopts the official SCHEDULED record) instead of re-posting.
   */
  async bookAppointment(input: BookAppointmentInput): Promise<Record<string, unknown>> {
    const result = await this.request('v1/external/public', {
      base: 'ams',
      payload: {
        appointmentId: input.applicationId,
        providerID: input.providerId,
        startTime: input.startTime,
        date: input.date,
        applicationID: input.applicationId,
        serviceID: input.serviceId,
        phone: input.phone,
        email: input.email,
        applicantUsername: input.applicantName,
        applicantName: input.applicantName,
        serviceName: input.serviceName,
        providerName: input.providerName,
        preferredNotificationChannel: 'PHONE_EMAIL',
        accountMode: 'PUBLIC',
        locationID: String(input.locationId),
      },
    });
    if (typeof result !== 'object' || result === null || !('id' in result) || !result.id) {
      throw new OfficialApiError(
        'not-confirmed',
        'The passport service did not confirm the appointment ID.',
      );
    }
    return result as Record<string, unknown>;
  }

  async reserveApplicationId(): Promise<string> {
    const result = (await this.request('process-state-controller/enrolment/sequences', {
      base: 'host',
    })) as { applicationId?: string };
    if (typeof result?.applicationId !== 'string' || !result.applicationId) {
      throw new OfficialApiError('http', 'The passport service did not return an application ID.');
    }
    return result.applicationId;
  }

  /** Required before the enrolment POST; returns the base64 receipt PDF. */
  async fetchSummaryReceipt(payload: Record<string, unknown>): Promise<string> {
    const result = await this.request('interface-adapter/reports/summary', { base: 'host', payload });
    if (typeof result !== 'string' || !result) {
      throw new OfficialApiError('http', 'The passport service did not return a receipt.');
    }
    return result;
  }

  async submitEnrolment(payload: Record<string, unknown>): Promise<void> {
    await this.request('process-state-controller/public/applications', { base: 'host', payload });
  }

  async submitApplication(payload: Record<string, unknown>): Promise<string> {
    const receipt = await this.fetchSummaryReceipt(payload);
    await this.submitEnrolment(payload);
    return receipt;
  }

  async refreshReceipt(payload: Record<string, unknown>): Promise<string> {
    return this.fetchSummaryReceipt(payload);
  }

  async appointmentRecords(applicationId: string): Promise<Record<string, unknown>[]> {
    const result = await this.request('v1/external/public/search', {
      base: 'ams',
      params: {
        applicationId,
        page: 1,
        sizePerPage: 20,
        sortName: 'date',
        ascending: 'false',
      },
    });
    const records =
      typeof result === 'object' && result !== null && !Array.isArray(result)
        ? (result as { data?: unknown }).data
        : result;
    return Array.isArray(records)
      ? records.filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null && !Array.isArray(item),
        )
      : [];
  }

  async cancelAppointment(applicationId: string): Promise<Record<string, unknown>> {
    const result = await this.request('v1/external/public/cancelAppointment', {
      base: 'ams',
      payload: { appointmentId: applicationId },
    });
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new OfficialApiError('http', 'The passport service returned an invalid cancellation response.');
    }
    return result as Record<string, unknown>;
  }

  // --- Transport ------------------------------------------------------------

  private async request(
    path: string,
    opts: { base: 'ams' | 'host'; params?: Record<string, string | number>; payload?: unknown },
  ): Promise<unknown> {
    const base = opts.base === 'ams' ? this.amsBase : this.origin;
    let url = `${base}/${path.replace(/^\/+/, '')}`;
    if (opts.params) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.params)) params.set(key, String(value));
      url = `${url}?${params.toString()}`;
    }
    // The government gateway occasionally drops connections mid-request. Reads
    // are retried; writes are not — a dropped POST may have landed.
    const attempts = opts.payload !== undefined ? 1 : 3;
    for (let dropped = 0; dropped < attempts; dropped++) {
      try {
        return await this.authedAttempt(url, opts.payload);
      } catch (error) {
        if (error instanceof OfficialApiError && error.kind === 'transport' && dropped + 1 < attempts) {
          await this.sleep(500 * (dropped + 1));
          continue;
        }
        throw error;
      }
    }
    throw new OfficialApiError('transport', 'Passport service request failed.');
  }

  private async authedAttempt(url: string, payload: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getFreeToken(attempt > 0);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      };
      if (payload !== undefined) headers['Content-Type'] = 'application/json';
      let response: Response;
      try {
        response = await this.options.fetchFn(url, {
          method: payload !== undefined ? 'POST' : 'GET',
          headers,
          body: payload !== undefined ? JSON.stringify(payload) : undefined,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch (error) {
        throw new OfficialApiError(
          'transport',
          `Passport service request failed (${error instanceof Error ? error.message : 'network failure'})`,
        );
      }
      const content = await response.text();
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok) {
        if (content.includes('enable JavaScript and cookies') || content.includes('specified URL cannot be found')) {
          throw new OfficialApiError(
            'gateway',
            'The government security gateway rejected the request. Try again later.',
            response.status,
          );
        }
        assertNotCaptcha(content);
        throw new OfficialApiError(
          'http',
          `Passport service returned HTTP ${response.status}: ${content.slice(0, 500)}`,
          response.status,
        );
      }
      try {
        return JSON.parse(content) as unknown;
      } catch {
        assertNotCaptcha(content);
        return content;
      }
    }
    throw new OfficialApiError('http', 'The passport service rejected the access token.', 401);
  }
}

function assertNotCaptcha(content: string): void {
  if (content.includes('captcha_resp') || content.includes('User validation required')) {
    throw new OfficialApiError(
      'captcha',
      'The passport service demands CAPTCHA verification (error 421). Try again later.',
    );
  }
}
