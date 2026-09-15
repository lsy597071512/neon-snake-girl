/**
 * 锈带纪元主页宣传图 ×10
 * 多参考图编辑：严格锁项目立绘/场景/官宣海报画风
 * 余额不足时立即停止，避免空跑扣费
 */
import fs from 'fs';
import path from 'path';
import { Blob } from 'node:buffer';

const KEY = 'sk-dca96c6401f088c55b8ef34766007d52686b8f1ca8e564a09f08e1c62239233c';
const REF = 'd:/neon-snake-girl/neon-snake-girl/.tmp-fhl-refs';
const OUT_DIR = 'C:/Users/LiSuYan/Desktop/锈带纪元-主页宣传图-10张';
const SIZE = '2160x3840'; // 4K 9:16
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

const STYLE_LOCK = `STRICT identity lock from the attached PROJECT reference images (combat portraits + official posters + scene art). 
Art style MUST match project assets exactly: polished anime mecha-musume digital painting with clean linework, soft skin, hard matte/gloss metal panels, cyan/orange energy accents, black studio character look placed into dusty rust-belt environments.
Do NOT invent new characters or redesign outfits/weapons/hair. Do NOT use purple generic cyberpunk. Do NOT add watermarks or UI buttons.
Title treatment when shown: Chinese 「锈带纪元」 weathered metallic + English 「RUST BELT ERA」 + subtle cyan HUD ring.
Player mascot when shown: small white barrel scrap robot with TWO glowing red circular eyes (from zhujue reference), weathered plating.
请严格按照 9:16 竖版画幅生成最终图片，整张图片必须为 9:16 竖向构图。`;

const JOBS = [
  {
    id: '01-ridge-squad-enhance',
    refs: ['poster-v2', 'cast-sheet', 'zhujue', 'beijing'],
    prompt: `${STYLE_LOCK}
Task: Upscale and refine the official ridge squad homepage poster to ultra-sharp 4K vertical promo.
Keep the SAME V-formation composition, dusty sunset scrap ridge, industrial smokestacks, and every character likeness from the official poster + cast sheet.
Foreground red-eye scrap robot must stay. Stronger micro-detail on metal/rust/fabric, cinematic dust godrays.`,
  },
  {
    id: '02-judgment-night',
    refs: ['poster-v5', 'stellar', 'outercore', 'frostline', 'zhujue'],
    prompt: `${STYLE_LOCK}
Night judgment homepage promo inspired by official night poster.
Center: 光轮·天音 — long black hair with pink underlights, glowing double halo, black off-shoulder puffer, white/black leotard, translucent gold cyber left leg, shear-wing blade pods.
Right: 橙兔·美羽 — lavender bob, white mech bunny ears, orange open coat + strap harness bikini, white/gold mech legs, monstrous mech rabbit companion with pink eyes and jagged teeth.
Include small red-eye scrap robot in foreground.
Dark navy starry sky, industrial crane silhouettes, cyan/pink neon accents, vertical mobile splash.`,
  },
  {
    id: '03-ashcrow-lead-station',
    refs: ['ashcrow', 'station', 'zhujue', 'poster-v2'],
    prompt: `${STYLE_LOCK}
Homepage hero starring 苍羽·澪 exactly as SR01_2: ash-platinum high ponytail, white wing head sensors, pale blue eyes, white crop + slate mech gauntlets, cyan glowing Z on right pauldron, white cyber legs with gold joints, huge white/grey energy rifle with cyan canisters.
Scene: zero-station rail platform from station reference — buried rails, stacked containers, cyan lanterns, ochre sunset dust.
Small red-eye scrap robot beside her feet. Low-angle cinematic vertical promo.`,
  },
  {
    id: '04-wireguard-gate',
    refs: ['wireguard', 'gate', 'zhujue', 'beijing'],
    prompt: `${STYLE_LOCK}
Homepage promo starring 黄狐·萤 exactly as SR05_1: long silver-white hair, mech fox ears, yellow eyes, half black/yellow respirator, oversized fluorescent yellow puffer off shoulders, white crop, black #22 pants, white/yellow chunky sneakers, silver mech arms and exposed midriff skeleton plating.
Scene: camp outdoor gate day from reference — spiked salvage gate, rust watchtower, tire tracks, sandbags.
Scrap robot nearby. Dusty daylight, vertical composition.`,
  },
  {
    id: '05-camp-home-squad',
    refs: ['beijing', 'gate', 'cast-sheet', 'zhujue', 'poster-v2'],
    prompt: `${STYLE_LOCK}
Homepage “home base” promo: scrap fortress settlement matching beijing01 / gate references (ship-cabin scrap building, pipes, sand dunes, rust watchtower).
Place a small squad using EXACT likenesses from cast sheet (澪 / 萤 / 天音 / 美羽 / 黑织 / 芹奈) standing near the gate road.
Foreground scrap robot with red eyes. Warm dusty daylight, lived-in rust-belt atmosphere, vertical 4K poster.`,
  },
  {
    id: '06-pathfinder-duo',
    refs: ['ashcrow', 'wireguard', 'heartforge', 'station', 'zhujue'],
    prompt: `${STYLE_LOCK}
Trio vertical promo on the rust-belt rail corridor:
- 苍羽·澪 (SR01_2 exact): platinum ponytail, wing sensors, cyan Z pauldron, energy rifle
- 黄狐·萤 (SR05_1 exact): fox ears, yellow jacket, respirator, #22 pants
- 白楯·芹奈 (SR02_1 exact): ash-blonde long hair, teal eyes, white/gold armor, huge dark shield + white rifle
Include scrap robot. Sunset containers + cyan lamps. Heroic but grounded wasteland mood.`,
  },
  {
    id: '07-heavy-fireteam',
    refs: ['frostline', 'prismrift', 'heartforge', 'poster-v2', 'zhujue'],
    prompt: `${STYLE_LOCK}
Heavy fireteam vertical promo on scrap ridge:
- 夜爪·黑织 (SSR01_1 exact): long black hair, matte black heavy claw gauntlets to the ground, twin shoulder cannons with cyan lights and orange heat vents, black micro outfit, heeled armored boots
- 焰甲·朱里 (SR04_1 exact): orange/white heavy armor, MB-02 shoulder railcannon, bulky orange gauntlets, talon feet
- 白楯·芹奈 with tall shield
Scrap robot in front. Dusty industrial sunset matching official poster grade.`,
  },
  {
    id: '08-stealth-blade-night',
    refs: ['neoncoil', 'dustblade', 'mirror', 'poster-v5', 'zhujue'],
    prompt: `${STYLE_LOCK}
Night infiltration vertical promo:
- 苍斩·凛 (SR01_3 exact): short icy blue-grey hair, orange headband, white ceramic full-body mech plating, black joints, sniper with bayonet, backpack cable
- 银绯·玲 (SR03_1 exact): grey-brown hair with silver fringe streak, red eyes, yellow antenna headset, white armor, bulky left gauntlet, yellow-vent wing pack, dark rifle
- 绯尾·椿 (SSR04_1 exact): brown-pink long hair, red eyes, black glossy suit, scorpion mech tail, black pointed ear headset, red cable spine
Deep navy industrial night, cyan rim light, scrap robot silhouette, vertical splash.`,
  },
  {
    id: '09-wing-and-forge',
    refs: ['skyshard', 'ironrain', 'pulse', 'beijing', 'zhujue'],
    prompt: `${STYLE_LOCK}
Vertical promo at scrap settlement:
- 翠翼·铃 (SSR02_1 exact): silver-white hair, neon-green glowing wing unit, white/grey suit, pointed mech feet
- 橙铠·琥珀 (SSR05_1 exact): bright orange high ponytail, teal forehead visor clip, glossy black leotard with gold trim, white limb armor with hazard stripes, sitting/leaning industrial table vibe adapted into outdoor scrap balcony
- 冰华·雫 (SSR03_1 exact): light blue-lavender hair, white plugsuit with gold joints, heavy white/blue companion mecha behind
Include scrap robot. Ochre dust + cyan accents, vertical homepage quality.`,
  },
  {
    id: '10-fullcast-epic',
    refs: ['poster-v2', 'poster-v5', 'cast-sheet', 'station', 'zhujue'],
    prompt: `${STYLE_LOCK}
Ultimate vertical homepage key art: combine official poster epic scale with exact cast likenesses from the cast sheet.
Low-angle V-formation on scrap ridge above zero-station corridor; dusty sunset OR night judgment lighting (pick the stronger cinematic look while keeping character IDs correct).
Must include titles 「锈带纪元」 / 「RUST BELT ERA」 and the red-eye scrap robot front-center.
Maximum sharpness, metal micro-detail, readable faces, no identity drift.`,
  },
];

