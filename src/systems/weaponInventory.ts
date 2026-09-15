export interface WeaponInventoryCharacterLike {
  characterId: string;
  weaponId: string | null;
}

export interface WeaponInventorySaveLike {
  ownedWeaponIds: string[];
  ownedCharacters: WeaponInventoryCharacterLike[];
}

export interface WeaponInventoryEntry {
  weaponId: string;
  total: number;
  equipped: number;
  free: number;
}

export function countOwnedWeaponCopies(save: WeaponInventorySaveLike, weaponId: string): number {
  let count = 0;
  for (const wid of save.ownedWeaponIds) {
    if (wid === weaponId) count++;
  }
  return count;
}

export function countEquippedWeaponCopies(
  save: WeaponInventorySaveLike,
  weaponId: string,
  excludeCharacterId?: string,
): number {
  let count = 0;
  for (const oc of save.ownedCharacters) {
    if (excludeCharacterId && oc.characterId === excludeCharacterId) continue;
    if (oc.weaponId === weaponId) count++;
  }
  return count;
}

export function countAvailableWeaponCopies(
  save: WeaponInventorySaveLike,
  weaponId: string,
  characterId?: string,
): number {
  return Math.max(0, countOwnedWeaponCopies(save, weaponId) - countEquippedWeaponCopies(save, weaponId, characterId));
}

export function canEquipWeapon(save: WeaponInventorySaveLike, characterId: string, weaponId: string): boolean {
  return countAvailableWeaponCopies(save, weaponId, characterId) > 0;
}

export function getWeaponInventory(save: WeaponInventorySaveLike): WeaponInventoryEntry[] {
  const seen = new Set<string>();
  const rows: WeaponInventoryEntry[] = [];

  for (const weaponId of save.ownedWeaponIds) {
    if (seen.has(weaponId)) continue;
    seen.add(weaponId);
    const total = countOwnedWeaponCopies(save, weaponId);
    const equipped = countEquippedWeaponCopies(save, weaponId);
    rows.push({
      weaponId,
      total,
      equipped,
      free: Math.max(0, total - equipped),
    });
  }

  return rows;
}
