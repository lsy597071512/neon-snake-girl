import type { AiLivingSave, CampPeriod, WeatherId } from './types';
import { resolveCampSceneId } from './sceneCards';

/**
 * 游戏时间流速（全系统唯一源）：
 * 营地默认：现实 1 分钟 ≈ 游戏 5 分钟 → 游戏一天约需现实 4.8 小时。
 * 对话页打开时：现实 1 分钟 ≈ 游戏 1 分钟（与现实同步）。
 */
export const GAME_MINUTES_PER_REAL_MINUTE = 5;
/** 对话沉浸页时间流速（与现实 1:1） */
export const GAME_MINUTES_PER_REAL_MINUTE_DIALOGUE = 1;
export const GAME_MINUTES_PER_REAL_MS = GAME_MINUTES_PER_REAL_MINUTE / 60_000;
export const REAL_MINUTES_PER_GAME_DAY = 1440 / GAME_MINUTES_PER_REAL_MINUTE;

/** 对话 overlay 是否打开（驱动 1:1 流速） */
export function isDialogueOverlayOpen(): boolean {
  return typeof document !== 'undefined' && Boolean(document.querySelector('[data-ai-dialogue]'));
}

/** 当前生效的「现实分钟 → 游戏分钟」倍率 */
export function getActiveGameMinutesPerRealMinute(): number {
  return isDialogueOverlayOpen()
    ? GAME_MINUTES_PER_REAL_MINUTE_DIALOGUE
    : GAME_MINUTES_PER_REAL_MINUTE;
}

/** 供 AI Prompt / UI 说明用 */
export function describeTimeScale(): string {
  const scale = getActiveGameMinutesPerRealMinute();
  if (scale === GAME_MINUTES_PER_REAL_MINUTE_DIALOGUE) {
    return `对话中：现实1分钟≈游戏1分钟（与现实同步）`;
  }
  return `现实1分钟≈游戏${GAME_MINUTES_PER_REAL_MINUTE}分钟；游戏一天约需现实${REAL_MINUTES_PER_GAME_DAY}分钟`;
}

/** 现实毫秒 → 应推进的游戏分钟（尊重当前流速） */
export function realMsToGameMinutes(realMs: number): number {
  const perMs = getActiveGameMinutesPerRealMinute() / 60_000;
  return Math.max(0, Math.floor(Math.max(0, realMs) * perMs));
}

/** 游戏分钟 → 约等于现实秒（按当前流速） */
export function gameMinutesToRealSeconds(gameMin: number): number {
  const scale = Math.max(0.01, getActiveGameMinutesPerRealMinute());
  return Math.max(0, Math.round((gameMin / scale) * 60));
}

const PERIOD_LABEL: Record<CampPeriod, string> = {
  qingchen: '清晨',
  zhongwu: '正午',
  huanghun: '黄昏',
  bangwan: '傍晚',
  shenye: '深夜',
  qingtian: '晴天',
};

export function createDefaultAiLiving(now = Date.now()): AiLivingSave {
  const date = new Date(now);
  const seedMinutes = date.getHours() * 60 + date.getMinutes();
  return {
    gameMinutes: seedMinutes,
    dayIndex: 0,
    lastRealTs: now,
    playerLocationId: 'camp_auto',
    affinities: {},
    relationships: {},
    memories: {},
    campLog: [],
    characterStatus: {},
    lastNpcEventAt: 0,
    lastOfflineSummaryAt: now,
    pendingOfflineSummary: null,
    recentChats: {},
    chatDigests: {},
    lastTalkAt: {},
    agendas: {},
    activeCampEvents: [],
    eventHistory: [],
    lastCampEventSpawnGameMin: 0,
    personas: {},
    pendingAiMessages: [],
    aiMessageStats: {},
    lastPlayerOutreachEvalAt: 0,
    pendingNpcSeeks: [],
    personaResets: {},
    skinRollouts: {},
    campWornSkins: {},
    eventTempSkins: {},
    emotionOutfitAt: {},
    lifeGoals: {},
    characterPockets: {},
    characterCyberHealth: {},
    lastCyberAgingDayIndex: 0,
    pendingCyberHealthEvents: [],
    characterCyberLoadout: {},
    campPlacements: {},
    structuredFacts: {},
    relationshipArcStage: {},
    dialogueTurnScene: {},
    pendingOutfitChanges: {},
    outfitWearLocks: {},
    outfitNarrativeHolds: {},
    bodyAnchors: {},
    characterSleep: {},
  };
}

