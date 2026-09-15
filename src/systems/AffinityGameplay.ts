/**
 * 好感 → 玩法兑现（战斗加成 / 皮肤折扣 / 内容门槛）
 * 数值给系统用；给 AI 的只是可读摘要，不暴露精确公式。
 */
import type { SaveData } from '../types';
import type { AiLivingSave } from '../ai/types';
import { resolveRelationshipArc } from '../ai/relationshipArc';
import { getCharacterSkin } from '../data/characterSkins';

/** 出场战力乘区（对 getCharacterPower 结果） */
export function getAffinityCombatMul(affinity: number): number {
  if (affinity >= 90) return 1.12;
  if (affinity >= 80) return 1.08;
  if (affinity >= 60) return 1.05;
  if (affinity >= 40) return 1.02;
  return 1;
}

export function getCharacterAffinityCombatMul(
  save: SaveData | undefined,
  characterId: string,
): number {
  const aff = save?.aiLiving?.affinities?.[characterId];
  if (typeof aff !== 'number') return 1;
  return getAffinityCombatMul(aff);
}

/** 皮肤解锁折扣 0~0.25（信赖起） */
export function getAffinitySkinDiscount(affinity: number): number {
  if (affinity >= 90) return 0.25;
  if (affinity >= 80) return 0.15;
  if (affinity >= 60) return 0.1;
  return 0;
}

export function getSkinUnlockPrice(
  save: SaveData,
  characterId: string,
  skinId: string,
): { listPrice: number; payPrice: number; discount: number; affinity: number } {
  const skin = getCharacterSkin(characterId, skinId);
  const listPrice = skin?.price ?? 0;
  const living = save.aiLiving as AiLivingSave | undefined;
  const affinity = living?.affinities?.[characterId] ?? 40;
  const discount = getAffinitySkinDiscount(affinity);
  // 标价 0 保持免费；有价时至少收 1，避免折扣后变 0
  const payPrice =
    listPrice <= 0 ? 0 : Math.max(1, Math.floor(listPrice * (1 - discount)));
  return { listPrice, payPrice, discount, affinity };
}

export type BondUnlockRow = {
  id: string;
  label: string;
  unlocked: boolean;
  needAffinity: number;
};

/** 专属羁绊侧内容（闲话深度 / 未来专属关）是否可开 */
export function canAccessBondSideStory(affinity: number): boolean {
  return affinity >= 80;
}

/** UI：关系内容门槛一览（不注入整表给 AI，只给玩家看） */
export function listBondContentUnlocks(affinity: number): BondUnlockRow[] {
  return [
    {
      id: 'combat_soft',
      label: '出征微弱同步（战力+）',
      unlocked: affinity >= 40,
      needAffinity: 40,
    },
    {
      id: 'talk_familiar',
      label: '对话：熟人话题自由度',
      unlocked: affinity >= 40,
      needAffinity: 40,
    },
    {
      id: 'skin_10',
      label: '外覆解锁 9 折',
      unlocked: affinity >= 60,
      needAffinity: 60,
    },
    {
      id: 'combat_mid',
      label: '出征稳定同步（战力++）',
      unlocked: affinity >= 60,
      needAffinity: 60,
    },
    {
      id: 'talk_friendly',
      label: '对话：心事/约定可谈',
      unlocked: affinity >= 60,
      needAffinity: 60,
    },
    {
      id: 'skin_15',
      label: '外覆解锁 85 折',
      unlocked: affinity >= 80,
      needAffinity: 80,
    },
    {
      id: 'combat_high',
      label: '出征强同步（战力+++）',
      unlocked: affinity >= 80,
      needAffinity: 80,
    },
    {
      id: 'story_bond',
      label: '专属羁绊侧内容（深层闲话）',
      unlocked: canAccessBondSideStory(affinity),
      needAffinity: 80,
    },
    {
      id: 'skin_25',
      label: '外覆解锁 75 折 · 亲密自由度',
      unlocked: affinity >= 90,
      needAffinity: 90,
    },
  ];
}

/**
 * 给 AI 的玩法兑现摘要（可读、无精确百分比）
 * —— 让角色知道「好感会改变出征与装扮」，但不要背公式。
 */
export function buildAffinityGameplayPromptHint(
  living: AiLivingSave,
  characterId: string,
): string {
  const aff = living.affinities[characterId] ?? 40;
  const arc = resolveRelationshipArc(aff);
  const bits: string[] = [];
  if (aff >= 40) bits.push('出征时你会因与指挥官的羁绊略更稳（战力有隐性加成）');
  if (aff >= 60) bits.push('指挥官为你解锁主页外覆时可享折扣');
  if (aff >= 80) bits.push('信赖阶段：可谈更深约定与专属心事；外覆折扣更深');
  if (aff >= 90) bits.push('亲密阶段：话题与归属感可更近；外覆折扣最大');
  if (!bits.length) {
    return `【好感玩法】当前「${arc.labelZh}」：羁绊尚浅，出征/外覆尚无额外优待；升温后会兑现。`;
  }
  return `【好感玩法·已兑现】当前「${arc.labelZh}」：${bits.join('；')}。可自然感知，勿报具体百分比或系统数值。`;
}
