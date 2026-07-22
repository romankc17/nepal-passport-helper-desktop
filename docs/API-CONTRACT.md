# Desktop API v1 Contract

Base URL: `{SERVER}/api/desktop/v1/`

All requests and responses are JSON. Authenticated endpoints require
`Authorization: Bearer <access_token>`.

## Envelope

Every response uses a consistent envelope:

```json
{ "ok": true, "data": {}, "error": null, "request_id": "9f1c…" }
```

Errors:

```json
{
  "ok": false,
  "data": null,
  "error": { "code": "TIME_SLOT_NOT_AVAILABLE", "message": "No slot is currently available. The clients remain queued.", "retryable": true },
  "request_id": "9f1c…"
}
```

`error` may additionally carry a `fields` map (`{ field: [messages] }`) when a
validation failure can be attributed to individual input fields.

Stable error codes (non-exhaustive): `VALIDATION_ERROR`, `AUTH_FAILED`,
`TOKEN_EXPIRED`, `DEVICE_REVOKED`, `PERMISSION_DENIED`, `NOT_FOUND`,
`LOCATION_NOT_PERMITTED`, `CLIENT_NOT_READY`, `CLIENT_ALREADY_QUEUED`,
`TIME_SLOT_NOT_AVAILABLE`, `CAPTCHA_REQUIRED`, `GOVERNMENT_UNAVAILABLE`,
`MONITOR_BUSY`, `RECEIPT_UNAVAILABLE`, `ALREADY_CANCELLED`,
`DUPLICATE_CLIENT`, `UNSUPPORTED_APPLICATION_TYPE`,
`RATE_LIMITED`, `SERVER_ERROR`.

## Auth

### POST `auth/login/`
Body: `{ "username", "password", "device_id" (uuid from client), "device_name" }`
→ 200 `{ token: { access_token, access_expires_in (seconds), refresh_token, refresh_expires_in }, user: { id, username, is_staff }, access: { mode, providers: [{id,name}] }, defaults: { interval_seconds } }`
→ 401 `AUTH_FAILED`, 429 `RATE_LIMITED`.

### POST `auth/refresh/`
Body: `{ "refresh_token" }` → same shape as login (rotates the refresh token).
401 `TOKEN_EXPIRED` / `DEVICE_REVOKED` when the device was signed out remotely.

### POST `auth/logout/` (auth)
Revokes this device. → `{ "signed_out": true }`

## Account

### GET `me/`
`{ user: {…}, access: {…}, defaults: {…}, devices: [{ id, name, device_id, last_seen_at, current }] }`

### POST `devices/<id>/revoke/` (auth)
Revoke another (or the current) device of the same user.

## Locations

### GET `locations/?kind=countries|provinces|districts|providers&parent=<id>`
`{ items: [{ id, name }] }`. Providers are filtered by the user's DesktopAccess.
`kind=countries` returns the official ams_countries: `222` = Nepal, `307` = "Other"
(foreign missions group). Nepal uses provinces → districts → providers; for
country 307 there is no province/district — `kind=providers&parent=307` lists
the foreign missions directly as providers.

## Clients

### GET `clients/?page=1&page_size=25&q=&status=&application_type=&provider_id=&booked=&sort=`
Paginated `{ items: [ClientSummary], page, page_size, total }`.
ClientSummary: `{ id, full_name, application_type, status (fresh|ready|booked|canceled),
desktop_status (ready|incomplete|queued|booked|not_permitted|cancelled), can_book,
official_application_id, provider_id, provider_name, district_name, phone, email,
missing_document_count, queued_booking_id, appointment: {date, start_time}|null, created_by,
country_id?, country_name?, appointment_country_id?, appointment_country_name? }`

### GET `clients/<id>/`
Adds `document_requirements: [{type, label, required, present}]`, `active_booking`.

### GET `clients/ready-by-location/`
`{ locations: [{ provider_id, provider_name, district_name, clients: [ClientSummary] }] }`
— ready, document-complete, permitted clients grouped by office.

### POST `clients/import-official/preview/` (auth)
Body: `{ application: {...} }` — the sanitized official-portal application
detail JSON collected by the desktop's import window. Any key (recursively)
matching token/jwt/authorization/cookie/password/captcha/secret/credential/
session is rejected with 400 `VALIDATION_ERROR` — never forward authentication
or session material.
Maps the payload onto client form fields (never inventing missing values).
→ `{ fields: {name: value}, warnings: [{ field, source_value, reason }],
unmapped: {key: value}, requirements: [{ type, label, required, present }],
duplicate: { client_id, full_name } | null }`
`duplicate` (same citizenship number + date of birth) is a warning, not an
error. Unrecognized dictionary values are left empty with a warning.
Unknown official application type → 400 `UNSUPPORTED_APPLICATION_TYPE`.

