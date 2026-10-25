#!/usr/bin/env node
/**
 * 云端美术同步门禁（打包规范 §0.2 通道③）
 *
 * 回答并处理一个问题：**B2 远端层美术是否与本地 tex-ship 一致？**
 *
 * 用法：
 *   node scripts/check-cloud-assets.mjs            # 只检查，不同步则非零退出（打包前置门禁）
 *   node scripts/check-cloud-assets.mjs --sync     # 检查 + 自动补齐云端（缺什么传什么 + 回写 assetHash）
 *   node scripts/check-cloud-assets.mjs --verbose  # 打印逐条差异（默认只打印摘要）
 *
 * 判定口径：
 *   - 逐条比对 `ship-manifest-cdn.json` 的 tier/size/sha256（远端层 P1/P2 为主，P0 也一并核对存在性）
 *   - 云端清单 contentHash 必须等于本地 contentHash
 *   - 网关 release 配置的 assetHash 必须等于本地 contentHash
 *     否则客户端弱更探测会误判「资源要更新」，每次启动白拉一遍清单。
 *
 * 退出码：0 = 云端已最新；1 = 需要同步（--sync 模式下同步失败同样为 1）。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIP_DIR = path.join(ROOT, 'tex-ship');
const CDN_MANIFEST = path.join(SHIP_DIR, 'ship-manifest-cdn.json');

const args = process.argv.slice(2);
const SYNC = args.includes('--sync');
const VERBOSE = args.includes('--verbose');

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
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  glb: 'model/gltf-binary',
  fbx: 'application/octet-stream',
};

function readSecrets() {
  const out = { url: '', adminKey: '', keyId: '', appKey: '' };
  out.keyId = process.env.B2_KEY_ID ?? '';
  out.appKey = process.env.B2_APP_KEY ?? '';
  out.adminKey = process.env.ADMIN_KEY ?? '';
  try {
    const s = JSON.parse(readFileSync(path.join(ROOT, 'gateway', '.secrets.local.json'), 'utf8'));
    out.url = s.url || '';
    out.adminKey = out.adminKey || s.ADMIN_KEY || '';
    out.keyId = out.keyId || s.B2_KEY_ID || '';
    out.appKey = out.appKey || s.B2_APP_KEY || '';
  } catch {
    /* ignore */
  }
  return out;
}

function fail(msg) {
  console.error(`[cloud-assets] ${msg}`);
  process.exit(1);
}

if (!existsSync(CDN_MANIFEST)) {
  fail('缺少 tex-ship/ship-manifest-cdn.json，请先运行 npm run assets:build-ship');
}

const local = JSON.parse(readFileSync(CDN_MANIFEST, 'utf8'));
const localFiles = local.files ?? {};
const localHash = local.contentHash;
const remoteLayer = Object.keys(localFiles).filter((k) => localFiles[k].tier !== 'P0');

/* ---------------- B2 ---------------- */

async function b2Authorize(keyId, appKey) {
  const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${appKey}`).toString('base64')}` },
  });
  if (!res.ok) throw new Error(`B2 授权失败 HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    apiUrl: data.apiInfo.storageApi.apiUrl,
    token: data.authorizationToken,
    accountId: data.accountId,
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
  console.log(`[cloud-assets] 已创建私有桶 ${BUCKET_NAME}`);
  return created.bucketId;
}

async function uploadOne(auth, bucketId, key, file) {
  const buf = readFileSync(file);
  const sha1 = createHash('sha1').update(buf).digest('hex');
  const ext = key.split('.').pop().toLowerCase();
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      const up = await b2Call(auth, 'b2_get_upload_url', { bucketId });
      const res = await fetch(up.uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: up.authorizationToken,
          'X-Bz-File-Name': encodeURIComponent(key),
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

/* ---------------- 主流程 ---------------- */

const secrets = readSecrets();
const base = (secrets.url || 'https://license.youziligames.com').replace(/\/$/, '');
const manifestUrl = `${base}/assets/tex/ship-manifest-cdn.json?t=${Date.now()}`;

console.log('[cloud-assets] —— 云端美术同步检查 ——');
console.log(`  本地 contentHash: ${localHash}`);
console.log(`  本地分层数量:     P0 ${countTier('P0')} / P1 ${countTier('P1')} / P2 ${countTier('P2')}`);
console.log(`  远端层(P1/P2):    ${remoteLayer.length} 个文件`);

function countTier(tier) {
  return Object.keys(localFiles).filter((k) => localFiles[k].tier === tier).length;
}

let remote = null;
try {
  const res = await fetch(manifestUrl, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  remote = await res.json();
} catch (err) {
  console.log(`  ⚠ 拉取云端清单失败：${err?.message ?? err}`);
}

let version = null;
try {
  const res = await fetch(`${base}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  version = await res.json();
} catch {
  /* 网关不可达时只影响 assetHash 校验 */
}

