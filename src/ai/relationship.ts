import type { AiLivingSave } from './types';
import { detectArcTransition, resolveRelationshipArc } from './relationshipArc';
import { recordArcTransitionFact } from './structuredFacts';

export function relationKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function getRelation(living: AiLivingSave, a: string, b: string): number {
  if (a === b) return 0;
  return living.relationships[relationKey(a, b)] ?? 0;
}

export function adjustRelation(living: AiLivingSave, a: string, b: string, delta: number): number {
  if (a === b) return 0;
  const key = relationKey(a, b);
  const next = Math.max(-100, Math.min(100, (living.relationships[key] ?? 0) + delta));
  living.relationships[key] = next;
  return next;
}

export function getAffinity(living: AiLivingSave, characterId: string): number {
  return living.affinities[characterId] ?? 40;
}

export function adjustAffinity(living: AiLivingSave, characterId: string, delta: number): number {
  const prev = getAffinity(living, characterId);
  const next = Math.max(0, Math.min(100, prev + delta));
  living.affinities[characterId] = next;

  if (!living.relationshipArcStage) living.relationshipArcStage = {};
  const transition = detectArcTransition(prev, next);
  if (transition) {
    living.relationshipArcStage[characterId] = transition.to.id;
    recordArcTransitionFact(
      living,
      characterId,
      transition.from.labelZh,
      transition.to.labelZh,
      next,
    );
  } else if (!living.relationshipArcStage[characterId]) {
    living.relationshipArcStage[characterId] = resolveRelationshipArc(next).id;
  }

  return next;
}

/** 送礼：按偏好匹配加更多好感 */
export function applyGiftAffinity(
  living: AiLivingSave,
  characterId: string,
  giftPreference: string,
  giftTier: 0 | 1 | 2,
): number {
  const base = [3, 7, 15][giftTier];
  const prefBoost = giftPreference ? 2 : 0;
  return adjustAffinity(living, characterId, base + prefBoost);
}

export function describeAffinity(score: number): string {
  if (score >= 90) return '亲密';
  if (score >= 80) return '信赖';
  if (score >= 60) return '友好';
  if (score >= 40) return '熟悉';
  if (score >= 20) return '冷淡';
  return '警惕';
}

/** 角色间关系文案（-100..100） */
export function describeRelation(score: number): string {
  if (score >= 60) return '挚友';
  if (score >= 30) return '亲近';
  if (score >= 10) return '投缘';
  if (score > -10) return '普通';
  if (score > -30) return '别扭';
  if (score > -60) return '隔阂';
  return '敌对';
}

export type RelationPairRow = {
  a: string;
  b: string;
  score: number;
  label: string;
};

/** 列出已拥有角色两两关系（按 |分| 降序） */
export function listRelationPairs(living: AiLivingSave, ownedIds: string[]): RelationPairRow[] {
  const rows: RelationPairRow[] = [];
  for (let i = 0; i < ownedIds.length; i++) {
    for (let j = i + 1; j < ownedIds.length; j++) {
      const a = ownedIds[i];
      const b = ownedIds[j];
      const score = getRelation(living, a, b);
      rows.push({ a, b, score, label: describeRelation(score) });
    }
  }
  rows.sort((x, y) => Math.abs(y.score) - Math.abs(x.score) || y.score - x.score);
  return rows;
}

/** 事件/共同行动后微调角色间关系 */
export function bumpPairwiseRelations(
  living: AiLivingSave,
  characterIds: string[],
  delta: number,
): void {
  for (let i = 0; i < characterIds.length; i++) {
    for (let j = i + 1; j < characterIds.length; j++) {
      adjustRelation(living, characterIds[i], characterIds[j], delta);
    }
  }
}

/**
 * AI 行为影响角色间好感：同屏事件成员、或同房且同为社交活动时缓慢升温/降温。
 * 每游戏分钟可调用；内部节流避免刷爆。
 */
export function tickRelationsFromAiBehavior(
  living: AiLivingSave,
  ownedIds: string[],
  roomOf: (id: string) => string,
): void {
  // 多人事件同屏：一起做事 → 关系微升
  for (const ev of living.activeCampEvents ?? []) {
    if (ev.phase !== 'active') continue;
    const members = (ev.coScreenIds ?? []).filter((id) => ownedIds.includes(id));
    if (members.length < 2) continue;
    // 约每 18 游戏分钟涨 1 点（用 gameMinutes 哈希节流）
    if ((living.gameMinutes + ev.outcomeSeed) % 18 === 0) {
      bumpPairwiseRelations(living, members, 1);
    }
  }

  // 同房社交活动（非事件偶然同房）：弱影响，且不触发同屏
  const byRoom = new Map<string, string[]>();
  for (const id of ownedIds) {
    const room = roomOf(id);
    if (!room) continue;
    const list = byRoom.get(room) ?? [];
    list.push(id);
    byRoom.set(room, list);
  }
  for (const ids of byRoom.values()) {
    if (ids.length < 2) continue;
    // 更慢：约每 40 游戏分钟 +1，且幅度小
    if (living.gameMinutes % 40 !== 0) continue;
    // 跳过已在同屏事件里的组合（避免双计）
    const inCo = new Set(
      (living.activeCampEvents ?? [])
        .filter((e) => e.phase === 'active')
        .flatMap((e) => e.coScreenIds ?? []),
    );
    const casual = ids.filter((id) => !inCo.has(id));
    if (casual.length >= 2) bumpPairwiseRelations(living, casual.slice(0, 4), 1);
  }
}
