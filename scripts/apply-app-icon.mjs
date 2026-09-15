/**
 * 用 resources/icon.png 生成 Android mipmap + Web favicon。
 * 源图：锈带纪元正式图标（icon-01 mech-maiden）。
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'resources', 'icon.png');
const resRoot = path.join(root, 'android', 'app', 'src', 'main', 'res');
const publicDir = path.join(root, 'public');

if (!fs.existsSync(src)) {
  console.error('缺少 resources/icon.png');
  process.exit(1);
}

const densities = {
  mdpi: { launcher: 48, foreground: 108 },
  hdpi: { launcher: 72, foreground: 162 },
  xhdpi: { launcher: 96, foreground: 216 },
  xxhdpi: { launcher: 144, foreground: 324 },
  xxxhdpi: { launcher: 192, foreground: 432 },
};

/** 自适应前景：画布居中，内容约占 72%（落在安全区） */
async function makeForeground(size) {
  const inner = Math.round(size * 0.72);
  const art = await sharp(src)
    .resize(inner, inner, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toBuffer();
}

async function writePng(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, buffer);
}

const base = sharp(src).ensureAlpha();

for (const [density, sizes] of Object.entries(densities)) {
  const dir = path.join(resRoot, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });

  const launcher = await base
    .clone()
    .resize(sizes.launcher, sizes.launcher, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writePng(path.join(dir, 'ic_launcher.png'), launcher);
  await writePng(path.join(dir, 'ic_launcher_round.png'), launcher);

  const fg = await makeForeground(sizes.foreground);
  await writePng(path.join(dir, 'ic_launcher_foreground.png'), fg);
  console.log(`mipmap-${density}: ${sizes.launcher} / fg ${sizes.foreground}`);
}

// Web
fs.mkdirSync(publicDir, { recursive: true });
await sharp(src)
  .resize(64, 64, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(publicDir, 'favicon.png'));
await sharp(src)
  .resize(180, 180, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(publicDir, 'apple-touch-icon.png'));
await sharp(src)
  .resize(512, 512, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(publicDir, 'app-icon.png'));

console.log('Web: public/favicon.png, apple-touch-icon.png, app-icon.png');
console.log('Done.');