const problems = [];

if (!remote) {
  problems.push('云端分层清单不可达（Worker 未部署 / 网络异常）');
} else {
  const remoteFiles = remote.files ?? {};
  console.log(`  云端 contentHash: ${remote.contentHash ?? '（无）'}`);

  const localOnly = Object.keys(localFiles).filter((k) => !remoteFiles[k]);
  const remoteOnly = Object.keys(remoteFiles).filter((k) => !localFiles[k]);
  const changed = Object.keys(localFiles).filter((k) => {
    const a = localFiles[k];
    const b = remoteFiles[k];
    return b && (a.size !== b.size || a.sha256 !== b.sha256 || a.tier !== b.tier);
  });
  const remoteLayerChanged = changed.filter((k) => localFiles[k].tier !== 'P0');

  if (localOnly.length) {
    const tiers = localOnly.reduce((acc, k) => {
      const t = localFiles[k].tier;
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`  本地独有:         ${localOnly.length} 条 (${Object.entries(tiers).map(([t, n]) => `${t} ${n}`).join(', ')})`);
    if (VERBOSE || remoteLayerChanged.length || localOnly.some((k) => localFiles[k].tier !== 'P0')) {
      for (const k of localOnly.slice(0, VERBOSE ? localOnly.length : 8)) console.log(`    + [${localFiles[k].tier}] ${k}`);
      if (!VERBOSE && localOnly.length > 8) console.log(`    ... 其余 ${localOnly.length - 8} 条（--verbose 看全部）`);
    }
  }
  if (remoteOnly.length) {
    console.log(`  云端独有:         ${remoteOnly.length} 条（本地已删，同步会保留旧文件但清单不再引用）`);
    if (VERBOSE) for (const k of remoteOnly) console.log(`    - [${remoteFiles[k].tier}] ${k}`);
  }
  if (changed.length) {
    console.log(`  内容已变更:       ${changed.length} 条（其中远端层 ${remoteLayerChanged.length} 条）`);
    if (VERBOSE) for (const k of changed.slice(0, 40)) console.log(`    ~ [${localFiles[k].tier}] ${k}`);
  }

  if (remote.contentHash !== localHash) {
    problems.push(`云端清单 contentHash(${remote.contentHash ?? '无'}) ≠ 本地(${localHash})`);
  }
  // 远端层内容变化才是「玩家会受影响」的硬同步项；P0 变化只影响清单一致性
  if (remoteLayerChanged.length) {
    problems.push(`远端层(P1/P2)有 ${remoteLayerChanged.length} 个文件内容与云端不一致`);
  }
  // 远端层有文件本地没有 → 云端多出来的美术，不影响出包，提示即可
  const remoteLayerRemoteOnly = remoteOnly.filter((k) => remoteFiles[k].tier !== 'P0');
  if (remoteLayerRemoteOnly.length) {
    console.log(`  提示：云端有 ${remoteLayerRemoteOnly.length} 个本地已删除的远端层文件（保留无害）`);
  }
}

if (version) {
  console.log(`  线上 assetHash:   ${version.assetHash || '（无）'}`);
  if (version.assetHash !== localHash) {
    problems.push(`网关 release.assetHash(${version.assetHash || '无'}) ≠ 本地(${localHash})`);
  }
}

/* ---------------- 结论 ---------------- */

if (!problems.length) {
  console.log('[cloud-assets] ✓ 云端美术与本地工程一致（三处 hash 对齐）');
  process.exit(0);
}

console.log('');
console.log('[cloud-assets] ⚠ 云端需要同步：');
for (const p of problems) console.log(`  - ${p}`);

if (!SYNC) {
  console.log('');
  console.log('  修复（一条命令，自动补齐缺失/变更文件并回写 assetHash）：');
  console.log('    npm run assets:sync-cloud');
  console.log('  文档：docs/asset-ship-pipeline.md §0.2 通道③');
  process.exit(1);
}

/* ---------------- 同步 ---------------- */

console.log('');
console.log('[cloud-assets] 开始同步到 B2 …');

if (!secrets.keyId || !secrets.appKey) {
  fail('缺少 B2 凭证：设置 B2_KEY_ID/B2_APP_KEY，或写入 gateway/.secrets.local.json');
}
if (!secrets.adminKey) {
  fail('缺少 ADMIN_KEY：无法回写网关 release 配置（gateway/.secrets.local.json）');
}

const auth = await b2Authorize(secrets.keyId, secrets.appKey);
const bucketId = await ensureBucket(auth);

const remoteFiles = remote?.files ?? {};
/** 需要上传的文件：本地存在、且云端缺失或 size/sha256 不同 */
const todo = [];
for (const outRel of Object.keys(localFiles)) {
  const meta = localFiles[outRel];
  const r = remoteFiles[outRel];
  if (r && r.size === meta.size && r.sha256 === meta.sha256) continue;
  const file = path.join(SHIP_DIR, outRel);
  if (!existsSync(file)) {
    console.log(`  ! 本地产物缺失，跳过：${outRel}`);
    continue;
  }
  todo.push({ key: `${KEY_PREFIX}${outRel}`, file, outRel });
}
// 分层清单永远最后单独传（保证「先有文件、后有清单引用」）

console.log(`[cloud-assets] 需上传 ${todo.length} 个产物`);
let done = 0;
let cursor = 0;
const failed = [];
async function worker() {
  while (cursor < todo.length) {
    const job = todo[cursor++];
    if (!job) return;
    try {
      await uploadOne(auth, bucketId, job.key, job.file);
    } catch (err) {
      failed.push({ key: job.key, err: String(err?.message ?? err) });
      console.error(`  [fail] ${job.key}: ${String(err?.message ?? err).slice(0, 160)}`);
    }
    done += 1;
    if (done % 25 === 0 || done === todo.length) console.log(`  [${done}/${todo.length}] 已上传`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

if (failed.length) {
  fail(`${failed.length} 个文件上传失败，请重跑 npm run assets:sync-cloud（同名覆盖无妨）`);
}

// 1) 上传新分层清单
await uploadOne(auth, bucketId, `${KEY_PREFIX}ship-manifest-cdn.json`, CDN_MANIFEST);
console.log('[cloud-assets] 已上传 ship-manifest-cdn.json');

// 2) 回写网关 release.assetHash（保持 latestBuild/minBuild/notes 不变）
try {
  const cur = version ?? { latestBuild: 0, minBuild: 0, apkUrl: '', notes: '' };
  const res = await fetch(`${base}/api/admin/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': secrets.adminKey },
    body: JSON.stringify({ ...cur, assetHash: localHash }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  console.log(`[cloud-assets] 已回写 assetHash=${localHash}`);
} catch (err) {
  fail(`回写 assetHash 失败：${err?.message ?? err}\n  云端文件已上传，请手工 POST /api/admin/release 修正 assetHash`);
}

// 3) 复核
console.log('[cloud-assets] 复核 …');
await new Promise((r) => setTimeout(r, 1200));
try {
  const [mres, vres] = await Promise.all([
    fetch(`${base}/assets/tex/ship-manifest-cdn.json?t=${Date.now()}`, { cache: 'no-store' }),
    fetch(`${base}/api/version`, { cache: 'no-store' }),
  ]);
  const m = await mres.json();
  const v = await vres.json();
  if (m.contentHash !== localHash) fail(`复核失败：云端清单 ${m.contentHash} ≠ 本地 ${localHash}`);
  if (v.assetHash !== localHash) fail(`复核失败：线上 assetHash ${v.assetHash} ≠ 本地 ${localHash}`);
  console.log(`[cloud-assets] ✓ 同步完成：云端清单与 assetHash 均=${localHash}`);
  process.exit(0);
} catch (err) {
  fail(`复核异常：${err?.message ?? err}（文件与配置已写入，稍后可用 npm run assets:check-cloud 复查）`);
}
