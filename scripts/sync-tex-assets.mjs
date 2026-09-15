/**
 * 将美术同步到 dist/tex。
 * P1：优先拷贝 tex-ship/（压缩产物）；若不存在则回退 P0 过滤拷贝 tex/。
 * 强规则：永不修改 tex/ 源目录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shouldSkipTexShip,
  scanTexShipPlan,
  formatMb,
  normRel,
} from './asset-ship-filter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const texSrc = path.join(root, 'tex');
const texShip = path.join(root, 'tex-ship');
const dest = path.join(root, 'dist', 'tex');
const MANIFEST = 'ship-manifest.json';

function copyDirFull(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (name === '.ship-cache.json') continue; // 缓存不进包
    const srcPath = path.join(from, name);
    const destPath = path.join(to, name);
    if (fs.statSync(srcPath).isDirectory()) copyDirFull(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

function copyFiltered(from, to, relBase = '') {
  fs.mkdirSync(to, { recursive: true });
  let copied = 0;
  let copiedBytes = 0;
  let skipped = 0;
  let skippedBytes = 0;
  /** @type {Record<string, { count: number, bytes: number }>} */
  const skipReasons = {};

  for (const name of fs.readdirSync(from)) {
    const srcPath = path.join(from, name);
    const destPath = path.join(to, name);
    const rel = relBase ? `${relBase}/${name}` : name;
    const st = fs.statSync(srcPath);
    if (st.isDirectory()) {
      const sub = copyFiltered(srcPath, destPath, rel);
      copied += sub.copied;
      copiedBytes += sub.copiedBytes;
      skipped += sub.skipped;
      skippedBytes += sub.skippedBytes;
      for (const [k, v] of Object.entries(sub.skipReasons)) {
        if (!skipReasons[k]) skipReasons[k] = { count: 0, bytes: 0 };
        skipReasons[k].count += v.count;
        skipReasons[k].bytes += v.bytes;
      }
      try {
        if (fs.existsSync(destPath) && fs.readdirSync(destPath).length === 0) {
          fs.rmdirSync(destPath);
        }
      } catch {
        /* ignore */
      }
      continue;
    }

    const decision = shouldSkipTexShip(rel);
    if (decision.skip) {
      skipped += 1;
      skippedBytes += st.size;
      const reason = decision.reason ?? 'skip';
      if (!skipReasons[reason]) skipReasons[reason] = { count: 0, bytes: 0 };
      skipReasons[reason].count += 1;
      skipReasons[reason].bytes += st.size;
      continue;
    }

    fs.copyFileSync(srcPath, destPath);
    copied += 1;
    copiedBytes += st.size;
  }

  return { copied, copiedBytes, skipped, skippedBytes, skipReasons };
}

function dirBytes(dir) {
  let total = 0;
  let files = 0;
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        total += st.size;
        files += 1;
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir);
  return { total, files };
}

if (!fs.existsSync(texSrc)) {
  console.warn('[sync-tex-assets] tex/ not found, skip');
  process.exit(0);
}

const useShip = fs.existsSync(path.join(texShip, MANIFEST));
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}

let report;

if (useShip) {
  console.log('[sync-tex-assets] using tex-ship/ → dist/tex/ (P2 ship; tex/ source untouched)');
  copyDirFull(texShip, dest);
  const shipped = dirBytes(dest);
  let manifestStats = null;
  try {
    manifestStats = JSON.parse(fs.readFileSync(path.join(dest, MANIFEST), 'utf8')).stats;
  } catch {
    /* ignore */
  }
  report = {
    generatedAt: new Date().toISOString(),
    policy: 'P1-tex-ship',
    source: 'tex-ship',
    shippedBytes: shipped.total,
    shippedFiles: shipped.files,
    shippedMb: Number(formatMb(shipped.total)),
    buildStats: manifestStats,
    note: 'Copied from tex-ship/. Source tex/ was not modified.',
  };
  console.log(
    `[sync-tex-assets] shipped ${shipped.files} files, ${formatMb(shipped.total)} MB`,
  );
} else {
  const allowFallback = process.env.ALLOW_TEX_FALLBACK === '1';
  console.error(
    '[sync-tex-assets] FATAL: tex-ship/ship-manifest.json 缺失。移动端/正式打包必须先走标准 ship 流程。',
  );
  console.error('文档: docs/asset-ship-pipeline.md');
  console.error('请执行: npm run assets:build-ship');
  if (!allowFallback) {
    process.exit(1);
  }
  console.warn(
    '[sync-tex-assets] ALLOW_TEX_FALLBACK=1 → 临时回退 P0 过滤（禁止用于正式发布）',
  );
  const plan = scanTexShipPlan(fs, texSrc);
  const srcBytes =
    plan.included.reduce((a, x) => a + x.bytes, 0) + plan.excluded.reduce((a, x) => a + x.bytes, 0);
  const result = copyFiltered(texSrc, dest);
  report = {
    generatedAt: new Date().toISOString(),
    policy: 'P0-ship-filter-fallback',
    source: 'tex',
    sourceTexBytes: srcBytes,
    shippedBytes: result.copiedBytes,
    excludedBytes: result.skippedBytes,
    shippedFiles: result.copied,
    excludedFiles: result.skipped,
    savedMb: Number(formatMb(result.skippedBytes)),
    skipReasons: Object.fromEntries(
      Object.entries(result.skipReasons).map(([k, v]) => [
        k,
        { count: v.count, mb: Number(formatMb(v.bytes)) },
      ]),
    ),
    note: 'EMERGENCY FALLBACK ONLY. Source tex/ is never modified.',
  };
  console.log(
    `[sync-tex-assets] FALLBACK ship | files ${result.copied}/${result.copied + result.skipped} | ` +
      `${formatMb(result.copiedBytes)} MB shipped, ${formatMb(result.skippedBytes)} MB excluded`,
  );
  for (const [reason, v] of Object.entries(result.skipReasons).sort(
    (a, b) => b[1].bytes - a[1].bytes,
  )) {
    console.log(`  - ${reason}: ${v.count} files, ${formatMb(v.bytes)} MB`);
  }
}

const musicSrc = path.join(root, 'music');
const musicDest = path.join(root, 'dist', 'music');
if (fs.existsSync(musicSrc)) {
  if (fs.existsSync(musicDest)) {
    fs.rmSync(musicDest, { recursive: true, force: true });
  }
  copyDirFull(musicSrc, musicDest);
  console.log('[sync-tex-assets] copied music/ → dist/music/');
}

const reportPath = path.join(root, 'dist', 'asset-ship-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`[sync-tex-assets] report: ${normRel(path.relative(root, reportPath))}`);
