/**
 * 码池面板凭据：项目内 gateway/.secrets.local.json + 本机备份（换机/同步丢文件时可恢复）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SECRETS_PATH = path.join(root, 'gateway', '.secrets.local.json');

export function backupSecretsPath() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
  return path.join(base, 'rust-belt-era', 'codes-dashboard-secrets.json');
}

export function readSecretsFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const sec = JSON.parse(raw);
  const url = (sec.url ?? '').replace(/\/$/, '');
  const adminKey = sec.ADMIN_KEY ?? '';
  if (!url || !adminKey) throw new Error('缺少 url 或 ADMIN_KEY');
  return { url, adminKey, raw: sec };
}

export function secretsReady() {
  try {
    if (!fs.existsSync(SECRETS_PATH)) return false;
    readSecretsFile(SECRETS_PATH);
    return true;
  } catch {
    return false;
  }
}

export function restoreSecretsFromBackup() {
  const backup = backupSecretsPath();
  if (!fs.existsSync(backup)) return false;
  try {
    readSecretsFile(backup);
    fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true });
    fs.copyFileSync(backup, SECRETS_PATH);
    return true;
  } catch {
    return false;
  }
}

export function backupSecretsToLocal() {
  if (!fs.existsSync(SECRETS_PATH)) return false;
  try {
    const backup = backupSecretsPath();
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(SECRETS_PATH, backup);
    return backup;
  } catch {
    return false;
  }
}
