/**
 * P2 非角色媒体进包：MP4 转码、GLB meshopt（可选工具链）。
 * 失败时回退原样拷贝，不影响可玩性。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let ffmpegPath = null;
let ffmpegChecked = false;

function resolveFfmpeg() {
  if (ffmpegChecked) return ffmpegPath;
  ffmpegChecked = true;
  const candidates = [
    process.env.FFMPEG_PATH,
    'ffmpeg',
    'C:\\Users\\admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      ffmpegPath = bin;
      return ffmpegPath;
    } catch {
      /* try next */
    }
  }
  ffmpegPath = null;
  return null;
}

/**
 * @param {string} absSrc
 * @param {string} absOut
 * @param {{ maxWidth: number, crf: number, preset?: string }} spec
 * @param {{ preserveAudio?: boolean }} [options]
 * @returns {boolean}
 */
export function transcodeMp4(absSrc, absOut, spec, options = {}) {
  const preserveAudio = options.preserveAudio ?? false;
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    console.warn('[ship-media] ffmpeg not found — skip video transcode, copy source');
    return false;
  }
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  const vf = `scale='min(${spec.maxWidth},iw)':-2`;
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    absSrc,
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-crf',
    String(spec.crf),
    '-preset',
    spec.preset ?? 'medium',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ];
  if (preserveAudio) {
    args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2');
  } else {
    args.push('-an');
  }
  args.push(absOut);
  try {
    execFileSync(ffmpeg, args, { stdio: 'pipe' });
    return fs.existsSync(absOut) && fs.statSync(absOut).size > 0;
  } catch (err) {
    console.warn(`[ship-media] ffmpeg failed for ${path.basename(absSrc)}:`, err?.message ?? err);
    try {
      if (fs.existsSync(absOut)) fs.unlinkSync(absOut);
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * v3.1 BUG2 修复：去除 combat-back 战斗待机 webm 首帧左下角的"音效图标"。
 * 做法：裁掉底部 100px（图标位置），保持 VP9 编码，输出 webm。
 * 失败回退原样拷贝（不影响玩法）。
 * @param {string} absSrc
 * @param {string} absOut
 * @param {{ cropBottom?: number }} [opts]
 * @returns {boolean}
 */
export function cropWebmBottom(absSrc, absOut, opts = {}) {
  const cropBottom = Math.max(0, opts.cropBottom ?? 100);
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    console.warn('[ship-media] ffmpeg not found — skip webm crop, copy source');
    return false;
  }
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  const vf = `crop=iw:ih-${cropBottom}:0:0`;
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    absSrc,
    '-vf',
    vf,
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-threads',
    '4',
    '-an',
    absOut,
  ];
  try {
    execFileSync(ffmpeg, args, { stdio: 'pipe' });
    return fs.existsSync(absOut) && fs.statSync(absOut).size > 0;
  } catch (err) {
    console.warn(`[ship-media] webm crop failed for ${path.basename(absSrc)}:`, err?.message ?? err);
    try {
      if (fs.existsSync(absOut)) fs.unlinkSync(absOut);
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * @param {string} absSrc
 * @param {string} absOut
 * @returns {boolean}
 */
export function optimizeGlb(absSrc, absOut) {
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(
    npx,
    ['--yes', '@gltf-transform/cli', 'optimize', absSrc, absOut, '--compress', 'meshopt'],
    { cwd: root, stdio: 'pipe', encoding: 'utf8', timeout: 120_000 },
  );
  if (result.status === 0 && fs.existsSync(absOut) && fs.statSync(absOut).size > 0) {
    return true;
  }
  const err = (result.stderr || result.stdout || '').trim().slice(0, 200);
  if (err) console.warn(`[ship-media] gltf-transform skip ${path.basename(absSrc)}: ${err}`);
  try {
    if (fs.existsSync(absOut)) fs.unlinkSync(absOut);
  } catch {
    /* ignore */
  }
  return false;
}

export function hasFfmpeg() {
  return !!resolveFfmpeg();
}
