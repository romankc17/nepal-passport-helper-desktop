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
- **Import from official application** — create a Fresh client from an
  application on the official passport portal (manual sign-in in a locked-down
  window, review mapped fields). See the
  [UI walkthrough](docs/UI-WALKTHROUGH.md#import-from-official-application).
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
backend or government calls are made. Env-gated test hooks exist
(`EPP_E2E=1`): `EPP_USER_DATA_DIR` isolates the vault/config per run,
`EPP_DEV_API_URL` points even packaged builds at the mock server,
`EPP_OFFICIAL_ORIGIN` points the official-import window at the local mock
portal (`e2e/mock-official-portal.ts`), and the receipt channel skips the
native save dialog and writes to the OS temp dir.

After `npm run package:mac`, a packaged-build smoke test of the official
import flow (including the navigation lock) can be run with:

```bash
node_modules/.bin/esbuild e2e/packaged-smoke.ts --bundle --platform=node \
  --format=cjs --external:playwright --outfile=/tmp/packaged-smoke.cjs \
  && NODE_PATH=node_modules node /tmp/packaged-smoke.cjs
```

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

## Updates

For the first installation, open the repository's **Releases** page, choose the
latest release, then download the Windows `.exe` or the macOS `.dmg` matching
the computer (`x64` for Intel, `arm64` for Apple silicon).

Every successful push to `main` creates a higher `major.minor.run` version and
a public GitHub release containing installers, blockmaps, and updater metadata.
Installed Windows and macOS apps check that latest release on launch and every
four hours, download it in the background, and show **Update app** in the top
bar plus **Install and restart** in Settings → Update. The current update state
is restored when either view opens, so the button is not lost if the download
finished earlier.

The desktop repository must be public; never embed a GitHub token in the app.
CI injects its own GitHub owner/repository into the packaged update
configuration; local packages do not contain an update feed.

## Docs

- [docs/API-CONTRACT.md](docs/API-CONTRACT.md) — the fixed backend contract
- [docs/SECURITY.md](docs/SECURITY.md) — token storage, CSP, secret hygiene
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common failure states
- [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) — how to cut a release
- [docs/UI-WALKTHROUGH.md](docs/UI-WALKTHROUGH.md) — screenshot tour
