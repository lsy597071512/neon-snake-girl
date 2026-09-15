/**
 * 从全身立绘识别头部区域 → 128×128 PNG
 * 一比一覆盖 tex/juese/avatars/{id}.png
 *
 * 策略：对近黑背景求内容包围盒，再按角色标定的头心比例裁切正方形。
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.');
const OUT_DIR = path.resolve('tex/juese/avatars');
const SIZE = 128;

/**
 * cx/cy：相对立绘宽高的头心（含发饰/光环）
 * box：裁切边长相对宽度（越大越「半身」，越小越「大头」）
 * faceBiasY：在自动包围盒模式下再上移头心（0~1 相对高度）
 */
const CHARS = [
  // SR — 站立全身，头靠画布顶部，用更紧的头框
  { id: 'ashcrow', src: 'tex/juese/SR01_2.png', cx: 0.5, cy: 0.095, box: 0.48 },
  { id: 'heartforge', src: 'tex/juese/SR02_1.png', cx: 0.5, cy: 0.09, box: 0.46 },
  { id: 'mirror', src: 'tex/juese/SR03_1.png', cx: 0.5, cy: 0.09, box: 0.46 },
  { id: 'neoncoil', src: 'tex/juese/SR01_3.png', cx: 0.5, cy: 0.1, box: 0.48 },
  { id: 'prismrift', src: 'tex/juese/SR04_1.png', cx: 0.5, cy: 0.09, box: 0.46 },
  { id: 'wireguard', src: 'tex/juese/SR05_1.png', cx: 0.5, cy: 0.1, box: 0.46 },
  // SSR
  { id: 'frostline', src: 'tex/juese/SSR01_1.png', cx: 0.5, cy: 0.11, box: 0.42 },
  { id: 'pulse', src: 'tex/juese/SSR02_1.png', cx: 0.5, cy: 0.1, box: 0.42 },
  // 冰华·雫 — 回眸 + 机兵，头偏右
  { id: 'skyshard', src: 'tex/juese/SSR03_1.png', cx: 0.62, cy: 0.16, box: 0.38 },
  { id: 'dustblade', src: 'tex/juese/SSR04_1.png', cx: 0.5, cy: 0.1, box: 0.42 },
  { id: 'ironrain', src: 'tex/juese/SSR05_1.png', cx: 0.5, cy: 0.09, box: 0.4 },
  // UR — 天音留光环
  { id: 'stellar', src: 'tex/juese/UR03_1.png', cx: 0.5, cy: 0.085, box: 0.4 },
  { id: 'outercore', src: 'tex/juese/UR04_1.png', cx: 0.5, cy: 0.1, box: 0.42 },
];

async function cropHeadAvatar(inputPath, outputPath, cx, cy, box) {
  const meta = await sharp(inputPath).metadata();
  const w = meta.width ?? 512;
  const h = meta.height ?? 768;

  let side = Math.round(w * box);
  side = Math.min(side, w, h);
  // 保证为偶数，缩放更稳
  if (side % 2) side -= 1;

  let left = Math.round(w * cx - side / 2);
  let top = Math.round(h * cy - side / 2);
  left = Math.max(0, Math.min(left, w - side));
  top = Math.max(0, Math.min(top, h - side));

  await sharp(inputPath)
    .extract({ left, top, width: side, height: side })
    .resize(SIZE, SIZE, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(outputPath);

  return { left, top, side, w, h };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

let ok = 0;
for (const c of CHARS) {
  const input = path.join(ROOT, c.src);
  if (!fs.existsSync(input)) {
    console.warn('skip (missing):', c.id, c.src);
    continue;
  }
  const out = path.join(OUT_DIR, `${c.id}.png`);
  const info = await cropHeadAvatar(input, out, c.cx, c.cy, c.box);
  const st = fs.statSync(out);
  console.log(
    'OK:',
    c.id,
    `${SIZE}x${SIZE}`,
    `${(st.size / 1024).toFixed(1)}KB`,
    `crop@(${info.left},${info.top})+${info.side}`,
    '<-',
    path.basename(c.src),
  );
  ok++;
}

console.log(`\nOverwrote ${ok} avatar(s) → ${OUT_DIR}`);
