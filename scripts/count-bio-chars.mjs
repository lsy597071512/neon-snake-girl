import { readFileSync } from 'fs';

const content = readFileSync('src/data/ssr-ur-bios.ts', 'utf8');
const ids = ['frostline', 'pulse', 'dustblade', 'ironrain', 'skyshard', 'stellar', 'outercore'];

for (const id of ids) {
  const re = new RegExp(`${id}:\\s*\\{[\\s\\S]*?detailedBio:\\s*\`([\\s\\S]*?)\`,\\s*homeRegion`);
  const m = content.match(re);
  if (!m) {
    console.log(`${id}: NOT FOUND`);
    continue;
  }
  const text = m[1];
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  console.log(`${id}: han=${han} total=${text.length}`);
}
