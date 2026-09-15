import { ARMORY_UPGRADE_COST, ARMORY_UPGRADE_MINUTES, ARMORY_WEIGHTS, WEAPONS, openCost } from '../data/weapons';
import type { SaveData, WeaponDef, WeaponRarity } from '../types';
import type { AiLivingSave } from '../ai/types';
import { recordArmoryGameplay } from '../ai/gameplayConsequences';
import {
  canEquipWeapon,
  countAvailableWeaponCopies,
  countEquippedWeaponCopies,
  countOwnedWeaponCopies,
  getWeaponInventory,
} from './weaponInventory';
import { addWeaponShard } from './ShardSystem';

function noteArmoryUpgrade(save: SaveData, label: string): void {
  if (!save.aiLiving) return;
  const char =
    save.settings.hubFeaturedCharId ?? save.squad[0] ?? save.ownedCharacters[0]?.characterId;
  if (!char) return;
  try {
    recordArmoryGameplay(save, save.aiLiving as AiLivingSave, {
      characterId: char,
      lines: [label],
      kind: 'upgrade',
    });
  } catch {
    /* boot 前可忽略 */
  }
}

export {
  canEquipWeapon,
  countAvailableWeaponCopies,
  countEquippedWeaponCopies,
  countOwnedWeaponCopies,
  getWeaponInventory,
} from './weaponInventory';

function rollRarity(level: number): WeaponRarity {
  const weights = ARMORY_WEIGHTS[Math.min(level, 8)] ?? ARMORY_WEIGHTS[8];
  const entries = Object.entries(weights).filter(([, w]) => w > 0) as [WeaponRarity, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [r, w] of entries) {
    roll -= w;
    if (roll <= 0) return r;
  }
  return 'N';
}

function pickWeapon(rarity: WeaponRarity): WeaponDef {
  const pool = WEAPONS.filter((w) => w.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

export function rollWeapon(level: number): WeaponDef {
  return pickWeapon(rollRarity(level));
}

export function rollPack(type: 'normal' | 'advanced' | 'legendary'): WeaponDef {
  if (type === 'normal') {
    return Math.random() < 0.7 ? pickWeapon('N') : pickWeapon('R');
  }
  if (type === 'advanced') {
    return Math.random() < 0.75 ? pickWeapon('R') : pickWeapon('E');
  }
  return Math.random() < 0.7 ? pickWeapon('E') : pickWeapon('L');
}

export function getOpenCost(save: SaveData, discounted: boolean): number {
  const base = openCost(save.armoryLevel);
  return discounted ? Math.floor(base * 0.8) : base;
}

export function canUpgradeArmory(save: SaveData): boolean {
  return save.armoryLevel < 8 && save.armoryUpgradeEnd === null;
}

export function startArmoryUpgrade(save: SaveData): { ok: boolean; msg: string } {
  if (save.armoryLevel >= 8) return { ok: false, msg: '军械箱已达最高等级' };
  if (save.armoryUpgradeEnd) return { ok: false, msg: '升级进行中' };
  const cost = ARMORY_UPGRADE_COST[save.armoryLevel];
  if (save.gold < cost) return { ok: false, msg: `锈币不足，需要 ${cost}` };
  save.gold -= cost;
  save.armoryUpgradeEnd = Date.now() + ARMORY_UPGRADE_MINUTES[save.armoryLevel] * 60 * 1000;
  noteArmoryUpgrade(save, `开始升级军械箱（花费 ${cost} 锈币）`);
  return { ok: true, msg: '升级开始' };
}

export function finishArmoryUpgradeIfReady(save: SaveData): boolean {
  if (!save.armoryUpgradeEnd) return false;
  if (Date.now() >= save.armoryUpgradeEnd) {
    save.armoryLevel += 1;
    save.armoryUpgradeEnd = null;
    noteArmoryUpgrade(save, `军械箱升至 Lv.${save.armoryLevel}`);
    return true;
  }
  return false;
}

export function skipArmoryUpgrade(save: SaveData): void {
  if (save.armoryUpgradeEnd) {
    save.armoryLevel += 1;
    save.armoryUpgradeEnd = null;
    noteArmoryUpgrade(save, `军械箱升至 Lv.${save.armoryLevel}（跳过等待）`);
  }
}

export function getUpgradeRemainingMs(save: SaveData): number {
  if (!save.armoryUpgradeEnd) return 0;
  return Math.max(0, save.armoryUpgradeEnd - Date.now());
}

export function equipWeapon(save: SaveData, characterId: string, weaponId: string): { ok: boolean; msg: string } {
  const oc = save.ownedCharacters.find((c) => c.characterId === characterId);
  if (!oc) return { ok: false, msg: '角色不存在' };
  if (!save.ownedWeaponIds.includes(weaponId)) return { ok: false, msg: '武器不存在' };
  if (!canEquipWeapon(save, characterId, weaponId)) {
    return { ok: false, msg: '该武器已被其他角色占用' };
  }
  oc.weaponId = weaponId;
  return { ok: true, msg: '装备成功' };
}

export function sellWeapon(save: SaveData, weaponId: string): { ok: boolean; gold: number; msg: string } {
  const def = WEAPONS.find((w) => w.id === weaponId);
  if (!def) return { ok: false, gold: 0, msg: '武器不存在' };

  if (countAvailableWeaponCopies(save, weaponId) <= 0) {
    return { ok: false, gold: 0, msg: '该武器复制体都已装备，无法出售' };
  }

  const idx = save.ownedWeaponIds.findIndex((id) => id === weaponId);
  if (idx === -1) return { ok: false, gold: 0, msg: '背包中无该武器' };
  save.ownedWeaponIds.splice(idx, 1);
  save.gold += def.sellPrice;
  return { ok: true, gold: def.sellPrice, msg: `出售获得 ${def.sellPrice} 锈币` };
}

export function addWeapon(save: SaveData, weapon: WeaponDef): void {
  save.ownedWeaponIds.push(weapon.id);
}

/** 获得武器：首次入背包，重复则转为该武器专属碎片 */
export function acquireWeapon(save: SaveData, weapon: WeaponDef): { duplicate: boolean; msg: string } {
  const alreadyOwned = countOwnedWeaponCopies(save, weapon.id) > 0;
  if (alreadyOwned) {
    addWeaponShard(save, weapon.id, 1);
    return { duplicate: true, msg: `${weapon.name} 碎片 ×1` };
  }
  addWeapon(save, weapon);
  return { duplicate: false, msg: weapon.name };
}

export function compareAndMaybeEquip(save: SaveData, characterId: string, newWeapon: WeaponDef): string {
  const acquired = acquireWeapon(save, newWeapon);
  if (acquired.duplicate) return acquired.msg;

  const oc = save.ownedCharacters.find((c) => c.characterId === characterId);
  if (!oc) return `获得 ${newWeapon.name}`;

  const current = oc.weaponId ? WEAPONS.find((w) => w.id === oc.weaponId) : null;
  if (!current || newWeapon.power > current.power) {
    oc.weaponId = newWeapon.id;
    return `装备 ${newWeapon.name}（战力 ${newWeapon.power}）`;
  }
  return `获得 ${newWeapon.name}，当前装备更优`;
}
