/**
 * 义体健康（Phase A）
 * - 战斗：每次被敌人命中 -1（按被撞角色）；时间老化每 2 游戏日 -1
 * - 不受性格/情感/心情直接扣减；心情/状态只微调「健康事件」触发概率
 * - 修复免费 / 购买任意义体 10 锈币 → 健康回 100
 * - 义体装备不改皮肤、不改战斗力
 */
import type { SaveData } from '../types';
import type { AiLivingSave, LightStatusTag } from '../ai/types';
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_PROPS, getCampProp, type CampPropDef } from '../data/campProps';
import { adjustAffinity, adjustRelation } from '../ai/relationship';
import { pushCampLog, pushMemory } from '../ai/memory';
import { getPersona } from '../ai/characterPersona';

export const CYBER_SHOP_PRICE = 10;
export const CYBER_HEALTH_MAX = 100;
export const CYBER_AGING_DAYS = 2;

export type CyberHealthEvent = {
  id: string;
  characterId: string;
  /** 叙事用：老化/受损部位暗示 */
  partHint: string;
  healthAtTrigger: number;
  createdGameMin: number;
  status: 'open' | 'resolved';
  note: string;
};

const PART_HINTS = [
  '肩甲伺服',
  '义眼对焦环',
  '膝侧液压',
  '胸甲散热口',
  '腕部接口',
  '脊节轴承',
  '小腿装甲缝',
  '核心供电针',
  '前臂肌铠纤维',
  '腹前接口环',
] as const;

function ensureHealthMap(living: AiLivingSave): Record<string, number> {
  if (!living.characterCyberHealth || typeof living.characterCyberHealth !== 'object') {
    living.characterCyberHealth = {};
  }
  return living.characterCyberHealth;
}

function ensureEvents(living: AiLivingSave): CyberHealthEvent[] {
  if (!Array.isArray(living.pendingCyberHealthEvents)) {
    living.pendingCyberHealthEvents = [];
  }
  return living.pendingCyberHealthEvents as CyberHealthEvent[];
}

function ensureLoadout(living: AiLivingSave): Record<string, Record<string, string>> {
  if (!living.characterCyberLoadout || typeof living.characterCyberLoadout !== 'object') {
    living.characterCyberLoadout = {};
  }
  return living.characterCyberLoadout;
}

export function isCyberProp(prop: CampPropDef | undefined | null): boolean {
  return prop?.category === 'equip';
}

export function listCyberProps(): CampPropDef[] {
  return CAMP_PROPS.filter((p) => p.category === 'equip');
}

export function getCyberHealth(living: AiLivingSave, characterId: string): number {
  const map = ensureHealthMap(living);
  if (map[characterId] === undefined) map[characterId] = CYBER_HEALTH_MAX;
  return Math.max(0, Math.min(CYBER_HEALTH_MAX, map[characterId] ?? CYBER_HEALTH_MAX));
}

export function seedCyberHealthForOwned(living: AiLivingSave, ownedIds: string[]): void {
  const map = ensureHealthMap(living);
  for (const id of ownedIds) {
    if (map[id] === undefined) map[id] = CYBER_HEALTH_MAX;
  }
  if (living.lastCyberAgingDayIndex == null) {
    living.lastCyberAgingDayIndex = living.dayIndex ?? 0;
  }
}

/** 健康变化：写记忆 + 营地日志，供 AI 同步 */
export function setCyberHealth(
  living: AiLivingSave,
  characterId: string,
  next: number,
  reason: string,
): { from: number; to: number; changed: boolean } {
  const map = ensureHealthMap(living);
  const from = getCyberHealth(living, characterId);
  const to = Math.max(0, Math.min(CYBER_HEALTH_MAX, Math.floor(next)));
  map[characterId] = to;
  if (from === to) return { from, to, changed: false };

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const delta = to - from;
  const summary = `${name}义体健康 ${from}→${to}（${delta > 0 ? '+' : ''}${delta}）：${reason}`;
  pushMemory(living, characterId, {
    kind: 'event',
    summary,
    importance: to <= 9 ? 8 : to <= 59 ? 6 : 5,
  });
  pushCampLog(living, {
    text: summary,
    source: 'system',
    characterIds: [characterId],
  });
  return { from, to, changed: true };
}

/** 战斗中被敌人命中：按伤害扣减义体健康（普通 1 / BOSS 弹幕 2，地狱 ×2） */
export function applyCombatCyberHit(
  living: AiLivingSave,
  characterId: string,
  stageName: string,
  damage = 1,
): { from: number; to: number; changed: boolean } {
  if (!characterId) return { from: 0, to: 0, changed: false };
  const cur = getCyberHealth(living, characterId);
  const loss = Math.max(1, Math.floor(damage));
  return setCyberHealth(living, characterId, cur - loss, `战斗「${stageName}」被命中 -${loss}`);
}

/** @deprecated 旧「整场 -1」；正式战斗已改为按命中扣减，仅调试按钮沿用 */
export function applyCombatCyberWear(
  living: AiLivingSave,
  squadIds: string[],
  stageName: string,
): void {
  for (const id of squadIds) {
    if (!id) continue;
    applyCombatCyberHit(living, id, stageName);
  }
}

