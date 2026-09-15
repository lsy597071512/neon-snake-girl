import type { SaveData } from '../types';
import {
  DISCIPLINE_TEMP_SKIN_INSTANCE,
  getCharacterSkin,
  isCampArmorMarker,
  LIFEWEAR_SKIN_ID,
  OUTFIT_CHANGE_SKIN_ID,
} from '../data/characterSkins';

/**
 * 皮肤显示通道（主页 / 营地分离）：
 * - player：仅玩家购买并「应用」的 activeSkinId（主页看板娘、角色详情）
 * - camp：仅 AI 营地穿搭（含生活服装基准 / 换装过程皮），与是否购买/应用无关
 * - none：强制默认原皮（战斗等）
 */
export type SkinChannel = 'player' | 'camp' | 'none';

const playerSkinByChar = new Map<string, string>();
const campSkinByChar = new Map<string, string>();

export function syncCharacterSkinRuntime(save: SaveData): void {
  playerSkinByChar.clear();
  campSkinByChar.clear();

  for (const oc of save.ownedCharacters) {
    if (oc.activeSkinId) {
      playerSkinByChar.set(oc.characterId, oc.activeSkinId);
    }
  }

  const living = save.aiLiving as
    | {
        campWornSkins?: Record<string, string>;
        eventTempSkins?: Record<string, { skinId?: string; eventInstanceId?: string }>;
        pendingOutfitChanges?: Record<string, { phase?: string }>;
      }
    | undefined;
  if (!living) return;

  const worn = living.campWornSkins ?? {};
  const temps = living.eventTempSkins ?? {};
  const pending = living.pendingOutfitChanges ?? {};

  const ids = new Set<string>([
    ...Object.keys(worn),
    ...Object.keys(temps),
    ...Object.keys(pending),
    ...save.ownedCharacters.map((o) => o.characterId),
  ]);

  for (const cid of ids) {
    const temp = temps[cid];
    if (temp?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE && temp.skinId) {
      campSkinByChar.set(cid, temp.skinId);
      continue;
    }

    if (pending[cid]?.phase === 'changing') {
      if (getCharacterSkin(cid, OUTFIT_CHANGE_SKIN_ID)?.portraitLive) {
        campSkinByChar.set(cid, OUTFIT_CHANGE_SKIN_ID);
        continue;
      }
    }

    if (temp?.skinId) {
      campSkinByChar.set(cid, temp.skinId);
      continue;
    }

    const w = worn[cid];
    if (isCampArmorMarker(w)) {
      // 装甲 = 无特别皮（原皮）
      continue;
    }
    if (w && getCharacterSkin(cid, w)) {
      campSkinByChar.set(cid, w);
      continue;
    }
    // 无账本 → 生活服装基准
    if (getCharacterSkin(cid, LIFEWEAR_SKIN_ID)?.portraitLive) {
      campSkinByChar.set(cid, LIFEWEAR_SKIN_ID);
    }
  }
}

/** 按通道取当前应显示的皮肤 id；none / 无记录 → null（默认原皮） */
export function getRuntimeActiveSkinId(
  characterId: string,
  channel: SkinChannel = 'player',
): string | null {
  if (channel === 'none') return null;
  if (channel === 'player') return playerSkinByChar.get(characterId) ?? null;
  return campSkinByChar.get(characterId) ?? null;
}
