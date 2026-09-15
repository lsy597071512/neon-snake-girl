import { CHARACTER_MAP, CHARACTERS, GACHA_PITY, GACHA_RATES, DUPLICATE_GOLD } from '../data/characters';
import { WEAPON_MAP } from '../data/weapons';
import type { CharacterDef, Rarity, SaveData } from '../types';
import { STAGE_MAP } from '../data/stages';
import { squadSlotsForStageDef } from '../game/combatBalance';
import { getSkillModifiersFromSkillIds, isCharacterSkillId } from './skillEffects';
import { addCharacterShard } from '../systems/ShardSystem';
import { getAffinityCombatMul } from '../systems/AffinityGameplay';

/**
 * 数值体系（战斗弹伤）：
 * 1) 战力 = 角色基础 + 武器基础 + 角色碎片强化 + 武器强化（可成长）
 * 2) 稀有度系数固定：职级越高输出越高
 * 3) 职业系数固定：由定位 tag 决定，不随养成改变
 * 4) 未装备武器有裸装惩罚，突出武器价值
 * 弹伤 = 战力/8 × 稀有度 × 职业 × 武装系数
 */

/** 稀有度输出系数：角色基础战力已归一化，避免基础面板与稀有度重复放大。 */
export const RARITY_DAMAGE_MUL: Record<Rarity, number> = {
  SR: 1,
  SSR: 1.14,
  UR: 1.3,
};

/** 各稀有度角色战斗面板基准，用于拆除角色基础战力中的稀有度重复加成。 */
const RARITY_BASE_POWER: Record<Rarity, number> = {
  SR: 118,
  SSR: 178,
  UR: 225,
};

/** 未装备武器时的输出惩罚 */
export const UNARMED_DAMAGE_MUL = 0.7;

/**
 * 职业/定位输出系数（固定，由 tag 推导）。
 * 战力可成长，职业系数不变。
 */
export function getRoleDamageMul(tag: string): number {
  const t = tag.toLowerCase();
  if (t.includes('boss')) return 1.2;
  if (t.includes('爆发') || t.includes('重炮') || t.includes('远程')) return 1.15;
  if (t.includes('清场') || t.includes('连击') || t.includes('穿透')) return 1.1;
  if (t.includes('突袭') || t.includes('机动') || t.includes('高速')) return 1.06;
  if (
    t.includes('近距') ||
    t.includes('防护') ||
    t.includes('支援') ||
    t.includes('警戒') ||
    t.includes('侦察') ||
    t.includes('闪避')
  ) {
    return 0.95;
  }
  return 1;
}

export function getCharacterPower(characterId: string, weaponId: string | null, save?: SaveData): number {
  const c = CHARACTER_MAP[characterId];
  if (!c) return 0;
  const w = weaponId ? WEAPON_MAP[weaponId] : null;
  let power = c.basePower + (w?.power ?? 0);
  if (save) {
    const oc = save.ownedCharacters.find((o) => o.characterId === characterId);
    power += oc?.shardPowerBonus ?? 0;
    if (weaponId) power += save.weaponEnhanceBonus[weaponId] ?? 0;
    // 好感出场同步：信赖越高战力略升（玩法兑现）
    const aff = save.aiLiving?.affinities?.[characterId];
    if (typeof aff === 'number') {
      power = Math.round(power * getAffinityCombatMul(aff));
    }
  }
  return power;
}

/**
 * 单发散弹伤害（战斗用，按角色独立结算）。
 * UR+传说武器应明显强于 SR 裸装。
 */
export function getCharacterShotDamage(
  characterId: string,
  weaponId: string | null,
  save?: SaveData,
): number {
  const c = CHARACTER_MAP[characterId];
  if (!c) return 1;
  const rawPower = getCharacterPower(characterId, weaponId, save);
  const rarityMul = RARITY_DAMAGE_MUL[c.rarity] ?? 1;
  // 角色基础战力先按稀有度基准归一化；武器与碎片成长保留为独立养成收益。
  const basePower = Math.max(1, c.basePower);
  const normalizedCharacterPower =
    RARITY_BASE_POWER[c.rarity] + (rawPower - basePower) * 0.72;
  const roleMul = getRoleDamageMul(c.tag);
  const armedMul = weaponId ? 1 : UNARMED_DAMAGE_MUL;
  return Math.max(1, (normalizedCharacterPower / 8) * rarityMul * roleMul * armedMul);
}

