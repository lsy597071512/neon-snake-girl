/**
 * Ensure gateway/.secrets.local.json exists (local backup -> Cloudflare restore).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backupSecretsToLocal,
  restoreSecretsFromBackup,
  secretsReady,
} from './lib/gateway-secrets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (secretsReady()) {
  backupSecretsToLocal();
  process.exit(0);
}

console.log('Missing gateway/.secrets.local.json - trying local backup...');
if (restoreSecretsFromBackup()) {
  console.log('Restored from local backup.');
  process.exit(0);
}

console.log('No backup. Restoring ADMIN_KEY via Cloudflare...');
const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'restore-admin-secrets.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (r.status !== 0) {
  console.error('\nAuto-restore failed. Run login-cloudflare.bat first, then codes-dashboard.bat');
  process.exit(r.status ?? 1);
}

backupSecretsToLocal();
process.exit(0);
