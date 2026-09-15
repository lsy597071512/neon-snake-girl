/**
 * UI 切片灰底抠图：从四边 flood-fill 标记外部灰底为透明，保留内部同色区域。
 * 用于 sub-ui (#414140) 与 wasteland-ui (#1a1a1a) 打包进 ship 前处理。
 */
import sharp from 'sharp';

/** @typedef {{ r: number, g: number, b: number, sumTol: number, maxTol: number, alphaCut?: number }} MattePreset */

/** @type {Record<string, MattePreset>} */
export const UI_MATTE_PRESETS = {
  subUi: { r: 65, g: 65, b: 64, sumTol: 42, maxTol: 22, alphaCut: 20 },
  wastelandUi: { r: 26, g: 26, b: 26, sumTol: 36, maxTol: 18, alphaCut: 20 },
};

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @param {MattePreset} preset
 */
export function isNearMatteBg(r, g, b, a, preset) {
  if (a < (preset.alphaCut ?? 20)) return true;
  const dr = Math.abs(r - preset.r);
  const dg = Math.abs(g - preset.g);
  const db = Math.abs(b - preset.b);
  return dr + dg + db <= preset.sumTol && Math.max(dr, dg, db) <= preset.maxTol;
}

/**
 * @param {Buffer|Uint8Array} data
 * @param {number} width
 * @param {number} height
 * @param {number} channels
 * @param {MattePreset} preset
 * @returns {Buffer}
 */
export function applyEdgeMatteRgba(data, width, height, channels, preset) {
  const n = width * height;
  const exterior = new Uint8Array(n);
  /** @type {number[]} */
  const queue = [];

  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (exterior[idx]) return;
    const i = idx * channels;
    if (!isNearMatteBg(data[i], data[i + 1], data[i + 2], data[i + 3], preset)) return;
    exterior[idx] = 1;
    queue.push(idx);
  };

  for (let x = 0; x < width; x++) {
    tryPush(x, 0);
    tryPush(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y);
    tryPush(width - 1, y);
  }

  while (queue.length) {
    const idx = queue.pop();
    const x = idx % width;
    const y = (idx - x) / width;
    tryPush(x - 1, y);
    tryPush(x + 1, y);
    tryPush(x, y - 1);
    tryPush(x, y + 1);
  }

  const out = Buffer.from(data);
  for (let idx = 0; idx < n; idx++) {
    if (exterior[idx]) out[idx * channels + 3] = 0;
  }
  return out;
}

/**
 * @param {string} absSrc
 * @param {MattePreset} preset
 * @returns {Promise<import('sharp').Sharp>}
 */
export async function edgeMatteSharp(absSrc, preset) {
  const { data, info } = await sharp(absSrc).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = applyEdgeMatteRgba(data, info.width, info.height, info.channels, preset);
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });
}

/**
 * @param {string} absSrc
 * @param {MattePreset} preset
 * @returns {Promise<{ transparentPct: number, width: number, height: number }>}
 */
export async function matteStats(absSrc, preset) {
  const { data, info } = await sharp(absSrc).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const matted = applyEdgeMatteRgba(data, info.width, info.height, info.channels, preset);
  let transparent = 0;
  const total = info.width * info.height;
  for (let i = 3; i < matted.length; i += info.channels) {
    if (matted[i] < 10) transparent++;
  }
  return {
    transparentPct: (transparent / total) * 100,
    width: info.width,
    height: info.height,
  };
}
