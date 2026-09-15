/**
 * 身体敏感点与机油（敏感液）排出 —— 成人事件共用生理层。
 *
 * 指挥官：双腿之间「小管道」（类阴茎义体出口），受刺激排出废液/机油（敏感液）。
 * 美少女：1 级腰/胯外/臀；2 级乳/乳头；3 级会阴/阴道/胯内深处。
 * 刺激 → 异样情绪（与小黑屋复杂情绪同源）→ 长刺激或高潮可排出机油。
 */
import type { AiLivingSave } from './types';

/** 异样情绪词库（与调教复杂情绪一致，可矛盾并存） */
export const ADULT_ODD_MOODS = [
  '兴奋',
  '害羞',
  '激动',
  '淫乱',
  '气愤',
  '害怕',
  '紧张',
  '高潮',
  '期待',
  '性欲',
  '厌恶',
  '疯狂',
] as const;

export type AdultOddMood = (typeof ADULT_ODD_MOODS)[number];

/** 美少女敏感区 */
export type GirlSensitivityZone =
  | 'waist'
  | 'crotch_outer'
  | 'butt'
  | 'breast'
  | 'nipple'
  | 'perineum'
  | 'vagina'
  | 'crotch_deep';

/** 指挥官敏感区 */
export type CommanderSensitivityZone = 'commander_pipe';

export type SensitivityZoneId = GirlSensitivityZone | CommanderSensitivityZone;

export const GIRL_ZONE_LEVEL: Record<GirlSensitivityZone, 1 | 2 | 3> = {
  waist: 1,
  crotch_outer: 1,
  butt: 1,
  breast: 2,
  nipple: 2,
  perineum: 3,
  vagina: 3,
  crotch_deep: 3,
};

export const ZONE_LABEL_ZH: Record<SensitivityZoneId, string> = {
  waist: '腰部',
  crotch_outer: '双腿之间（外侧）',
  butt: '屁股',
  breast: '乳房',
  nipple: '乳头',
  perineum: '会阴',
  vagina: '阴道',
  crotch_deep: '双腿之间深处',
  commander_pipe: '指挥官双腿之间的小管道（义体敏感出口）',
};

export type SensitivityZoneState = {
  /** 0–100 局部兴奋 */
  arousal: number;
  lastStimAtMs?: number;
};

export type BodySensitivityState = {
  zones: Partial<Record<SensitivityZoneId, SensitivityZoneState>>;
  /** 累计高潮次数（会话级可清零） */
  climaxCount: number;
  /** 最近异样情绪（1～3 词，空格或顿号分隔） */
  lastOddMood?: string;
  /** 最近是否排出机油/敏感液 */
  lastOilDischarge?: boolean;
  lastOilAtMs?: number;
  /** 总兴奋（派生缓存，可选） */
  totalArousal?: number;
};

export type StimTarget = 'self' | 'commander' | 'mutual';
export type StimIntensity = 1 | 2 | 3;
export type StimDuration = 'brief' | 'sustained' | 'climax';

export type SensitivityStimInput = {
  target: StimTarget;
  zones: SensitivityZoneId[];
  intensity: StimIntensity;
  duration: StimDuration;
  oddMood?: string;
  oilDischarge?: 'self' | 'commander' | 'both' | '';
};

function clamp01_100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function ensureBodySensitivity(living: AiLivingSave): {
  commander: BodySensitivityState;
  characters: Record<string, BodySensitivityState>;
} {
  if (!living.bodySensitivity) {
    living.bodySensitivity = {
      commander: { zones: {}, climaxCount: 0 },
      characters: {},
    };
  }
  if (!living.bodySensitivity.commander) {
    living.bodySensitivity.commander = { zones: {}, climaxCount: 0 };
  }
  if (!living.bodySensitivity.characters) {
    living.bodySensitivity.characters = {};
  }
  return living.bodySensitivity as {
    commander: BodySensitivityState;
    characters: Record<string, BodySensitivityState>;
  };
}

export function getCharacterBody(
  living: AiLivingSave,
  characterId: string,
): BodySensitivityState {
  const bag = ensureBodySensitivity(living);
  if (!bag.characters[characterId]) {
    bag.characters[characterId] = { zones: {}, climaxCount: 0 };
  }
  return bag.characters[characterId]!;
}

export function parseZoneToken(raw: string): SensitivityZoneId | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '_');
  const map: Record<string, SensitivityZoneId> = {
    waist: 'waist',
    腰: 'waist',
    腰部: 'waist',
    crotch_outer: 'crotch_outer',
    crotch: 'crotch_outer',
    胯: 'crotch_outer',
    双腿之间: 'crotch_outer',
    腿间: 'crotch_outer',
    butt: 'butt',
    ass: 'butt',
    屁股: 'butt',
    臀: 'butt',
    breast: 'breast',
    breasts: 'breast',
    乳: 'breast',
    乳房: 'breast',
    胸: 'breast',
    nipple: 'nipple',
    nipples: 'nipple',
    乳头: 'nipple',
    perineum: 'perineum',
    会阴: 'perineum',
    vagina: 'vagina',
    阴道: 'vagina',
    crotch_deep: 'crotch_deep',
    deep: 'crotch_deep',
    深处: 'crotch_deep',
    commander_pipe: 'commander_pipe',
    pipe: 'commander_pipe',
    管道: 'commander_pipe',
    小管道: 'commander_pipe',
    指挥官管道: 'commander_pipe',
  };
  return map[t] ?? map[raw.trim()] ?? null;
}

