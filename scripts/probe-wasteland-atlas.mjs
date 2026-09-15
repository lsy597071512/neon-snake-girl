import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const atlasPath = path.resolve('tex/Asset-xho8xde31z.png');
const outDir = path.resolve('tex/wasteland-ui');

const { data, info } = await sharp(atlasPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const BG = 26;
function isFg(x, y) {
  const i = (y * width + x) * channels;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const a = data[i + 3];
  if (a < 20) return false;
  const dr = Math.abs(r - BG);
  const dg = Math.abs(g - BG);
  const db = Math.abs(b - BG);
  return dr + dg + db > 36 || Math.max(dr, dg, db) > 18;
}

const visited = new Uint8Array(width * height);
const components = [];

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = y * width + x;
    if (visited[idx] || !isFg(x, y)) continue;

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
      if (visited[cidx] || !isFg(cx, cy)) continue;
      visited[cidx] = 1;
      area++;
      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }

    if (area < 800) continue;
    components.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
}

components.sort((a, b) => a.y - b.y || a.x - b.x);

fs.mkdirSync(outDir, { recursive: true });
console.log('Components:', components.length);
for (let i = 0; i < components.length; i++) {
  const r = components[i];
  console.log(`#${i}`, JSON.stringify(r));
  await sharp(atlasPath)
    .extract({ left: r.x, top: r.y, width: r.w, height: r.h })
    .png()
    .toFile(path.join(outDir, `cmp-${String(i).padStart(2, '0')}.png`));
}
