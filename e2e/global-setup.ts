import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// e2e drives the built app (main/preload/renderer), so build once per run.
export default function globalSetup(): void {
  const root = join(__dirname, '..');
  const builtMain = join(root, 'dist/main/index.js');
  if (process.env.EPP_E2E_SKIP_BUILD === '1' && existsSync(builtMain)) return;
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}
