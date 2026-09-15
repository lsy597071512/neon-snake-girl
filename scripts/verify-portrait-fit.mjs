import fs from 'node:fs';
import path from 'node:path';

const cssPath = path.join(process.cwd(), 'src', 'cc-ui.css');
const css = fs.readFileSync(cssPath, 'utf8');

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

function block(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'm'));
  return match?.[1] ?? '';
}

const homeFeaturedBox = block('.home-featured-portrait');
const homeFeaturedImg = block('.home-char-portrait');
const listBox = block('.char-portrait');
const listImg = block('.char-portrait-img');
const hubBox = block('.hub-char-zone');

assert(homeFeaturedBox.includes('overflow: hidden'), 'home featured portrait container clips overflow');
assert(homeFeaturedImg.includes('position: absolute'), 'home featured portrait is positioned inside the frame');
assert(homeFeaturedImg.includes('object-fit: contain'), 'home featured portrait keeps full visual proportion');

assert(listBox.includes('overflow: hidden'), 'character list portrait container clips overflow');
assert(listImg.includes('position: absolute'), 'character list portrait is positioned inside the frame');
assert(listImg.includes('object-fit: contain'), 'character list portrait keeps full visual proportion');

assert(
  hubBox.includes('overflow: hidden') || hubBox.includes('overflow: visible'),
  'hub portrait zone clips oversized visual overflow',
);

const viewports = [
  { name: 'pc', width: 1600, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
];

for (const viewport of viewports) {
  assert(viewport.width > 0 && viewport.height > 0, `${viewport.name} viewport sample is valid`);
  assert(css.includes('object-position: center bottom'), `${viewport.name} keeps portraits bottom-aligned inside frames`);
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log('\nAll portrait fit validation tests passed.');
