import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const atlas = path.resolve('tex/Asset-xho8xde31z.png');
const out = path.resolve('tex/wasteland-ui');
const manifestPath = path.resolve('tex/wasteland-ui/manifest.json');

const BG = 26;

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
  return dr + dg + db > 36 || Math.max(dr, dg, db) > 18;
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

      if (area < 800) continue;
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

function pickOrManifest(components, pred, name, fallback) {
  const hit = components.find(pred);
  if (hit) return hit;
  const box = fallback?.slices?.[name];
  if (box) {
    console.warn(`[slice-wasteland-ui] ${name}: use manifest fallback`, box);
    return box;
  }
  throw new Error(`Component not found: ${name}`);
}

function pickAll(components, pred) {
  return components.filter(pred).sort((a, b) => a.y - b.y || a.x - b.x);
}

const manifestFallback = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : null;

const { data, info } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
const comps = findComponents(data, width, height, channels);

const avatarFrame = pickOrManifest(comps, (c) => c.x < 500 && c.y < 400 && c.w < 450 && c.h < 400, 'avatarFrame', manifestFallback);
const xpBar = pickOrManifest(comps, (c) => c.x > 400 && c.x < 600 && c.y > 200 && c.y < 350 && c.w > 800, 'xpBar', manifestFallback);
const resBars = pickAll(comps, (c) => c.x > 1800 && c.y < 300 && c.h < 180 && c.w > 400 && c.w < 700);
const quickBtns = pickAll(comps, (c) => c.x > 70 && c.x < 900 && c.y > 380 && c.y < 680 && c.w < 260 && c.h < 260);
const sideBtns = pickAll(comps, (c) => c.x < 750 && c.y > 680 && c.y < 1700 && c.w > 500 && c.h > 150 && c.h < 220);
const bannerExpedition = pick(comps, (c) => c.x > 1500 && c.y > 450 && c.y < 700 && c.w > 1500);
const btnExplore = pick(comps, (c) => c.x > 700 && c.x < 900 && c.y > 1150 && c.y < 1350 && c.w > 1000);
const btnStartBattle = pick(comps, (c) => c.x > 2000 && c.y > 1150 && c.y < 1350 && c.w > 1200);
const bottomNav = pick(comps, (c) => c.y > 1700 && c.w > 3000);

const SLICES = {
  avatarFrame,
  xpBar,
  resGold: resBars[0],
  resGem: resBars[1],
  resEnergy: resBars[2],
  btnMail: quickBtns[0],
  btnSocial: quickBtns[1],
  btnSettings: quickBtns[2],
  sideShop: sideBtns[0],
  sideEvents: sideBtns[1],
  sideTasks: sideBtns[2],
  sideWarehouse: sideBtns[3],
  sideSquad: sideBtns[4],
  bannerExpedition,
  btnExplore,
  btnStartBattle,
  bottomNav,
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
