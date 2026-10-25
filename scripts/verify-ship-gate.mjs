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
import { shouldSkipTexShip } from './asset-ship-filter.mjs';

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

/**
 * 0 字节产物 = 手机端整片黑图/空白立绘，且会被 ship 缓存永久固化。
 *
 * 这里刻意「全目录扫描」而不是遍历 manifest.map：
 * map 只收栅格图（png/jpg→webp），.webm / .glb / .mp4 走 passthrough 不进 map，
 * 历史上正是角色动态立绘 webm 为 0 字节却完全绕过本门禁，
 * 表现为「角色说自己换了衣服，但立绘不显示」。任何 0 字节产物一律阻断发布。
 */
function assertNoEmptyShipOutputs(dir, label) {
  const empties = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (st.size === 0) empties.push(path.relative(d, p).replace(/\\/g, '/'));
    }
  };
  if (!fs.existsSync(dir)) {
    fail(`缺少目录 ${label}: ${dir}`);
    return;
  }
  walk(dir);
  if (empties.length) {
    fail(
      `${label} 含 0 字节产物（手机端黑图/立绘空白，共 ${empties.length} 个，前 8 个）: ` +
        `${empties.slice(0, 8).join(', ')}；` +
        '修复 tex/ 源资产后，删除对应 tex-ship/.ship-cache.json 条目再重跑 npm run assets:build-ship',
    );
  }
}

/**
 * 源资产体检：0 字节源 + Windows「(1)」重复副本陷阱。
 * 形如 X.ext 为空、X(1).ext 才是真身 时，重跑 ship 多少次都修不好，
 * 必须在这里点名让人手工回填。
 */
function assertSourceAssetsHealthy() {
  const texDir = path.join(root, 'tex');
  if (!fs.existsSync(texDir)) return;
  const problems = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (st.size !== 0) continue;
      const rel = path.relative(texDir, p).replace(/\\/g, '/');
      // 只体检真正要进包的源：_candidates / beifen / 母带等本就 skip 的目录不参与
      if (shouldSkipTexShip(rel).skip) continue;
      const dup = rel.replace(/(\.[^.]+)$/, '(1)$1');
      const hasRealTwin = fs.existsSync(path.join(texDir, dup));
      problems.push(`${rel}${hasRealTwin ? `（真身疑似 ${dup}，请手工回填）` : ''}`);
    }
  };
  walk(texDir);
  if (problems.length) {
    fail(
      `源资产 tex/ 含 0 字节文件（共 ${problems.length} 个，前 8 个）: ${problems.slice(0, 8).join(', ')}；` +
        '源为空时任何打包/重建都无法修复，必须先补齐源资产',
    );
  }
}

function assertNoForbiddenInDir(texDir, label) {
  if (!fs.existsSync(texDir)) {
    fail(`缺少目录 ${label}: ${texDir}`);
    return;
  }
  // 开始页过场动画白名单（P0 首屏允许在 poster-candidates 内进包）
  // + 过场首帧垫底图（视频首帧渲染前的无缝垫底，防黑屏）
  const POSTER_CUTSCENES = new Set([
    'diyici.mp4',
    'jinru.mp4',
    'xunhuan.mp4',
    'chuqu.mp4',
    'still_diyici.webp',
    'still_xunhuan.webp',
    'still_diyici.png',
    'still_xunhuan.png',
  ]);
  const forbidden = [];
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (
          /^_candidates$|^_old_/i.test(name) ||
          /^beifen$/i.test(name) ||
          /^_h3_out$/i.test(name) ||
          /^_trim_qa$/i.test(name)
        ) {
          forbidden.push(path.relative(texDir, p));
        }
        walk(p);
        continue;
      }
      if (/\.mov$/i.test(name) || name === 'pv01.mp4') {
        forbidden.push(path.relative(texDir, p));
      }
      const relFile = path.relative(texDir, p).replace(/\\/g, '/');
      // poster-candidates 只允许开始页三支过场动画；其余候选视频（如 diyici）禁止进包
      if (/(^|\/)poster-candidates\//i.test(relFile) && !POSTER_CUTSCENES.has(name)) {
        forbidden.push(relFile);
      }
      // 角色区禁止残留 mp4 母带（运行时只用 webm）
      if (/\.mp4$/i.test(name) && /^juese\//i.test(relFile)) {
        forbidden.push(relFile);
      }
    }
  }
  walk(texDir);
  if (forbidden.length) {
    fail(`${label} 含禁止进包文件/目录（前 5 个）: ${forbidden.slice(0, 5).join(', ')}`);
  }
}

assertSourceAssetsHealthy();

const ship = readManifest(shipManifest, 'tex-ship/ship-manifest.json');
assertShipManifest(ship, 'tex-ship');
assertNoForbiddenInDir(path.join(root, 'tex-ship'), 'tex-ship');
assertNoEmptyShipOutputs(path.join(root, 'tex-ship'), 'tex-ship');

const dist = readManifest(distManifest, 'dist/tex/ship-manifest.json');
assertShipManifest(dist, 'dist/tex');
assertNoForbiddenInDir(path.join(root, 'dist', 'tex'), 'dist/tex');
assertNoEmptyShipOutputs(path.join(root, 'dist', 'tex'), 'dist/tex');

if (checkAndroid) {
  const and = readManifest(androidManifest, 'android/.../public/tex/ship-manifest.json');
  assertShipManifest(and, 'android public tex');
  assertNoForbiddenInDir(
    path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'tex'),
    'android public tex',
  );
  assertNoEmptyShipOutputs(
    path.join(root, 'android', 'app', 'src', 'main', 'assets', 'public', 'tex'),
    'android public tex',
  );
}

console.log(`[verify-ship-gate] PASS (policy ${SHIP_POLICY_VERSION})`);
console.log('[verify-ship-gate] 已优化产物不会二次优化（源未变且策略版本未变时走缓存）');
