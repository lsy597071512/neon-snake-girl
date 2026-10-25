/**
 * 发布新鲜度总检查：多智能体并行改代码后，测试前跑一下，
 * 一条命令回答「三条发布通道分别要不要补操作」。
 *
 * 通道① APK：src/、tex/、music/、gateway/、scripts/ 等最新改动时间 vs 桌面 APK 构建时间
 * 通道② Worker：gateway/worker.js 改动时间 vs wrangler 最近一次部署时间
 * 通道③ B2 资源：本地 tex-ship 清单 contentHash vs 网关 release 的 assetHash
 *
 * 用法：node scripts/check-build-stale.mjs
 * 退出码：0 = 全部最新；1 = 至少一条通道需要补操作。
 */
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const APK_DIR = join(homedir(), 'Desktop', 'rust-belt-era-apk');
const BUILD_STAMP = join(APK_DIR, 'build-stamp.json');
/** 优先看 release 包（发版用），没有再退回 debug 包 */
function findApk() {
  const candidates = [join(APK_DIR, 'rust-belt-era-release.apk'), join(APK_DIR, 'rust-belt-era-debug.apk')];
  return candidates.find((p) => existsSync(p)) ?? null;
}
const APK = findApk();
const GATEWAY_BASE = 'https://license.youziligames.com';

const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
let stale = false;

/* ---------- 通道①：APK 是否包含最新源码 ---------- */
const WATCH_DIRS = ['src', 'gateway', 'scripts', 'tex', 'music'];
const WATCH_FILES = ['vite.config.ts', 'package.json', 'index.html'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'tex-ship']);

let newest = { time: 0, file: '' };
function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p);
    } else if (extname(e.name) !== '.map') {
      const st = statSync(p);
      if (st.mtimeMs > newest.time) newest = { time: st.mtimeMs, file: p };
    }
  }
}
for (const d of WATCH_DIRS) walk(join(ROOT, d));
for (const f of WATCH_FILES) {
  const p = join(ROOT, f);
  if (existsSync(p)) {
    const st = statSync(p);
    if (st.mtimeMs > newest.time) newest = { time: st.mtimeMs, file: p };
  }
}

console.log('—— 通道① APK 打包 ——');
if (!APK) {
  console.log(`⚠ 未找到 APK（${APK_DIR}），需要 npm run build:apk:release`);
  stale = true;
} else {
  // Windows copyFileSync 保留源 mtime + gradle UP-TO-DATE，APK 的 mtime 不可靠；
  // 以 build-stamp.json 的真实构建时间为准，缺失才退回文件 mtime。
  let apkTime = statSync(APK).mtimeMs;
  let timeSource = '文件修改时间';
  if (existsSync(BUILD_STAMP)) {
    try {
      const stamp = JSON.parse(readFileSync(BUILD_STAMP, 'utf8'));
      const t = Date.parse(stamp.builtAt);
      if (Number.isFinite(t)) {
        apkTime = t;
        timeSource = 'build-stamp.json';
      }
    } catch {
      /* 戳记损坏则退回 mtime */
    }
  }
  console.log(`  APK:            ${APK}`);
  console.log(`  APK 构建时间:  ${fmt(apkTime)}  (${timeSource})`);
  console.log(`  源码最新改动:  ${fmt(newest.time)}  (${newest.file.replace(ROOT + '\\', '')})`);
  if (newest.time > apkTime) {
    console.log('  ⚠ 源码比 APK 新 → 需要重打包：npm run build:apk:release');
    stale = true;
  } else {
    console.log('  ✓ APK 已包含全部最新源码');
  }
}

/* ---------- 通道②：Worker 是否已部署 ---------- */
console.log('\n—— 通道② Worker 网关 ——');
const workerFile = join(ROOT, 'gateway', 'worker.js');
try {
  const workerMtime = statSync(workerFile).mtimeMs;
  const out = execSync('npx wrangler deployments list --name rust-belt-license', {
    cwd: join(ROOT, 'gateway'),
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30000,
  }).toString();
  // 输出里含 ISO 时间戳，取最新的一个
  const stamps = [...out.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g)].map((m) => Date.parse(m[0]));
  const deployedAt = stamps.length ? Math.max(...stamps) : 0;
  console.log(`  worker.js 改动:  ${fmt(workerMtime)}`);
  console.log(`  最近部署时间:    ${deployedAt ? fmt(deployedAt) : '（解析失败）'}`);
  if (!deployedAt || workerMtime > deployedAt + 60 * 1000) {
    console.log('  ⚠ worker.js 可能比线上新 → 需要 cd gateway && npx wrangler deploy');
    stale = true;
  } else {
    console.log('  ✓ 线上 Worker 已是最新');
  }
} catch {
  console.log('  ? 无法查询部署状态（wrangler 未登录或网络问题），请人工确认 worker.js 改动后是否 deploy 过');
}

/* ---------- 通道③：B2 远端资源是否与本地清单一致 ---------- */
console.log('\n—— 通道③ B2 远端资源 ——');
const localManifestPath = join(ROOT, 'tex-ship', 'ship-manifest-cdn.json');
const apkBundledManifest = join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public', 'tex', 'ship-manifest-cdn.json');
try {
  const manifest = JSON.parse(readFileSync(localManifestPath, 'utf8'));
  const res = await fetch(`${GATEWAY_BASE}/api/version`, { signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  console.log(`  本地清单 hash:   ${manifest.contentHash}`);
  console.log(`  线上 assetHash:  ${data.assetHash ?? '（无）'}`);
  if (data.assetHash !== manifest.contentHash) {
    console.log('  ⚠ 不一致 → 需要 npm run assets:sync-cloud');
    stale = true;
  } else {
    console.log('  ✓ 远端资源与本地清单一致');
  }
  // APK 内嵌清单 = 出包时的资源基线，必须与本地 tex-ship 同代，否则「APK 里的是旧美术」
  if (existsSync(apkBundledManifest)) {
    const bundled = JSON.parse(readFileSync(apkBundledManifest, 'utf8'));
    console.log(`  APK 内嵌 hash:   ${bundled.contentHash}`);
    if (bundled.contentHash !== manifest.contentHash) {
      console.log('  ⚠ APK 内嵌清单比本地旧 → 需要 npm run build:apk:release 重打包');
      stale = true;
    } else {
      console.log('  ✓ APK 内嵌资源与本地 tex-ship 同代');
    }
  }
} catch (err) {
  console.log(`  ? 检查失败（${err?.message ?? err}），请人工确认`);
}

console.log('');
if (stale) {
  console.log('[check:build] 结论：有通道需要补操作（见上方 ⚠ 项）');
} else {
  console.log('[check:build] 结论：✓ 三条通道全部最新，可直接安装测试');
}
// 用 exitCode 而非 process.exit()：避免 Windows 上 fetch/定时器句柄未释放导致 libuv 断言崩溃
process.exitCode = stale ? 1 : 0;
