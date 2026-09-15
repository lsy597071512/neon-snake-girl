/**
 * Mobile squad regression: exercise the Pointer Events fallback used by
 * Android WebViews, including bench-to-slot replacement and bench removal.
 * Usage: node scripts/verify-mobile-squad-touch.mjs [url]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
let failures = 0;

function fail(message) {
  console.error('[verify-mobile-squad-touch] FAIL:', message);
  failures += 1;
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const relative = urlPath.replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(dist, relative);
    if (!file.startsWith(dist + path.sep) && file !== path.join(dist, 'index.html')) {
      response.statusCode = 403;
      response.end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(file)] ?? 'application/octet-stream';
      response.setHeader('Content-Type', mime);
      response.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const suppliedUrl = process.argv[2];
const server = suppliedUrl ? null : await startStaticServer();
const url = suppliedUrl ?? `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.on('pageerror', (error) => fail(`page error: ${error.message}`));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    const licensePayload = btoa(JSON.stringify({
      c: 'RB-TEST-SQUAD',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    // Browser tests only need the client-side expiry check; avoid hitting the live gateway.
    localStorage.setItem('rb-license-token', `${licensePayload}.test-signature`);
    localStorage.setItem('rb-license-validated-at', String(Date.now()));
    const key = 'rust-belt-era-save-v1';
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}');
    raw.version = 7;
    raw.ownedCharacters = [
      { characterId: 'ashcrow', weaponId: 'w01', giftCount: 0, shardPowerBonus: 0 },
      { characterId: 'heartforge', weaponId: 'w02', giftCount: 0, shardPowerBonus: 0 },
      { characterId: 'mirror', weaponId: null, giftCount: 0, shardPowerBonus: 0 },
    ];
    raw.ownedWeaponIds = ['w01', 'w02'];
    raw.squad = ['ashcrow', 'heartforge'];
    raw.tutorialFlags = { ...(raw.tutorialFlags ?? {}), worldIntroSeen: true };
    raw.settings = { ...(raw.settings ?? {}), hubFeaturedCharId: 'ashcrow', useLivePortrait: false };
    localStorage.setItem(key, JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-title-start]').click();
  await page.locator('[data-goto="squad"]').click();
  await page.locator('[data-squad-drag="mirror"]').waitFor();

  async function touchDrag(source, target) {
    const sourceLocator = page.locator(source);
    const targetLocator = page.locator(target);
    await targetLocator.scrollIntoViewIfNeeded();
    const start = await sourceLocator.boundingBox();
    const end = await targetLocator.boundingBox();
    if (!start || !end) throw new Error('drag source or target is not visible');
    await page.evaluate(({ startPoint, endPoint, sourceSelector }) => {
      const sourceElement = document.querySelector(sourceSelector);
      if (!sourceElement) throw new Error('drag source disappeared');
      const fire = (type, point) => {
        document.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType: 'touch',
          isPrimary: true,
          clientX: point.x,
          clientY: point.y,
        }));
      };
      sourceElement.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: startPoint.x,
        clientY: startPoint.y,
      }));
      fire('pointermove', { x: startPoint.x + 12, y: startPoint.y + 12 });
      fire('pointermove', endPoint);
      fire('pointerup', endPoint);
    }, {
      sourceSelector: source,
      startPoint: { x: start.x + start.width / 2, y: start.y + start.height / 2 },
      endPoint: { x: end.x + end.width / 2, y: end.y + end.height / 2 },
    });
  }

  await touchDrag('[data-squad-drag="mirror"]', '[data-squad-slot="1"]');
  await page.locator('[data-squad-slot="1"][data-squad-char="mirror"]').waitFor();
  const afterReplacement = await page.evaluate(() => JSON.parse(localStorage.getItem('rust-belt-era-save-v1')).squad);
  if (JSON.stringify(afterReplacement) !== JSON.stringify(['ashcrow', 'mirror'])) {
    fail(`bench-to-slot touch drag produced ${JSON.stringify(afterReplacement)}`);
  }

  await touchDrag('[data-squad-slot-drag="ashcrow"]', '[data-squad-bench-drop]');
  await page.locator('[data-squad-slot="1"].empty').waitFor();
  const afterRemoval = await page.evaluate(() => JSON.parse(localStorage.getItem('rust-belt-era-save-v1')).squad);
  if (JSON.stringify(afterRemoval) !== JSON.stringify(['mirror'])) {
    fail(`slot-to-bench touch drag produced ${JSON.stringify(afterRemoval)}`);
  }

  console.log('Mobile squad Pointer Events assertions passed.');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  if (server) server.close();
}

process.exit(failures > 0 ? 1 : 0);
