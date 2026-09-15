import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import os from 'os';

const srcDir = path.join(
  os.homedir(),
  '.cursor',
  'projects',
  'd-neon-snake-girl-neon-snake-girl',
  'assets',
);
const outDir = path.join(process.env.USERPROFILE || os.homedir(), 'Desktop', 'rust-belt-era-icons');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  'icon-01-mech-maiden.png',
  'icon-02-gear-snake.png',
  'icon-03-cyber-eye.png',
  'icon-04-runner-lanes.png',
  'icon-05-heart-core.png',
  'icon-06-wing-sensor.png',
  'icon-07-hazard-shield.png',
  'icon-08-fox-ears.png',
  'icon-09-camp-fort.png',
  'icon-10-era-emblem.png',
];

for (const name of files) {
  const src = path.join(srcDir, name);
  if (!fs.existsSync(src)) {
    console.error('missing', src);
    process.exit(1);
  }
  const base = name.replace(/\.png$/i, '');
  const out64 = path.join(outDir, `${base}-64.png`);
  const outSrc = path.join(outDir, `${base}-source.png`);
  fs.copyFileSync(src, outSrc);
  await sharp(src)
    .resize(64, 64, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toFile(out64);
  const meta = await sharp(out64).metadata();
  console.log(`${base}: ${meta.width}x${meta.height}`);
}
console.log('OUT', outDir);