### POST `clients/import-official/confirm/` (auth)
Body: `{ fields: {...reviewed mapped fields...}, allow_duplicate: bool,
idempotency_key }` (the `Idempotency-Key` header is also accepted; repeating
with the same key returns the original response). Keys outside the client form
are dropped; auth/session-shaped keys → 400 `VALIDATION_ERROR`.
Creates a **Fresh** client owned by the requesting user — no booking, receipt,
or document rows are created, and the source WPT ID is never stored.
→ `{ client: ClientSummary, edit_url }` (`edit_url` is the web-portal edit path).
409 `DUPLICATE_CLIENT` when a client with the same citizenship number + DOB
exists and `allow_duplicate` is false. 403 `PERMISSION_DENIED` for a
non-permitted appointment office. Form failures → 400 `VALIDATION_ERROR` with
`error.fields: { name: [messages] }`.

## Queue & booking

### POST `queue/`
Body: `{ provider_id, district_id, province_id, provider_name, client_ids: [...], idempotency_key,
country_id?, country_name? }` (foreign missions: `country_id: 307` with empty district/province)
Queues clients on the user's auto-book watcher for the location (created if needed).
→ `{ watcher: Watcher, queued: [{client_id, booking_id}], skipped: [{client_id, reason}] }`
Repeating with the same `idempotency_key` returns the original response.

### POST `queue/remove/`
Body: `{ booking_ids: [...] }` → `{ removed: [...], skipped: [{booking_id, reason}] }`
Only pending/failed bookings may be removed.

### POST `book-now/`
Body: `{ provider_id, district_id, province_id, provider_name, client_ids: [...], slots?: ["YYYY-MM-DD|HH:MM"], idempotency_key }`
Queues (if needed) and immediately runs a forced check-and-book.
→ `{ watcher, results: [{ client_id, booking_id, outcome: booked|queued|failed, error?, appointment?: {date, start_time} }] }`

### GET `progress/?booking_ids=1,2,3`
`{ items: [{ booking_id, stage: submitting|booking|booked|failed|null, meta }] }`

## Watchers

Watcher JSON: `{ id, name, mode (notify|book), province_id, district_id, provider_id,
provider_name, district_name, country_id?, country_name? (default 222/"Nepal"; foreign
missions are normalized to province_id="", location 307), interval_seconds, days_ahead, desired_bookings,
notify (bool), active (bool), last_checked_at, next_check_due_at, last_error,
available_slots: [{date, start_time, end_time}], queued_count, booked_count,
created_at }`

### GET `watchers/` → `{ items: [Watcher] }`
### POST `watchers/` body `{ provider_id, district_id, province_id, provider_name, country_id?, country_name?, mode, interval_seconds?, days_ahead?, desired_bookings?, notify? }` → `{ watcher }`
### GET `watchers/<id>/` → `{ watcher, matching_clients, priority_bookings, recent_bookings }`
### POST `watchers/<id>/settings/` body `{ interval_seconds?, days_ahead?, notify?, desired_bookings? }` → `{ watcher }`
### POST `watchers/<id>/pause/` / `watchers/<id>/resume/` → `{ watcher }`
### POST `watchers/<id>/check/` body `{ force?: bool, slots?: [...] }` — runs check now (check-and-book for book-mode watchers) → `{ watcher, checked: bool, slots_found, booked: [...], errors: [...] }`
### DELETE `watchers/<id>/` → `{ deleted: true }`
### POST `watchers/<id>/reorder-priority/` body `{ booking_ids: [...] }` → `{ reordered: true }`
### GET `watchers/<id>/history/?page=` → paginated `{ items: [{ id, started_at, finished_at, success, error, slots_found, request (redacted), response (redacted) }] }`

## Appointments

### GET `appointments/?status=booked|cancelled&q=&provider_id=&page=`
`{ items: [{ booking_id, client_id, client_name, official_application_id,
appointment_code, provider_id, provider_name, date, start_time, status,
booked_at, cancelled_at, booked_by_system (bool), receipt_available (bool) }], … }`

### POST `appointments/<booking_id>/cancel/` → `{ cancelled: true, booking_id }`
Cancels the official appointment, invalidates the receipt, frees the client for a fresh booking.

