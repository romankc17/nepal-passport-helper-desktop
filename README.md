# Nepal Passport Helper — Desktop

Electron desktop companion for the Nepal passport appointment workspace. It polls
government offices for open appointment slots through the Django backend, queues
clients, auto-books appointments, downloads receipts, and keeps running in the
system tray.

![Overview](docs/screenshots/overview.png)

## What it does

- **Slot Watchers** — per-office watchers with independent schedules, live state
  (checking / backoff / paused / CAPTCHA / auth-expired), jittered intervals and
  exponential backoff in the main process.
- **Booking Queue** — queue document-ready clients per office, run forced
  check-and-book with per-client live progress, idempotent submissions.
- **Clients** — searchable, filterable client list with a detail drawer and
  one-click queueing.
- **Appointments** — booked/cancelled tabs, native receipt downloads, cancel and
  reconcile with official records.
- **Activity** — unified audit feed of checks, queue actions, bookings, cancels.
- **Settings** — server preferences, tray/login behaviour, device management.

All API traffic goes renderer → IPC → main process → Django. The renderer never
talks to the network directly; tokens are stored encrypted via Electron
`safeStorage` (OS keychain). See [docs/SECURITY.md](docs/SECURITY.md) and the
[API contract](docs/API-CONTRACT.md).

## Architecture

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                  │
│  Renderer (React 18)          Preload (CJS, sandboxed)           │
│  ┌───────────────────┐        ┌──────────────────────┐           │
│  │ pages / components│──IPC──▶│ contextBridge        │           │
│  │ TanStack Query    │◀─events│ window.desktop (typed)│          │
│  └───────────────────┘        └──────────┬───────────┘           │
│                                          │                       │
│  Main process                            │                       │
│  ┌───────────────────────────────────────▼───────────────────┐   │
│  │ ipc.ts (validated channels) → api-client.ts (envelope,     │   │
│  │ token refresh) → Django /api/desktop/v1/                   │   │
│  │ scheduler.ts (per-watcher loops, backoff, concurrency cap) │   │
│  │ vault.ts (safeStorage tokens)  store.ts (JSON settings)    │   │
│  │ tray.ts  notifications.ts  net-status.ts  window.ts (CSP)  │   │
│  └────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
                     │ HTTPS (Bearer, rotating refresh)
                     ▼
        Django backend (new-epp project) → government passport service
```

## Repo layout

```
src/main/        Electron main: window, tray, ipc, api-client, scheduler, vault, store, …
src/preload/     contextBridge surface + window.desktop typings
src/renderer/    React app (pages, components, contexts, lib)
src/shared/      API contract types + IPC channel names/validators
e2e/             Playwright e2e + mock server (implements the whole contract in-memory)
tests/unit/      Vitest unit tests (scheduler, store, validators) + component tests
docs/            API contract, security notes, troubleshooting, release checklist, screenshots
```

## Prerequisites

- Node.js 22+ and npm
- The Django backend from the `new-epp` project (see its own docs) running at
  `http://localhost:8000` for development, e.g.
  `cd /path/to/new-epp && .venv/bin/python manage.py runserver 8000`

## Develop

```bash
npm install
EPP_DEV_API_URL=http://localhost:8000 npm run dev
```

Log in with any backend account. In dev builds the login page also accepts a
custom server URL; production builds lock the API URL to the constant in
`src/main/settings.ts` (`PRODUCTION_API_URL` — set it before releasing).

## Test

```bash
npm test              # Vitest: unit (scheduler/store/validators) + component tests
npm run test:e2e      # Playwright: drives the real app against an in-memory mock backend
npm run test:e2e:headed
npm run screenshots   # regenerates docs/screenshots/*.png from the mock backend
```

The e2e suite builds the app, launches it via Playwright `_electron`, and runs
against `e2e/mock-server.ts` — a full in-memory implementation of the API
contract with switchable failure scenarios (`POST /__scenario__`). No real
backend or government calls are made. Two env-gated test hooks exist
(`EPP_E2E=1`): `EPP_USER_DATA_DIR` isolates the vault/config per run, and the
receipt channel skips the native save dialog and writes to the OS temp dir.

## Package

```bash
npm run package        # unpackaged app dir (release/)
npm run package:mac    # macOS zip + dmg (unsigned locally)
npm run package:win    # Windows NSIS installer (unsigned locally)
npm run package:win:zip# Windows zip fallback
```

Unsigned local builds are **not distribution-ready**: Windows SmartScreen and
macOS Gatekeeper will warn. Signed installers are produced by CI
(`.github/workflows/ci.yml`) on Windows/macOS runners with signing secrets —
see [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md).

## Docs

- [docs/API-CONTRACT.md](docs/API-CONTRACT.md) — the fixed backend contract
- [docs/SECURITY.md](docs/SECURITY.md) — token storage, CSP, secret hygiene
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common failure states
- [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) — how to cut a release
- [docs/UI-WALKTHROUGH.md](docs/UI-WALKTHROUGH.md) — screenshot tour