/** 构建小队每人弹幕伤害表 */
export function getSquadShotDamageMap(save: SaveData, squadIds: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const id of squadIds) {
    const oc = save.ownedCharacters.find((o) => o.characterId === id);
    map[id] = getCharacterShotDamage(id, oc?.weaponId ?? null, save);
  }
  return map;
}

export function getFullSquadTcp(save: SaveData): number {
  return save.squad.reduce((sum, cid) => {
    const owned = save.ownedCharacters.find((o) => o.characterId === cid);
    if (!owned) return sum;
    return sum + getCharacterPower(owned.characterId, owned.weaponId, save);
  }, 0);
}

export function getDeployIds(save: SaveData, stageId: number): string[] {
  const stage = STAGE_MAP[stageId];
  const slots = stage ? squadSlotsForStageDef(stage, save) : save.squad.length;
  return save.squad.slice(0, slots);
}

export function getTeamTcp(save: SaveData, stageId?: number): number {
  if (!stageId) return getFullSquadTcp(save);
  const active = getDeployIds(save, stageId);
  return active.reduce((sum, cid) => {
    const owned = save.ownedCharacters.find((o) => o.characterId === cid);
    if (!owned) return sum;
    return sum + getCharacterPower(owned.characterId, owned.weaponId, save);
  }, 0);
}

export function canManualWin(tcp: number, recommended: number, isBoss: boolean): boolean {
  const ratio = isBoss ? 0.88 : 0.82;
  return tcp >= recommended * ratio;
}

export function rollRarity(pity: number): Rarity {
  if (pity >= GACHA_PITY - 1) return 'UR';
  const roll = Math.random();
  if (roll < GACHA_RATES.UR) return 'UR';
  if (roll < GACHA_RATES.UR + GACHA_RATES.SSR) return 'SSR';
  return 'SR';
}

export function pickCharacterByRarity(rarity: Rarity, owned: string[]): CharacterDef {
  const pool = CHARACTERS.filter((c) => c.rarity === rarity);
  const notOwned = pool.filter((c) => !owned.includes(c.id));
  const source = notOwned.length ? notOwned : pool;
  return source[Math.floor(Math.random() * source.length)];
}

export interface GachaResult {
  characterId: string;
  rarity: Rarity;
  duplicate: boolean;
  goldRefund: number;
  pityReset: boolean;
}

export function performGachaPull(save: SaveData): GachaResult {
  const owned = save.ownedCharacters.map((c) => c.characterId);
  const rarity = rollRarity(save.gachaPity);
  const char = pickCharacterByRarity(rarity, owned);
  const duplicate = owned.includes(char.id);

  let goldRefund = 0;
  if (duplicate) goldRefund = DUPLICATE_GOLD;

  return {
    characterId: char.id,
    rarity: char.rarity,
    duplicate,
    goldRefund,
    pityReset: rarity === 'UR',
  };
}

export function applyGachaResult(save: SaveData, result: GachaResult): void {
  if (result.duplicate) {
    save.gold += Math.floor(DUPLICATE_GOLD * 0.4);
    addCharacterShard(save, result.characterId, 1);
  } else {
    save.ownedCharacters.push({
      characterId: result.characterId,
      weaponId: null,
      giftCount: 0,
      shardPowerBonus: 0,
      unlockedSkins: [],
      activeSkinId: null,
    });
    if (!save.squad.includes(result.characterId) && save.squad.length < 3) {
      save.squad.push(result.characterId);
    }
  }
  if (result.pityReset) save.gachaPity = 0;
  else save.gachaPity += 1;
}

export function updateLegendaryStat(save: SaveData): void {
  let count = 0;
  for (const oc of save.ownedCharacters) {
    if (oc.weaponId && WEAPON_MAP[oc.weaponId]?.rarity === 'L') count++;
  }
  save.stats.legendariesEquipped = count;
}

export function getSkillModifiers(characterIds: string[]) {
  return getSkillModifiersFromSkillIds(
    characterIds.map((id) => {
      const skillId = CHARACTER_MAP[id]?.skillId;
      return isCharacterSkillId(skillId) ? skillId : undefined;
    }),
  );
}
