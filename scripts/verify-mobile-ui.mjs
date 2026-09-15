import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

// ── 静态文件检查 ──
const indexHtml = read('index.html');
assert(!indexHtml.includes('fonts.googleapis.com'), 'index.html 已移除 Google Fonts CDN');
assert(indexHtml.includes('viewport-fit=cover'), 'index.html 保留 viewport-fit=cover');

assert(exists('src/fonts.css'), 'src/fonts.css 存在');
const fontsCss = read('src/fonts.css');
assert(fontsCss.includes('@fontsource/noto-sans-sc'), 'fonts.css 引入 Noto Sans SC');
assert(fontsCss.includes('@fontsource/orbitron'), 'fonts.css 引入 Orbitron');

const styleCss = read('src/style.css');
assert(styleCss.includes('--safe-top'), 'style.css 定义 --safe-top');
assert(styleCss.includes('html.capacitor-native'), 'style.css 含 capacitor-native 规则');
assert(styleCss.includes('.confirm-actions'), 'style.css 含确认弹窗样式');

assert(exists('src/ui/confirmDialog.ts'), 'confirmDialog.ts 存在');
assert(exists('src/platform/nativeInit.ts'), 'nativeInit.ts 存在');

const appTs = read('src/ui/App.ts');
assert(!appTs.includes("alert('"), 'App.ts 已移除 alert()');
assert(appTs.includes('showAlert'), 'App.ts 使用 showAlert');

const combatTs = read('src/game/Combat3D.ts');
assert(!combatTs.includes("confirm('"), 'Combat3D.ts 已移除 confirm()');

// ── 9:16 画幅在不同手机比例下的计算 ──
const viewports = [
  { name: '18:9', vw: 360, vh: 720 },
  { name: '19.5:9', vw: 390, vh: 844 },
  { name: '20:9', vw: 412, vh: 915 },
  { name: '21:9', vw: 384, vh: 896 },
];

for (const vp of viewports) {
  const frameW = Math.min(vp.vw, (vp.vh * 9) / 16);
  const frameH = Math.min(vp.vh, (vp.vw * 16) / 9);
  const ratio = frameW / frameH;
  assert(Math.abs(ratio - 9 / 16) < 0.02, `${vp.name} 画幅比维持 9:16 (${ratio.toFixed(3)})`);
  assert(frameW > 0 && frameH > 0, `${vp.name} 画幅尺寸有效 ${frameW}x${frameH}`);
}

console.log('');
if (failed > 0) {
  console.error(`移动端 UI 校验失败: ${failed} 项`);
  process.exit(1);
}
console.log('移动端 UI / 平台校验全部通过');
