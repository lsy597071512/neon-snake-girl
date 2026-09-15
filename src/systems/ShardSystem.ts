import { CHARACTER_MAP } from '../data/characters';
import { WEAPON_MAP } from '../data/weapons';
import type { Rarity, SaveData, WeaponRarity } from '../types';

const CHAR_SHARD_BASE: Record<Rarity, number> = { SR: 3, SSR: 2, UR: 1 };
const CHAR_SHARD_POWER: Record<Rarity, number> = { SR: 10, SSR: 50, UR: 100 };

/** 武器碎片需求更苛刻：基础需求更高，每次递增也更大 */
const WEAPON_SHARD_BASE: Record<WeaponRarity, number> = { N: 6, R: 5, E: 4, L: 3 };
const WEAPON_SHARD_STEP: Record<WeaponRarity, number> = { N: 2, R: 2, E: 1, L: 1 };
const WEAPON_SHARD_POWER: Record<WeaponRarity, number> = { N: 3, R: 6, E: 12, L: 20 };

export function getCharacterShardCount(save: SaveData, characterId: string): number {
  return save.characterShards[characterId] ?? 0;
}

export function getWeaponShardCount(save: SaveData, weaponId: string): number {
  return save.weaponShards[weaponId] ?? 0;
}

export function addCharacterShard(save: SaveData, characterId: string, amount = 1): void {
  if (!CHARACTER_MAP[characterId] || amount <= 0) return;
  save.characterShards[characterId] = getCharacterShardCount(save, characterId) + amount;
}

export function addWeaponShard(save: SaveData, weaponId: string, amount = 1): void {
  if (!WEAPON_MAP[weaponId] || amount <= 0) return;
  save.weaponShards[weaponId] = getWeaponShardCount(save, weaponId) + amount;
}

export function getCharacterShardUseCount(save: SaveData, characterId: string): number {
  return save.characterShardUses[characterId] ?? 0;
}

export function getWeaponShardUseCount(save: SaveData, weaponId: string): number {
  return save.weaponShardUses[weaponId] ?? 0;
}

export function getCharacterShardRequirement(rarity: Rarity, useCount: number): number {
  return CHAR_SHARD_BASE[rarity] + useCount;
}

export function getCharacterShardPowerGain(rarity: Rarity): number {
  return CHAR_SHARD_POWER[rarity];
}

export function getWeaponShardRequirement(rarity: WeaponRarity, useCount: number): number {
  return WEAPON_SHARD_BASE[rarity] + useCount * WEAPON_SHARD_STEP[rarity];
}

export function getWeaponShardPowerGain(rarity: WeaponRarity, useCount = 0): number {
  const base = WEAPON_SHARD_POWER[rarity];
  // 旧档的固定加成仍然有效；新强化按等级逐步提高，避免后期每次强化收益停滞。
  const growth = 1 + Math.min(0.8, Math.max(0, useCount) * 0.08);
  return Math.max(1, Math.round(base * growth));
}

export function getCharacterShardUpgradeInfo(save: SaveData, characterId: string): {
  owned: number;
  required: number;
  powerGain: number;
  uses: number;
} | null {
  const c = CHARACTER_MAP[characterId];
  const oc = save.ownedCharacters.find((o) => o.characterId === characterId);
  if (!c || !oc) return null;
  const uses = getCharacterShardUseCount(save, characterId);
  return {
    owned: getCharacterShardCount(save, characterId),
    required: getCharacterShardRequirement(c.rarity, uses),
    powerGain: getCharacterShardPowerGain(c.rarity),
    uses,
  };
}

export function getWeaponShardUpgradeInfo(save: SaveData, weaponId: string): {
  owned: number;
  required: number;
  powerGain: number;
  uses: number;
  enhanceBonus: number;
} | null {
  const w = WEAPON_MAP[weaponId];
  if (!w) return null;
  const uses = getWeaponShardUseCount(save, weaponId);
  return {
    owned: getWeaponShardCount(save, weaponId),
    required: getWeaponShardRequirement(w.rarity, uses),
    powerGain: getWeaponShardPowerGain(w.rarity, uses),
    uses,
    enhanceBonus: save.weaponEnhanceBonus[weaponId] ?? 0,
  };
}

export function useCharacterShards(save: SaveData, characterId: string): { ok: boolean; msg: string } {
  const c = CHARACTER_MAP[characterId];
  const oc = save.ownedCharacters.find((o) => o.characterId === characterId);
  if (!c || !oc) return { ok: false, msg: '未拥有该角色' };

  const uses = getCharacterShardUseCount(save, characterId);
  const required = getCharacterShardRequirement(c.rarity, uses);
  const owned = getCharacterShardCount(save, characterId);
  if (owned < required) {
    return { ok: false, msg: `碎片不足，需要 ${required} 个` };
  }

  save.characterShards[characterId] = owned - required;
  save.characterShardUses[characterId] = uses + 1;
  const gain = getCharacterShardPowerGain(c.rarity);
  oc.shardPowerBonus = (oc.shardPowerBonus ?? 0) + gain;
  return { ok: true, msg: `${c.name} 战力 +${gain}（消耗 ${required} 碎片）` };
}

export function useWeaponShards(save: SaveData, weaponId: string): { ok: boolean; msg: string } {
  const w = WEAPON_MAP[weaponId];
  if (!w) return { ok: false, msg: '武器不存在' };

  const uses = getWeaponShardUseCount(save, weaponId);
  const required = getWeaponShardRequirement(w.rarity, uses);
  const owned = getWeaponShardCount(save, weaponId);
  if (owned < required) {
    return { ok: false, msg: `碎片不足，需要 ${required} 个` };
  }

  save.weaponShards[weaponId] = owned - required;
  save.weaponShardUses[weaponId] = uses + 1;
  const gain = getWeaponShardPowerGain(w.rarity, uses);
  save.weaponEnhanceBonus[weaponId] = (save.weaponEnhanceBonus[weaponId] ?? 0) + gain;
  return { ok: true, msg: `${w.name} 强化 +${gain} 战力（消耗 ${required} 碎片）` };
}

export function dismantleWeaponCopy(save: SaveData, weaponId: string): { ok: boolean; gold: number; msg: string } {
  const w = WEAPON_MAP[weaponId];
  if (!w) return { ok: false, gold: 0, msg: '武器不存在' };

  const idx = save.ownedWeaponIds.indexOf(weaponId);
  if (idx === -1) return { ok: false, gold: 0, msg: '背包中没有该武器' };

  let equipped = 0;
  for (const oc of save.ownedCharacters) {
    if (oc.weaponId === weaponId) equipped++;
  }
  const total = save.ownedWeaponIds.filter((id) => id === weaponId).length;
  if (total <= equipped) {
    return { ok: false, gold: 0, msg: '所有复制体均已装备，无法分解' };
  }

  save.ownedWeaponIds.splice(idx, 1);
  const gold = Math.floor(w.sellPrice * 1.2);
  save.gold += gold;
  return { ok: true, gold, msg: `分解 ${w.name} 获得 ${gold} 锈币` };
}
