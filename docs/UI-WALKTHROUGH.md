# UI walkthrough

All screenshots are captured deterministically against the e2e mock backend
(`npm run screenshots`).

## Overview

![Overview](screenshots/overview.png)

The operations dashboard: today's stats, upcoming checks with live countdowns,
recent activity, and backend/scheduler connectivity dots.

## Slot Watchers

![Slot Watchers](screenshots/watchers.png)

Watcher cards with live state badges, per-card check history, slot lists, and
pause/resume/edit/delete actions. CAPTCHA and auth-expired states get
actionable banners.

## Booking Queue

![Booking Queue](screenshots/queue.png)

Ready clients grouped by office with bulk selection, "Queue selected" and
"Check & book now" per group, plus the currently-queued list per watcher.

## Clients

![Clients](screenshots/clients.png)

Paginated, searchable, filterable client table. Row click opens a detail
drawer with the document checklist and one-click queueing.

## Appointments

![Appointments](screenshots/appointments.png)

Booked/cancelled tabs with receipt downloads (booked only — cancelled
appointments never offer receipts), cancel with confirmation, and reconcile.

## Activity

![Activity](screenshots/activity.png)

The unified audit feed: checks, queue actions, bookings, cancellations —
filterable by type, office, status and date range.

## Settings

![Settings](screenshots/settings.png)

Server notification preferences, local app behaviour (tray, login item,
polling defaults), server URL (dev only), device management and sign-out.
