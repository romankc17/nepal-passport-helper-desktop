# Security Notes

## Credential rotation required before distribution

The legacy terminal scripts at `new-epp-scripts/config.toml` contain **production
secrets in plaintext**: the PostgreSQL/Neon `DATABASE_URL`, Cloudflare R2 access
key/secret, the government service bearer token and session cookies
(`PASSPORT_AUTHORIZATION`, `PASSPORT_COOKIE`), and SMTP credentials. These values
must be considered compromised once this repository or any build artifact is
shared. **Rotate all of them before distributing the desktop application.**

None of these values are used by, copied into, or needed by this desktop
application. They live only on the Django server as environment variables.

## What the desktop app never contains

- `DATABASE_URL` / Neon credentials
- R2 access key or secret
- SMTP credentials
- Django `SECRET_KEY`
- Government service cookies or shared bearer tokens
- Admin passwords

The desktop only ever talks to versioned HTTPS Django endpoints
(`/api/desktop/v1/`) with a per-device, revocable token pair.

## Token storage

- Access + refresh tokens are encrypted with Electron `safeStorage` (OS keychain:
  Keychain on macOS, DPAPI on Windows) and stored in the app's userData
  directory. They are never written to `localStorage`, plain files, or logs.
- The refresh token is rotated on every refresh; the server stores only its
  SHA-256 hash. Signing out (or a staff member revoking the device) kills both
  tokens server-side.
- The renderer process never sees tokens. All API calls are made by the main
  process, which attaches the `Authorization` header.

## Renderer hardening

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
  `webSecurity: true`.
- Restrictive Content Security Policy; the renderer cannot open network
  connections to the API origin directly (`connect-src 'self'`).
- Navigation and new-window requests are denied; external links open only after
  URL validation (`https:` only) via the default browser.
- All permission requests (camera, mic, etc.) are denied.
- IPC is a narrow, typed `contextBridge` surface. Every channel validates its
  arguments and the sender frame.

## Logging

- Server and desktop logs redact authorization headers, cookies, tokens, and
  document contents. Activity/history payloads pass through the server's
  `redact_sensitive` before storage and before display.

## Government service

- The app never attempts to bypass CAPTCHA, WAF, or anti-bot verification. When
  the government service returns a 421/CAPTCHA state, the affected watcher
  pauses and shows an actionable state until an operator refreshes the
  server-side session.

## Import from official portal (`src/main/official-import.ts`)

The "Import from official application" flow is built so that official-portal
credentials and session material can never reach the app, the renderer, or the
Django server:

- Sign-in happens in a dedicated, maximally locked-down `BrowserWindow`:
  `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
  `webSecurity: true`, no preload, `devTools` disabled, and an in-memory
  `partition: official-import-<timestamp>` — never `persist:`.
- Navigation is locked to `https://online.nepalpassport.gov.np` via
  `will-navigate` + `will-redirect` guards. Popups are always denied; external
  `https:` links open in the system browser instead. All permission requests
  and checks on the window's session are denied.
- Credentials and the CAPTCHA are typed only into the official page. The app
  never collects, stores, transmits, or logs official passwords, CAPTCHA
  answers, JWTs, refresh tokens, session cookies, or authorization headers.
- Official API calls run inside the page context via
  `webContents.executeJavaScript`: the injected script finds the portal token
  in `localStorage` or a plain (non-HttpOnly) cookie *inside the page*, attaches
  it to a same-origin fetch, and echoes the portal's `XSRF-TOKEN` cookie as an
  `X-XSRF-TOKEN` header (the portal's Spring backend rejects POSTs without it,
  and its own axios client does the same). The script
  returns only `{ status, contentType, body (parsed JSON), hadToken (bool) }`.
  No token ever crosses into main-process variables, logs, or IPC.
- Before anything crosses IPC, a recursive sanitizer in main drops keys
  matching auth/biometric/photo/document/receipt/payment patterns (with a small
  exemption list for mappable document-type fields such as `documentSubtype`
  and `previousDocumentNumber`), caps depth/array/string sizes, and rejects
  payloads over 256 KB. IPC validators repeat the auth-key check on preview and
  confirm payloads, and the Django endpoints reject such keys again with 400.
- The window's session storage, cache, and auth cache are wiped on success,
  cancel, window close, and app quit.
- Only the public portal endpoints are used. The internal endpoints
  `/process-state-controller/applications/{id}` and
  `/interface-adapter/applications/get-application/...` are blocked — never
  call them.
- There is no CAPTCHA bypass or automation, and no arbitrary ID enumeration:
  only the signed-in account's own listed applications or a user-entered WPT ID
  are fetched. The source WPT ID is never persisted (neither locally nor in
  Django).
- The `EPP_OFFICIAL_ORIGIN` override (used to point the window at the e2e mock
  portal) is honored only when `EPP_E2E=1`; production builds ignore it.
