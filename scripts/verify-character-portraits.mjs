import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const charactersPath = path.join(root, 'src', 'data', 'characters.ts');
const text = fs.readFileSync(charactersPath, 'utf8');

/** 与 characters.ts 当前映射对齐 */
const expected = [
  { id: 'ashcrow', front: 'SR01_2.png', back: 'SR01_2.png', live: 'SR01_2.webm', live2: 'SR01_2_1.webm', model: 'SR01.glb' },
  { id: 'heartforge', front: 'SR02_1.png', back: 'SR02_1.png', live: 'SR02_1.webm', live2: 'SR02_1_1.webm', model: 'SR02.glb' },
  { id: 'mirror', front: 'SR03_1.png', back: 'SR03_1.png', live: 'SR03_1.webm', live2: 'SR03_1_1.webm', model: 'SR03_1.glb' },
  { id: 'neoncoil', front: 'SR01_3.png', back: 'SR01_3.png', live: 'SR01_3.webm', live2: 'SR01_3_1.webm', model: 'SR01_3.glb' },
  { id: 'prismrift', front: 'SR04_1.png', back: 'SR04_1.png', live: 'SR04_1.webm', live2: 'SR04_1_1.webm', model: 'SR04_1.glb' },
  { id: 'wireguard', front: 'SR05_1.png', back: 'SR05_1.png', live: 'SR05_1.webm', live2: 'SR05_1_1.webm', model: 'SR05_1.glb' },
  { id: 'frostline', front: 'SSR01_1.png', back: 'SSR01_1.png', live: 'SSR01_1.webm', live2: 'SSR01_1_1.webm', model: 'SSR01_1.glb' },
  { id: 'pulse', front: 'SSR02_1.png', back: 'SSR02_1.png', live: 'SSR02_1.webm', live2: 'SSR02_1_1.webm', model: 'SSR02_1.glb' },
  { id: 'dustblade', front: 'SSR04_1.png', back: 'SSR04_1.png', live: 'SSR04_1.webm', live2: 'SSR04_1_1.webm', model: 'SSR04_1.glb' },
  { id: 'ironrain', front: 'SSR05_1.png', back: 'SSR05_1.png', live: 'SSR05_1.webm', live2: 'SSR05_1_1.webm', model: 'SSR05_1.glb' },
  { id: 'skyshard', front: 'SSR03_1.png', back: 'SSR03_1.png', live: 'SSR03_1.webm', live2: 'SSR03_1_1.webm', model: 'SSR03_1.glb' },
  { id: 'stellar', front: 'UR03_1.png', back: 'UR03_1.png', live: 'UR03_1.webm', live2: 'UR03_1_1.webm', model: 'UR03_1.glb' },
  { id: 'outercore', front: 'UR04_1.png', back: 'UR04_1.png', live: 'UR04_1.webm', live2: 'UR04_1_1.webm', model: 'UR04_1.glb' },
];

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

function existsNonEmpty(rel) {
  const p = path.join(root, 'tex', 'juese', rel);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
}

for (const row of expected) {
  assert(text.includes(`id: '${row.id}'`), `${row.id} defined in characters.ts`);
  assert(text.includes(`portraitFront: './tex/juese/${row.front}'`), `${row.id} front -> ${row.front}`);
  assert(text.includes(`portraitBack: './tex/juese/${row.back}'`), `${row.id} back -> ${row.back}`);
  assert(text.includes(`portraitLive: './tex/juese/${row.live}'`), `${row.id} live -> ${row.live}`);
  assert(
    text.includes(`portraitLiveSecondary: './tex/juese/${row.live2}'`),
    `${row.id} live2 -> ${row.live2}`,
  );
  assert(text.includes(`combatModel: './tex/juese/${row.model}'`), `${row.id} model -> ${row.model}`);

  for (const file of [row.front, row.back, row.live, row.live2, row.model]) {
    assert(existsNonEmpty(file), `${file} on disk`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log('\nAll character portrait / live / combat model mappings verified.');
