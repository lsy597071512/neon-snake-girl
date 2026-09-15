/**
 * Mild P2 base (robot between thighs, no explicit penetration) for Ashcrow.
 * Then local Anima can finish P4 fill without redesigning identity.
 */
import fs from 'fs';
import path from 'path';
import { Blob } from 'node:buffer';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const QA = path.join(ROOT, 'tmp', 'cmd_discipline_p4_qa');
const OUT = path.join(QA, 'fhl_p4');
const SIZE = '1440x2560';

function loadKey() {
  if (process.env.FHL_API_KEY) return process.env.FHL_API_KEY.trim();
  const text = fs.readFileSync(path.join(ROOT, '.tmp-fhl-batch10.mjs'), 'utf8');
  const m = text.match(/const KEY = '([^']+)'/);
  if (!m) throw new Error('missing FHL_API_KEY');
  return m[1];
}

const KEY = loadKey();
const REFS = [
  path.join(QA, 'ref_body_openeye_green.png'),
  path.join(QA, 'ref_official_green.png'),
  path.join(QA, 'ref_zhujue_front_green.png'),
];

const PROMPT = `STRICT identity lock from attached project references.
Keep EXACT same girl as reference 1 (Ashcrow Mio SR01_2 white lace discipline bodysuit): ash-gold high ponytail, wing hair clips, ice-blue open eyes, pale skin, white cyber legs mid-thigh down with gold joints, same lace suit and art polish as the project skin.
Reference 3 is the small scrap robot commander: dome head, twin red circular eyes, weathered off-white metal, much shorter than the girl.
Edit the scene: REMOVE all tentacles completely. Place the small scrap robot standing on the ground BETWEEN her thighs / in front of her pelvis, fully visible body. Robot three-finger hands reach up and press against the lace bodysuit chest fabric only (cloth-covered, no nudity beyond the lace suit already shown).
Full-body vertical 9:16 game character illustration plate.
Chroma key pure green screen #00b140 seamless matte, no black backdrop, no floor shadow.
Premium anime game skin quality matching official SR01_2. Ultra sharp lineart. Do not redesign face, hair, eyes, wing clips, or cyber legs. No tentacles. No second girl. No cat ears.`;

async function once(tag) {
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', PROMPT);
  form.append('n', '1');
  form.append('size', SIZE);
  form.append('quality', 'high');
  form.append('output_format', 'png');
  form.append('response_format', 'b64_json');
  REFS.forEach((filePath, index) => {
    const field = index === 0 ? 'image' : 'image[]';
    form.append(field, new Blob([fs.readFileSync(filePath)], { type: 'image/png' }), path.basename(filePath));
  });
  const res = await fetch('https://www.fhl.mom/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
    body: form,
  });
  const text = await res.text();
  const j = JSON.parse(text.replace(/^\s+/, ''));
  if (!res.ok || j.error) throw new Error(j.error?.message || text.slice(0, 500));
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error('no b64');
  const outPath = path.join(OUT, `${tag}.png`);
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  return outPath;
}

fs.mkdirSync(OUT, { recursive: true });
const results = [];
for (const tag of ['p2_base_a', 'p2_base_b', 'p2_base_c']) {
  console.error(`\n== ${tag} ==`);
  const t0 = Date.now();
  try {
    const outPath = await once(tag);
    results.push({ tag, ok: true, outPath, ms: Date.now() - t0 });
    console.error('OK', outPath);
  } catch (e) {
    results.push({ tag, ok: false, error: e.message, ms: Date.now() - t0 });
    console.error('FAIL', e.message);
    await new Promise((r) => setTimeout(r, 1500));
  }
}
fs.writeFileSync(path.join(OUT, 'manifest_p2.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
