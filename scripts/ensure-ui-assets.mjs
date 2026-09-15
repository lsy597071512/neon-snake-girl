import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function needsSlice(dir, required) {
  if (!fs.existsSync(path.join(root, dir, 'manifest.json'))) return true;
  return required.some((name) => !fs.existsSync(path.join(root, dir, name)));
}

const tasks = [];

if (
  needsSlice('tex/wasteland-ui', [
    'avatarFrame.png',
    'bottomNav.png',
    'sideShop.png',
    'resGold.png',
  ])
) {
  tasks.push('slice-wasteland-ui.mjs');
}

if (
  needsSlice('tex/sub-ui', [
    'headerBar.png',
    'panelMain.png',
    'btnPrimary.png',
  ])
) {
  tasks.push('slice-sub-ui.mjs');
}

for (const script of tasks) {
  console.log(`[ensure-ui-assets] generating missing slices via ${script}`);
  execSync(`node scripts/${script}`, { cwd: root, stdio: 'inherit' });
}

const avatarDir = path.join(root, 'tex/juese/avatars');
const avatarSample = path.join(avatarDir, 'ashcrow.png');
if (!fs.existsSync(avatarSample)) {
  console.log('[ensure-ui-assets] generating character avatars');
  execSync('node scripts/generate-character-avatars.mjs', { cwd: root, stdio: 'inherit' });
}
