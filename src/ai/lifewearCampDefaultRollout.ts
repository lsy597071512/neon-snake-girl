/**
 * 生活服装 pifu00：读档时把营地「空穿着/隐式装甲」迁到生活服装基准。
 * v2：显式 'default' 装甲标记（旧存档）也迁到生活服装。
 * 已有泳装/睡衣/私服等具体外覆不覆盖。
 */
import { CAMP_ARMOR_MARKER, LIFEWEAR_SKIN_ID, getCharacterSkin } from '../data/characterSkins';
import type { SaveData } from '../types';
import { ensureCampWornMap } from './campOutfit';
import { pushMemory } from './memory';
import type { AiLivingSave } from './types';

export const LIFEWEAR_CAMP_DEFAULT_ROLLOUT_REV = 2;

export function applyLifewearCampDefaultRollout(
  save: SaveData,
  living: AiLivingSave,
): void {
  if (!living.skinRollouts) living.skinRollouts = {};
  const prevRev = living.skinRollouts.pifu00 ?? 0;
  if (prevRev >= LIFEWEAR_CAMP_DEFAULT_ROLLOUT_REV) return;

  const map = ensureCampWornMap(living);
  const owned = save.ownedCharacters.map((o) => o.characterId);
  const applied: string[] = [];

  for (const cid of owned) {
    if (!getCharacterSkin(cid, LIFEWEAR_SKIN_ID)?.portraitLive) continue;
    const cur = map[cid];
    if (prevRev < 1 && !cur) {
      map[cid] = LIFEWEAR_SKIN_ID;
      applied.push(cid);
      continue;
    }
    if (prevRev < 2 && cur === CAMP_ARMOR_MARKER) {
      map[cid] = LIFEWEAR_SKIN_ID;
      applied.push(cid);
    }
  }

  living.skinRollouts.pifu00 = LIFEWEAR_CAMP_DEFAULT_ROLLOUT_REV;

  if (applied.length) {
    try {
      pushMemory(living, applied[0]!, {
        kind: 'event',
        summary:
          `营地日常基准已改为「生活服装」(pifu00)：居家/出门休闲。默认战斗装甲仅在主动想穿、室外干活或军械/执勤时穿着。`,
        importance: 5,
      });
    } catch {
      /* boot 前可忽略 */
    }
  }
}
