import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function countHan(s) {
  return (s.match(/[\u4e00-\u9fff]/g) || []).length;
}

function extractBios(filePath) {
  const t = fs.readFileSync(filePath, 'utf8');
  const results = [];
  // Match id: { ... detailedBio: `...`,
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
    results.push({ id, han: countHan(bio), len: bio.length });
  }
  return results;
}

for (const rel of ['src/data/sr-bios.ts', 'src/data/ssr-ur-bios.ts', 'src/data/sr-bios-draft.ts']) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.log('MISSING', rel);
    continue;
  }
  console.log('===', rel, '===');
  for (const r of extractBios(p)) {
    console.log(
      r.id.padEnd(12),
      'han=',
      String(r.han).padStart(5),
      r.han >= 2000 ? 'OK' : 'SHORT',
      'bytes=',
      r.len,
    );
  }
}
