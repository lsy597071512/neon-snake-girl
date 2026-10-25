/**
 * 市场合规词表校验（只扫描，不改源码）。
 *
 * 三层分级，依据「绯月絮语」实测（国新出审〔2025〕1488号、B站官号宣发）：
 *   T1 HARD_REDLINE —— 器官名 / 露点 / 性行为。全库必须为 0，越线即违规。
 *   T2 PROMPT_RISKY —— 可用于「人工固定文案」，但不应作为 LLM 实时输出目标
 *                       （模型自我审查/降级风险；且动态内容无法事后修正）。
 *   T3 PROMPT_SAFE  —— 文案层与 Prompt 层都可安全使用的擦边词。
 *
 * 判定口径：文案尺度 ≫ 画面尺度。线画在画面（露点/性部位特写），不在文案。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const TARGETS = ['src/ai', 'src/data', 'src/ui'];

/** T1：硬红线——器官、露点、性行为。全库禁止。 */
const T1_HARD_REDLINE = [
  '乳头', '乳晕', '阴道', '阴茎', '肉棒', '小穴', '淫', '勃起',
  '发情', '潮吹', '射精', '精液', '口交', '性交', '做爱', '自慰',
  '会阴', '肛交', '裸体', '全裸', '露点', '无罩', '硬了',
];

/** T2：人工文案可用，但不得作为 LLM 实时输出目标（此词入库会让模型自我审查/降智）。 */
const T2_PROMPT_RISKY = [
  '调教', '触手', '拘束', '敏感点', '开腿', '呻吟', '娇喘', '快感',
];

/** T3：文案层与 Prompt 层均可安全使用。 */
const T3_PROMPT_SAFE = [
  '调情', '撩拨', '暧昧', '私密', '服侍', '挑逗', '情趣', '撩人', '勾人',
  '风情', '展示身材', '惩罚', '诱惑', '独占', '若即若离', '玩心',
];

/** 已下线的玩法标识：代码里不得再出现。 */
const REMOVED_IDS = ['小黑屋', '调教室'];

/** 允许 T2 出现的「人工文案层」目录（成就/道具/营地/lore/JSON 静态文本）。 */
const COPY_ALLOW_DIRS = ['src/data'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const errors = [];
const warnings = [];
const notes = [];

for (const rel of TARGETS) {
  for (const file of walk(join(ROOT, rel))) {
    const text = readFileSync(file, 'utf8');
    const relFile = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const isCopyLayer = COPY_ALLOW_DIRS.some((d) => relFile.startsWith(d));
    // 逐行扫描：带 t1-check-exempt 的行跳过（仅用于中和替换正则）。
    const liveLines = text.split('\n').filter((l) => !l.includes('t1-check-exempt'));
    const live = liveLines.join('\n');

    for (const term of T1_HARD_REDLINE) {
      const n = live.split(term).length - 1;
      if (n > 0) errors.push(`T1-HARD-REDLINE ${term} x${n} :: ${relFile}`);
    }
    for (const term of REMOVED_IDS) {
      const n = text.split(term).length - 1;
      if (n > 0) errors.push(`T1-REMOVED-ID ${term} x${n} :: ${relFile}`);
    }
    for (const term of T2_PROMPT_RISKY) {
      const n = text.split(term).length - 1;
      if (n === 0) continue;
      // src/ai 视为 Prompt 层（喂给 LLM）；src/data 视为人工文案层（可用）
      if (relFile.startsWith('src/ai')) warnings.push(`T2-PROMPT-RISKY ${term} x${n} :: ${relFile}`);
      else notes.push(`T2-COPY-OK ${term} x${n} :: ${relFile}`);
    }
    for (const term of T3_PROMPT_SAFE) {
      const n = text.split(term).length - 1;
      if (n > 0) notes.push(`T3-SAFE ${term} x${n} :: ${relFile}`);
    }
  }
}

for (const e of errors) console.log(e);
for (const w of warnings) console.log(w);
const t1 = errors.length;
console.log(t1 === 0 ? 'cloud-check: T1 clean (no hard-redline wording)' : `cloud-check: ${t1} T1 ERRORS`);
if (warnings.length) console.log(`cloud-check: ${warnings.length} T2 prompt-layer warnings (请确认不作为 LLM 输出目标)`);