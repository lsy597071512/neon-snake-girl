/**
 * P2：从 tex/（只读）生成 tex-ship/（压缩进包产物）。
 *  - UI 灰底 edge-matte → WebP
 *  - 非角色位图合理 WebP 压缩；角色区保持 P1 高品质
 *  - 非角色 MP4 H.264 转码；非角色 GLB meshopt（可选）
 * 强规则：绝不覆盖 / 删除 / 改写 tex/ 源文件
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { shouldSkipTexShip, formatMb, normRel } from './asset-ship-filter.mjs';
import {
  specForRel,
  matteKeyForRel,
  RASTER_EXTS,
  PASSTHROUGH_EXTS,
  SHIP_POLICY_VERSION,
  shouldTranscodeVideo,
  shouldPreserveVideoAudio,
  shouldOptimizeGlb,
  VIDEO_SPEC_AMBIENT,
  VIDEO_SPEC_VERSION,
} from './assets-pipeline.config.mjs';
import { UI_MATTE_PRESETS, edgeMatteSharp } from './lib/ui-edge-matte.mjs';
import { transcodeMp4, optimizeGlb } from './lib/ship-media.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEX_SRC = path.join(root, 'tex');
const TEX_SHIP = path.join(root, 'tex-ship');
const CACHE_PATH = path.join(TEX_SHIP, '.ship-cache.json');
const MANIFEST_NAME = 'ship-manifest.json';

const CONCURRENCY = Math.max(2, Math.min(6, Number(process.env.SHIP_CONCURRENCY) || 4));
const FORCE = process.argv.includes('--force');
const SKIP_VIDEO = process.env.SHIP_SKIP_VIDEO === '1';
const SKIP_GLB = process.env.SHIP_SKIP_GLB === '1';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function fileSha1(abs) {
  const hash = crypto.createHash('sha1');
  hash.update(fs.readFileSync(abs));
  return hash.digest('hex');
}

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function listSourceFiles(absDir, relDir, out) {
  for (const name of fs.readdirSync(absDir)) {
    if (name === '.' || name === '..') continue;
    const abs = path.join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      listSourceFiles(abs, rel, out);
      continue;
    }
    out.push({ abs, rel: normRel(rel), size: st.size, mtimeMs: st.mtimeMs });
  }
}

/**
 * @param {string} absSrc
 * @param {string} rel
 * @param {import('./assets-pipeline.config.mjs').WebpSpec} spec
 * @returns {Promise<import('sharp').Sharp>}
 */
async function openRasterPipeline(absSrc, rel) {
  const matteKey = matteKeyForRel(rel);
  if (matteKey) {
    const preset = UI_MATTE_PRESETS[matteKey];
    if (preset) return edgeMatteSharp(absSrc, preset);
  }
  return sharp(absSrc, { failOn: 'none' }).rotate();
}

/**
 * @param {string} absSrc
 * @param {string} rel
 * @param {string} absOut
 * @param {import('./assets-pipeline.config.mjs').WebpSpec} spec
 */
