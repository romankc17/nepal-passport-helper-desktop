# Release checklist

## 0. Before anything else — secrets

- [ ] Rotate the legacy plaintext secrets listed in
      [SECURITY.md](SECURITY.md) (Neon `DATABASE_URL`, R2 keys, government
      bearer token/cookies, SMTP). They must be considered compromised.
- [ ] Confirm no secrets exist in this repo (`.env.example` holds only the
      dev API URL; tokens live in the OS keychain at runtime).

## 1. Version & configuration

- [ ] Keep the distribution repository public. Auto-update must not ship a
      private-repository token inside the application.
- [ ] Bump `major.minor` in `package.json` only for a planned major/minor
      release. CI uses the GitHub workflow run number as the patch version on
      every `main` push.
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

- [ ] Push or merge to `main`. CI creates `v<major>.<minor>.<run-number>` and
      publishes `.exe`, `.dmg`, `.zip`, `.blockmap`, `latest.yml`, and
      `latest-mac.yml` assets to a GitHub release.
- [ ] For first-time installs, direct users to GitHub → Releases → Latest and
      have them download `.exe` on Windows or `.dmg` on macOS.
- [ ] Sanity-check the Windows installer on a clean machine (install, sign in,
      watcher runs, receipt download, tray quit).
- [ ] Sanity-check the macOS dmg likewise (Gatekeeper should not warn once
      signed + notarized).

## 5. Auto-update

- [ ] Confirm packaged builds check for updates on launch (logs in main process).
      Dev/unpackaged builds skip auto-check; the Settings → Update card still
      shows the current version and lets users check manually.
- [ ] After a release is published, verify a packaged build from the previous
      version detects the new release and prompts to install.
- [ ] If auto-update is ever disabled for a release, set the `GH_TOKEN` env var
      only on CI runners and never commit it.