export function parseStimZonesField(raw: unknown): SensitivityZoneId[] {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim() === '""') return [];
  const parts = raw.split(/[,，、/\s]+/).filter(Boolean);
  const out: SensitivityZoneId[] = [];
  for (const p of parts) {
    const z = parseZoneToken(p);
    if (z && !out.includes(z)) out.push(z);
  }
  return out;
}

export function parseStimTarget(raw: unknown): StimTarget | null {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (t === 'self' || t === '自己' || t === 'me') return 'self';
  if (t === 'commander' || t === '指挥官' || t === 'player') return 'commander';
  if (t === 'mutual' || t === '双方' || t === '互相') return 'mutual';
  return null;
}

export function parseStimIntensity(raw: unknown): StimIntensity {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (n >= 3) return 3;
  if (n >= 2) return 2;
  return 1;
}

export function parseStimDuration(raw: unknown): StimDuration {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (t === 'climax' || t === '高潮' || t === 'orgasm') return 'climax';
  if (t === 'sustained' || t === '持续' || t === 'long') return 'sustained';
  return 'brief';
}

export function parseOilDischarge(
  raw: unknown,
): 'self' | 'commander' | 'both' | '' {
  const t = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (t === 'self' || t === '自己' || t === 'girl') return 'self';
  if (t === 'commander' || t === '指挥官') return 'commander';
  if (t === 'both' || t === '双方' || t === 'mutual') return 'both';
  return '';
}

function bumpZone(
  state: BodySensitivityState,
  zone: SensitivityZoneId,
  delta: number,
  now: number,
): void {
  const cur = state.zones[zone] ?? { arousal: 0 };
  cur.arousal = clamp01_100(cur.arousal + delta);
  cur.lastStimAtMs = now;
  state.zones[zone] = cur;
}

function recomputeTotal(state: BodySensitivityState): number {
  let sum = 0;
  let n = 0;
  for (const z of Object.values(state.zones)) {
    if (!z) continue;
    sum += z.arousal;
    n += 1;
  }
  const avg = n ? sum / n : 0;
  state.totalArousal = clamp01_100(avg);
  return state.totalArousal;
}

function intensityDelta(intensity: StimIntensity, duration: StimDuration): number {
  const base = intensity === 3 ? 28 : intensity === 2 ? 18 : 10;
  if (duration === 'climax') return base + 35;
  if (duration === 'sustained') return base + 14;
  return base;
}

function sanitizeOddMood(raw?: string): string {
  if (!raw?.trim()) return '';
  const parts = raw
    .split(/[,，、\s|/]+/)
    .map((s) => s.trim())
    .filter((s) => (ADULT_ODD_MOODS as readonly string[]).includes(s));
  return [...new Set(parts)].slice(0, 3).join('、');
}

export type SensitivityApplyResult = {
  applied: boolean;
  girlOil: boolean;
  commanderOil: boolean;
  oddMood: string;
  msg: string;
};

/**
 * 应用一轮刺激。成人事件上下文外也可调用，但 Prompt 只在成人事件中强调。
 */