/**
 * 在线游戏内每跨越 2 个游戏日，全员 -1（身体结构老化）。
 * 可一次跨多日（离线追日）按 floor(Δday/2) 累计扣减。
 */
export function applyCyberAgingByDayIndex(
  living: AiLivingSave,
  ownedIds: string[],
): number {
  seedCyberHealthForOwned(living, ownedIds);
  const day = living.dayIndex ?? 0;
  let last = living.lastCyberAgingDayIndex;
  if (last == null) {
    living.lastCyberAgingDayIndex = day;
    return 0;
  }
  if (day <= last) return 0;
  const steps = Math.floor((day - last) / CYBER_AGING_DAYS);
  if (steps <= 0) return 0;
  living.lastCyberAgingDayIndex = last + steps * CYBER_AGING_DAYS;

  const part = PART_HINTS[Math.floor(Math.random() * PART_HINTS.length)]!;
  for (const id of ownedIds) {
    const cur = getCyberHealth(living, id);
    setCyberHealth(
      living,
      id,
      cur - steps,
      `时间老化×${steps}（约 ${part} 等结构微损）`,
    );
  }
  return steps;
}

/** 基础触发率：60–100→10%，10–59→20%，1–9→40%，0→100% */
export function baseCyberEventChance(health: number): number {
  if (health <= 0) return 1;
  if (health <= 9) return 0.4;
  if (health <= 59) return 0.2;
  return 0.1;
}

/**
 * 心情/状态只微调触发概率（不直接改健康值）。
 * 0 血锁死 100%。
 */
export function adjustedCyberEventChance(living: AiLivingSave, characterId: string): number {
  const hp = getCyberHealth(living, characterId);
  if (hp <= 0) return 1;
  let c = baseCyberEventChance(hp);
  const tags = (living.characterStatus[characterId] ?? []) as string[];
  if (tags.includes('injured') || tags.includes('fatigue')) c += 0.08;
  if (tags.includes('anxiety_state') || tags.includes('fear_state')) c += 0.05;
  if (tags.includes('hunger') || tags.includes('thirst')) c += 0.03;
  if (tags.includes('calm') || tags.includes('inspired') || tags.includes('affection')) c -= 0.05;

  try {
    const persona = getPersona(living, characterId);
    const mood = `${persona.moodNote ?? ''} ${persona.dayMode ?? ''}`;
    if (/烦|累|痛|倦|焦|闷|阴/.test(mood)) c += 0.05;
    if (/兴|喜|轻松|暖|开朗/.test(mood)) c -= 0.03;
    if (persona.dayMode === 'withdrawn' || persona.dayMode === 'dutiful') c += 0.03;
    if (persona.dayMode === 'playful' || persona.dayMode === 'social' || persona.dayMode === 'idle')
      c -= 0.03;
  } catch {
    /* persona 未就绪时忽略 */
  }

  return Math.max(0.05, Math.min(0.95, c));
}

export function listOpenCyberEvents(living: AiLivingSave): CyberHealthEvent[] {
  return ensureEvents(living).filter((e) => e.status === 'open');
}

export function getOpenCyberEventFor(
  living: AiLivingSave,
  characterId: string,
): CyberHealthEvent | undefined {
  return listOpenCyberEvents(living).find((e) => e.characterId === characterId);
}

export function resolveCyberEvent(
  living: AiLivingSave,
  eventId: string,
  note: string,
): void {
  const ev = ensureEvents(living).find((e) => e.id === eventId);
  if (!ev || ev.status !== 'open') return;
  ev.status = 'resolved';
  ev.note = `${ev.note} → ${note}`.slice(0, 160);
}

/** 心跳/巡检：按角色掷骰，触发「义体需要维修/更换」事件 */
export function tryRollCyberHealthEvents(
  living: AiLivingSave,
  ownedIds: string[],
): CyberHealthEvent | null {
  seedCyberHealthForOwned(living, ownedIds);
  const openIds = new Set(listOpenCyberEvents(living).map((e) => e.characterId));
  const shuffled = [...ownedIds].sort(() => Math.random() - 0.5);

  for (const id of shuffled) {
    if (openIds.has(id)) continue;
    const chance = adjustedCyberEventChance(living, id);
    if (Math.random() > chance) continue;

    const hp = getCyberHealth(living, id);
    const part = PART_HINTS[Math.floor(Math.random() * PART_HINTS.length)]!;
    const name = CHARACTER_MAP[id]?.name ?? id;
    const ev: CyberHealthEvent = {
      id: `cyber_${id}_${living.gameMinutes}_${Math.floor(Math.random() * 999)}`,
      characterId: id,
      partHint: part,
      healthAtTrigger: hp,
      createdGameMin: living.gameMinutes,
      status: 'open',
      note: `${name}的${part}告警（健康 ${hp}），需要修复或购置新义体`,
    };
    ensureEvents(living).push(ev);
    // 只保留最近 12 条
    living.pendingCyberHealthEvents = ensureEvents(living).slice(-12);

    pushMemory(living, id, {
      kind: 'event',
      summary: ev.note,
      importance: hp <= 9 ? 9 : 7,
    });
    pushCampLog(living, {
      text: `【义体告警】${ev.note}`,
      source: 'system',
      characterIds: [id],
    });

    const tags = new Set(living.characterStatus[id] ?? []);
    tags.add('anxiety_state' as LightStatusTag);
    living.characterStatus[id] = [...tags].slice(0, 4) as LightStatusTag[];
    return ev;
  }
  return null;
}

