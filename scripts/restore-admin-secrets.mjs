/**
 * Restore local codes-dashboard credentials.
 * Rotates ADMIN_KEY only (does not touch Worker LICENSE_SECRET).
 *
 *   node scripts/restore-admin-secrets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { SECRETS_PATH, backupSecretsToLocal } from './lib/gateway-secrets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsPath = SECRETS_PATH;
const wranglerJs = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const PRIMARY_URL = 'https://license.youziligames.com';
const FALLBACK_URL = 'https://rust-belt-license.lsy-games.workers.dev';

function randSecret() {
  return crypto.randomBytes(36).toString('base64').replace(/[+/=]/g, (c) => ({ '+': 'a', '/': 'b', '=': 'c' })[c]);
}

function wrangler(args, { input } = {}) {
  const r = spawnSync(process.execPath, [wranglerJs, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    env: process.env,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim();
    throw new Error(`wrangler ${args.join(' ')} failed: ${err || r.status}`);
  }
  return (r.stdout || '') + (r.stderr || '');
}

console.log('==> check Cloudflare login');
const who = wrangler(['whoami']);
if (/not authenticated|Please run.? wrangler login/i.test(who)) {
  throw new Error('Not logged in. Run: node node_modules/wrangler/bin/wrangler.js login');
}
console.log(who.trim().split('\n').slice(-3).join('\n'));

let url = PRIMARY_URL;
let licenseSecret = '';
if (fs.existsSync(secretsPath)) {
  try {
    const old = JSON.parse(fs.readFileSync(secretsPath, 'utf8').replace(/^\uFEFF/, ''));
    if (old.url) url = String(old.url);
    if (old.LICENSE_SECRET) licenseSecret = String(old.LICENSE_SECRET);
    console.log(`==> reuse url: ${url}`);
  } catch {
    /* ignore */
  }
}

const adminKey = randSecret();
console.log('==> put Worker ADMIN_KEY (rotate admin password only)');
wrangler(['secret', 'put', 'ADMIN_KEY', '--name', 'rust-belt-license'], { input: adminKey });

const sec = {
  url,
  ADMIN_KEY: adminKey,
  LICENSE_SECRET: licenseSecret,
  note: 'ADMIN_KEY rotated by restore-admin-secrets.mjs; LICENSE_SECRET unchanged on Worker if empty here',
};
fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
fs.writeFileSync(secretsPath, JSON.stringify(sec, null, 2) + '\n', 'utf8');
const backup = backupSecretsToLocal();
console.log(`==> wrote ${secretsPath}`);
if (backup) console.log(`==> backup ${backup}`);

async function ping(u) {
  const res = await fetch(`${u}/api/ping`, { signal: AbortSignal.timeout(20000) });
  return res.json();
}

try {
  const p = await ping(url);
  console.log('==> ping ok', JSON.stringify(p));
} catch (e1) {
  console.warn(`==> ping ${url} failed: ${e1.message}; try fallback`);
  try {
    const p = await ping(FALLBACK_URL);
    console.log('==> ping ok', JSON.stringify(p));
    sec.url = FALLBACK_URL;
    fs.writeFileSync(secretsPath, JSON.stringify(sec, null, 2) + '\n', 'utf8');
    console.log(`==> switched url to ${FALLBACK_URL}`);
  } catch (e2) {
    console.warn(`==> both ping failed (${e2.message}). Dashboard can start but list/generate may 502.`);
  }
}

console.log('\nDone. Start dashboard: node scripts/codes-dashboard.mjs');
console.log('Or double-click 码池管理.bat');
