/**
 * Ashcrow SR01_2 · Commander Direct P4 via fhl multi-ref image edit.
 * Quality bar: must match existing tiaojiao / official skin polish.
 *
 * Auth: FHL_API_KEY env, or KEY line in .tmp-fhl-batch10.mjs (local only).
 */
import fs from 'fs';
import path from 'path';
import { Blob } from 'node:buffer';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const QA = path.join(ROOT, 'tmp', 'cmd_discipline_p4_qa');
const OUT = path.join(QA, 'fhl_p4');
const SIZE = '1440x2560'; // 2K-ish 9:16

function loadKey() {
  if (process.env.FHL_API_KEY) return process.env.FHL_API_KEY.trim();
  const src = path.join(ROOT, '.tmp-fhl-batch10.mjs');
  const text = fs.readFileSync(src, 'utf8');
  const m = text.match(/const KEY = '([^']+)'/);
  if (!m) throw new Error('missing FHL_API_KEY');
  return m[1];
}

const KEY = loadKey();

const PROMPT = `STRICT identity lock from attached project references.
Reference 1 = Ashcrow Mio / SR01_2 in white lace discipline bodysuit (tiaojiao skin): ash-gold high ponytail, straight bangs, white mechanical wing hair clips both sides, ice-blue OPEN eyes, pale fair skin, white-silver cyber legs from mid-thigh with gold/grey joints. Keep the SAME face, hair, wing clips, lace suit, cyber legs, art polish as reference 1.
Reference 2 = official combat portrait for face/hair identity reinforcement.
Reference 3 = commander scrap robot front view: small weathered off-white dome-head robot, twin glowing red circular eyes, three-finger hands — much shorter than the girl.

Task: create ONE full-body vertical 9:16 game character skin plate for Commander Direct Discipline stage P4.
REPLACE all tentacles with the commander robot. Robot stands BETWEEN her thighs / pressed to pelvis, fully visible.
P4 action: robot main mechanical pipe inserted vagina through lace crotch slit; thinner secondary mechanical tube in anus; BOTH robot hands pinching nipples through lace; oil/hydraulic fluid stains on crotch and thighs; trembling thighs, arched spine, biting lip, overwhelmed shame blush, eyes open ice-blue.
Chroma key pure green screen #00b140, seamless studio matte, no floor, no black backdrop, no letterbox.
2D anime game illustration quality matching official SR01_2 skins — ultra sharp lineart, clean cel shading, no photoreal pores, no redesign.
NO tentacles, NO octopus, NO second girl, NO three-view sheet, NO cat ears, NO nude without lace.`;

const REFS = [
  path.join(QA, 'ref_body_openeye_green.png'),
  path.join(QA, 'ref_official_green.png'),
  path.join(QA, 'ref_zhujue_front_green.png'),
];

function isBillingError(msg) {
  return /余额|balance|quota|billing|insufficient|402|payment|credit|用尽|耗尽|欠费/i.test(msg);
}

async function editOnce(tag, prompt) {
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('n', '1');
  form.append('size', SIZE);
  form.append('quality', 'high');
  form.append('output_format', 'png');
  form.append('response_format', 'b64_json');

  REFS.forEach((filePath, index) => {
    const buf = fs.readFileSync(filePath);
    const field = index === 0 ? 'image' : 'image[]';
    form.append(field, new Blob([buf], { type: 'image/png' }), path.basename(filePath));
  });

  const res = await fetch('https://www.fhl.mom/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
    body: form,
  });
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text.replace(/^\s+/, ''));
  } catch {
    throw new Error(`invalid json HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || j.error) {
    const msg = j.error?.message || text.slice(0, 500);
    const err = new Error(msg);
    err.billing = isBillingError(msg) || res.status === 402;
    err.status = res.status;
    throw err;
  }
  const item = j.data?.[0];
  const b64 = item?.b64_json;
  if (!b64 && !item?.url) throw new Error('no image in response');
  const outPath = path.join(OUT, `${tag}.png`);
  if (b64) fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  else fs.writeFileSync(outPath, Buffer.from(await (await fetch(item.url)).arrayBuffer()));
  return outPath;
}

fs.mkdirSync(OUT, { recursive: true });
const tags = ['p4_a', 'p4_b', 'p4_c'];
const results = [];
for (const tag of tags) {
  console.error(`\n== ${tag} ==`);
  const t0 = Date.now();
  try {
    const outPath = await editOnce(tag, PROMPT);
    results.push({ tag, ok: true, outPath, ms: Date.now() - t0 });
    console.error('OK', outPath, `${Date.now() - t0}ms`);
  } catch (e) {
    results.push({ tag, ok: false, error: e.message, billing: !!e.billing, ms: Date.now() - t0 });
    console.error('FAIL', e.message);
    if (e.billing) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results, null, 2));
