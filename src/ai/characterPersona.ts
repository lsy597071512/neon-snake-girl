/**
 * 动态人设 / 今日行为：档案作息只是底稿，今日模式由漂移 + 日哈希决定，可随对话与事件改变。
 */
import { CHARACTER_MAP } from '../data/characters';
import { getAiProfile } from './aiProfiles';
import type { AiLivingSave } from './types';

export type PersonaDayMode =
  | 'dutiful'
  | 'idle'
  | 'social'
  | 'withdrawn'
  | 'playful'
  | 'restless';

export type CharacterPersonaLive = {
  /** 本条 dayPlan 对应的游戏日 */
  dayIndex: number;
  dayMode: PersonaDayMode;
  /** 今日行为梗概（给人看 / 进 Prompt） */
  dayPlan: string;
  /** 相对基线的情绪漂移短句 */
  moodNote: string;
  /** 情绪连续体：愉悦度 -100..100 */
  moodValence?: number;
  /** 情绪连续体：唤醒度 0..100 */
  moodArousal?: number;
  /** 上次连续体衰减结算的 gameMinutes */
  lastMoodTickGameMin?: number;
  /** 长期漂移轴 -40..40 */
  traits: {
    duty: number;
    warmth: number;
    play: number;
    caution: number;
  };
  lastEvolveGameMin: number;
  /** 连续对话轮次累计（跨日衰减） */
  talkStreak: number;
};

const MODE_LABEL: Record<PersonaDayMode, string> = {
  dutiful: '尽责日常',
  idle: '发呆闲晃',
  social: '想找人',
  withdrawn: '想独处',
  playful: '想玩闹',
  restless: '坐不住',
};

function clampTrait(n: number): number {
  return Math.max(-40, Math.min(40, Math.round(n)));
}

