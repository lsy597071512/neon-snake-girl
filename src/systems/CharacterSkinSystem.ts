import {
  getCharacterSkin,
  getCharacterSkins,
  getHubPurchasableSkins,
  isHubPurchasableSkin,
  SHOWER_SKIN_ID,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import type { SaveData } from '../types';
import { recordShopOrSkinSpend } from '../ai/gameplayConsequences';
import { getAiLiving } from '../ai/livingService';
import { getSkinUnlockPrice } from './AffinityGameplay';

export function isCharacterSkinUnlocked(save: SaveData, characterId: string, skinId: string): boolean {
  const oc = save.ownedCharacters.find((o) => o.characterId === characterId);
  return !!oc?.unlockedSkins?.includes(skinId);
}

export function getActiveCharacterSkinId(save: SaveData, characterId: string): string | null {
  const oc = save.ownedCharacters.find((o) => o.characterId === characterId);
  return oc?.activeSkinId ?? null;
}

/**
 * 主页看板娘商店解锁。仅可购皮肤；不写营地 AI 记忆/通知。
 * 营地穿搭不依赖本解锁。
 */
export function unlockCharacterSkin(
  save: SaveData,
  characterId: string,
  skinId: string,
  opts?: { free?: boolean },
): { ok: boolean; msg: string } {
  const skin = getCharacterSkin(characterId, skinId);
  if (!skin) return { ok: false, msg: '皮肤不存在' };
  if (!isHubPurchasableSkin(skin)) {
    return { ok: false, msg: '该皮肤不可在看板娘商店购买（仅营地情境可用）' };
  }

  const oc = save.ownedCharacters.find((o) => o.characterId === characterId);
  if (!oc) return { ok: false, msg: '未拥有该角色' };

  if (!oc.unlockedSkins) oc.unlockedSkins = [];
  if (oc.unlockedSkins.includes(skinId)) return { ok: false, msg: '已解锁该皮肤' };

  if (!opts?.free) {
    const { payPrice, listPrice, discount } = getSkinUnlockPrice(save, characterId, skinId);
    if (save.gold < payPrice) return { ok: false, msg: '锈币不足' };
    if (payPrice > 0) save.gold -= payPrice;
    oc.unlockedSkins.push(skinId);
    const name = CHARACTER_MAP[characterId]?.name ?? characterId;
    try {
      recordShopOrSkinSpend(getAiLiving(), characterId, {
        gold: payPrice,
        label: `为${name}买下看板娘外覆「${skin.name}」（仅主页展示，与营地无关）`,
        kind: 'skin',
      });
    } catch {
      /* boot 前可忽略 */
    }
    return {
      ok: true,
      msg: `已解锁「${skin.name}」${discount > 0 ? ` · 省 ${listPrice - payPrice} 币` : ''}（看板娘）`,
    };
  }

  oc.unlockedSkins.push(skinId);
  return { ok: true, msg: `已解锁「${skin.name}」（看板娘）` };
}

/** 应用为主页看板娘外观；不改营地穿搭、不通知营地 AI */
export function applyCharacterSkin(
  save: SaveData,
  characterId: string,
  skinId: string,
): { ok: boolean; msg: string } {
  const skin = getCharacterSkin(characterId, skinId);
  if (!skin) return { ok: false, msg: '皮肤不存在' };
  if (!isHubPurchasableSkin(skin)) {
    return { ok: false, msg: '该皮肤不可设为看板娘外观' };
  }
  if (skinId === SHOWER_SKIN_ID) {
    return { ok: false, msg: '蒸汽毛巾仅洗浴时可临时穿着，不能设为日常外覆' };
  }

  const oc = save.ownedCharacters.find((o) => o.characterId === characterId);
  if (!oc) return { ok: false, msg: '未拥有该角色' };
  if (!oc.unlockedSkins?.includes(skinId)) return { ok: false, msg: '请先解锁皮肤' };

  oc.activeSkinId = skinId;
  return { ok: true, msg: `已应用「${skin.name}」（看板娘）` };
}

export function clearCharacterSkin(
  save: SaveData,
  characterId: string,
): { ok: boolean; msg: string } {
  const oc = save.ownedCharacters.find((o) => o.characterId === characterId);
  if (!oc) return { ok: false, msg: '未拥有该角色' };
  if (!oc.activeSkinId) return { ok: false, msg: '当前已是默认皮肤' };

  oc.activeSkinId = null;
  return { ok: true, msg: '已切换为默认皮肤（看板娘）' };
}

export function characterHasAnySkin(characterId: string): boolean {
  return getHubPurchasableSkins(characterId).length > 0 || getCharacterSkins(characterId).length > 0;
}

export function characterHasHubSkins(characterId: string): boolean {
  return getHubPurchasableSkins(characterId).length > 0;
}
