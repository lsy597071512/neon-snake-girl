/**
 * 亲近区与机体渗出 —— 亲密氛围共用生理层。
 *
 * 指挥官：机体核心（义体敏感出口），受刺激会渗出机体液。
 * 美少女：1 级腰/身侧；2 级胸口/锁骨一带；3 级身侧深处。
 * 刺激 → 异样情绪 → 长时间亲近可渗出机体液。
 */
import type { AiLivingSave } from './types';

/** 异样情绪词库（可矛盾并存） */
export const ADULT_ODD_MOODS = [
  '兴奋',
  '害羞',
  '激动',
  '心乱',
  '气愤',
  '害怕',
  '紧张',
  '失神',
  '期待',
  '心动',
  '厌恶',
  '迷糊',
] as const;

export type AdultOddMood = (typeof ADULT_ODD_MOODS)[number];

/** 美少女亲近区 */
export type GirlSensitivityZone =
  | 'waist'
  | 'outer_lower'
  | 'butt'
  | 'chest'
  | 'chest_upper'
  | 'mid'
  | 'inner'
  | 'inner_deep';

/** 指挥官亲近区 */
export type CommanderSensitivityZone = 'commander_core';

export type SensitivityZoneId = GirlSensitivityZone | CommanderSensitivityZone;

export const GIRL_ZONE_LEVEL: Record<GirlSensitivityZone, 1 | 2 | 3> = {
  waist: 1,
  outer_lower: 1,
  butt: 1,
  chest: 2,
  chest_upper: 2,
  mid: 3,
  inner: 3,
  inner_deep: 3,
};

export const ZONE_LABEL_ZH: Record<SensitivityZoneId, string> = {
  waist: '腰部',
  outer_lower: '腰侧',
  butt: '身后',
  chest: '胸口',
  chest_upper: '锁骨一带',
  mid: '身侧',
  inner: '身侧深处',
  inner_deep: '身侧深处',
  commander_core: '指挥官机体核心',
};

export type SensitivityZoneState = {
  /** 0–100 局部升温 */
  arousal: number;
  lastStimAtMs?: number;
};

export type BodySensitivityState = {
  zones: Partial<Record<SensitivityZoneId, SensitivityZoneState>>;
  /** 累计峰值次数（会话级可清零） */
  climaxCount: number;
  /** 最近异样情绪（1～3 词，空格或顿号分隔） */
  lastOddMood?: string;
  /** 最近是否渗出机体液 */
  lastOilDischarge?: boolean;
  lastOilAtMs?: number;
  /** 总升温（派生缓存，可选） */
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
    outer_lower: 'outer_lower',
    crotch_outer: 'outer_lower',
    outer: 'outer_lower',
    腰侧: 'outer_lower',
    腿间: 'outer_lower',
    butt: 'butt',
    ass: 'butt',
    身后: 'butt',
    臀: 'butt',
    chest: 'chest',
    breast: 'chest',
    breasts: 'chest',
    胸口: 'chest',
    胸: 'chest',
    chest_upper: 'chest_upper',
    nipple: 'chest_upper',
    nipples: 'chest_upper',
    锁骨: 'chest_upper',
    mid: 'mid',
    perineum: 'mid',
    身侧: 'mid',
    inner: 'inner',
    vagina: 'inner',
    深处: 'inner',
    inner_deep: 'inner_deep',
    crotch_deep: 'inner_deep',
    deep: 'inner_deep',
    commander_core: 'commander_core',
    commander_pipe: 'commander_core',
    pipe: 'commander_core',
    核心: 'commander_core',
    机体核心: 'commander_core',
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
  if (t === 'climax' || t === '失神' || t === 'orgasm') return 'climax';
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
 * 应用一轮亲近刺激。亲密氛围上下文外也可调用，但 Prompt 只在亲密氛围中强调。
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
    if (z === 'commander_core') {
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
      bumpZone(girl, 'outer_lower', delta, now);
      girlHit = true;
    }
    if (hitCmd) {
      bumpZone(cmd, 'commander_core', delta + 4, now);
      cmdHit = true;
    }
  }

  const girlTotal = recomputeTotal(girl);
  const cmdTotal = recomputeTotal(cmd);

  let oddMood = sanitizeOddMood(stim.oddMood);
  if (!oddMood && (girlHit || cmdHit)) {
    if (stim.duration === 'climax' || girlTotal >= 85 || cmdTotal >= 85) oddMood = '失神、兴奋';
    else if (stim.intensity >= 3) oddMood = '紧张、心动';
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
  if (girlHit) bits.push(`角色升温≈${girlTotal}`);
  if (cmdHit) bits.push(`指挥官机体核心升温≈${cmdTotal}`);
  if (oddMood) bits.push(`异样情绪：${oddMood}`);
  if (girlOil) bits.push('角色情绪到顶点');
  if (commanderOil) bits.push('指挥官机体核心被牵动');

  return {
    applied: true,
    girlOil,
    commanderOil,
    oddMood,
    msg: bits.join('；'),
  };
}

/** 非亲密场景缓慢衰减 */
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
  const bits = [`${label}亲近区：${zones.join('、') || '平静'}`];
  if (s.lastOddMood) bits.push(`异样情绪「${s.lastOddMood}」`);
  if (s.lastOilDischarge) bits.push('近期情绪到过顶点');
  return bits.join('；');
}

/** Prompt：当前亲近区快照（亲密氛围内注入） */
export function buildBodySensitivityPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const bag = ensureBodySensitivity(living);
  const girl = getCharacterBody(living, characterId);
  const gLine = summarizeBody('你', girl);
  const cLine = summarizeBody('指挥官', bag.commander);
  const lines = [
    '【亲近区·亲密氛围层（情绪反应）】',
    '指挥官：亲近区是机体核心（义体敏感出口）；被贴身时他的反应属氛围层。',
    '你：1级=腰部/腰侧/身后；2级=胸口/锁骨一带；3级=身侧深处。被亲近时以情绪反应为主——心跳加快、耳根发烫、腿软、说不出话、理智掉线，可矛盾并存（兴奋/害羞/激动/心乱/紧张/失神/期待/心动/迷糊…）。',
    '字段：stim_target=self|commander|mutual；stim_zones=区id逗号分隔（waist,outer_lower,butt,chest,chest_upper,mid,inner,inner_deep,commander_core）；stim_intensity=1|2|3；stim_duration=brief|sustained|climax；adult_odd_mood=1～3个异样情绪词；oil_discharge=self|commander|both|""。',
    '反应到顶点时，用一句话点出你的失神或依恋即可，不做生理描写；用角色声线写动作与感觉，点到即止。',
  ];
  if (gLine) lines.push(`- 此刻状态：${gLine}`);
  if (cLine) lines.push(`- 此刻状态：${cLine}`);
  return lines.join('\n');
}
