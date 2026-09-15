import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  characters: path.join(root, 'src', 'data', 'characters.ts'),
  app: path.join(root, 'src', 'ui', 'App.ts'),
  uiAssets: path.join(root, 'src', 'ui', 'uiAssets.ts'),
  livePortrait: path.join(root, 'src', 'ui', 'livePortrait.ts'),
  css: path.join(root, 'src', 'cc-ui.css'),
};

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

const characters = read(files.characters);
const app = read(files.app);
const uiAssets = read(files.uiAssets);
const livePortrait = read(files.livePortrait);
const css = read(files.css);

const requiredAssets = [
  'tex/juese/SR01_2.png',
  'tex/juese/SR01_2.webm',
  'tex/juese/SR01_2_1.webm',
  'tex/juese/SR01.glb',
];

for (const asset of requiredAssets) {
  const full = path.join(root, asset);
  assert(fs.existsSync(full) && fs.statSync(full).size > 0, `${asset} exists and is not empty`);
}

assert(
  characters.includes("portraitLive: './tex/juese/SR01_2.webm'"),
  'ashcrow live portrait points to SR01_2.webm',
);
assert(uiAssets.includes('renderLivePortrait'), 'uiAssets re-exports renderLivePortrait');
assert(app.includes('getLivePortraitSrc'), 'live portrait source is resolved from character data');
assert(app.includes('bindLivePortraits'), 'live portrait media is bound after render');
assert(livePortrait.includes('isRestrictedInAppBrowser'), 'in-app browsers are detected');
assert(livePortrait.includes('MicroMessenger'), 'wechat is detected');
assert(livePortrait.includes('Feishu'), 'feishu is detected');
assert(livePortrait.includes('canPlayWebmLivePortrait'), 'webm capability is detected');
assert(livePortrait.includes('getLivePortraitMimeType'), 'live portrait MIME is resolved');
assert(livePortrait.includes('type="${mime}"'), 'capable browsers use typed video source');
assert(!livePortrait.includes('.webp'), 'live portrait does not use webp');
assert(livePortrait.includes('autoplay muted loop playsinline'), 'live portrait has mobile-safe autoplay attributes');
assert(app.includes('data-toggle-live-portrait'), 'live portrait toggle button is rendered');

assert(
  css.includes('.hub-char-zone .hub-char-portrait,\n.hub-char-zone .char-live-portrait'),
  'live and static hub portraits share layout',
);
assert(css.includes('object-fit: contain'), 'portrait media keeps aspect ratio');

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log('\nAll SR01 art and live portrait tests passed.');