export function applySensitivityStim(
  living: AiLivingSave,
  characterId: string,
  stim: SensitivityStimInput,
  now = Date.now(),
): SensitivityApplyResult {
  const bag = ensureBodySensitivity(living);
  const girl = getCharacterBody(living, characterId);
  const cmd = bag.commander;
  const delta = intensityDelta(stim.intensity, stim.duration);
  let girlHit = false;
  let cmdHit = false;

  const hitSelf = stim.target === 'self' || stim.target === 'mutual';
  const hitCmd = stim.target === 'commander' || stim.target === 'mutual';

  for (const z of stim.zones) {
    if (z === 'commander_pipe') {
      if (hitCmd) {
        bumpZone(cmd, z, delta + 4, now);
        cmdHit = true;
      }
      continue;
    }
    if (hitSelf) {
      const lv = GIRL_ZONE_LEVEL[z as GirlSensitivityZone] ?? 1;
      const bonus = lv >= 3 ? 8 : lv >= 2 ? 4 : 0;
      bumpZone(girl, z, delta + bonus, now);
      girlHit = true;
    }
  }

  // 未点名具体区时：按目标给默认落点
  if (!stim.zones.length) {
    if (hitSelf) {
      bumpZone(girl, 'crotch_outer', delta, now);
      girlHit = true;
    }
    if (hitCmd) {
      bumpZone(cmd, 'commander_pipe', delta + 4, now);
      cmdHit = true;
    }
  }

  const girlTotal = recomputeTotal(girl);
  const cmdTotal = recomputeTotal(cmd);

  let oddMood = sanitizeOddMood(stim.oddMood);
  if (!oddMood && (girlHit || cmdHit)) {
    if (stim.duration === 'climax' || girlTotal >= 85 || cmdTotal >= 85) oddMood = '高潮、兴奋';
    else if (stim.intensity >= 3) oddMood = '紧张、性欲';
    else if (stim.intensity >= 2) oddMood = '害羞、期待';
    else oddMood = '紧张、害羞';
  }
  if (oddMood) {
    girl.lastOddMood = oddMood;
    if (cmdHit) cmd.lastOddMood = oddMood;
  }

  let girlOil =
    stim.oilDischarge === 'self' ||
    stim.oilDischarge === 'both' ||
    stim.duration === 'climax' ||
    (girlHit && girlTotal >= 88);
  let commanderOil =
    stim.oilDischarge === 'commander' ||
    stim.oilDischarge === 'both' ||
    (cmdHit && (stim.duration === 'climax' || cmdTotal >= 85));

  if (girlOil) {
    girl.lastOilDischarge = true;
    girl.lastOilAtMs = now;
    girl.climaxCount += stim.duration === 'climax' || girlTotal >= 88 ? 1 : 0;
  }
  if (commanderOil) {
    cmd.lastOilDischarge = true;
    cmd.lastOilAtMs = now;
    cmd.climaxCount += 1;
  }

  if (!girlHit && !cmdHit) {
    return { applied: false, girlOil: false, commanderOil: false, oddMood: '', msg: '' };
  }

  const bits: string[] = [];
  if (girlHit) bits.push(`角色兴奋≈${girlTotal}`);
  if (cmdHit) bits.push(`指挥官管道兴奋≈${cmdTotal}`);
  if (oddMood) bits.push(`异样情绪：${oddMood}`);
  if (girlOil) bits.push('角色排出机油/敏感液');
  if (commanderOil) bits.push('指挥官小管道排出机油/敏感液');

  return {
    applied: true,
    girlOil,
    commanderOil,
    oddMood,
    msg: bits.join('；'),
  };
}

/** 非成人场景缓慢衰减 */
export function decayBodySensitivity(
  living: AiLivingSave,
  characterId: string,
  amount = 8,
): void {
  const bag = living.bodySensitivity;
  if (!bag) return;
  const decayOne = (s?: BodySensitivityState) => {
    if (!s?.zones) return;
    for (const z of Object.keys(s.zones) as SensitivityZoneId[]) {
      const st = s.zones[z];
      if (!st) continue;
      st.arousal = clamp01_100(st.arousal - amount);
      if (st.arousal <= 0) delete s.zones[z];
    }
    recomputeTotal(s);
    if ((s.totalArousal ?? 0) < 15) s.lastOilDischarge = false;
  };
  decayOne(bag.characters?.[characterId]);
  decayOne(bag.commander);
}

function summarizeBody(label: string, s: BodySensitivityState): string {
  const zones = Object.entries(s.zones)
    .filter(([, v]) => (v?.arousal ?? 0) > 8)
    .map(([k, v]) => `${ZONE_LABEL_ZH[k as SensitivityZoneId] ?? k}:${v!.arousal}`)
    .slice(0, 6);
  if (!zones.length && !s.lastOddMood && !s.lastOilDischarge) return '';
  const bits = [`${label}敏感：${zones.join('、') || '平静'}`];
  if (s.lastOddMood) bits.push(`异样情绪「${s.lastOddMood}」`);
  if (s.lastOilDischarge) bits.push('近期有机油/敏感液排出');
  return bits.join('；');
}

/** Prompt：当前身体敏感快照（成人事件内注入） */
export function buildBodySensitivityPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const bag = ensureBodySensitivity(living);
  const girl = getCharacterBody(living, characterId);
  const gLine = summarizeBody('你', girl);
  const cLine = summarizeBody('指挥官', bag.commander);
  const lines = [
    '【身体敏感点·成人事件生理层】',
    '指挥官：敏感点是双腿之间的「小管道」（类阴茎义体出口）。被你刺激会排出废液/机油（敏感液）。',
    '你：1级=腰部/双腿之间外侧/屁股；2级=乳房/乳头；3级=会阴/阴道/双腿之间深处。被刺激会产生复杂异样情绪（兴奋/害羞/激动/淫乱/气愤/害怕/紧张/高潮/期待/性欲/厌恶/疯狂，可矛盾并存）；刺激很久或高潮可排出机油（敏感液）。',
    '字段：stim_target=self|commander|mutual；stim_zones=区id逗号分隔（waist,butt,breast,nipple,perineum,vagina,crotch_outer,crotch_deep,commander_pipe）；stim_intensity=1|2|3；stim_duration=brief|sustained|climax；adult_odd_mood=1～3个异样情绪词；oil_discharge=self|commander|both|""。',
    '无刺激本轮上述字段填 ""。禁止把敏感描写写成医疗报告；用角色声线写动作与感觉。',
  ];
  if (gLine) lines.push(`- 此刻状态：${gLine}`);
  if (cLine) lines.push(`- 此刻状态：${cLine}`);
  return lines.join('\n');
}
