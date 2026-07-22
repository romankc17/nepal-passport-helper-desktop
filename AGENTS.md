# AGENTS.md

## Official portal import

`src/main/official-import.ts` opens a locked-down, non-persistent BrowserWindow on `https://online.nepalpassport.gov.np` for manual sign-in; official API calls run inside the page via `webContents.executeJavaScript` (the token never leaves the page) and only sanitized JSON crosses IPC. Never add a preload, a `persist:` partition, or generic JS/URL IPC channels to this window. E2E can override the origin with `EPP_OFFICIAL_ORIGIN` (honored only when `EPP_E2E=1`, see `src/main/e2e.ts`).

## Backend

The Django backend for this desktop app lives at `~/dev/new-epp` (absolute: `/Users/roman/dev/new-epp`). It can be read and changed directly there — server-side behavior (API endpoints, validation rules, error messages) should be fixed in that repo, not worked around in this one.

- Desktop API v1 endpoints: `appointments/desktop_api_v1.py` (routes in `appointments/urls.py`, prefix `api/desktop/v1/`)
- Legacy desktop API: `appointments/desktop_api.py` (prefix `desktop-api/`)
- Run backend tests with its venv: `cd ~/dev/new-epp && .venv/bin/python manage.py test appointments.tests_desktop_v1`
- The backend repo has its own `AGENTS.md` — follow it when editing there.
