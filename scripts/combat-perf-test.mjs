import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const filteredArgs = args.filter((a) => a !== '--headed');
const url = filteredArgs[0] ?? 'http://127.0.0.1:4175/?debugCombat&debugStage=1&quality=high';
const dwellMs = Number(filteredArgs[1] ?? 12000);

const browser = await chromium.launch({
  headless: !headed,
  args: [
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=default',
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
  ],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(dwellMs);

const result = await page.evaluate(() => {
  const fpsEl = document.querySelector('[data-hud="fps"]');
  const canvas = document.querySelector('canvas.combat-canvas');
  const perf = performance.getEntriesByType('measure').length;
  return {
    fpsText: fpsEl?.textContent ?? null,
    geo: window.__combatGeoStats ?? null,
    inCombat: document.getElementById('game-root')?.classList.contains('visible') ?? false,
    canvasPx: canvas ? `${canvas.width}x${canvas.height}` : null,
    webglRenderer: (() => {
      try {
        const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
        if (!gl) return null;
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (!dbg) return 'unknown';
        return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      } catch {
        return null;
      }
    })(),
    perf,
  };
});

const samples = [];
const start = Date.now();
while (Date.now() - start < 3000) {
  const text = await page.evaluate(() => document.querySelector('[data-hud="fps"]')?.textContent ?? '');
  const m = text.match(/FPS\s+(\d+)/);
  if (m) samples.push(Number(m[1]));
  await page.waitForTimeout(300);
}

const rawFps = await page.evaluate(() =>
  new Promise((resolve) => {
    const deltas = [];
    let prev = performance.now();
    let n = 0;
    const tick = (now) => {
      if (n++ > 0) deltas.push(now - prev);
      prev = now;
      if (deltas.length >= 120) {
        const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        resolve(Math.round(1000 / avg));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }),
);

await browser.close();

const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0;
const min = samples.length ? Math.min(...samples) : 0;
const max = samples.length ? Math.max(...samples) : 0;

console.log(JSON.stringify({ url, result, samples, avg, min, max, rawFps }, null, 2));
process.exit(Math.max(avg, rawFps) >= 100 ? 0 : 1);
