// In-memory mock of the Desktop API v1 contract (docs/API-CONTRACT.md).
// Used by Playwright e2e tests and the screenshot capture script — never by
// the app itself. Scenarios are switched via POST /__scenario__.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Scenario =
  | 'normal'
  | 'no_slots'
  | 'one_slot'
  | 'multi_slot'
  | 'time_slot_not_available'
  | 'captcha_421'
  | 'expired_auth'
  | 'network_timeout'
  | 'partial_success'
  | 'booking_success'
  | 'cancel_success'
  | 'cancel_failure'
  | 'receipt_unavailable';

interface MockBooking {
  id: number;
  client_id: number;
  client_name: string;
  watcher_id: number;
  provider_id: number;
  provider_name: string;
  status: 'pending' | 'failed' | 'booked' | 'cancelled';
  stage: 'submitting' | 'booking' | 'booked' | 'failed' | null;
  date: string | null;
  start_time: string | null;
  error: string | null;
  idempotency_key: string;
  official_application_id: string;
  appointment_code: number | null;
  booked_at: string | null;
  cancelled_at: string | null;
  booked_by_system: boolean;
  receipt_available: boolean;
}

interface MockWatcher {
  id: number;
  name: string;
  mode: 'notify' | 'book';
  province_id: string | number;
  district_id: string | number;
  provider_id: number;
  provider_name: string;
  district_name: string;
  interval_seconds: number;
  days_ahead: number;
  desired_bookings: number;
  notify: boolean;
  active: boolean;
  last_checked_at: string | null;
  next_check_due_at: string | null;
  last_error: string;
  available_slots: { date: string; start_time: string; end_time: string }[];
  created_at: string;
}

interface MockClient {
  id: number;
  full_name: string;
  application_type: string;
  status: string;
  desktop_status: string;
  can_book: boolean;
  official_application_id: string;
  provider_id: number;
  provider_name: string;
  district_name: string;
  phone: string;
  email: string;
  missing_document_count: number;
  queued_booking_id: number | null;
  appointment: { date: string; start_time: string } | null;
  created_by: string;
  document_requirements: { type: string; label: string; required: boolean; present: boolean }[];
}

const NO_SLOT_MESSAGE = 'No slot is currently available. The clients remain queued.';
const RECEIPT_PDF_BASE64 = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
).toString('base64');

export class MockServer {
  private server: http.Server;
  private scenario: Scenario = 'normal';
  private requestCounter = 0;
  private nextBookingId = 500;
  private nextWatcherId = 90;
  private readonly bookings: MockBooking[] = [];
  private readonly watchers: MockWatcher[] = [];
  private readonly clients: MockClient[] = [];
  private readonly activity: Record<string, unknown>[] = [];
  private readonly checkHistory: Record<string, unknown>[] = [];
  private readonly idempotentResponses = new Map<string, unknown>();
  readonly idempotencyKeysSeen: string[] = [];
  private preferences = {
    notifications_enabled: true,
    sound_enabled: true,
    email_on_booking: false,
    email_address: '',
  };

