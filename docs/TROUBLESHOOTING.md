# Troubleshooting

## Login fails

- **"Cannot reach the server"** — the backend is down or the URL is wrong. In
  dev builds, check the server URL field on the login page
  (`http://localhost:8000` by default, or `EPP_DEV_API_URL`). In production the
  URL is locked at build time.
- **"Invalid username or password"** — backend credentials, not the OS account.
- **429 RATE_LIMITED** — wait a minute and retry; the server throttles logins.

## Session expired / signed out unexpectedly

The app refreshes tokens automatically. If the refresh token itself expires or
the device was revoked (Settings → Devices on another machine, or a server-side
sign-out), all watchers stop (`auth-expired`) and the app returns to the login
page. Sign in again — watcher configuration lives on the server and resumes
automatically.

## A watcher shows "CAPTCHA required"

The government site presented a CAPTCHA during a check. That watcher pauses
itself to avoid hammering the site. Solve the CAPTCHA through the normal web
flow (or wait for the session to clear), then press **Resume** on the watcher
card. Other watchers are unaffected.

## A watcher is not running

Check the state badge on the card:

- **Paused** — resume it (local pause never touches the server queue).
- **Retrying** — transient network/server failure; backoff doubles up to 30 min
  and recovers on its own.
- **Error** — a permanent failure (e.g. permission denied for that office). The
  error message is shown on the card; fix the cause, then resume.
- **Offline** — the backend is unreachable; watchers resume when it comes back.
- After sleep, timers are recalculated automatically (power monitor).

## Backend offline behaviour

If the backend is unreachable at launch, the app still opens: the top bar shows
a red "Offline" dot, the login page shows a clean "Cannot reach the server"
error on submit, and watchers go to the `offline` state and resume on their own.

## Tray behaviour

With "Minimize to tray" enabled (default), closing the window hides it — the app
keeps watching in the tray. Use the tray menu **Show** to reopen and **Quit** to
actually exit. Disabling the setting makes the close button quit the app.

## "Secure token storage is unavailable"

Electron `safeStorage` needs an OS keychain: Keychain on macOS, DPAPI on
Windows, and a Secret Service (gnome-keyring / kwallet) on Linux. On headless
Linux there is no keychain — logins will fail with this error until one is
available. Tokens are never written in plaintext as a fallback.

## Windows SmartScreen / macOS Gatekeeper warnings

Locally built installers are unsigned. Windows shows "Windows protected your
PC" (click *More info → Run anyway* for internal use); macOS requires
right-click → Open on first launch. Signed + notarized builds from CI do not
show these warnings — see docs/RELEASE-CHECKLIST.md.

## Logs

There is no file logging by design (tokens must never hit disk). To see
main-process and renderer logs:

- Dev: `ELECTRON_ENABLE_LOGGING=1 npm run dev` pipes renderer console output to
  the terminal alongside main-process output.
- Packaged app: launch from a terminal with `ELECTRON_ENABLE_LOGGING=1` set.
- DevTools are enabled in dev builds (View menu); disabled in production.

Error text never contains tokens or `Authorization` headers — sharing log
output for bug reports is safe.
