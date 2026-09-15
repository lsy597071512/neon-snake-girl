/**
 * P2 美术进包规格：角色保护区维持 P1 高品质；其余资源打包时合理压缩。
 * 强规则：永不修改 tex/ 源文件；产物只写入 tex-ship/。
 * 文档：docs/asset-ship-pipeline.md（强制标准）
 */
import path from 'node:path';

/** 策略版本：变更规格时必须递增，使 ship 缓存失效并重压 */
export const SHIP_POLICY_VERSION = '2026-09-06-p2-mobile-v3.3-bug5-bug6-bug7-unref';

/** @typedef {{ maxLongEdge: number, quality: number, alphaQuality?: number, matte?: 'edge' | null }} WebpSpec */
/** @typedef {{ maxWidth: number, crf: number, preset?: string }} VideoSpec */

/** 角色相关：保持 P1 高品质（不降级） */
/** @type {Record<string, WebpSpec>} */
export const WEBP_SPECS_CHARACTER = {
  emotionPose: { maxLongEdge: 1280, quality: 90, alphaQuality: 100 },
  portrait: { maxLongEdge: 1536, quality: 92, alphaQuality: 100 },
  poster: { maxLongEdge: 1280, quality: 90, alphaQuality: 100 },
  avatar: { maxLongEdge: 256, quality: 90, alphaQuality: 100 },
};

/** 非角色：手机游戏合理压缩档（v3：场景/背景按源图分辨率直出，杜绝 1280 长边缩糊） */
/** @type {Record<string, WebpSpec>} */
export const WEBP_SPECS_SHIP = {
  uiIcon: { maxLongEdge: 1024, quality: 84, alphaQuality: 100, matte: 'edge' },
  uiPanel: { maxLongEdge: 2048, quality: 86, alphaQuality: 100, matte: 'edge' },
  sceneBg: { maxLongEdge: 2560, quality: 87, alphaQuality: 100 },
  combatBg: { maxLongEdge: 2048, quality: 86, alphaQuality: 100 },
  prop: { maxLongEdge: 1280, quality: 84, alphaQuality: 100 },
  poster: { maxLongEdge: 1600, quality: 90, alphaQuality: 100 },
  default: { maxLongEdge: 1920, quality: 85, alphaQuality: 100 },
};

/** @deprecated 兼容旧引用 */
export const WEBP_SPECS = { ...WEBP_SPECS_CHARACTER, ...WEBP_SPECS_SHIP };

/** @type {VideoSpec} */
// 画质优先档：maxWidth 1920（1080p 源零降分辨率）、CRF 18（视觉透明，暗场/烟雾不糊不脏）、
// preset slow（同画质下再省 5~10% 体积，只增加打包时间）。
// 转码目的 = Android WebView 兼容（H.264 硬解）+ 体积；角色立绘 webm 走保护区原样拷贝，永不转码。
export const VIDEO_SPEC_AMBIENT = { maxWidth: 1920, crf: 18, preset: 'slow' };
export const VIDEO_SPEC_VERSION = 'v3-crf18-1920-slow-a160k';

const UI_PANEL_NAMES = new Set([
  'panelbanner',
  'panelmain',
  'panellower',
  'panelfooter',
  'headerbar',
  'sectionbar',
  'bottomnav',
  'xpbar',
  'bannerexpedition',
  'btnexplore',
  'btnstartbattle',
]);

/**
 * @param {string} rel
 */
export function normRelPath(rel) {
  return rel.replace(/\\/g, '/');
}

/**
 * 角色相关资源：打包时不降级（立绘 / 表情 / 角色 webm / 角色 glb 等）
 *
 * v3.1 收紧：仅当资源路径命中 `juese/<运行时引用子目录>/` 时视为保护区，
 * 其它 juese/ 子路径（包括 AI 流水线中间件 pifu_weizhi / pifu/shenghuoshizhuang01/new 等）
 * 由 asset-ship-filter.mjs 的 `no-runtime-reference` 兜底排除，不再盲目走 P1 高品质。
 *
 * @param {string} rel
 */
