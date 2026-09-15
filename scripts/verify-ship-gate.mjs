/**
 * 打包门禁：强制已走 asset ship 标准流程。
 * 文档：docs/asset-ship-pipeline.md
 *
 * 用法：
 *   node scripts/verify-ship-gate.mjs           # 检查 tex-ship + dist/tex
 *   node scripts/verify-ship-gate.mjs --android # 额外检查 Capacitor 同步产物
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIP_POLICY_VERSION } from './assets-pipeline.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkAndroid = process.argv.includes('--android');
const allowFallback = process.env.ALLOW_TEX_FALLBACK === '1';

const shipManifest = path.join(root, 'tex-ship', 'ship-manifest.json');
const distManifest = path.join(root, 'dist', 'tex', 'ship-manifest.json');
const androidManifest = path.join(
  root,
  'android',
  'app',
  'src',
  'main',
  'assets',
  'public',
  'tex',
  'ship-manifest.json',
);

function fail(msg) {
  console.error(`[verify-ship-gate] FAIL: ${msg}`);
  console.error('标准文档: docs/asset-ship-pipeline.md');
  console.error('请先: npm run assets:build-ship && npm run assets:sync');
  if (allowFallback) {
    console.warn('[verify-ship-gate] ALLOW_TEX_FALLBACK=1 → 仅警告，不阻断（禁止用于正式发布）');
    return false;
  }
  process.exit(1);
}

function readManifest(p, label) {
  if (!fs.existsSync(p)) {
    fail(`缺少 ${label}: ${p}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`${label} 无法解析 JSON: ${e.message}`);
    return null;
  }
}

function assertShipManifest(m, label) {
  if (!m) return;
  if (m.policy !== 'P2-mobile-ship' && m.policy !== 'P1-webp-ship') {
    fail(`${label} policy 必须为 P2-mobile-ship，当前: ${m.policy}`);
  }
  if (!m.shipPolicyVersion || m.shipPolicyVersion !== SHIP_POLICY_VERSION) {
    fail(
      `${label} shipPolicyVersion 须为 ${SHIP_POLICY_VERSION}（当前: ${m.shipPolicyVersion ?? '缺失'}），请重跑 npm run assets:build-ship`,
    );
  }
  const mapCount = m.map ? Object.keys(m.map).length : 0;
  const converted = m.stats?.convertedWebp ?? mapCount;
  if (mapCount < 100 && (converted ?? 0) < 100) {
    // 正常工程应有大量 webp 映射；过少说明 ship 不完整
    fail(`${label} WebP 映射过少（map=${mapCount}），疑似未完整执行 P1`);
  }
  // 禁止进包残留母带
  console.log(`[verify-ship-gate] OK ${label}: map=${mapCount}, policy=${m.policy}`);
}

function assertNoForbiddenInDir(texDir, label) {
  if (!fs.existsSync(texDir)) {
    fail(`缺少目录 ${label}: ${texDir}`);
    return;
  }
  const forbidden = [];
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (/^_candidates$|^_old_/i.test(name) || name === 'poster-candidates') {
          forbidden.push(path.relative(texDir, p));
        }
        walk(p);
        continue;
      }
      if (/\.mov$/i.test(name) || name === 'pv01.mp4') {
        forbidden.push(path.relative(texDir, p));
      }
    }
  }
  walk(texDir);
  if (forbidden.length) {
    fail(`${label} 含禁止进包文件/目录（前 5 个）: ${forbidden.slice(0, 5).join(', ')}`);
  }
}

const ship = readManifest(shipManifest, 'tex-ship/ship-manifest.json');
assertShipManifest(ship, 'tex-ship');
assertNoForbiddenInDir(path.join(root, 'tex-ship'), 'tex-ship');

const dist = readManifest(distManifest, 'dist/tex/ship-manifest.json');
assertShipManifest(dist, 'dist/tex');
assertNoForbiddenInDir(path.join(root, 'dist', 'tex'), 'dist/tex');

if (checkAndroid) {
  const and = readManifest(androidManifest, 'android/.../public/tex/ship-manifest.json');
  assertShipManifest(and, 'android public tex');
  assertNoForbiddenInDir(
    path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'tex'),
    'android public tex',
  );
}

console.log(`[verify-ship-gate] PASS (policy ${SHIP_POLICY_VERSION})`);
console.log('[verify-ship-gate] 已优化产物不会二次优化（源未变且策略版本未变时走缓存）');