function hash01(seed: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function ensureMap(living: AiLivingSave): Record<string, CharacterPersonaLive> {
  if (!living.personas) living.personas = {};
  return living.personas;
}

function defaultTraits(characterId: string): CharacterPersonaLive['traits'] {
  const p = getAiProfile(characterId);
  const needs = (p?.coreNeeds ?? []).join('');
  return {
    duty: /路|守|护|巡|责任/.test(needs) ? 8 : 0,
    warmth: /陪伴|热|共情|笑/.test(needs) ? 6 : 0,
    play: /玩|热闹|兔|歌/.test(needs) ? 6 : 0,
    caution: (p?.fears?.length ?? 0) > 2 ? 6 : 2,
  };
}

function pickDayMode(
  characterId: string,
  living: AiLivingSave,
  traits: CharacterPersonaLive['traits'],
): PersonaDayMode {
  const day = living.dayIndex;
  const roll = hash01(characterId, day * 97 + 11);
  // 权重随漂移变化：玩闹↑ → playful；尽责↓ → idle 更常见
  const weights: { mode: PersonaDayMode; w: number }[] = [
    { mode: 'dutiful', w: 28 + traits.duty },
    { mode: 'idle', w: 18 - traits.duty * 0.4 + (1 - Math.abs(traits.play) / 40) * 6 },
    { mode: 'social', w: 16 + traits.warmth + traits.play * 0.3 },
    { mode: 'withdrawn', w: 12 + traits.caution - traits.warmth * 0.3 },
    { mode: 'playful', w: 12 + traits.play },
    { mode: 'restless', w: 10 + Math.abs(traits.duty) * 0.2 },
  ];
  // 日哈希扰动，避免天天同模式
  for (const row of weights) {
    row.w = Math.max(2, row.w * (0.65 + hash01(characterId + row.mode, day) * 0.7));
  }
  const total = weights.reduce((s, r) => s + r.w, 0);
  let t = roll * total;
  for (const row of weights) {
    t -= row.w;
    if (t <= 0) return row.mode;
  }
  return 'dutiful';
}

function buildDayPlan(characterId: string, mode: PersonaDayMode, living: AiLivingSave): string {
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const profile = getAiProfile(characterId);
  const archive = (profile?.dailyRoutine ?? '').split('→')[0]?.trim() || '例行检查';
  const day = living.dayIndex + 1;
  const variants: Record<PersonaDayMode, string[]> = {
    dutiful: [
      `第${day}日偏尽责：上午做一点「${archive}」，下午岗位晃一圈，夜里早歇`,
      `第${day}日照旧守本分，但不走完整旧流程——只抓一两件要紧的`,
    ],
    idle: [
      `第${day}日提不起劲：门口/中庭发呆大半天，有人叫才动；聊天偏闲聊`,
      `第${day}日放空：少干活，多看沙与天花板，不想谈任务`,
    ],
    social: [
      `第${day}日想凑热闹：往大厅/娱乐间蹭人，主动搭话`,
      `第${day}日社交日：找人吃饭、听闲话，岗位能拖就拖`,
    ],
    withdrawn: [
      `第${day}日想躲人：多待卧室或角落，话更短，别逼问`,
      `第${day}日关机边缘：能不说话就不说，只做最低限度的事`,
    ],
    playful: [
      `第${day}日心情轻：想玩、想贫嘴、想瞎逛，正经事先放一边`,
      `第${day}日放松档：娱乐间/闲聊优先，警戒心暂时下调`,
    ],
    restless: [
      `第${day}日坐不住：房间换来换去，闲逛像巡逻又不是真任务`,
      `第${day}日躁：走来走去找事做，聊也聊不久`,
    ],
  };
  const pool = variants[mode];
  const idx = Math.floor(hash01(characterId, living.dayIndex * 13 + mode.length) * pool.length) % pool.length;
  return `${name}·${MODE_LABEL[mode]}｜${pool[idx]}`;
}

function moodFromTraits(traits: CharacterPersonaLive['traits'], mode: PersonaDayMode): string {
  const bits: string[] = [];
  if (traits.warmth >= 12) bits.push('比平时软一点');
  if (traits.warmth <= -10) bits.push('比平时更硬/更远');
  if (traits.play >= 12) bits.push('更想说笑');
  if (traits.duty >= 14) bits.push('更抓任务');
  if (traits.duty <= -10) bits.push('不太想负责');
  if (traits.caution >= 14) bits.push('更警惕');
  if (mode === 'idle') bits.push('今天懒得端着');
  if (mode === 'social') bits.push('今天更想被人陪');
  if (!bits.length) bits.push('情绪接近基线，但仍不是复读档案');
  return bits.slice(0, 3).join('；');
}

export function getPersona(living: AiLivingSave, characterId: string): CharacterPersonaLive {
  const map = ensureMap(living);
  let p = map[characterId];
  if (!p) {
    p = {
      dayIndex: -1,
      dayMode: 'dutiful',
      dayPlan: '',
      moodNote: '',
      traits: defaultTraits(characterId),
      lastEvolveGameMin: living.gameMinutes,
      talkStreak: 0,
    };
    map[characterId] = p;
  }
  if (p.dayIndex !== living.dayIndex) {
    // 跨日：轻微衰减漂移 + 重抽今日模式
    p.traits = {
      duty: clampTrait(p.traits.duty * 0.92),
      warmth: clampTrait(p.traits.warmth * 0.92),
      play: clampTrait(p.traits.play * 0.92),
      caution: clampTrait(p.traits.caution * 0.92),
    };
    p.talkStreak = Math.max(0, Math.floor(p.talkStreak * 0.5));
    p.dayMode = pickDayMode(characterId, living, p.traits);
    p.dayPlan = buildDayPlan(characterId, p.dayMode, living);
    p.moodNote = moodFromTraits(p.traits, p.dayMode);
    // 跨日把连续体拉回今日模式基线附近（不完全清零，保留一点惯性）
    p.moodValence = Math.round(
      (typeof p.moodValence === 'number' ? p.moodValence * 0.35 : 0) +
        (p.dayMode === 'playful' || p.dayMode === 'social'
          ? 18
          : p.dayMode === 'withdrawn' || p.dayMode === 'idle'
            ? -10
            : 6),
    );
    p.moodArousal = Math.round(
      (typeof p.moodArousal === 'number' ? p.moodArousal * 0.4 : 38) +
        (p.dayMode === 'restless' || p.dayMode === 'playful' ? 12 : 0),
    );
    p.lastMoodTickGameMin = living.gameMinutes;
    p.dayIndex = living.dayIndex;
    p.lastEvolveGameMin = living.gameMinutes;
  }
  return p;
}

/** 对话后微调性格漂移（多次对话会改变后天倾向） */
export function evolvePersonaAfterTalk(
  living: AiLivingSave,
  characterId: string,
  opts: { affectionDelta: number; playerMessage: string },
): void {
  const p = getPersona(living, characterId);
  p.talkStreak += 1;
  const msg = opts.playerMessage;
  let dDuty = 0;
  let dWarm = 0;
  let dPlay = 0;
  let dCaut = 0;
  if (/吃|玩|闲|聊聊|陪|休息|发呆/.test(msg)) {
    dPlay += 1;
    dDuty -= 0.5;
    dWarm += 0.5;
  }
  if (/任务|巡逻|守|危险|沙暴|出发/.test(msg)) {
    dDuty += 1;
    dCaut += 0.5;
  }
  if (/关心|辛苦|谢谢|喜欢|想你/.test(msg)) dWarm += 1.2;
  if (/滚|笨蛋|没用|闭嘴/.test(msg)) {
    dWarm -= 1.5;
    dCaut += 1;
  }
  if (opts.affectionDelta > 0) dWarm += 0.4;
  if (opts.affectionDelta < 0) dWarm -= 0.6;
  // 多聊会慢慢松或黏
  if (p.talkStreak >= 5) dWarm += 0.3;
  if (p.talkStreak >= 10) dPlay += 0.3;

  p.traits.duty = clampTrait(p.traits.duty + dDuty);
  p.traits.warmth = clampTrait(p.traits.warmth + dWarm);
  p.traits.play = clampTrait(p.traits.play + dPlay);
  p.traits.caution = clampTrait(p.traits.caution + dCaut);
  p.moodNote = moodFromTraits(p.traits, p.dayMode);
  p.lastEvolveGameMin = living.gameMinutes;

  // 高玩闹/低尽责时，当日模式可被对话「撬」到更闲
  if (p.dayMode === 'dutiful' && p.traits.play >= 16 && hash01(characterId, living.gameMinutes) > 0.72) {
    p.dayMode = 'idle';
    p.dayPlan = buildDayPlan(characterId, 'idle', living);
    p.moodNote = moodFromTraits(p.traits, p.dayMode);
  }
}

export function evolvePersonaAfterEvent(
  living: AiLivingSave,
  characterId: string,
  kind: 'social' | 'conflict' | 'fear' | 'duty',
): void {
  const p = getPersona(living, characterId);
  if (kind === 'social') {
    p.traits.warmth = clampTrait(p.traits.warmth + 2);
    p.traits.play = clampTrait(p.traits.play + 1);
  } else if (kind === 'conflict') {
    p.traits.caution = clampTrait(p.traits.caution + 2);
    p.traits.warmth = clampTrait(p.traits.warmth - 1);
  } else if (kind === 'fear') {
    p.traits.caution = clampTrait(p.traits.caution + 3);
    p.traits.duty = clampTrait(p.traits.duty + 1);
  } else if (kind === 'duty') {
    p.traits.duty = clampTrait(p.traits.duty + 2);
  }
  p.moodNote = moodFromTraits(p.traits, p.dayMode);
  p.lastEvolveGameMin = living.gameMinutes;
}

/** 远征回营：胜利松一口气 / 败退更警惕——影响次日模式权重 */
export function evolvePersonaAfterCombat(
  living: AiLivingSave,
  characterId: string,
  victory: boolean,
): void {
  const p = getPersona(living, characterId);
  if (victory) {
    p.traits.duty = clampTrait(p.traits.duty + 2);
    p.traits.caution = clampTrait(p.traits.caution - 1);
    p.traits.warmth = clampTrait(p.traits.warmth + 1);
    p.traits.play = clampTrait(p.traits.play + 0.5);
    if (p.dayMode === 'withdrawn' && hash01(characterId, living.gameMinutes) > 0.55) {
      p.dayMode = 'social';
      p.dayPlan = buildDayPlan(characterId, 'social', living);
    }
  } else {
    p.traits.caution = clampTrait(p.traits.caution + 3);
    p.traits.duty = clampTrait(p.traits.duty + 1);
    p.traits.warmth = clampTrait(p.traits.warmth - 1);
    p.traits.play = clampTrait(p.traits.play - 1);
    if (p.dayMode === 'playful' || p.dayMode === 'idle') {
      p.dayMode = 'withdrawn';
      p.dayPlan = buildDayPlan(characterId, 'withdrawn', living);
    }
  }
  p.moodNote = moodFromTraits(p.traits, p.dayMode);
  p.lastEvolveGameMin = living.gameMinutes;
}

export function evolvePersonaAfterGift(
  living: AiLivingSave,
  characterId: string,
  tier: 0 | 1 | 2,
): void {
  const p = getPersona(living, characterId);
  p.traits.warmth = clampTrait(p.traits.warmth + 1.5 + tier);
  p.traits.play = clampTrait(p.traits.play + (tier >= 1 ? 1 : 0.3));
  p.moodNote = moodFromTraits(p.traits, p.dayMode);
  p.lastEvolveGameMin = living.gameMinutes;
}

/** kept=true 办完；false 食言 */
export function evolvePersonaAfterPromise(
  living: AiLivingSave,
  characterId: string,
  kept: boolean,
): void {
  const p = getPersona(living, characterId);
  if (kept) {
    p.traits.duty = clampTrait(p.traits.duty + 2);
    p.traits.warmth = clampTrait(p.traits.warmth + 1);
  } else {
    p.traits.duty = clampTrait(p.traits.duty - 1.5);
    p.traits.caution = clampTrait(p.traits.caution + 1);
    p.traits.warmth = clampTrait(p.traits.warmth - 1);
  }
  p.moodNote = moodFromTraits(p.traits, p.dayMode);
  p.lastEvolveGameMin = living.gameMinutes;
}

/** 刷新所有拥有角色的今日人设（跨日时） */
export function refreshPersonasForOwned(living: AiLivingSave, ownedIds: string[]): void {
  for (const id of ownedIds) getPersona(living, id);
}

export function describePersonaForPrompt(living: AiLivingSave, characterId: string): string {
  const p = getPersona(living, characterId);
  const profile = getAiProfile(characterId);
  const archive = profile?.dailyRoutine?.slice(0, 36) ?? '（无）';
  return [
    `【今日状态·动态】模式=${MODE_LABEL[p.dayMode]}；${p.dayPlan}`,
    `情绪漂移：${p.moodNote}（duty${p.traits.duty}/warmth${p.traits.warmth}/play${p.traits.play}/caution${p.traits.caution}）`,
    `【档案习惯·仅底稿】${archive}…——禁止当成今日必须执行的固定流水线；今日以【今日状态】为准。`,
    `旧记忆可参考，但禁止复读过时的风向/沙尘口头禅，除非今日模式或当前事件真的相关。`,
  ].join('\n');
}

export function personaDayMode(living: AiLivingSave, characterId: string): PersonaDayMode {
  return getPersona(living, characterId).dayMode;
}

export function personaLabel(mode: PersonaDayMode): string {
  return MODE_LABEL[mode];
}
