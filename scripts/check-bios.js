const fs = require('fs');
const path = require('path');

function cn(s) {
  return (s.match(/[\u4e00-\u9fff]/g) || []).length;
}

const root = path.join(__dirname, '..');
for (const f of ['src/data/sr-bios.ts', 'src/data/ssr-ur-bios.ts']) {
  const t = fs.readFileSync(path.join(root, f), 'utf8');
  const ids = [...t.matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
  console.log('FILE', f);
  for (const id of ids) {
    const re = new RegExp(id + ':\\s*\\{[\\s\\S]*?detailedBio:\\s*`([\\s\\S]*?)`');
    const m = t.match(re);
    if (!m) {
      console.log(id, 'MISS');
      continue;
    }
    const n = cn(m[1]);
    console.log(id, n, n >= 2000 ? 'OK' : 'SHORT');
  }
}

console.log('--- data files ---');
console.log(fs.readdirSync(path.join(root, 'src/data')).join('\n'));
const lore = path.join(root, 'src/data/lore');
if (fs.existsSync(lore)) console.log('lore:', fs.readdirSync(lore).join(', '));
