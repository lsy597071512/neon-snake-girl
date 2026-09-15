import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const atlas = path.resolve('tex/UI01.png');
const out = path.resolve('tex/sub-ui');
const manifestPath = path.resolve('tex/sub-ui/manifest.json');

/** UI01.png 灰底约 #414140 */
const BG = 65;

function isFg(data, width, channels, x, y) {
  const i = (y * width + x) * channels;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const a = data[i + 3];
  if (a < 20) return false;
  const dr = Math.abs(r - BG);
  const dg = Math.abs(g - BG);
  const db = Math.abs(b - BG);
  return dr + dg + db > 42 || Math.max(dr, dg, db) > 22;
}

function findComponents(data, width, height, channels) {
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || !isFg(data, width, channels, x, y)) continue;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      const stack = [[x, y]];

      while (stack.length) {
        const [cx, cy] = stack.pop();
        const cidx = cy * width + cx;
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        if (visited[cidx] || !isFg(data, width, channels, cx, cy)) continue;
        visited[cidx] = 1;
        area++;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }

      if (area < 600) continue;
      components.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
    }
  }

  return components.sort((a, b) => a.y - b.y || a.x - b.x);
}

function pick(components, pred) {
  const hit = components.find(pred);
  if (!hit) throw new Error(`Component not found: ${pred.toString()}`);
  return hit;
}

const { data, info } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const comps = findComponents(data, width, height, channels);

const SLICES = {
  headerBar: pick(comps, (c) => c.y < 120 && c.w > 3000),
  backBtn: pick(comps, (c) => c.x < 900 && c.y > 350 && c.y < 550 && c.w > 500 && c.w < 800),
  sectionBar: pick(comps, (c) => c.x > 1400 && c.y > 380 && c.y < 550 && c.w > 1200 && c.h < 220),
  panelBanner: pick(comps, (c) => c.x < 1400 && c.y > 550 && c.y < 900 && c.h > 500),
  btnSecondary: pick(comps, (c) => c.x > 1400 && c.x < 2000 && c.y > 600 && c.y < 900 && c.h < 250),
  btnPrimary: pick(comps, (c) => c.x > 2300 && c.y > 600 && c.y < 900 && c.h < 250),
  panelMain: pick(comps, (c) => c.x > 1400 && c.y > 850 && c.y < 1100 && c.w > 1500 && c.h > 500),
  panelFooter: pick(comps, (c) => c.x < 1400 && c.y > 1150 && c.y < 1350 && c.w > 900 && c.h < 200),
  btnRowLeft: pick(comps, (c) => c.x < 800 && c.y > 1350 && c.y < 1600 && c.w > 400),
  btnRowRight: pick(comps, (c) => c.x > 750 && c.x < 1400 && c.y > 1350 && c.y < 1600 && c.w > 400),
  crtMonitor: pick(comps, (c) => c.x > 3000 && c.y > 1400 && c.w > 400),
  btnAdWide: pick(comps, (c) => c.x < 900 && c.y > 1550 && c.y < 1750 && c.w > 500 && c.h < 180),
  panelLower: pick(comps, (c) => c.x > 1400 && c.y > 1550 && c.w > 1500 && c.h > 350),
  btnAdSmall: pick(comps, (c) => c.x < 600 && c.y > 1900 && c.w > 300 && c.h < 160),
  btnTinyAd: pick(comps, (c) => c.w < 350 && c.h < 180 && c.y > 1750 && c.y < 1850),
  btnTinyBox: pick(comps, (c) => c.w < 350 && c.h < 180 && c.x > 550 && c.x < 950 && c.y > 1750),
};

fs.mkdirSync(out, { recursive: true });

const manifest = { atlas: { width, height }, slices: {} };

for (const [name, box] of Object.entries(SLICES)) {
  await sharp(atlas)
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .png()
    .toFile(path.join(out, `${name}.png`));
  manifest.slices[name] = box;
  console.log(name, box);
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('manifest ->', manifestPath);
