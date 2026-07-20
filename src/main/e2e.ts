// E2E test hooks, active only when EPP_E2E=1 (never set in production):
// - EPP_USER_DATA_DIR isolates the vault/config per test run (index.ts)
// - the receipt channel skips the native save dialog and writes to the
//   system temp dir instead (ipc.ts)
// Documented in README.md.
export const isE2E = process.env.EPP_E2E === '1';
