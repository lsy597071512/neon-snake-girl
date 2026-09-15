import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function extractShortBios(src) {
  const out = {};
  const re = /id:\s*'([^']+)'[\s\S]*?bio:\s*'((?:\\'|[^'])*)'/g;
  let m;
  while ((m = re.exec(src))) {
    out[m[1]] = m[2].replace(/\\'/g, "'").trim();
  }
  return out;
}

function extractDetailed(filePath) {
  const t = fs.readFileSync(filePath, 'utf8');
  const results = {};
  const idRe = /^\s{2}([a-zA-Z0-9_-]+):\s*\{/gm;
  let m;
  while ((m = idRe.exec(t))) {
    const id = m[1];
    const from = m.index;
    const bioKey = t.indexOf('detailedBio:', from);
    if (bioKey < 0 || bioKey > from + 200) continue;
    const tick = t.indexOf('`', bioKey);
    if (tick < 0) continue;
    let i = tick + 1;
    let bio = '';
    while (i < t.length) {
      if (t[i] === '\\' && i + 1 < t.length) {
        bio += t[i + 1];
        i += 2;
        continue;
      }
      if (t[i] === '`') break;
      bio += t[i];
      i++;
    }
    results[id] = bio.trim();
  }
  return results;
}

const shorts = extractShortBios(fs.readFileSync(path.join(root, 'src/data/characters.ts'), 'utf8'));
const detailed = {
  ...extractDetailed(path.join(root, 'src/data/sr-bios.ts')),
  ...extractDetailed(path.join(root, 'src/data/ssr-ur-bios.ts')),
};

for (const id of Object.keys(shorts)) {
  const short = shorts[id];
  const full = detailed[id];
  if (!full) {
    console.log(id, 'MISSING_DETAILED');
    continue;
  }
  const first = full.split(/\n+/)[0].trim();
  const ok = first.includes(short.slice(0, Math.min(24, short.length))) || short.includes(first.slice(0, 24));
  console.log(id, ok ? 'OPEN_OK' : 'OPEN_MISMATCH');
  if (!ok) {
    console.log('  short:', short.slice(0, 50));
    console.log('  first:', first.slice(0, 50));
  }
}
