# Release checklist

## 0. Before anything else — secrets

- [ ] Rotate the legacy plaintext secrets listed in
      [SECURITY.md](SECURITY.md) (Neon `DATABASE_URL`, R2 keys, government
      bearer token/cookies, SMTP). They must be considered compromised.
- [ ] Confirm no secrets exist in this repo (`.env.example` holds only the
      dev API URL; tokens live in the OS keychain at runtime).

## 1. Version & configuration

- [ ] Bump `version` in `package.json` (semver).
- [ ] Set the production API URL: `PRODUCTION_API_URL` in
      `src/main/settings.ts`. Production builds lock to this value and ignore
      `EPP_DEV_API_URL` and any stored dev override.

## 2. Quality gates (all must be green)

- [ ] `npm run typecheck`
- [ ] `npm test` (unit + component)
- [ ] `npm run test:e2e` (Playwright against the mock backend)
- [ ] `npm run build`
- [ ] CI `test` job green on the release commit.

## 3. Signing (CI runners)

Windows (`windows-latest`):

- [ ] `WIN_CSC_LINK` — base64-encoded .p12 code-signing certificate
- [ ] `WIN_CSC_KEY_PASSWORD` — certificate password
- [ ] Note: an unsigned NSIS installer triggers SmartScreen. Ship only signed
      installers from the CI `build` job; the local `npm run package:win`
      output is for testing, not distribution.

macOS (`macos-latest`):

- [ ] `CSC_LINK` / `CSC_KEY_PASSWORD` — Developer ID Application .p12
- [ ] `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — notarization

## 4. Release

- [ ] Tag `vX.Y.Z` and push — CI builds signed artifacts on both runners and
      attaches them (plus `.blockmap` files) to a GitHub release.
- [ ] Sanity-check the Windows installer on a clean machine (install, sign in,
      watcher runs, receipt download, tray quit).
- [ ] Sanity-check the macOS dmg likewise (Gatekeeper should not warn once
      signed + notarized).

## 5. Auto-update (future)

- [ ] The release job already publishes installers with blockmaps in the layout
      `electron-updater` expects. Wiring `electron-updater` into the app
      (`publish` provider in the electron-builder config + update check in
      main) is deliberately left for a later phase — keep `publish: null`
      locally until then.
