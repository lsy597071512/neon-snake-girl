#!/usr/bin/env node
/**
 * Storyboard stills → vertical 9:16 / 5s cinematic clips (ffmpeg).
 * Preserves full still content (no AI redraw): blurred fill + sharp plate + gentle push-in.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tex', 'storyboards');
const FFMPEG =
  process.env.FFMPEG_PATH ||
  'C:\\Users\\admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe';

const SECONDS = 5;
const W = 1080;
const H = 1920;
const FPS = 30;
const FRAMES = SECONDS * FPS;

/** Focus bias for push-in (0–1 within plate). Mild = no chaotic warp. */
const CLIPS = [
  { file: '01-ashcrow-charge.png', zx: 0.42, zy: 0.48 },
  { file: '02-heartforge-guard.png', zx: 0.5, zy: 0.5 },
  { file: '03-mirror-scout.png', zx: 0.55, zy: 0.42 },
  { file: '04-wireguard-campfire.png', zx: 0.5, zy: 0.55 },
  { file: '05-frostline-ambush.png', zx: 0.48, zy: 0.45 },
  { file: '07-dustblade-hunt.png', zx: 0.52, zy: 0.48 },
  { file: '08-ironrain-workshop.png', zx: 0.5, zy: 0.48 },
  { file: '09-stellar-judgment.png', zx: 0.5, zy: 0.42 },
  { file: '10-outercore-sync.png', zx: 0.48, zy: 0.52 },
  { file: '11-skyshard-iceguard.png', zx: 0.5, zy: 0.46 },
];

function run(args) {
  const r = spawnSync(FFMPEG, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(FFMPEG)) {
  console.error('ffmpeg missing:', FFMPEG);
  process.exit(1);
}

for (const clip of CLIPS) {
  const input = path.join(dir, clip.file);
  if (!fs.existsSync(input)) {
    console.error('missing still:', input);
    process.exit(1);
  }
  const outName = clip.file.replace(/\.png$/i, '.mp4');
  const out = path.join(dir, outName);
  console.log('→', outName);

  // Full still preserved: blurred cover bg + sharp letterboxed plate, then soft zoom + light grade.
  // zoompan on composed 1080x1920; start zoom 1.0 → ~1.08 so edges stay readable.
  const z = "min(1.08,1+0.00105*on)";
  const x = `(iw-iw/zoom)*${clip.zx}`;
  const y = `(ih-ih/zoom)*${clip.zy}`;

  const filterComplex = [
    // [0] blur fill
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=28,eq=brightness=-0.08:saturation=1.05[bg]`,
    // [0] sharp plate fitted inside 9:16 (keeps entire original image)
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[comp]`,
    `[comp]zoompan=z='${z}':x='${x}':y='${y}':d=${FRAMES}:s=${W}x${H}:fps=${FPS},eq=contrast=1.1:brightness=0.035:saturation=1.14,unsharp=5:5:0.7:5:5:0.0[vout]`,
  ].join(';');

  run([
    '-y',
    '-loop',
    '1',
    '-i',
    input,
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-t',
    String(SECONDS),
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '17',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    out,
  ]);
}

console.log('done: 10 vertical 5s clips in', dir);