export function isCharacterProtected(rel) {
  const r = normRelPath(rel);
  if (!/^juese\//i.test(r)) return false;
  // 运行时可达的子目录白名单（与 src/ 中静态拼出的模板一致）
  return (
    /(^|\/)avatars\//i.test(r) ||
    /(^|\/)combat-back\//i.test(r) ||
    /(^|\/)emotion-poses\//i.test(r) ||
    /(^|\/)pifu(\/|$)/i.test(r) ||                   // 含 pifu/ 顶级与所有 6 个子目录
    // juese/<Stem>.{png,webm,glb} 顶层角色立绘/视频/战斗模型
    /^[A-Za-z][A-Za-z0-9_]*\.(png|webm|glb)$/i.test(path.basename(r))
  );
}

/**
 * UI 灰底抠图 preset key（sub-ui / wasteland-ui）
 * @param {string} rel
 * @returns {'subUi' | 'wastelandUi' | null}
 */
export function matteKeyForRel(rel) {
  const r = normRelPath(rel);
  if (!/\.(png|jpe?g)$/i.test(r)) return null;
  const spec = specForRel(rel);
  if (spec.matte !== 'edge') return null;
  if (/^sub-ui\//i.test(r)) return 'subUi';
  if (/^wasteland-ui\//i.test(r)) return 'wastelandUi';
  return null;
}

/**
 * @param {string} rel
 */
function isUiPanelSlice(rel) {
  const base = path.basename(rel, path.extname(rel)).toLowerCase();
  return UI_PANEL_NAMES.has(base);
}

/**
 * @param {string} rel 相对 tex/
 * @returns {WebpSpec}
 */
export function specForRel(rel) {
  const r = normRelPath(rel);

  if (isCharacterProtected(r)) {
    if (/(^|\/)emotion-poses\//i.test(r)) return WEBP_SPECS_CHARACTER.emotionPose;
    if (/(^|\/)avatars\//i.test(r)) return WEBP_SPECS_CHARACTER.avatar;
    if (/(^|\/)char-posters\//i.test(r)) return WEBP_SPECS_CHARACTER.poster;
    if (/\.(png|jpe?g)$/i.test(r)) return WEBP_SPECS_CHARACTER.portrait;
  }

  if (/^sub-ui\//i.test(r) || /^wasteland-ui\//i.test(r)) {
    return isUiPanelSlice(r) ? WEBP_SPECS_SHIP.uiPanel : WEBP_SPECS_SHIP.uiIcon;
  }
  if (/^UI\//i.test(r)) return WEBP_SPECS_SHIP.uiIcon;
  if (/(^|\/)combat\/(backgrounds|billboards)\//i.test(r)) return WEBP_SPECS_SHIP.combatBg;
  if (/(^|\/)Indoor\//i.test(r)) return WEBP_SPECS_SHIP.sceneBg;
  if (/^beijing01/i.test(r.split('/').pop() ?? '')) return WEBP_SPECS_SHIP.sceneBg;
  if (/^game-poster/i.test(r.split('/').pop() ?? '')) return WEBP_SPECS_SHIP.poster;
  if (/(^|\/)gallery\//i.test(r)) return WEBP_SPECS_SHIP.sceneBg;
  if (/(^|\/)props\//i.test(r)) return WEBP_SPECS_SHIP.prop;
  if (/(^|\/)char-posters\//i.test(r)) return WEBP_SPECS_SHIP.poster;
  if (/(^|\/)build\//i.test(r) && /\.(png|jpe?g)$/i.test(r)) return WEBP_SPECS_SHIP.prop;
  if (/(^|\/)world\//i.test(r)) return WEBP_SPECS_SHIP.sceneBg;
  if (/(^|\/)storyboards\//i.test(r) && /\.(png|jpe?g)$/i.test(r)) return WEBP_SPECS_SHIP.poster;

  return WEBP_SPECS_SHIP.default;
}

/**
 * 非角色 MP4：打包时 H.264 重编码（路径不变，不改运行时逻辑）
 * @param {string} rel
 */
export function shouldTranscodeVideo(rel) {
  if (isCharacterProtected(rel)) return false;
  if (!/\.mp4$/i.test(rel)) return false;
  const r = normRelPath(rel);
  if (/^storyboards\//i.test(r)) return true;
  const base = path.basename(r).toLowerCase();
  if (base === 'beijing01.mp4' || base === 'shop.mp4' || base === 'pv_720p.mp4') return true;
  return false;
}

/** 需要保留音轨的视频（白名单）：世界观 PV、商店开箱动画 */
const VIDEO_KEEP_AUDIO = new Set(['pv_720p.mp4', 'shop.mp4']);

/** 白名单视频保留音轨；其余环境视频仍去音轨 */
export function shouldPreserveVideoAudio(rel) {
  const base = path.basename(normRelPath(rel)).toLowerCase();
  return VIDEO_KEEP_AUDIO.has(base);
}

/**
 * 非角色 GLB：meshopt 压缩（角色 juese/*.glb 不处理）
 * @param {string} rel
 */
export function shouldOptimizeGlb(rel) {
  if (isCharacterProtected(rel)) return false;
  return /\.glb$/i.test(normRelPath(rel));
}

/** 可转 WebP 的扩展名 */
export const RASTER_EXTS = new Set(['.png', '.jpg', '.jpeg']);

/** 原样拷贝进 ship 的扩展 */
export const PASSTHROUGH_EXTS = new Set([
  '.webm',
  '.mp4',
  '.glb',
  '.gltf',
  '.fbx',
  '.wav',
  '.mp3',
  '.ogg',
  '.json',
  '.svg',
  '.webp',
]);
