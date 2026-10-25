#!/usr/bin/env node
/**
 * P3 资源云分发 · Backblaze B2 批量上传（免信用卡方案，替代 R2）
 *
 * 把 tex-ship/ 的远端层产物（P1/P2，测试期为合并远端包）上传到 B2 私有桶，
 * 键约定：tex/<outRel>（与网关 /assets/ 路由、客户端 buildCdnUrl 对应）。
 * 同时上传 tex/ship-manifest-cdn.json（客户端弱更探测用）。
 * 桶为 allPrivate：新账号无支付记录无法建公开桶；玩家访问统一走
 * Worker /assets/ 代理（Worker 持有凭证），B2↔Cloudflare 带宽联盟免流量费。
 *
 * 用法：
 *   node scripts/upload-tex-b2.mjs            # 实际上传
 *   node scripts/upload-tex-b2.mjs --dry-run  # 只打印计划，不上传
 *
 * 凭证（二选一，不入库）：
 *   - 环境变量 B2_KEY_ID + B2_APP_KEY
 *   - gateway/.secrets.local.json 里加 "B2_KEY_ID" / "B2_APP_KEY"
 *
 * 上传完成后桶即私有可用，Worker 侧通过 B2_KEY_ID/B2_APP_KEY 两个 secret 取文件。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET_NAME = 'rust-belt-assets';
const KEY_PREFIX = 'tex/';
const CONCURRENCY = 6;
const MAX_RETRY = 3;

const MIME = {
  webp: 'image/webp',
  webm: 'video/webm',
  mp4: 'video/mp4',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  vtt: 'text/vtt; charset=utf-8',
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shipDir = path.join(root, 'tex-ship');
const manifestPath = path.join(shipDir, 'ship-manifest-cdn.json');
const dryRun = process.argv.includes('--dry-run');

function readSecrets() {
  let keyId = process.env.B2_KEY_ID ?? '';
  let appKey = process.env.B2_APP_KEY ?? '';
  if (!keyId || !appKey) {
    try {
      const s = JSON.parse(readFileSync(path.join(root, 'gateway', '.secrets.local.json'), 'utf8'));
      keyId = keyId || s.B2_KEY_ID || '';
      appKey = appKey || s.B2_APP_KEY || '';
    } catch {
      /* ignore */
    }
  }
  return { keyId, appKey };
}

if (!existsSync(manifestPath)) {
  console.error('缺少 tex-ship/ship-manifest-cdn.json，请先运行 node scripts/build-tex-ship.mjs');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const remoteEntries = Object.entries(manifest.files ?? {}).filter(([, m]) => m && m.tier !== 'P0');

const jobs = remoteEntries.map(([outRel]) => ({
  key: `${KEY_PREFIX}${outRel}`,
  file: path.join(shipDir, outRel),
}));
jobs.push({ key: `${KEY_PREFIX}ship-manifest-cdn.json`, file: manifestPath });

console.log(
  `[b2-upload] 远端层文件 ${remoteEntries.length} 个 + 清单 1 个，目标桶 ${BUCKET_NAME}，contentHash=${manifest.contentHash}`,
);
if (dryRun) {
  for (const j of jobs) console.log(`  [dry] ${j.key}`);
  console.log('[b2-upload] dry-run 结束，未上传');
  process.exit(0);
}

const { keyId, appKey } = readSecrets();
if (!keyId || !appKey) {
  console.error('缺少 B2 凭证：请设置环境变量 B2_KEY_ID/B2_APP_KEY，或写入 gateway/.secrets.local.json');
  process.exit(1);
}

/* ---------- B2 原生 API ---------- */

async function b2Authorize() {
  const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${appKey}`).toString('base64')}` },
  });
  if (!res.ok) throw new Error(`B2 授权失败 HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    apiUrl: data.apiInfo.storageApi.apiUrl,
    token: data.authorizationToken,
    accountId: data.accountId,
    downloadUrl: data.apiInfo.storageApi.downloadUrl,
  };
}

async function b2Call(auth, api, body) {
  const res = await fetch(`${auth.apiUrl}/b2api/v3/${api}`, {
    method: 'POST',
    headers: { Authorization: auth.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${api} 失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function ensureBucket(auth) {
  const list = await b2Call(auth, 'b2_list_buckets', { accountId: auth.accountId });
  const found = (list.buckets ?? []).find((b) => b.bucketName === BUCKET_NAME);
  if (found) return found.bucketId;
  const created = await b2Call(auth, 'b2_create_bucket', {
    accountId: auth.accountId,
    bucketName: BUCKET_NAME,
    bucketType: 'allPrivate',
  });
  console.log(`[b2-upload] 已创建私有桶 ${BUCKET_NAME}`);
  return created.bucketId;
}

async function uploadOne(auth, bucketId, job) {
  const buf = readFileSync(job.file);
  const sha1 = createHash('sha1').update(buf).digest('hex');
  const ext = job.key.split('.').pop().toLowerCase();

  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      const up = await b2Call(auth, 'b2_get_upload_url', { bucketId });
      const res = await fetch(up.uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: up.authorizationToken,
          'X-Bz-File-Name': encodeURIComponent(job.key),
          'Content-Type': MIME[ext] ?? 'application/octet-stream',
          'Content-Length': String(buf.byteLength),
          'X-Bz-Content-Sha1': sha1,
        },
        body: buf,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('上传失败');
}

/* ---------- 主流程 ---------- */

const auth = await b2Authorize();
const bucketId = await ensureBucket(auth);

let done = 0;
const failed = [];
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    if (!job) return;
    if (!existsSync(job.file)) {
      failed.push({ job, err: '本地文件缺失' });
      continue;
    }
    try {
      await uploadOne(auth, bucketId, job);
    } catch (err) {
      failed.push({ job, err: String(err?.message ?? err) });
      console.error(`  [fail] ${job.key}: ${String(err?.message ?? err).slice(0, 200)}`);
    }
    done += 1;
    if (done % 25 === 0 || done === jobs.length) console.log(`  [${done}/${jobs.length}] 已处理`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

if (failed.length) {
  console.error(`[b2-upload] 完成，但有 ${failed.length} 个失败，请重跑本脚本（同名覆盖无妨）`);
  process.exit(2);
}
console.log(`[b2-upload] 全部完成：${jobs.length} 个对象`);
console.log('[b2-upload] 完成。Worker 已持 B2 凭证代理访问，无需再配 B2_ORIGIN。');
console.log(`[b2-upload] 发布配置 assetHash=${manifest.contentHash}`);
