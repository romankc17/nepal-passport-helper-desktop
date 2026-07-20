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

export type LocationKind = 'provinces' | 'districts' | 'providers';

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
  clients: ClientSummary[];
}

// Queue & booking

export interface QueueAddInput {
  provider_id: number | string;
  district_id: number | string;
  province_id: number | string;
  provider_name: string;
  client_ids: number[];
  idempotency_key: string;
}

export interface QueueAddResult {
  watcher: Watcher;
  queued: { client_id: number; booking_id: number }[];
  skipped: { client_id: number; reason: string }[];
}

export interface QueueRemoveResult {
  removed: number[];
  skipped: { booking_id: number; reason: string }[];
}

export interface BookNowInput extends QueueAddInput {
  slots?: string[];
}

export interface BookNowResultItem {
  client_id: number;
  booking_id: number;
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
  interval_seconds: number;
  days_ahead: number;
  desired_bookings: number;
  notify: boolean;
  active: boolean;
  last_checked_at: string | null;
  next_check_due_at: string | null;
  last_error: string | null;
  available_slots: SlotInfo[];
  queued_count: number;
  booked_count: number;
  created_at: string;
}

export interface WatcherCreateInput {
  provider_id: number | string;
  district_id: number | string;
  province_id: number | string;
  provider_name: string;
  mode: WatcherMode;
  interval_seconds?: number;
  days_ahead?: number;
  desired_bookings?: number;
  notify?: boolean;
}

export interface WatcherSettingsPatch {
  interval_seconds?: number;
  days_ahead?: number;
  notify?: boolean;
  desired_bookings?: number;
}

export interface WatcherCheckResult {
  watcher: Watcher;
  checked: boolean;
  slots_found: number;
  booked: unknown[];
  errors: { code?: string; message?: string }[];
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

export interface Preferences {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  email_on_booking: boolean;
  email_address: string;
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

export interface WatcherSyncItem {
  id: number;
  intervalSeconds: number;
  active: boolean;
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
