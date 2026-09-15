/**
 * P1 对话世界同步验证：Vite 打包真实模块图 → 无头 Chromium 断言。
 * 用法：node scripts/verify-dialogue-sync.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harnessDir = path.join(root, 'tmp', 'verify-dialogue-sync');
const outDir = path.join(harnessDir, 'dist');

let failed = 0;
function fail(msg) {
  console.error('[verify-dialogue-sync] FAIL:', msg);
  failed += 1;
}

// 1) Vite 打包（configFile:false，避免带进主工程插件）
try {
  await build({
    configFile: false,
    root: harnessDir,
    base: './',
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2022',
    },
  });
} catch (err) {
  fail('vite build failed: ' + (err?.message ?? err));
  process.exit(1);
}

// 2) 静态服务
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = urlPath.replace(/^\/+/, '') || 'index.html';
  // The harness intentionally builds without the app's static tex plugin, so serve source assets directly.
  const isTexRequest = rel.startsWith('tex/');
  const assetRoot = isTexRequest ? path.join(root, 'tex') : outDir;
  const abs = path.resolve(assetRoot, isTexRequest ? rel.slice('tex/'.length) : rel);
  const relativePath = path.relative(assetRoot, abs);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.webm': 'video/webm',
    }[ext] ?? 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html`;

// 3) 无头 Chromium 执行
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (err) => fail('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser:error]', msg.text().slice(0, 300));
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__VERIFY_DONE === true, null, { timeout: 30000 });
  const results = await page.evaluate(() => window.__VERIFY_RESULTS);
  for (const line of results.lines) console.log(line);
  if (results.fail > 0) {
    fail(`${results.fail} assertion(s) failed (${results.pass} passed)`);
  } else {
    console.log(`\nAll dialogue-sync assertions passed (${results.pass}).`);
  }
} catch (err) {
  fail('browser run failed: ' + (err?.message ?? err));
} finally {
  await browser.close();
  server.close();
}

process.exit(failed > 0 ? 1 : 0);