  constructor() {
    this.seed();
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        resolve((this.server.address() as AddressInfo).port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  setScenario(scenario: Scenario): void {
    this.scenario = scenario;
  }

  bookingCount(): number {
    return this.bookings.length;
  }

  bookedCount(): number {
    return this.bookings.filter((booking) => booking.status === 'booked').length;
  }

  private seed(): void {
    this.watchers.push({
      id: 88,
      name: 'Rupandehi',
      mode: 'book',
      province_id: '226',
      district_id: '280',
      provider_id: 501,
      provider_name: 'Rupandehi',
      district_name: 'Rupandehi/रुपन्देही',
      interval_seconds: 3600,
      days_ahead: 7,
      desired_bookings: 5,
      notify: true,
      active: true,
      last_checked_at: null,
      next_check_due_at: null,
      last_error: '',
      available_slots: [],
      created_at: new Date().toISOString(),
    });

    const docs = (missing: number) => [
      {
        type: 'citizenshipCertificate',
        label: 'Citizenship certificate (both sides)',
        required: true,
        present: missing === 0,
      },
      { type: 'nationalEID', label: 'National eID', required: false, present: true },
    ];

    this.clients.push(
      { id: 101, full_name: 'RAM BAHADUR', application_type: 'First issuance (new)', status: 'ready', desktop_status: 'ready', can_book: true, official_application_id: '', provider_id: 501, provider_name: 'Rupandehi', district_name: 'Rupandehi/रुपन्देही', phone: '+9779841000001', email: '', missing_document_count: 0, queued_booking_id: null, appointment: null, created_by: 'admin', document_requirements: docs(0) },
      { id: 102, full_name: 'SITA KUMARI', application_type: 'Passport renewal', status: 'ready', desktop_status: 'ready', can_book: true, official_application_id: '', provider_id: 501, provider_name: 'Rupandehi', district_name: 'Rupandehi/रुपन्देही', phone: '+9779841000002', email: '', missing_document_count: 0, queued_booking_id: null, appointment: null, created_by: 'admin', document_requirements: docs(0) },
      { id: 103, full_name: 'Hari Prasad', application_type: 'First issuance (new)', status: 'ready', desktop_status: 'ready', can_book: true, official_application_id: '', provider_id: 544, provider_name: 'Department of Passports', district_name: 'Kathmandu/काठमाडौं', phone: '+9779841000003', email: '', missing_document_count: 0, queued_booking_id: null, appointment: null, created_by: 'admin', document_requirements: docs(0) },
      { id: 104, full_name: 'Gita Sharma', application_type: 'Replacement (lost/stolen)', status: 'fresh', desktop_status: 'incomplete', can_book: false, official_application_id: '', provider_id: 501, provider_name: 'Rupandehi', district_name: 'Rupandehi/रुपन्देही', phone: '', email: '', missing_document_count: 1, queued_booking_id: null, appointment: null, created_by: 'admin', document_requirements: docs(1) },
      { id: 105, full_name: 'Bikash Thapa', application_type: 'First issuance (new)', status: 'ready', desktop_status: 'ready', can_book: true, official_application_id: '', provider_id: 501, provider_name: 'Rupandehi', district_name: 'Rupandehi/रुपन्देही', phone: '+9779841000005', email: '', missing_document_count: 0, queued_booking_id: null, appointment: null, created_by: 'admin', document_requirements: docs(0) },
    );
  }

  private addActivity(
    type: string,
    status: string,
    message: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.activity.unshift({
      id: `${type}-${this.activity.length + 1}`,
      type,
      at: new Date().toISOString(),
      duration_ms: 1200,
      actor: 'admin',
      device: 'e2e-runner',
      provider_id: extra.provider_id ?? null,
      provider_name: extra.provider_name ?? null,
      client_id: extra.client_id ?? null,
      client_name: extra.client_name ?? null,
      status,
      message,
      request_id: `mock-${this.requestCounter}`,
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const body = await readBody(req);

    // Control endpoint — not part of the contract.
    if (path === '/__scenario__' && req.method === 'POST') {
      this.setScenario((JSON.parse(body || '{}') as { name: Scenario }).name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }

    if (!path.startsWith('/api/desktop/v1/')) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (this.scenario === 'network_timeout') {
      return; // never respond — simulates a hung network
    }

    const route = path.slice('/api/desktop/v1'.length);

    if (route === '/auth/login/' && req.method === 'POST') {
      const credentials = JSON.parse(body || '{}') as { username?: string; password?: string };
      if (credentials.password === 'wrong') {
        return this.fail(res, 401, 'AUTH_FAILED', 'Invalid username or password.', false);
      }
      return this.ok(res, this.tokenPayload());
    }

    if (route === '/auth/refresh/' && req.method === 'POST') {
      if (this.scenario === 'expired_auth') {
        return this.fail(res, 401, 'TOKEN_EXPIRED', 'Refresh token expired.', false);
      }
      return this.ok(res, this.tokenPayload());
    }

    // Everything below requires a bearer token.
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer mock-access') || this.scenario === 'expired_auth') {
      return this.fail(res, 401, 'TOKEN_EXPIRED', 'Access token expired.', false);
    }

    try {
      await this.route(req.method ?? 'GET', route, url, body, res);
    } catch (error) {
      this.fail(
        res,
        500,
        'SERVER_ERROR',
        error instanceof Error ? error.message : 'mock error',
        true,
      );
    }
  }

  private tokenPayload(): Record<string, unknown> {
    this.requestCounter++;
    return {
      token: {
        access_token: `mock-access-${this.requestCounter}`,
        access_expires_in: 3600,
        refresh_token: `mock-refresh-${this.requestCounter}`,
        refresh_expires_in: 86400,
      },
      user: { id: 1, username: 'admin', is_staff: true },
      access: {
        mode: 'providers',
        providers: [
          { id: 501, name: 'Rupandehi' },
          { id: 544, name: 'Department of Passports' },
        ],
      },
      defaults: { interval_seconds: 300 },
    };
  }

  private async route(
    method: string,
    route: string,
    url: URL,
    body: string,
    res: http.ServerResponse,
  ): Promise<void> {
    const json = body ? (JSON.parse(body) as Record<string, unknown>) : {};

    if (route === '/auth/logout/' && method === 'POST') return this.ok(res, { signed_out: true });

    if (route === '/me/' && method === 'GET') {
      return this.ok(res, {
        user: { id: 1, username: 'admin', is_staff: true },
        access: {
          mode: 'providers',
          providers: [
            { id: 501, name: 'Rupandehi' },
            { id: 544, name: 'Department of Passports' },
          ],
        },
        defaults: { interval_seconds: 300 },
        devices: [
          { id: 1, name: 'e2e-runner', device_id: 'mock-device', last_seen_at: new Date().toISOString(), current: true },
          { id: 2, name: 'old-laptop', device_id: 'mock-device-2', last_seen_at: new Date(Date.now() - 86400000).toISOString(), current: false },
        ],
      });
    }

    const deviceMatch = route.match(/^\/devices\/(\d+)\/revoke\/$/);
    if (deviceMatch && method === 'POST') return this.ok(res, { revoked: true });

    if (route === '/locations/' && method === 'GET') {
      const kind = url.searchParams.get('kind');
      const parent = url.searchParams.get('parent');
      if (kind === 'provinces') {
        return this.ok(res, {
          items: [
            { id: '225', name: 'Bagmati/बागमती' },
            { id: '226', name: 'Lumbini/लुम्बिनी' },
          ],
        });
      }
      if (kind === 'districts' && parent === '225') {
        return this.ok(res, { items: [{ id: '264', name: 'Kathmandu/काठमाडौं' }] });
      }
      if (kind === 'districts' && parent === '226') {
        return this.ok(res, { items: [{ id: '280', name: 'Rupandehi/रुपन्देही' }] });
      }
      if (kind === 'providers' && parent === '264') {
        return this.ok(res, { items: [{ id: 544, name: 'Department of Passports' }] });
      }
      if (kind === 'providers' && parent === '280') {
        return this.ok(res, { items: [{ id: 501, name: 'Rupandehi' }] });
      }
      return this.fail(res, 400, 'VALIDATION_ERROR', 'Choose a valid location lookup.', false);
    }

    if (route === '/clients/' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const status = url.searchParams.get('status') ?? '';
      const type = url.searchParams.get('application_type') ?? '';
      const provider = url.searchParams.get('provider_id') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('page_size') ?? '25');
      let items = this.clients.map(({ document_requirements: _docs, ...summary }) => summary);
      if (q) items = items.filter((client) => client.full_name.toLowerCase().includes(q));
      if (status) items = items.filter((client) => client.desktop_status === status);
      if (type) items = items.filter((client) => client.application_type === type);
      if (provider) items = items.filter((client) => String(client.provider_id) === provider);
      const start = (page - 1) * pageSize;
      return this.ok(res, {
        items: items.slice(start, start + pageSize),
        page,
        page_size: pageSize,
        total: items.length,
      });
    }

    const clientMatch = route.match(/^\/clients\/(\d+)\/$/);
    if (clientMatch && method === 'GET') {
      const client = this.clients.find((entry) => entry.id === Number(clientMatch[1]));
      if (!client) return this.fail(res, 404, 'NOT_FOUND', 'Client not found.', false);
      const active = this.bookings.find(
        (booking) => booking.client_id === client.id && booking.status === 'booked',
      );
      return this.ok(res, { client: { ...client, active_booking: active ?? null } });
    }

    if (route === '/clients/ready-by-location/' && method === 'GET') {
      const ready = this.clients.filter(
        (client) => client.can_book && client.missing_document_count === 0,
      );
      const byProvider = new Map<number, MockClient[]>();
      for (const client of ready) {
        const group = byProvider.get(client.provider_id) ?? [];
        group.push(client);
        byProvider.set(client.provider_id, group);
      }
      return this.ok(res, {
        locations: [...byProvider.entries()].map(([providerId, clients]) => ({
          provider_id: providerId,
          provider_name: clients[0].provider_name,
          district_name: clients[0].district_name,
          clients: clients.map(({ document_requirements: _docs, ...summary }) => summary),
        })),
      });
    }

    if (route === '/queue/' && method === 'POST') {
      const key = String(json.idempotency_key ?? '');
      const cached = this.idempotentResponses.get(`queue:${key}`);
      if (cached) return this.ok(res, cached);
      const watcher = this.ensureWatcher(json);
      const queued: { client_id: number; booking_id: number }[] = [];
      const skipped: { client_id: number; reason: string }[] = [];
      for (const clientId of json.client_ids as number[]) {
        const client = this.clients.find((entry) => entry.id === clientId);
        if (!client) {
          skipped.push({ client_id: clientId, reason: 'Client not found' });
          continue;
        }
        if (
          this.bookings.some(
            (booking) =>
              booking.client_id === clientId &&
              (booking.status === 'pending' || booking.status === 'booked'),
          )
        ) {
          skipped.push({ client_id: clientId, reason: 'Already queued' });
          continue;
        }
        const booking = this.newBooking(client, watcher.id, key);
        queued.push({ client_id: clientId, booking_id: booking.id });
        client.queued_booking_id = booking.id;
      }
      const payload = { watcher: this.watcherJson(watcher), queued, skipped };
      this.idempotentResponses.set(`queue:${key}`, payload);
      return this.ok(res, payload);
    }

    if (route === '/queue/remove/' && method === 'POST') {
      const removed: number[] = [];
      const skipped: { booking_id: number; reason: string }[] = [];
      for (const bookingId of json.booking_ids as number[]) {
        const index = this.bookings.findIndex((booking) => booking.id === bookingId);
        const booking = this.bookings[index];
        if (!booking || (booking.status !== 'pending' && booking.status !== 'failed')) {
          skipped.push({
            booking_id: bookingId,
            reason: 'Only pending or failed bookings can be removed',
          });
          continue;
        }
        this.bookings.splice(index, 1);
        const client = this.clients.find((entry) => entry.id === booking.client_id);
        if (client) client.queued_booking_id = null;
        removed.push(bookingId);
      }
      return this.ok(res, { removed, skipped });
    }

    if (route === '/book-now/' && method === 'POST') {
      const key = String(json.idempotency_key ?? '');
      const cached = this.idempotentResponses.get(`book-now:${key}`);
      if (cached) return this.ok(res, cached);
      const watcher = this.ensureWatcher(json);
      const results: Record<string, unknown>[] = [];
      for (const clientId of json.client_ids as number[]) {
        const client = this.clients.find((entry) => entry.id === clientId);
        if (!client) continue;
        let booking = this.bookings.find(
          (entry) => entry.client_id === clientId && entry.status === 'pending',
        );
        if (!booking) booking = this.newBooking(client, watcher.id, key);
        booking.stage = 'booking';
        results.push(this.bookOutcome(booking, clientId, results.length));
      }
      const payload = { watcher: this.watcherJson(watcher), results };
      this.idempotentResponses.set(`book-now:${key}`, payload);
      // Give the UI's progress polling a window to observe intermediate stages.
      await new Promise((resolve) => setTimeout(resolve, 700));
      return this.ok(res, payload);
    }

    if (route === '/progress/' && method === 'GET') {
      const ids = (url.searchParams.get('booking_ids') ?? '')
        .split(',')
        .filter(Boolean)
        .map(Number);
      return this.ok(res, {
        items: ids.map((id) => {
          const booking = this.bookings.find((entry) => entry.id === id);
          return { booking_id: id, stage: booking?.stage ?? null, meta: {} };
        }),
      });
    }

    if (route === '/watchers/' && method === 'GET') {
      return this.ok(res, { items: this.watchers.map((watcher) => this.watcherJson(watcher)) });
    }

    if (route === '/watchers/' && method === 'POST') {
      const watcher: MockWatcher = {
        id: this.nextWatcherId++,
        name: String(json.provider_name ?? 'Watcher'),
        mode: (json.mode as 'notify' | 'book') ?? 'book',
        province_id: json.province_id as string,
        district_id: json.district_id as string,
        provider_id: Number(json.provider_id),
        provider_name: String(json.provider_name ?? ''),
        district_name: '',
        interval_seconds: Number(json.interval_seconds ?? 3600),
        days_ahead: Number(json.days_ahead ?? 7),
        desired_bookings: Number(json.desired_bookings ?? 5),
        notify: Boolean(json.notify ?? true),
        active: true,
        last_checked_at: null,
        next_check_due_at: null,
        last_error: '',
        available_slots: [],
        created_at: new Date().toISOString(),
      };
      this.watchers.push(watcher);
      return this.ok(res, { watcher: this.watcherJson(watcher) });
    }

    const watcherMatch = route.match(/^\/watchers\/(\d+)(\/.*)?$/);
    if (watcherMatch) {
      const watcher = this.watchers.find((entry) => entry.id === Number(watcherMatch[1]));
      if (!watcher) return this.fail(res, 404, 'NOT_FOUND', 'Watcher not found.', false);
      const sub = watcherMatch[2] ?? '/';

      if (sub === '/' && method === 'GET') {
        const watcherBookings = this.bookings.filter((booking) => booking.watcher_id === watcher.id);
        return this.ok(res, {
          watcher: this.watcherJson(watcher),
          matching_clients: [],
          priority_bookings: watcherBookings
            .filter((booking) => booking.status === 'pending' || booking.status === 'failed')
            .map((booking) => ({
              id: booking.id,
              client_id: booking.client_id,
              client_name: booking.client_name,
              status: booking.status,
            })),
          recent_bookings: watcherBookings.map((booking) => ({
            id: booking.id,
            client_id: booking.client_id,
            client_name: booking.client_name,
            status: booking.status,
            date: booking.date,
            start_time: booking.start_time,
            error: booking.error,
          })),
        });
      }
      if (sub === '/settings/' && method === 'POST') {
        if (json.interval_seconds !== undefined) watcher.interval_seconds = Number(json.interval_seconds);
        if (json.days_ahead !== undefined) watcher.days_ahead = Number(json.days_ahead);
        if (json.desired_bookings !== undefined) watcher.desired_bookings = Number(json.desired_bookings);
        if (json.notify !== undefined) watcher.notify = Boolean(json.notify);
        return this.ok(res, { watcher: this.watcherJson(watcher) });
      }
      if (sub === '/pause/' && method === 'POST') {
        watcher.active = false;
        return this.ok(res, { watcher: this.watcherJson(watcher) });
      }
      if (sub === '/resume/' && method === 'POST') {
        watcher.active = true;
        return this.ok(res, { watcher: this.watcherJson(watcher) });
      }
      if (sub === '/check/' && method === 'POST') {
        return this.runCheck(watcher, res);
      }
      if (sub === '/' && method === 'DELETE') {
        this.watchers.splice(this.watchers.indexOf(watcher), 1);
        return this.ok(res, { deleted: true });
      }
      if (sub === '/reorder-priority/' && method === 'POST') {
        return this.ok(res, { reordered: true });
      }
      if (sub === '/history/' && method === 'GET') {
        return this.ok(res, {
          items: this.checkHistory,
          page: 1,
          page_size: 25,
          total: this.checkHistory.length,
        });
      }
    }

    if (route === '/appointments/' && method === 'GET') {
      const status = url.searchParams.get('status') ?? 'booked';
      const page = Number(url.searchParams.get('page') ?? '1');
      const items = this.bookings
        .filter((booking) => booking.status === status)
        .map((booking) => this.appointmentJson(booking));
      return this.ok(res, { items, page, page_size: 25, total: items.length });
    }

    const cancelMatch = route.match(/^\/appointments\/(\d+)\/cancel\/$/);
    if (cancelMatch && method === 'POST') {
      const booking = this.bookings.find((entry) => entry.id === Number(cancelMatch[1]));
      if (!booking) return this.fail(res, 404, 'NOT_FOUND', 'Booking not found.', false);
      if (this.scenario === 'cancel_failure') {
        return this.fail(res, 409, 'ALREADY_CANCELLED', 'The office rejected the cancellation.', false);
      }
      booking.status = 'cancelled';
      booking.cancelled_at = new Date().toISOString();
      booking.receipt_available = false;
      const client = this.clients.find((entry) => entry.id === booking.client_id);
      if (client) client.appointment = null;
      this.addActivity('cancel', 'cancelled', `Appointment cancelled for ${booking.client_name}`, {
        provider_id: booking.provider_id,
        provider_name: booking.provider_name,
        client_id: booking.client_id,
        client_name: booking.client_name,
      });
      return this.ok(res, { cancelled: true, booking_id: booking.id });
    }

    const receiptMatch = route.match(/^\/appointments\/(\d+)\/receipt\/$/);
    if (receiptMatch && method === 'GET') {
      const booking = this.bookings.find((entry) => entry.id === Number(receiptMatch[1]));
      if (
        !booking ||
        booking.status !== 'booked' ||
        this.scenario === 'receipt_unavailable' ||
        !booking.receipt_available
      ) {
        return this.fail(
          res,
          409,
          'RECEIPT_UNAVAILABLE',
          'Receipt is not available for this booking.',
          false,
        );
      }
      return this.ok(res, { filename: `receipt-${booking.id}.pdf`, data: RECEIPT_PDF_BASE64 });
    }

    if (route === '/appointments/reconcile/' && method === 'POST') {
      return this.ok(res, { healed: [] });
    }

    if (route === '/activity/' && method === 'GET') {
      const type = url.searchParams.get('type') ?? '';
      const status = url.searchParams.get('status') ?? '';
      const page = Number(url.searchParams.get('page') ?? '1');
      let items = this.activity;
      if (type) items = items.filter((item) => item.type === type);
      if (status) items = items.filter((item) => item.status === status);
      return this.ok(res, { items, page, page_size: 25, total: items.length });
    }

    if (route === '/preferences/' && method === 'GET') return this.ok(res, this.preferences);
    if (route === '/preferences/' && method === 'POST') {
      this.preferences = { ...this.preferences, ...json } as typeof this.preferences;
      return this.ok(res, this.preferences);
    }

    if (route === '/overview/' && method === 'GET') {
      return this.ok(res, {
        active_watchers: this.watchers.filter((watcher) => watcher.active).length,
        queued_clients: this.bookings.filter((booking) => booking.status === 'pending').length,
        slots_found_today: this.checkHistory.reduce(
          (sum, entry) => sum + (entry.slots_found as number),
          0,
        ),
        booked_today: this.bookings.filter((booking) => booking.status === 'booked').length,
        failed_today: this.bookings.filter((booking) => booking.status === 'failed').length,
        recent_activity: this.activity.slice(0, 10),
        upcoming_checks: [],
      });
    }

    this.fail(res, 404, 'NOT_FOUND', `Mock has no route for ${method} ${route}`, false);
  }

  private runCheck(watcher: MockWatcher, res: http.ServerResponse): void {
    if (this.scenario === 'captcha_421') {
      return this.fail(
        res,
        421,
        'CAPTCHA_REQUIRED',
        'The government site presented a CAPTCHA.',
        false,
      );
    }
    const slotCount = this.scenario === 'one_slot' ? 1 : this.scenario === 'multi_slot' ? 3 : 0;
    watcher.available_slots = Array.from({ length: slotCount }, (_, index) => ({
      date: '2026-08-01',
      start_time: `1${index}:00`,
      end_time: `1${index}:30`,
    }));
    watcher.last_checked_at = new Date().toISOString();
    this.checkHistory.unshift({
      id: this.checkHistory.length + 1,
      started_at: watcher.last_checked_at,
      finished_at: watcher.last_checked_at,
      success: true,
      error: '',
      slots_found: slotCount,
      request: {},
      response: {},
    });
    this.addActivity('check', 'success', `${slotCount} slot(s) found`, {
      provider_id: watcher.provider_id,
      provider_name: watcher.provider_name,
    });
    this.ok(res, {
      watcher: this.watcherJson(watcher),
      checked: true,
      slots_found: slotCount,
      booked: [],
      errors: [],
    });
  }

  private bookOutcome(booking: MockBooking, clientId: number, index: number): Record<string, unknown> {
    const bookThisOne =
      this.scenario === 'booking_success' ||
      (this.scenario === 'partial_success' && index === 0) ||
      (this.scenario === 'one_slot' && index === 0);

    if (bookThisOne) {
      booking.status = 'booked';
      booking.stage = 'booked';
      booking.date = '2026-08-01';
      booking.start_time = '10:00';
      booking.appointment_code = 99000 + booking.id;
      booking.official_application_id = `WPT100000${booking.id}`;
      booking.booked_at = new Date().toISOString();
      booking.receipt_available = true;
      const client = this.clients.find((entry) => entry.id === clientId);
      if (client) client.appointment = { date: booking.date, start_time: booking.start_time };
      this.addActivity('booking', 'booked', `Booked ${booking.client_name} · 2026-08-01 10:00`, {
        provider_id: booking.provider_id,
        provider_name: booking.provider_name,
        client_id: clientId,
        client_name: booking.client_name,
      });
      return {
        client_id: clientId,
        booking_id: booking.id,
        outcome: 'booked',
        appointment: { date: booking.date, start_time: booking.start_time },
      };
    }

    if (this.scenario === 'partial_success') {
      booking.status = 'failed';
      booking.stage = 'failed';
      booking.error = 'Passport service returned HTTP 422 (TIME_SLOT_NOT_AVAILABLE)';
      this.addActivity('booking', 'failed', `Failed to book ${booking.client_name}`, {
        provider_id: booking.provider_id,
        provider_name: booking.provider_name,
        client_id: clientId,
        client_name: booking.client_name,
      });
      return { client_id: clientId, booking_id: booking.id, outcome: 'failed', error: booking.error };
    }

    booking.stage = null;
    this.addActivity('booking', 'success', `${booking.client_name} queued — no slot available`, {
      provider_id: booking.provider_id,
      provider_name: booking.provider_name,
      client_id: clientId,
      client_name: booking.client_name,
    });
    return { client_id: clientId, booking_id: booking.id, outcome: 'queued', error: NO_SLOT_MESSAGE };
  }

  private ensureWatcher(json: Record<string, unknown>): MockWatcher {
    const providerId = Number(json.provider_id);
    let watcher = this.watchers.find((entry) => entry.provider_id === providerId);
    if (!watcher) {
      watcher = {
        id: this.nextWatcherId++,
        name: String(json.provider_name ?? 'Watcher'),
        mode: 'book',
        province_id: json.province_id as string,
        district_id: json.district_id as string,
        provider_id: providerId,
        provider_name: String(json.provider_name ?? ''),
        district_name: '',
        interval_seconds: 3600,
        days_ahead: 7,
        desired_bookings: 5,
        notify: true,
        active: true,
        last_checked_at: null,
        next_check_due_at: null,
        last_error: '',
        available_slots: [],
        created_at: new Date().toISOString(),
      };
      this.watchers.push(watcher);
    }
    return watcher;
  }

  private newBooking(client: MockClient, watcherId: number, key: string): MockBooking {
    this.idempotencyKeysSeen.push(key);
    const booking: MockBooking = {
      id: this.nextBookingId++,
      client_id: client.id,
      client_name: client.full_name,
      watcher_id: watcherId,
      provider_id: client.provider_id,
      provider_name: client.provider_name,
      status: 'pending',
      stage: 'submitting',
      date: null,
      start_time: null,
      error: null,
      idempotency_key: key,
      official_application_id: '',
      appointment_code: null,
      booked_at: null,
      cancelled_at: null,
      booked_by_system: true,
      receipt_available: false,
    };
    this.bookings.push(booking);
    return booking;
  }

  private watcherJson(watcher: MockWatcher): Record<string, unknown> {
    const watcherBookings = this.bookings.filter((booking) => booking.watcher_id === watcher.id);
    return {
      ...watcher,
      queued_count: watcherBookings.filter(
        (booking) => booking.status === 'pending' || booking.status === 'failed',
      ).length,
      booked_count: watcherBookings.filter((booking) => booking.status === 'booked').length,
    };
  }

  private appointmentJson(booking: MockBooking): Record<string, unknown> {
    return {
      booking_id: booking.id,
      client_id: booking.client_id,
      client_name: booking.client_name,
      official_application_id: booking.official_application_id,
      appointment_code: booking.appointment_code,
      provider_id: booking.provider_id,
      provider_name: booking.provider_name,
      date: booking.date,
      start_time: booking.start_time,
      status: booking.status,
      booked_at: booking.booked_at,
      cancelled_at: booking.cancelled_at,
      booked_by_system: booking.booked_by_system,
      receipt_available: booking.receipt_available,
    };
  }

  private ok(res: http.ServerResponse, data: unknown): void {
    this.requestCounter++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ ok: true, data, error: null, request_id: `mock-${this.requestCounter}` }),
    );
  }

  private fail(
    res: http.ServerResponse,
    status: number,
    code: string,
    message: string,
    retryable: boolean,
  ): void {
    this.requestCounter++;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: false,
        data: null,
        error: { code, message, retryable },
        request_id: `mock-${this.requestCounter}`,
      }),
    );
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
  });
}