async function encodeWebp(absSrc, rel, absOut, spec) {
  ensureDir(path.dirname(absOut));
  let pipeline = await openRasterPipeline(absSrc, rel);
  const meta = await pipeline.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const longEdge = Math.max(w, h);
  if (longEdge > spec.maxLongEdge) {
    pipeline = pipeline.resize({
      width: w >= h ? spec.maxLongEdge : undefined,
      height: h > w ? spec.maxLongEdge : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  await pipeline
    .webp({
      quality: spec.quality,
      alphaQuality: spec.alphaQuality ?? 100,
      effort: 6,
      smartSubsample: true,
    })
    .toFile(absOut);
}

function cacheEntry(sha1, outRel, outBytes, action, specVersion) {
  const entry = { sha1, outRel, outBytes, action, policyVersion: SHIP_POLICY_VERSION };
  if (specVersion) entry.specVersion = specVersion;
  return entry;
}

async function mapPool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function main() {
  if (!fs.existsSync(TEX_SRC)) {
    console.error('[build-tex-ship] tex/ not found');
    process.exit(1);
  }

  console.log('[build-tex-ship] HARD RULES: tex/ is read-only; writing only to tex-ship/');
  console.log(`[build-tex-ship] policy ${SHIP_POLICY_VERSION} — unchanged sources skip re-encode`);
  ensureDir(TEX_SHIP);

  /** @type {{ abs: string, rel: string, size: number, mtimeMs: number }[]} */
  const all = [];
  listSourceFiles(TEX_SRC, '', all);

  const included = all.filter((f) => !shouldSkipTexShip(f.rel).skip);
  const excluded = all.length - included.length;

  const cache = FORCE ? {} : loadCache();
  /** @type {Record<string, string>} */
  const map = {};
  /** @type {Record<string, { sha1: string, outRel: string, outBytes: number, action: string }>} */
  const nextCache = {};

  let converted = 0;
  let copied = 0;
  let skippedCache = 0;
  let keptPng = 0;
  let matteApplied = 0;
  let videoTranscoded = 0;
  let glbOptimized = 0;
  let srcRasterBytes = 0;
  let outRasterBytes = 0;
  let passthroughBytes = 0;
  let errors = 0;

  const jobs = included;
  let done = 0;

  await mapPool(jobs, CONCURRENCY, async (file) => {
    const ext = path.extname(file.rel).toLowerCase();
    const sha1 = fileSha1(file.abs);
    const prev = cache[file.rel];

    try {
      if (RASTER_EXTS.has(ext)) {
        srcRasterBytes += file.size;
        const spec = specForRel(file.rel);
        const outRel = file.rel.replace(/\.(png|jpe?g)$/i, '.webp');
        const absOut = path.join(TEX_SHIP, outRel);

        if (
          !FORCE &&
          prev &&
          prev.sha1 === sha1 &&
          prev.outRel &&
          prev.policyVersion === SHIP_POLICY_VERSION &&
          fs.existsSync(path.join(TEX_SHIP, prev.outRel))
        ) {
          const outBytes = fs.statSync(path.join(TEX_SHIP, prev.outRel)).size;
          map[file.rel] = prev.outRel;
          nextCache[file.rel] = cacheEntry(sha1, prev.outRel, outBytes, 'cache');
          outRasterBytes += outBytes;
          skippedCache += 1;
          done += 1;
          return;
        }

        if (matteKeyForRel(file.rel)) matteApplied += 1;
        await encodeWebp(file.abs, file.rel, absOut, spec);
        let outBytes = fs.statSync(absOut).size;

        if (outBytes >= file.size * 0.98) {
          fs.unlinkSync(absOut);
          const absPngOut = path.join(TEX_SHIP, file.rel);
          ensureDir(path.dirname(absPngOut));
          const matteKey = matteKeyForRel(file.rel);
          if (matteKey) {
            const preset = UI_MATTE_PRESETS[matteKey];
            await (await edgeMatteSharp(file.abs, preset)).png().toFile(absPngOut);
          } else {
            fs.copyFileSync(file.abs, absPngOut);
          }
          outBytes = fs.statSync(absPngOut).size;
          map[file.rel] = file.rel;
          nextCache[file.rel] = cacheEntry(sha1, file.rel, outBytes, matteKey ? 'keep-matte-png' : 'keep-raster');
          keptPng += 1;
          outRasterBytes += outBytes;
        } else {
          map[file.rel] = outRel;
          nextCache[file.rel] = cacheEntry(sha1, outRel, outBytes, matteKeyForRel(file.rel) ? 'webp-matte' : 'webp');
          converted += 1;
          outRasterBytes += outBytes;
        }
      } else if (ext === '.mp4' && shouldTranscodeVideo(file.rel) && !SKIP_VIDEO) {
        const absOut = path.join(TEX_SHIP, file.rel);
        if (
          !FORCE &&
          prev &&
          prev.sha1 === sha1 &&
          prev.outRel === file.rel &&
          prev.policyVersion === SHIP_POLICY_VERSION &&
          prev.specVersion === VIDEO_SPEC_VERSION &&
          fs.existsSync(absOut)
        ) {
          const outBytes = fs.statSync(absOut).size;
          nextCache[file.rel] = cacheEntry(sha1, file.rel, outBytes, 'cache', VIDEO_SPEC_VERSION);
          passthroughBytes += outBytes;
          skippedCache += 1;
          done += 1;
          return;
        }
        const ok = transcodeMp4(file.abs, absOut, VIDEO_SPEC_AMBIENT, {
          preserveAudio: shouldPreserveVideoAudio(file.rel),
        });
        if (ok && fs.statSync(absOut).size < file.size * 0.98) {
          const outBytes = fs.statSync(absOut).size;
          passthroughBytes += outBytes;
          nextCache[file.rel] = cacheEntry(sha1, file.rel, outBytes, 'video-h264', VIDEO_SPEC_VERSION);
          videoTranscoded += 1;
        } else {
          if (fs.existsSync(absOut)) fs.unlinkSync(absOut);
          ensureDir(path.dirname(absOut));
          fs.copyFileSync(file.abs, absOut);
          passthroughBytes += file.size;
          nextCache[file.rel] = cacheEntry(sha1, file.rel, file.size, 'copy');
          copied += 1;
        }
      } else if (ext === '.glb' && shouldOptimizeGlb(file.rel) && !SKIP_GLB) {
        const absOut = path.join(TEX_SHIP, file.rel);
        if (
          !FORCE &&
          prev &&
          prev.sha1 === sha1 &&
          prev.outRel === file.rel &&
          prev.policyVersion === SHIP_POLICY_VERSION &&
          fs.existsSync(absOut)
        ) {
          const outBytes = fs.statSync(absOut).size;
          nextCache[file.rel] = cacheEntry(sha1, file.rel, outBytes, 'cache');
          passthroughBytes += outBytes;
          skippedCache += 1;
          done += 1;
          return;
        }
        const ok = optimizeGlb(file.abs, absOut);
        if (ok && fs.statSync(absOut).size < file.size * 0.98) {
          const outBytes = fs.statSync(absOut).size;
          passthroughBytes += outBytes;
          nextCache[file.rel] = cacheEntry(sha1, file.rel, outBytes, 'glb-meshopt');
          glbOptimized += 1;
        } else {
          if (fs.existsSync(absOut)) fs.unlinkSync(absOut);
          ensureDir(path.dirname(absOut));
          fs.copyFileSync(file.abs, absOut);
          passthroughBytes += file.size;
          nextCache[file.rel] = cacheEntry(sha1, file.rel, file.size, 'copy');
          copied += 1;
        }
      } else if (PASSTHROUGH_EXTS.has(ext) || ext === '') {
        const absOut = path.join(TEX_SHIP, file.rel);
        if (
          !FORCE &&
          prev &&
          prev.sha1 === sha1 &&
          prev.outRel === file.rel &&
          prev.policyVersion === SHIP_POLICY_VERSION &&
          fs.existsSync(absOut)
        ) {
          nextCache[file.rel] = cacheEntry(sha1, file.rel, fs.statSync(absOut).size, 'cache');
          passthroughBytes += fs.statSync(absOut).size;
          skippedCache += 1;
          done += 1;
          return;
        }
        // v3.1 BUG2 / v3.3 BUG6 (combat-back / juese 顶层 / juese/pifu 顶层) 已被回退：
        // 本周新增的 cropWebmBottom 逻辑会把 .webm 通过 ffmpeg 重编码裁底 100px，
        // 但源 webm 已是 chroma-key 产物（带 alpha_mode=1 tag），重编码导致 alpha 通道丢失，
        // 角色立绘在 Android WebView 中显示黑底。
        // 上周五版本未启用该逻辑，所有 .webm 原样 passthrough（仅 fs.copyFileSync），
        // 工作良好。本周按 workspace 规则 .cursor/rules/asset-ship-pipeline.mdc：
        //   "已优化资源（缓存命中）不得二次压缩；改规格须升 SHIP_POLICY_VERSION"
        // 决定完全回退到上周五行为（彻底禁用），不再裁底任何角色 webm。
        // 如未来确实需要修复"左下角水印"，须：
        //   1) 用户明确授权；
        //   2) 在 docs/asset-ship-pipeline.md 写明新规格并升 SHIP_POLICY_VERSION；
        //   3) 用无损流拷贝（-c copy 或 stream copy）而非转码，保证 alpha 通道不被破坏。
        // 当前实现：直接走 fs.copyFileSync（与上周五一致），失败回退无意义。
        ensureDir(path.dirname(absOut));
        fs.copyFileSync(file.abs, absOut);
        passthroughBytes += file.size;
        nextCache[file.rel] = cacheEntry(sha1, file.rel, file.size, 'copy');
        copied += 1;
      } else {
        const absOut = path.join(TEX_SHIP, file.rel);
        ensureDir(path.dirname(absOut));
        fs.copyFileSync(file.abs, absOut);
        passthroughBytes += file.size;
        nextCache[file.rel] = cacheEntry(sha1, file.rel, file.size, 'copy-unknown');
        copied += 1;
      }
    } catch (err) {
      errors += 1;
      console.warn(`[build-tex-ship] FAIL ${file.rel}:`, err?.message ?? err);
      try {
        const absOut = path.join(TEX_SHIP, file.rel);
        ensureDir(path.dirname(absOut));
        fs.copyFileSync(file.abs, absOut);
        if (RASTER_EXTS.has(ext)) {
          map[file.rel] = file.rel;
          outRasterBytes += file.size;
        } else {
          passthroughBytes += file.size;
        }
        nextCache[file.rel] = cacheEntry(sha1, file.rel, file.size, 'fallback-copy');
      } catch {
        /* ignore */
      }
    }

    done += 1;
    if (done % 50 === 0 || done === jobs.length) {
      console.log(`[build-tex-ship] progress ${done}/${jobs.length}`);
    }
  });

  const validOut = new Set(Object.values(nextCache).map((c) => normRel(c.outRel)));
  validOut.add(MANIFEST_NAME);
  validOut.add('.ship-cache.json');

  function cleanShip(absDir, relDir) {
    for (const name of fs.readdirSync(absDir)) {
      if (name === '.ship-cache.json') continue;
      const abs = path.join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        cleanShip(abs, rel);
        try {
          if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
        } catch {
          /* ignore */
        }
        continue;
      }
      if (name === MANIFEST_NAME) continue;
      if (!validOut.has(normRel(rel))) {
        fs.unlinkSync(abs);
      }
    }
  }
  cleanShip(TEX_SHIP, '');

  const manifest = {
    version: 2,
    policy: 'P2-mobile-ship',
    shipPolicyVersion: SHIP_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    note: 'Source tex/ is never modified. Keys are paths relative to tex/; values are paths relative to tex-ship/dist/tex. See docs/asset-ship-pipeline.md',
    map,
    stats: {
      sourceFilesScanned: all.length,
      p0Excluded: excluded,
      shippedInputs: included.length,
      convertedWebp: converted,
      uiMatteApplied: matteApplied,
      videoTranscoded,
      glbOptimized,
      keptOriginalRaster: keptPng,
      passthroughCopied: copied,
      cacheHits: skippedCache,
      errors,
      srcRasterMb: Number(formatMb(srcRasterBytes)),
      outRasterMb: Number(formatMb(outRasterBytes)),
      passthroughMb: Number(formatMb(passthroughBytes)),
      rasterSavedMb: Number(formatMb(Math.max(0, srcRasterBytes - outRasterBytes))),
    },
  };

  fs.writeFileSync(path.join(TEX_SHIP, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(CACHE_PATH, JSON.stringify(nextCache, null, 2), 'utf8');

  if (!TEX_SHIP.startsWith(root) || TEX_SHIP === TEX_SRC) {
    throw new Error('Safety trip: ship path invalid');
  }

  console.log('[build-tex-ship] done');
  console.log(
    `  webp: ${converted}, matte: ${matteApplied}, video: ${videoTranscoded}, glb: ${glbOptimized}, kept raster: ${keptPng}, passthrough: ${copied}, cache: ${skippedCache}, errors: ${errors}`,
  );
  console.log(
    `  raster ${formatMb(srcRasterBytes)} MB → ${formatMb(outRasterBytes)} MB (saved ${formatMb(Math.max(0, srcRasterBytes - outRasterBytes))} MB)`,
  );
  console.log(`  passthrough ${formatMb(passthroughBytes)} MB`);
  console.log(`  manifest entries: ${Object.keys(map).length}`);
  console.log(`  output: tex-ship/ (source tex/ untouched)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
