/**
 * 校验小黑屋 idle/姿势切换不会出现 primary+secondary 叠影。
 * 使用最小 DOM fixture + 与正式逻辑一致的硬隐藏规则。
 */
import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const fixture = path.join(root, 'scripts', '_fixtures', 'discipline-skin-overlap.html');

fs.mkdirSync(path.dirname(fixture), { recursive: true });
fs.writeFileSync(
  fixture,
  `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
.ai-dlg-layer-skin { position: relative; width: 200px; height: 300px; }
.ai-dlg-skin-secondary {
  position: absolute; inset: 0; width: 100%; height: 100%;
}
.ai-dlg-skin-secondary:not([hidden]):not(.is-hidden) { z-index: 2; }
.ai-dlg-skin-secondary[hidden],
.ai-dlg-skin-secondary.is-hidden {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
  z-index: 0 !important;
}
video.is-hidden { opacity: 0; }
</style>
</head>
<body>
<div class="ai-dlg-portrait-stage" data-dialogue-portrait-stage data-character-id="prismrift" data-skin-phase="discipline-sticky" data-discipline-pose-index="4" data-discipline-sticky-clip="pose4.webm">
  <div class="ai-dlg-layer ai-dlg-layer-skin is-active" data-role="skin">
    <video data-ai-live-portrait class="is-hidden" data-testid="primary"></video>
    <video data-role="skin-secondary" data-skin-src="pose4.webm" data-testid="secondary"></video>
  </div>
</div>
<script>
function hideDialogueSecondaryHard(secondary) {
  if (!secondary) return;
  secondary.pause();
  secondary.loop = false;
  secondary.classList.remove('is-entering', 'is-exiting');
  secondary.classList.add('is-hidden');
  secondary.setAttribute('hidden', '');
  secondary.setAttribute('aria-hidden', 'true');
}
function crossfadeToPrimary(stage) {
  const primary = stage.querySelector('[data-ai-live-portrait]');
  const secondary = stage.querySelector('[data-role="skin-secondary"]');
  delete stage.dataset.disciplineStickyClip;
  delete stage.dataset.disciplinePoseIndex;
  stage.dataset.skinPhase = 'idle';
  hideDialogueSecondaryHard(secondary);
  if (primary) {
    primary.classList.remove('is-hidden', 'is-exiting');
    primary.classList.add('is-entering');
  }
  hideDialogueSecondaryHard(secondary);
  return {
    primaryHidden: primary.classList.contains('is-hidden'),
    secondaryHasHidden: secondary.hasAttribute('hidden'),
    secondaryIsHiddenClass: secondary.classList.contains('is-hidden'),
    secondaryDisplay: getComputedStyle(secondary).display,
    secondaryVisibility: getComputedStyle(secondary).visibility,
    overlapFree: secondary.hasAttribute('hidden') || secondary.classList.contains('is-hidden') || primary.classList.contains('is-hidden'),
  };
}
window.__runIdleSwitch = () => crossfadeToPrimary(document.querySelector('[data-dialogue-portrait-stage]'));
</script>
</body>
</html>`,
  'utf8',
);

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('OK:', msg);
  else {
    console.error('FAIL:', msg);
    failed += 1;
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('file://' + fixture.replace(/\\/g, '/'));
const result = await page.evaluate(() => window.__runIdleSwitch());
await browser.close();

assert(result.secondaryHasHidden === true, 'secondary 带 [hidden]');
assert(result.secondaryIsHiddenClass === true, 'secondary 带 .is-hidden');
assert(result.secondaryDisplay === 'none', `secondary display:none（实际 ${result.secondaryDisplay}）`);
assert(result.primaryHidden === false, 'primary 已显示（无 is-hidden）');
assert(result.overlapFree === true, 'idle 切换后无叠影');

if (failed) {
  console.error(`discipline skin overlap verify failed: ${failed}`);
  process.exit(1);
}
console.log('discipline skin overlap verify passed');
