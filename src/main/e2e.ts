// E2E test hooks, active only when EPP_E2E=1 (never set in production):
// - EPP_USER_DATA_DIR isolates the vault/config per test run (index.ts)
// - EPP_DEV_API_URL points even packaged builds at the local mock server
//   (settings.ts), EPP_OFFICIAL_ORIGIN points the import window at the local
//   mock official portal (official-import.ts)
// - the receipt channel skips the native save dialog and writes to the
//   system temp dir instead (ipc.ts)
// Documented in README.md.
export const isE2E = process.env.EPP_E2E === '1';
