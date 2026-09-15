/**
 * 欲望表：在时段作息之外，用状态/人设/皮肤/远征余波推高「想去某地」的权重。
 */
import {
  CASUAL_FASHION_SKIN_ID,
  getCharacterSkins,
  POOL_PARTY_SKIN_ID,
  SLEEPWEAR_SKIN_ID,
} from '../data/characterSkins';
import { getAiProfile } from './aiProfiles';
import { personaDayMode } from './characterPersona';
import type { AiLivingSave } from './types';
import { getHour } from './worldClock';

/** 营地欲望：只看是否有外覆资源，不看是否购买 */
function ownsSkin(characterId: string, skinId: string): boolean {
  return getCharacterSkins(characterId).some((s) => s.id === skinId);
}

export type DesireId =
  | 'thirst'
  | 'stuffy'
  | 'shop'
  | 'swim'
  | 'armory'
  | 'tower'
  | 'social'
  | 'rest';

export type DesireSnapshot = {
  scores: Record<DesireId, number>;
  /** 一句给 Prompt / 调试 */
  topLine: string;
};

type AgendaWeightTarget = {
  goal: string;
  targetRoomId: string;
  weight: number;
};

function hash01(characterId: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < characterId.length; i++) h = (h * 31 + characterId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function hasTag(living: AiLivingSave, characterId: string, tag: string): boolean {
  return (living.characterStatus[characterId] ?? []).includes(tag as never);
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** 计算角色当前欲望分（0–100，不落盘，每轮现算） */
export function computeDesires(
  living: AiLivingSave,
  characterId: string,
): DesireSnapshot {
  const hour = getHour(living);
  const dayMode = personaDayMode(living, characterId);
  const profile = getAiProfile(characterId);
  const needs = profile?.coreNeeds ?? [];
  const fears = profile?.fears ?? [];
  const salt = living.gameMinutes + living.dayIndex * 13;
  const roll = hash01(characterId, salt);

  const scores: Record<DesireId, number> = {
    thirst: 8,
    stuffy: 6,
    shop: 10,
    swim: 8,
    armory: 10,
    tower: 6,
    social: 10,
    rest: 8,
  };

  if (hasTag(living, characterId, 'thirst')) scores.thirst += 35;
  if (hasTag(living, characterId, 'fatigue')) {
    scores.rest += 28;
    scores.stuffy += 12;
  }
  if (hasTag(living, characterId, 'hunger')) scores.shop += 8;
  if (hasTag(living, characterId, 'inspired')) scores.tower += 15;
  if (hasTag(living, characterId, 'anxiety_state')) scores.swim += 10;
  if (hasTag(living, characterId, 'injured')) {
    scores.rest += 20;
    scores.armory -= 8;
  }

  if (needs.some((n) => /水|洁|凉/.test(n))) scores.swim += 12;
  if (needs.some((n) => /补给|零件|物/.test(n))) scores.shop += 14;
  if (needs.some((n) => /社交|热闹|陪伴/.test(n))) scores.social += 12;
  if (fears.some((f) => /沙|风|外|暴/.test(f))) {
    scores.tower -= 10;
    scores.swim -= 6;
    scores.stuffy += 8;
  }

  if (dayMode === 'playful') {
    scores.swim += 18;
    scores.social += 10;
  }
  if (dayMode === 'social') {
    scores.shop += 12;
    scores.social += 16;
  }
  if (dayMode === 'dutiful') scores.armory += 18;
  if (dayMode === 'idle') {
    scores.stuffy += 14;
    scores.tower += 10;
  }
  if (dayMode === 'withdrawn') {
    scores.rest += 16;
    scores.social -= 12;
  }
  if (dayMode === 'restless') {
    scores.shop += 10;
    scores.armory += 8;
  }

  // 时段：午后闷、傍晚想逛、夜里想歇
  if (hour >= 13 && hour < 17) scores.stuffy += 16;
  if (hour >= 9 && hour < 21) scores.shop += 8;
  if (hour >= 10 && hour < 19) scores.swim += 10;
  if (hour >= 8 && hour < 20) scores.armory += 6;
  if (hour >= 16 && hour < 22) scores.tower += 10;
  if (hour >= 21 || hour < 5) scores.rest += 20;

  // 已购泳装/睡衣 → 更想去对应场景「穿上过日子」
  if (ownsSkin(characterId, POOL_PARTY_SKIN_ID)) scores.swim += 14;
  if (ownsSkin(characterId, SLEEPWEAR_SKIN_ID) && (hour >= 20 || hour < 6)) scores.rest += 10;
  if (ownsSkin(characterId, CASUAL_FASHION_SKIN_ID) && hour >= 10 && hour < 22) {
    scores.social += 8;
  }
  if (
    getCharacterSkins(characterId).some((s) => ownsSkin(characterId, s.id)) &&
    hour >= 18 &&
    hour < 22
  ) {
    scores.social += 6;
  }

  // 战斗型标签
  if (/刃|盾|射|械|战|巡|守/.test(`${profile?.summary ?? ''}`)) {
    scores.armory += 12;
  }

  // 个人噪声，避免全员同步
  scores.swim += Math.floor(roll * 12);
  scores.shop += Math.floor(hash01(characterId, salt + 3) * 10);
  scores.armory += Math.floor(hash01(characterId, salt + 5) * 10);

  for (const k of Object.keys(scores) as DesireId[]) {
    scores[k] = clamp(scores[k]);
  }

  const ranked = (Object.entries(scores) as [DesireId, number][]).sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = ranked[0]!;
  const label: Record<DesireId, string> = {
    thirst: '想喝水/碰凉',
    stuffy: '闷得慌想透气',
    shop: '想逛商店',
    swim: '想去泳池',
    armory: '想去武器库',
    tower: '想上警卫塔',
    social: '想找人说话',
    rest: '想回房歇着',
  };
  return {
    scores,
    topLine: topScore >= 28 ? `${label[topId]}（欲望 ${topScore}）` : '没有特别强烈的念头',
  };
}

/**
 * 把欲望加到议程候选权重上（改写 candidates 原地）。
 * 阈值：欲望≥32 才明显抬权，避免压过吃饭睡觉。
 */
export function applyDesireBoostsToCandidates(
  living: AiLivingSave,
  characterId: string,
  candidates: AgendaWeightTarget[],
): DesireSnapshot {
  const snap = computeDesires(living, characterId);
  const s = snap.scores;

  for (const c of candidates) {
    let add = 0;
    if (c.targetRoomId === 'room_1f_pool' || c.goal === 'pool_soak') {
      add += s.swim >= 32 ? (s.swim - 28) / 12 : 0;
      add += s.thirst >= 40 ? 1.2 : 0;
    }
    if (c.targetRoomId === 'room_1f_shop' || c.goal === 'browse_shop') {
      add += s.shop >= 32 ? (s.shop - 28) / 11 : 0;
    }
    if (c.targetRoomId === 'room_1f_armory' || c.goal === 'armory_maintain') {
      add += s.armory >= 32 ? (s.armory - 28) / 11 : 0;
    }
    if (c.targetRoomId === 'room_1f_tower') {
      add += s.tower >= 32 ? (s.tower - 28) / 12 : 0;
      add += s.stuffy >= 36 ? 1.5 : 0;
    }
    if (c.targetRoomId === 'room_yard' && c.goal.includes('idle')) {
      add += s.stuffy >= 34 ? 1.4 : 0;
    }
    if (c.goal === 'play' || c.goal === 'hall_chat') {
      add += s.social >= 36 ? (s.social - 30) / 14 : 0;
    }
    if (c.goal === 'rest' || c.goal === 'idle_home' || c.goal === 'sleep') {
      add += s.rest >= 40 ? (s.rest - 36) / 14 : 0;
    }
    if (c.goal === 'bathe') {
      add += s.thirst >= 38 ? 1.5 : 0;
    }
    c.weight = Math.max(0.5, c.weight + add);
  }
  return snap;
}

/** 欲望驱动：若极强欲望且候选里没有对应目标，补一条短意图 */
export function pushDesireForcedCandidates(
  living: AiLivingSave,
  characterId: string,
  push: (c: {
    goal: string;
    targetRoomId: string;
    activity: import('./types').CharacterActivity;
    behavior: string;
    remainGameMin: number;
    reason: string;
    source: import('./types').AgendaSource;
    weight: number;
  }) => void,
): void {
  const { scores } = computeDesires(living, characterId);
  const salt = living.gameMinutes + 77;

  if (scores.swim >= 55) {
    push({
      goal: 'pool_soak',
      targetRoomId: 'room_1f_pool',
      activity: 'play',
      behavior: '被欲望推着去泳池透透',
      remainGameMin: 40 + Math.floor(hash01(characterId, salt) * 40),
      reason: '心里痒，想碰水',
      source: 'need',
      weight: 4.2 + (scores.swim - 55) / 20,
    });
  }
  if (scores.shop >= 55) {
    push({
      goal: 'browse_shop',
      targetRoomId: 'room_1f_shop',
      activity: 'idle',
      behavior: '被欲望推着去商店逛一圈',
      remainGameMin: 35 + Math.floor(hash01(characterId, salt + 1) * 35),
      reason: '想看看货架缺什么',
      source: 'need',
      weight: 4.0 + (scores.shop - 55) / 20,
    });
  }
  if (scores.armory >= 55) {
    push({
      goal: 'armory_maintain',
      targetRoomId: 'room_1f_armory',
      activity: 'maintain',
      behavior: '被欲望推着去武器库点检',
      remainGameMin: 40 + Math.floor(hash01(characterId, salt + 2) * 40),
      reason: '手痒，想摸摸武装',
      source: 'need',
      weight: 4.0 + (scores.armory - 55) / 20,
    });
  }
  if (scores.tower >= 55) {
    push({
      goal: 'tower_watch',
      targetRoomId: 'room_1f_tower',
      activity: 'idle',
      behavior: '上警卫塔透气远眺',
      remainGameMin: 35 + Math.floor(hash01(characterId, salt + 3) * 40),
      reason: '闷了，想上塔看看',
      source: 'need',
      weight: 3.8 + (scores.tower - 55) / 22,
    });
  }
}
