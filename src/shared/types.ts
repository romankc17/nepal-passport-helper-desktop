// Types mirroring docs/API-CONTRACT.md (Desktop API v1).
// Shared by main, preload and renderer — keep free of any runtime imports.

export interface ApiEnvelope<T> {
  ok: boolean;
  data: T | null;
  error: ApiErrorShape | null;
  request_id: string;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}

// Auth

export interface TokenBundle {
  access_token: string;
  access_expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

export interface User {
  id: number;
  username: string;
  is_staff: boolean;
}

export interface AccessProvider {
  id: number;
  name: string;
}

export interface Access {
  mode: string;
  providers: AccessProvider[];
  booking_lab: boolean;
}

export interface AccountDefaults {
  interval_seconds: number;
}

export interface LoginResult {
  token: TokenBundle;
  user: User;
  access: Access;
  defaults: AccountDefaults;
}

export interface Device {
  id: number;
  name: string;
  device_id: string;
  last_seen_at: string;
  current: boolean;
}

export interface MeResult {
  user: User;
  access: Access;
  defaults: AccountDefaults;
  devices: Device[];
}

export interface SessionInfo {
  user: User;
  access: Access;
  defaults: AccountDefaults;
  offline: boolean;
}

// Locations

export type LocationKind = 'countries' | 'provinces' | 'districts' | 'providers';

// Official ams_countries: 222 = Nepal, 307 = "Other" (foreign missions group).
export const COUNTRY_NEPAL_ID = '222';
export const COUNTRY_OTHER_ID = '307';

export interface LocationItem {
  // Province/district ids arrive as strings ("225"), provider ids as numbers.
  id: number | string;
  name: string;
}

// Clients

export type ClientStatus = 'fresh' | 'ready' | 'booked' | 'canceled';
export type ClientDesktopStatus =
  | 'ready'
  | 'incomplete'
  | 'queued'
  | 'booked'
  | 'not_permitted'
  | 'cancelled';

export interface AppointmentRef {
  date: string;
  start_time: string;
}

export interface ClientSummary {
  id: number;
  full_name: string;
  application_type: string;
  status: ClientStatus;
  desktop_status: ClientDesktopStatus;
  can_book: boolean;
  official_application_id: string;
  provider_id: number;
  provider_name: string;
  district_name: string;
  phone: string;
  email: string;
  missing_document_count: number;
  queued_booking_id: number | null;
  appointment: AppointmentRef | null;
  created_by: string;
  created_at: string;
  country_id?: number | string;
  country_name?: string;
  appointment_country_id?: number | string;
  appointment_country_name?: string;
}

export interface DocumentRequirement {
  type: string;
  label: string;
  required: boolean;
  present: boolean;
}

export interface ClientDetail extends ClientSummary {
  document_requirements: DocumentRequirement[];
  active_booking: unknown | null;
}

export interface Paged<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface ClientListResult extends Paged<ClientSummary> {
  providers: { id: number; name: string }[];
}

export interface ClientListQuery {
  page?: number;
  page_size?: number;
  q?: string;
  status?: string;
  application_type?: string;
  provider_id?: number;
  booked?: boolean;
  sort?: string;
}

export interface ReadyByLocationGroup {
  provider_id: number;
  provider_name: string;
  district_name: string;
  country_id?: number | string;
  country_name?: string;
  clients: ClientSummary[];
}

// Make Ready (submit a fresh/cancelled client to the official pre-enrollment
// form to obtain its official_application_id, independent of booking).

export interface ClientSubmitInput {
  client_ids: number[];
}

export interface ClientSubmitOutcome {
  client_id: number;
  name: string;
  official_application_id: string;
}

export interface ClientSubmitFailure {
  client_id: number;
  name: string;
  error: string;
}

export interface ClientSubmitResult {
  submitted: ClientSubmitOutcome[];
  failed: ClientSubmitFailure[];
}

// Import from official portal

// Sanitized summary of an application listed on the official portal account.
export interface OfficialApplicationSummary {
  id: string;
  applicant_name: string;
  application_type: string;
  submitted_at: string;
  status: string;
}

export interface ImportWarning {
  field: string;
  source_value: string;
  reason: string;
}

export interface ImportDuplicate {
  client_id: number;
  full_name: string;
}

// A supporting document scan (citizenship certificate, national eID, ...)
// captured alongside an official application. Carried separately from the
// sanitized application fields since base64 image data is far larger than
// the generic IPC payload cap.
export interface SupportingDocument {
  documentType: string;
  documents: string[];
}

// Mapped client fields are plain string/string-or-number key-values matching
// the ApplicantForm field names on the Django side.
export interface ImportPreviewResult {
  fields: Record<string, string>;
  warnings: ImportWarning[];
  unmapped: Record<string, string>;
  requirements: DocumentRequirement[];
  duplicate: ImportDuplicate | null;
}

export interface ImportConfirmResult {
  client: ClientSummary;
  edit_url: string;
}

// Broadcast from main when the official-login window opens/closes, and when a
// navigation to a non-official origin is blocked (a silent block would look
// like a hang if the portal legitimately redirects after login).
export interface OfficialImportStateEvent {
  type: 'official-import-state';
  state: 'opened' | 'closed' | 'blocked-navigation';
  /** Present for 'blocked-navigation' — the host that was blocked. */
  host?: string;
}

// Queue & booking

export interface QueueAddInput {
  provider_id: number | string;
  district_id: number | string;
  province_id: number | string;
  provider_name: string;
  client_ids: number[];
  idempotency_key: string;
  // Foreign missions: country 307 with district_id/province_id sent as ''.
  country_id?: number | string;
  country_name?: string;
}

export interface QueueAddResult {
  watcher: Watcher;
  queued: { client_id: number }[];
  skipped: { client_id: number; reason: string }[];
}

export interface QueueRemoveResult {
  removed: number[];
  skipped: { client_id: number; reason: string }[];
}

export interface BookNowInput extends QueueAddInput {
  slots?: string[];
}

export interface BookNowResultItem {
  client_id: number;
  booking_id?: number;
  outcome: 'booked' | 'queued' | 'failed';
  error?: string;
  appointment?: AppointmentRef;
}

export interface BookNowResult {
  watcher: Watcher;
  results: BookNowResultItem[];
}

export interface ProgressItem {
  booking_id: number;
  stage: 'submitting' | 'booking' | 'booked' | 'failed' | null;
  meta: Record<string, unknown>;
}

// Watchers

export type WatcherMode = 'notify' | 'book';

export interface SlotInfo {
  date: string;
  start_time: string;
  end_time: string;
}

export interface Watcher {
  id: number;
  name: string;
  mode: WatcherMode;
  province_id: number | string;
  district_id: number | string;
  provider_id: number | string;
  provider_name: string;
  district_name: string;
  country_id?: number | string;
  country_name?: string;
  interval_seconds: number;
  days_ahead: number;
  desired_bookings: number;
  notify: boolean;
  notification_email: string;
  active: boolean;
  last_checked_at: string | null;
  next_check_due_at: string | null;
  last_error: string | null;
  available_slots: SlotInfo[];
  queued_count: number;
  booked_count: number;
  created_at: string;
  priority_bookings?: PriorityBooking[];
}

export interface WatcherCreateInput {
  provider_id: number | string;
  district_id: number | string;
  province_id: number | string;
  provider_name: string;
  country_id?: number | string;
  country_name?: string;
  mode: WatcherMode;
  interval_seconds?: number;
  days_ahead?: number;
  desired_bookings?: number;
  notify?: boolean;
  notification_email?: string;
}

export interface WatcherSettingsPatch {
  interval_seconds?: number;
  days_ahead?: number;
  notify?: boolean;
  desired_bookings?: number;
  notification_email?: string;
}

export interface WatcherCheckResult {
  watcher: Watcher;
  checked: boolean;
  slots_found: number;
  booked: unknown[];
  errors: { code?: string; message?: string; client_id?: number }[];
}

export interface LocalRunStart {
  checked: boolean;
  watcher?: Watcher;
  run_id?: string;
  service_id?: number;
  provider_id?: number | string;
  start_date?: string;
  days_ahead?: number;
  mode?: WatcherMode;
}

export interface LocalBookingJob {
  client_id: number;
  application_id: string;
  date: string;
  start_time: string;
  end_time: string;
  application_payload: Record<string, unknown>;
  booking_payload: Record<string, unknown>;
}

export interface LocalBookingResult {
  client_id: number;
  application_id: string;
  booked: boolean;
  date: string;
  start_time: string;
  receipt?: string;
  response?: Record<string, unknown>;
  error?: string;
}

export interface WatcherMatchingClient {
  id: number;
  name: string;
  application_type: string;
  application_id: string;
  missing_document_count: number;
  ready: boolean;
  is_booked: boolean;
  is_queued: boolean;
  queued_booking_id: number | null;
  can_select: boolean;
  added_by: string;
}

export interface PriorityBooking {
  id: number;
  client_id: number;
  client_name: string;
  status: string;
}

export interface RecentBooking extends PriorityBooking {
  date: string | null;
  start_time: string | null;
  error: string | null;
}

export interface WatcherDetail {
  watcher: Watcher;
  matching_clients: WatcherMatchingClient[];
  priority_bookings: PriorityBooking[];
  recent_bookings: RecentBooking[];
}

export interface WatcherHistoryItem {
  id: number;
  started_at: string;
  finished_at: string;
  success: boolean;
  error: string | null;
  slots_found: number;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

// Appointments

export type AppointmentStatus = 'booked' | 'cancelled';

export interface Appointment {
  booking_id: number;
  client_id: number;
  client_name: string;
  official_application_id: string;
  appointment_code: string | number;
  provider_id: number;
  provider_name: string;
  date: string;
  start_time: string;
  status: AppointmentStatus;
  booked_at: string;
  cancelled_at: string | null;
  booked_by_system: boolean;
  receipt_available: boolean;
  edit_url: string;
  country_id?: number | string;
  country_name?: string;
}

export interface AppointmentListQuery {
  status?: AppointmentStatus;
  q?: string;
  provider_id?: number;
  page?: number;
}

export interface ReceiptResult {
  filename: string;
  data: string;
}

export interface ReconcileResult {
  healed: { client_id: number; booking_id: number; date: string; start_time: string }[];
}

// Activity

export interface ActivityItem {
  id: number | string;
  type: string;
  at: string;
  duration_ms: number | null;
  actor: string;
  device: string | null;
  provider_id: number | null;
  provider_name: string | null;
  client_id: number | null;
  client_name: string | null;
  status: string;
  message: string | null;
  request_id: string | null;
}

export interface ActivityQuery {
  type?: string;
  provider_id?: number;
  status?: string;
  client_id?: number;
  from?: string;
  to?: string;
  page?: number;
}

// Preferences

export interface FavoriteLocation {
  provider_id: number | string;
  provider_name: string;
  district_id: number | string;
  province_id: number | string;
  district_name?: string;
}

export interface Preferences {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  email_on_booking: boolean;
  email_address: string;
  favorite_locations: FavoriteLocation[];
}

export type PreferencesPatch = Partial<Preferences>;

// Overview

export interface Overview {
  active_watchers: number;
  queued_clients: number;
  slots_found_today: number;
  booked_today: number;
  failed_today: number;
  recent_activity: ActivityItem[];
  upcoming_checks: { watcher_id: number; provider_name: string; due_at: string }[];
}

// Scheduler (local runtime, not part of the HTTP contract)

export type WatcherLoopState =
  | 'idle'
  | 'scheduled'
  | 'checking'
  | 'backoff'
  | 'paused'
  | 'offline'
  | 'captcha'
  | 'auth-expired'
  | 'error';

export type CheckOutcomeStatus =
  | 'ok'
  | 'retryable-error'
  | 'permanent-error'
  | 'captcha'
  | 'auth-expired';

export interface CheckOutcome {
  status: CheckOutcomeStatus;
  slotsFound?: number;
  bookedCount?: number;
  errorCode?: string;
  message?: string;
}

export interface WatcherStateEvent {
  type: 'watcher-state';
  watcherId: number;
  state: WatcherLoopState;
  lastResult?: CheckOutcome;
  nextRunAt?: number;
}

export interface AuthExpiredEvent {
  type: 'auth-expired';
}

export type SchedulerEvent = WatcherStateEvent | AuthExpiredEvent;

export interface WatcherRuntime {
  watcherId: number;
  state: WatcherLoopState;
  nextRunAt?: number;
  lastResult?: CheckOutcome;
}

// Why a manual "check now" click was rejected — surfaced to the user instead
// of silently ignoring the click.
export type CheckNowRejection = 'auth-expired' | 'already-running';

export interface CheckNowResult {
  accepted: boolean;
  reason?: CheckNowRejection;
}

export interface WatcherSyncItem {
  id: number;
  intervalSeconds: number;
  active: boolean;
}

// Local session booking queue (in-memory in the main process, never persisted
// to disk or the backend DB — gone when the app closes).

export interface LocalQueueLocation {
  provider_id: number | string;
  provider_name: string;
  district_id: number | string;
  province_id: number | string;
  country_id?: number | string;
  country_name?: string;
}

export type LocalQueueItemStatus = 'queued' | 'submitting' | 'booking' | 'booked' | 'failed';

export interface LocalQueueItem {
  client_id: number;
  client_name: string;
  official_application_id: string;
  phone: string;
  email: string;
  location: LocalQueueLocation;
  added_at: number;
  status: LocalQueueItemStatus;
  /** True when the failure is permanent (e.g. client not ready) — excluded from auto-retry. */
  permanent?: boolean;
  error?: string;
  appointment?: { date: string; start_time: string };
}

export type LocalQueueEngineState =
  | 'idle'
  | 'scheduled'
  | 'checking'
  | 'backoff'
  | 'paused'
  | 'offline'
  | 'captcha'
  | 'error';

export interface LocalQueueGroupEngine {
  state: LocalQueueEngineState;
  next_run_at?: number;
  interval_seconds: number;
  last_checked_at?: number;
  last_slots_found?: number;
  last_error?: string;
}

export interface LocalQueueGroup {
  key: string;
  location: LocalQueueLocation;
  items: LocalQueueItem[];
  engine: LocalQueueGroupEngine;
}

export interface LocalQueueSnapshot {
  groups: LocalQueueGroup[];
  total: number;
}

export interface LocalQueueAddInput extends LocalQueueLocation {
  client_ids: number[];
}

export interface LocalQueueAddResult {
  queued: { client_id: number }[];
  skipped: { client_id: number; reason: string }[];
}

export interface LocalQueueStateEvent {
  type: 'local-queue-state';
  snapshot: LocalQueueSnapshot;
}

// Local settings (main-process only, never sent to the server)

export interface AppSettings {
  apiUrl: string | null;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  minimizeToTray: boolean;
  startOnLogin: boolean;
  defaultIntervalSeconds: number;
  defaultDaysAhead: number;
  theme: 'light' | 'system';
}

export type AppSettingsPatch = Partial<AppSettings>;

// Auto-update status broadcast from main to renderer.

export type UpdateStatus =
  | { type: 'idle' }
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseNotes?: string | null }
  | { type: 'downloading'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { type: 'downloaded'; version: string }
  | { type: 'up-to-date'; version: string }
  | { type: 'error'; message: string };

// Booking Lab

export type LabClientStatus =
  | 'draft'
  | 'submitted'
  | 'queued'
  | 'booked'
  | 'failed'
  | 'cancelled';

export interface LabClient {
  id: number;
  name: string;
  application_type: string;
  status: LabClientStatus;
  owner: string;
  owner_id: number;
  official_application_id: string;
  provider_id: number;
  provider_name: string;
  district_name: string;
  booking_id: number | null;
  booking_status: string | null;
  appointment_date: string | null;
  start_time: string | null;
  can_book: boolean;
  can_cancel: boolean;
  can_delete: boolean;
  receipt_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface LabClientDetail extends LabClient {
  history: LabHistoryItem[];
  data: Record<string, unknown>;
}

export interface LabHistoryItem {
  id: number;
  client_id: number;
  client_name: string;
  owner: string;
  status: string;
  monitor_name: string;
  appointment_date: string | null;
  start_time: string | null;
  error: string | null;
  created_at: string;
  booked_at: string | null;
  cancelled_at: string | null;
}

export interface LabSummary {
  generated: number;
  submitted: number;
  queued: number;
  booked: number;
  failed: number;
  cancelled: number;
  watchers: number;
}

export interface LabListQuery {
  status?: string;
  q?: string;
  owner?: string;
  provider_id?: number;
  page?: number;
  page_size?: number;
}

export interface LabGenerateInput {
  province_id: number | string;
  district_id: number | string;
  provider_id: number;
  application_type: string;
  count: number;
  idempotency_key: string;
}

export interface LabGenerateResult {
  clients: Record<string, unknown>[];
  count: number;
}

export interface LabSubmitInput {
  clients: Record<string, unknown>[];
  idempotency_key: string;
}

export interface LabSubmitResult {
  submitted: { client_id: number; applicant_id: number; name: string; official_application_id: string }[];
  failed: { client_id: number; name: string; error: string }[];
}

export interface LabBookInput {
  client_ids: number[];
  idempotency_key: string;
}

export interface LabBookResult {
  results: {
    provider: string;
    slots_found: number;
    booked: number;
    queued: number;
    error: string | null;
  }[];
}

export interface LabJob {
  batch_id: string;
  kind: 'submit' | 'book';
  total: number;
  completed: number;
  failed: number;
  finished: boolean;
  stages: Record<number, 'pending' | 'submitting' | 'booking' | 'done' | 'failed'>;
  result: LabSubmitResult | LabBookResult | null;
  error: string | null;
}

export interface LabReconcileInput {
  client_ids?: number[];
}

export interface LabReconcileResult {
  healed: { client_id: number; booking_id: number; date: string; start_time: string }[];
}
