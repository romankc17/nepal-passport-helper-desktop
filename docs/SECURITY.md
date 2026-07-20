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