### GET `appointments/<booking_id>/receipt/`
→ `{ filename, data (base64 pdf) }`. 409 `RECEIPT_UNAVAILABLE` when the booking
is cancelled or the receipt is missing. Receipts are never served for cancelled bookings.

### POST `appointments/reconcile/` body `{ client_ids?: [...] }`
Re-checks official state and adopts SCHEDULED records. → `{ healed: [{ client_id, booking_id, date, start_time }] }`

## Booking Lab

### GET `lab/summary/`
→ `{ generated, submitted, queued, booked, failed, cancelled, watchers }`

### GET `lab/clients/?status=&q=&owner=&provider_id=&page=&page_size=`
→ `{ items: [LabClient], page, page_size, total, is_staff }`.
LabClient: `{ id, name, application_type, status, owner, owner_id, official_application_id,
provider_id, provider_name, district_name, booking_id, booking_status, appointment_date,
start_time, can_book, can_cancel, can_delete, receipt_available, created_at, updated_at }`.
Status: `draft|submitted|queued|booked|failed|cancelled` — computed from live booking state
(a FAILED booking reports `failed`, a PENDING one `queued`), and `can_book` stays true for
failed clients so they can be retried.
`status` accepts a single value or a comma-separated set (e.g. `submitted,queued,failed`);
`owner` accepts `me` or (staff only) a user id.
`application_type` is the raw code: `NEW|RENEW|REPLACE_LOST|REPLACE_DAMAGED|MODIFICATION`.

### GET `lab/clients/<id>/`
→ LabClient + `{ history: [...], data: {...} }`.

### POST `lab/generate/`
Body: `{ province_id, district_id, provider_id, application_type, count, idempotency_key }`
→ `{ clients: [...], count }`. Returns demo client data without persisting.

### POST `lab/submit/`
Body: `{ clients: [...], idempotency_key }`
→ `{ batch_id }`. Starts an async job that creates Applicant + documents, submits to the
official API with a bounded worker pool, and persists BookingLabClient rows.
Poll `GET lab/jobs/<batch_id>/` for progress and final `{ submitted, failed }`.

### POST `lab/book/`
Body: `{ client_ids: [...], idempotency_key }`
→ `{ batch_id }`. Starts an async job that books submitted clients using existing WPT IDs.
Poll `GET lab/jobs/<batch_id>/` for progress and final `{ results: [{ provider, slots_found, booked, queued, error }] }`.

### GET `lab/jobs/<batch_id>/`
→ `{ batch_id, kind, total, completed, failed, finished, stages: {item_id: stage}, result, error }`.
`stage` is one of `pending|submitting|booking|done|failed`. `result` is populated once
`finished` is true. The response belongs to the authenticated user.

### POST `lab/reconcile/`
Body: `{ client_ids?: [...] }` → `{ healed: [...] }`.

### GET `lab/history/?status=&owner=&provider_id=&q=&page=`
→ `{ items: [LabHistoryItem], page, page_size, total }`.
LabHistoryItem: `{ id, client_id, client_name, owner, status, monitor_name, appointment_date, start_time, error, created_at, booked_at, cancelled_at }`.

### POST `lab/bookings/<booking_id>/cancel/`
→ `{ cancelled: true, application_id }`. Cancels official appointment, removes receipt.

### GET `lab/bookings/<booking_id>/receipt/`
→ `{ filename, data (base64 pdf) }`. 404 if not booked or receipt missing.

### DELETE `lab/clients/<id>/delete/`
→ `{ deleted: true }`. Deletes the lab client and its applicant. Blocked if booked.

## Activity

### GET `activity/?type=&provider_id=&status=&client_id=&from=&to=&page=`
Unified feed of watch checks, queue actions, booking attempts/successes/failures,
cancellations, reconciliations: `{ items: [{ id, type, at, duration_ms, actor,
device, provider_id, provider_name, client_id, client_name, status, message,
request_id }] }`. Never contains tokens, cookies, or document contents.

## Preferences

### GET `preferences/` → `{ notifications_enabled, sound_enabled, email_on_booking, email_address, favorite_locations }`
`favorite_locations`: `[{ provider_id, provider_name, district_id, province_id, district_name? }]` (max 20; display data only — ids are revalidated on watcher creation).
### POST `preferences/` body any subset of the above → same.

## Overview

### GET `overview/`
`{ active_watchers, queued_clients, slots_found_today, booked_today, failed_today,
recent_activity: [...], upcoming_checks: [{ watcher_id, provider_name, due_at }] }`