/** 推进游戏时钟；返回离线跨越的现实毫秒 */
export function advanceWorldClock(living: AiLivingSave, now = Date.now()): number {
  const elapsed = Math.max(0, now - living.lastRealTs);
  const add = realMsToGameMinutes(elapsed);
  if (add > 0) {
    const prevDay = Math.floor(living.gameMinutes / 1440);
    living.gameMinutes += add;
    const nextDay = Math.floor(living.gameMinutes / 1440);
    living.dayIndex += Math.max(0, nextDay - prevDay);
  }
  living.lastRealTs = now;
  return elapsed;
}

export function getDayMinute(living: AiLivingSave): number {
  return ((living.gameMinutes % 1440) + 1440) % 1440;
}

export function getHour(living: AiLivingSave): number {
  return Math.floor(getDayMinute(living) / 60);
}

export function resolvePeriod(living: AiLivingSave): CampPeriod {
  const h = getHour(living);
  if (h >= 5 && h < 8) return 'qingchen';
  if (h >= 8 && h < 11) return 'qingtian';
  if (h >= 11 && h < 16) return 'zhongwu';
  if (h >= 16 && h < 18) return 'huanghun';
  if (h >= 18 && h < 21) return 'bangwan';
  return 'shenye';
}

/** 稀疏天气：按 dayIndex 哈希，约 1/5 黄昏有雨 */
export function resolveWeather(living: AiLivingSave): WeatherId {
  const period = resolvePeriod(living);
  if (period === 'qingchen') return 'hazy';
  if (period === 'zhongwu') return 'dusty';
  const rainRoll = (living.dayIndex * 17 + 3) % 5;
  if (rainRoll === 0 && (period === 'huanghun' || period === 'bangwan')) return 'rain';
  return 'clear';
}

export function periodLabel(period: CampPeriod): string {
  return PERIOD_LABEL[period];
}

export function formatGameClock(living: AiLivingSave): string {
  const m = getDayMinute(living);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `第${living.dayIndex + 1}日 ${hh}:${mm} · ${periodLabel(resolvePeriod(living))}`;
}

/** 玩家当前应显示的场景 id（室内 / 户外地标优先；否则按时段外景） */
export function resolveActiveSceneId(living: AiLivingSave): string {
  const loc = living.playerLocationId;
  if (loc === 'camp_yard') return 'outdoor_gate';
  if (loc && loc !== 'camp_auto' && !loc.startsWith('camp_')) {
    return loc;
  }
  return resolveCampSceneId(resolvePeriod(living), resolveWeather(living));
}

export function resolveActiveCampImage(living: AiLivingSave): string {
  const period = resolvePeriod(living);
  const loc = living.playerLocationId;
  if (loc === 'camp_yard' || loc === 'outdoor_gate' || loc?.startsWith('outdoor_')) {
    return getSceneCardImage(loc === 'camp_yard' ? 'outdoor_gate' : loc, period) ?? './tex/beijing01.png';
  }
  const id = resolveCampSceneId(period, resolveWeather(living));
  const map: Record<string, string> = {
    camp_qingchen: './tex/beijing01_qingchen.png',
    camp_zhongwu: './tex/beijing01_zhongwu.png',
    camp_huanghun: './tex/beijing01_huanghun.png',
    camp_bangwan: './tex/beijing01_bangwan01.png',
    camp_bangwan02: './tex/beijing01_bangwan02.png',
    camp_shenye: './tex/beijing01_shenye.png',
    camp_shenye02: './tex/beijing01_shenye02.png',
    camp_qingtian: './tex/beijing01_qingtian.png',
    camp_xiayu_huanghun: './tex/beijing01_xiayu_huanghun.png',
    camp_yard: './tex/Indoor/shinei01_outdoor_gate_day.png',
    outdoor_gate: './tex/Indoor/shinei01_outdoor_gate_day.png',
  };
  return getSceneCardImage(id, period) ?? map[id] ?? './tex/beijing01.png';
}

function getSceneCardImage(id: string, period: CampPeriod): string | null {
  try {
    // 延迟引用，避免 worldClock ↔ sceneCards 循环过重
    const { getSceneCard, resolveSceneCardImage } = require('./sceneCards') as typeof import('./sceneCards');
    const card = getSceneCard(id);
    return card ? resolveSceneCardImage(card, period) : null;
  } catch {
    return null;
  }
}

export function shouldShowRainOverlay(living: AiLivingSave): boolean {
  return resolveWeather(living) === 'rain';
}
