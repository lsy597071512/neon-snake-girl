#!/usr/bin/env node
/**
 * P3 资源云分发 · R2 批量上传
 *
 * 把 tex-ship/ 的远端层产物（P1/P2，测试期为合并远端包）上传到 R2 桶，
 * 键约定：tex/<outRel>（与网关 /assets/ 路由、客户端 buildCdnUrl 对应）。
 * 同时上传 tex/ship-manifest-cdn.json（客户端弱更探测用）。
 *
 * 用法：
 *   node scripts/upload-tex-r2.mjs            # 实际上传
 *   node scripts/upload-tex-r2.mjs --dry-run  # 只打印计划，不上传
 *
 * 前置：
 *   1. 已跑过 node scripts/build-tex-ship.mjs（生成 tex-ship/ship-manifest-cdn.json）
 *   2. npx wrangler login 且已建桶：npx wrangler r2 bucket create rust-belt-assets
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'rust-belt-assets';
const KEY_PREFIX = 'tex/';
const CONCURRENCY = 6;

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

if (!existsSync(manifestPath)) {
  console.error('缺少 tex-ship/ship-manifest-cdn.json，请先运行 node scripts/build-tex-ship.mjs');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const remoteEntries = Object.entries(manifest.files ?? {}).filter(([, m]) => m && m.tier !== 'P0');

// 上传清单：远端层产物 + 分层清单本身（客户端弱更拉取）
const jobs = remoteEntries.map(([outRel]) => ({
  key: `${KEY_PREFIX}${outRel}`,
  file: path.join(shipDir, outRel),
}));
jobs.push({ key: `${KEY_PREFIX}ship-manifest-cdn.json`, file: manifestPath });

console.log(
  `[r2-upload] 远端层文件 ${remoteEntries.length} 个 + 清单 1 个，目标桶 ${BUCKET}，contentHash=${manifest.contentHash}`,
);
if (dryRun) {
  for (const j of jobs) console.log(`  [dry] ${j.key}`);
  console.log('[r2-upload] dry-run 结束，未上传');
  process.exit(0);
}

function put(job) {
  return new Promise((resolve) => {
    const ext = job.key.split('.').pop().toLowerCase();
    const args = [
      'wrangler',
      'r2',
      'object',
      'put',
      `${BUCKET}/${job.key}`,
      '--file',
      job.file,
      '--remote',
      '--content-type',
      MIME[ext] ?? 'application/octet-stream',
    ];
    execFile('npx', args, { shell: true, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
      resolve({ job, err: err ? String(stderr || err.message || err) : null });
    });
  });
}

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
    const { err } = await put(job);
    done += 1;
    if (err) {
      failed.push({ job, err });
      console.error(`  [fail] ${job.key}: ${err.slice(0, 200)}`);
    } else if (done % 25 === 0 || done === jobs.length) {
      console.log(`  [${done}/${jobs.length}] 已上传`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

if (failed.length) {
  console.error(`[r2-upload] 完成，但有 ${failed.length} 个失败，请重跑本脚本（已传对象覆盖无妨）`);
  process.exit(2);
}
console.log(`[r2-upload] 全部完成：${jobs.length} 个对象。记得把 assetHash=${manifest.contentHash} 写入发布配置（/api/admin/release）`);
