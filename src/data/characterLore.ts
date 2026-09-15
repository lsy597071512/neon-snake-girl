import { SR_BIOS } from './sr-bios';
import { SSR_UR_BIOS } from './ssr-ur-bios';
import type { CharacterBioLore } from './lore/types';

/** 锈带纪元 16:9 漫画世界地图（与 worldMap.ts 同源） */
export { WORLD_MAP_SRC as WORLD_MAP_IMAGE } from './worldMap';

type BioEntry = Omit<CharacterBioLore, 'characterId'>;

function buildCharacterLoreMap(): Record<string, CharacterBioLore> {
  const map: Record<string, CharacterBioLore> = {};
  for (const [characterId, entry] of Object.entries(SR_BIOS) as [string, BioEntry][]) {
    map[characterId] = { characterId, ...entry };
  }
  for (const [characterId, entry] of Object.entries(SSR_UR_BIOS) as [string, BioEntry][]) {
    map[characterId] = { characterId, ...entry };
  }
  return map;
}

export const CHARACTER_LORE: Record<string, CharacterBioLore> = buildCharacterLoreMap();

export function getCharacterLore(characterId: string): CharacterBioLore | null {
  return CHARACTER_LORE[characterId] ?? null;
}

export function hasCharacterLore(characterId: string): boolean {
  return characterId in CHARACTER_LORE;
}