function isBillingError(msg) {
  return /余额|balance|quota|billing|insufficient|402|payment|credit|用尽|耗尽|欠费/i.test(msg);
}

async function editOnce(job) {
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', job.prompt);
  form.append('n', '1');
  form.append('size', SIZE);
  form.append('quality', 'auto');
  form.append('output_format', 'png');
  form.append('response_format', 'b64_json');

  job.refs.forEach((name, index) => {
    const filePath = path.join(REF, `${name}.png`);
    const buf = fs.readFileSync(filePath);
    const field = index === 0 ? 'image' : 'image[]';
    form.append(field, new Blob([buf], { type: 'image/png' }), `${name}.png`);
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
    throw new Error(`invalid json HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  if (!res.ok || j.error) {
    const msg = j.error?.message || text.slice(0, 400);
    const err = new Error(msg);
    err.billing = isBillingError(msg) || res.status === 402;
    err.status = res.status;
    throw err;
  }
  const item = j.data?.[0];
  const b64 = item?.b64_json;
  if (!b64 && !item?.url) throw new Error('no image in response');
  const outPath = path.join(OUT_DIR, `${job.id}.png`);
  if (b64) fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
  else fs.writeFileSync(outPath, Buffer.from(await (await fetch(item.url)).arrayBuffer()));
  return { outPath, bytes: fs.statSync(outPath).size };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const results = [];
console.error(`Start ${JOBS.length} jobs @ ${SIZE}`);

for (let i = 0; i < JOBS.length; i++) {
  const job = JOBS[i];
  console.error(`\n[${i + 1}/${JOBS.length}] ${job.id} refs=${job.refs.join(',')}`);
  const t0 = Date.now();
  try {
    const r = await editOnce(job);
    const row = { id: job.id, ok: true, ms: Date.now() - t0, ...r };
    results.push(row);
    console.error('OK', r.outPath, r.bytes, `${row.ms}ms`);
  } catch (e) {
    const row = { id: job.id, ok: false, ms: Date.now() - t0, error: e.message, billing: !!e.billing };
    results.push(row);
    console.error('FAIL', e.message);
    if (e.billing) {
      console.error('Billing/quota hit — stop remaining jobs to protect balance.');
      break;
    }
    // transient upstream: brief wait then continue
    await new Promise((r) => setTimeout(r, 2500));
  }
}

fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), size: SIZE, results }, null, 2));
const ok = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ okCount: ok, totalAttempted: results.length, outDir: OUT_DIR, results }, null, 2));