export type CyberRestoreResult = {
  ok: boolean;
  msg: string;
  log?: string;
  affinityDelta?: number;
};

/**
 * 修复：免费，健康→100。
 * helperId：帮修的人（player | 角色id | self）；非 self 时成功+好感/关系。
 */
export function repairCyberHealth(
  living: AiLivingSave,
  characterId: string,
  helperId: 'player' | string = 'self',
): CyberRestoreResult {
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const before = getCyberHealth(living, characterId);
  if (before >= CYBER_HEALTH_MAX) {
    return { ok: false, msg: `${name}义体健康已满，无需修复` };
  }

  setCyberHealth(living, characterId, CYBER_HEALTH_MAX, '义体修复完成（免费）');
  const open = getOpenCyberEventFor(living, characterId);
  if (open) resolveCyberEvent(living, open.id, '已修复');

  let affinityDelta = 0;
  if (helperId === 'player') {
    const prev = getAffinityScore(living, characterId);
    adjustAffinity(living, characterId, 4);
    affinityDelta = getAffinityScore(living, characterId) - prev;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `指挥官帮忙修复了义体，健康回满`,
      importance: 6,
    });
  } else if (helperId !== 'self' && helperId !== characterId) {
    adjustRelation(living, characterId, helperId, 5);
    affinityDelta = 5;
    const helperName = CHARACTER_MAP[helperId]?.name ?? helperId;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `${helperName}帮忙修复了义体，健康回满`,
      importance: 6,
    });
    pushMemory(living, helperId, {
      kind: 'event',
      summary: `帮 ${name} 修好了义体`,
      importance: 5,
    });
  }

  return {
    ok: true,
    msg: `已修复 ${name} 义体，健康 ${before}→${CYBER_HEALTH_MAX}`,
    log: `${name}义体修复回满`,
    affinityDelta,
  };
}

function getAffinityScore(living: AiLivingSave, characterId: string): number {
  return living.affinities[characterId] ?? 40;
}

/** 求助失败时扣好友度 */
export function penalizeCyberHelpFail(
  living: AiLivingSave,
  characterId: string,
  helperId: 'player' | string,
  reason: string,
): void {
  if (helperId === 'player') {
    adjustAffinity(living, characterId, -3);
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `向指挥官求助义体未成：${reason}`,
      importance: 5,
    });
  } else if (helperId !== 'self' && helperId !== characterId) {
    adjustRelation(living, characterId, helperId, -4);
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `向同伴求助义体未成：${reason}`,
      importance: 5,
    });
  }
}

/** 装备栏（叙事用，不影响皮肤/战力） */
export function getCyberLoadout(
  living: AiLivingSave,
  characterId: string,
): Record<string, string> {
  const all = ensureLoadout(living);
  if (!all[characterId]) all[characterId] = {};
  return all[characterId]!;
}

export function summarizeCyberLoadout(living: AiLivingSave, characterId: string): string {
  const lo = getCyberLoadout(living, characterId);
  const parts: string[] = [];
  for (const [slot, propId] of Object.entries(lo)) {
    const p = getCampProp(propId);
    if (p) parts.push(`${slot}:${p.nameZh}`);
  }
  return parts.join('、') || '无';
}

export function buildCyberHealthPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  seedCyberHealthForOwned(living, [characterId]);
  const hp = getCyberHealth(living, characterId);
  const loadout = summarizeCyberLoadout(living, characterId);
  const open = getOpenCyberEventFor(living, characterId);
  const chancePct = Math.round(adjustedCyberEventChance(living, characterId) * 100);
  const lines = [
    `【义体健康】（战斗被命中每次-1 + 时间老化；与性格/心情无关。装备不改皮肤/战力）`,
    `- 当前健康：${hp}/100`,
    `- 已挂载义体（叙事）：${loadout}`,
    `- 义体单价 10 锈币；恢复方式：① 角色自主休息（营地生活按周期回血）；② 军械库购买新义体换装。`,
    `- camp_item_action：action=repair|equip|unequip|buy（义体）|place|play；求助指挥官填 payer=player。`,
  ];
  if (open) {
    lines.push(`- ⚠ 进行中告警：${open.note}（部位暗示：${open.partHint}）。须尽快 repair 或买新义体；钱/货不足不能假装修好。`);
  } else if (hp < 60) {
    lines.push(`- 健康偏低，告警风险约 ${chancePct}%；可主动检查/预约维修。`);
  }
  return lines.join('\n');
}
