/**
 * P2 打包质量抽检：UI 透明通道、角色区未被误压、ship 策略版本。
 * 仅检查构建产物，不修改任何运行时逻辑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SHIP_POLICY_VERSION, isCharacterProtected } from './assets-pipeline.config.mjs';
import { UI_MATTE_PRESETS, matteStats } from './lib/ui-edge-matte.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEX_SHIP = path.join(root, 'tex-ship');
const TEX_SRC = path.join(root, 'tex');
const CACHE_PATH = path.join(TEX_SHIP, '.ship-cache.json');

const UI_SAMPLES = [
  { src: 'sub-ui/btnSecondary.png', minTransparentPct: 3 },
  { src: 'sub-ui/btnPrimary.png', minTransparentPct: 1.5 },
  { src: 'sub-ui/headerBar.png', minTransparentPct: 3 },
  { src: 'wasteland-ui/btnMail.png', minTransparentPct: 1.5 },
];

function fail(msg) {
  console.error(`[verify-ship-p2] FAIL: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`[verify-ship-p2] WARN: ${msg}`);
}

async function alphaPct(abs) {
  const { data, info } = await sharp(abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  const total = info.width * info.height;
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] < 10) transparent++;
  }
  return (transparent / total) * 100;
}

async function main() {
  const manifestPath = path.join(TEX_SHIP, 'ship-manifest.json');
  if (!fs.existsSync(manifestPath)) fail('缺少 tex-ship/ship-manifest.json');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.policy !== 'P2-mobile-ship') {
    fail(`policy 须为 P2-mobile-ship（当前 ${manifest.policy}）`);
  }
  if (manifest.shipPolicyVersion !== SHIP_POLICY_VERSION) {
    fail(`shipPolicyVersion 须为 ${SHIP_POLICY_VERSION}`);
  }

  for (const sample of UI_SAMPLES) {
    const mapped = manifest.map?.[sample.src] ?? sample.src.replace(/\.png$/i, '.webp');
    const absShip = path.join(TEX_SHIP, mapped);
    const absSrc = path.join(TEX_SRC, sample.src);
    if (!fs.existsSync(absShip)) {
      warn(`跳过 UI 抽检（ship 缺失）: ${sample.src}`);
      continue;
    }
    const pct = await alphaPct(absShip);
    if (pct < sample.minTransparentPct) {
      fail(`${sample.src} → ${mapped} 透明像素仅 ${pct.toFixed(1)}%（期望 ≥ ${sample.minTransparentPct}%）`);
    }
    console.log(`[verify-ship-p2] OK UI alpha ${sample.src}: ${pct.toFixed(1)}%`);

    if (fs.existsSync(absSrc)) {
      const key = sample.src.startsWith('sub-ui/') ? 'subUi' : 'wastelandUi';
      const stats = await matteStats(absSrc, UI_MATTE_PRESETS[key]);
      if (stats.transparentPct < sample.minTransparentPct) {
        warn(`源图 matte 模拟透明 ${stats.transparentPct.toFixed(1)}% < ${sample.minTransparentPct}%`);
      }
    }
  }

  if (fs.existsSync(CACHE_PATH)) {
    const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    // v3.3 角色 webm 允许的"无损或可逆"动作：copy、cache、fallback-copy
    //   + webm-crop-bug2（BUG2 修复：combat-back/*_pifu00_shoot_idle.webm
    //     底部 100px 音效水印裁切，已在 BUG2 已批准）
    //   + webm-crop-bug6（BUG6 修复：juese/* + juese/pifu/* 主立绘底部
    //     100px "通讯/语言"图标裁切，已在 BUG6 已批准）
    // 其他动作（如 webp-matte / webm-rewrap 等真正改变画面）仍禁止。
    const charWebm = Object.entries(cache).filter(([k, v]) => /\.webm$/i.test(k) && isCharacterProtected(k));
    const downgraded = charWebm.filter(
      ([, v]) => v.action && !['copy', 'cache', 'fallback-copy', 'webm-crop-bug2', 'webm-crop-bug6'].includes(v.action),
    );
    if (downgraded.length) {
      fail(`角色 webm 被非 copy 动作处理: ${downgraded.slice(0, 3).map(([k]) => k).join(', ')}`);
    }
    console.log(`[verify-ship-p2] OK 角色 webm 保护: ${charWebm.length} 条`);
  }

  console.log(`[verify-ship-p2] PASS (policy ${SHIP_POLICY_VERSION})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
