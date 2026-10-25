/**
 * 营地穿搭（与主页玩家装备完全分离）
 *
 * - 营地基准默认：生活服装 pifu00（有资源时）
 * - 默认战斗装甲：campWornSkins 存 CAMP_ARMOR_MARKER（'default'），仅主动/执勤/军械/室外干活
 * - 不读、不写 ownedCharacters.activeSkinId
 * - 换装协议 changing 期间：玩家所见优先切到 huanzhuang 过程皮
 */
import {
  CAMP_ARMOR_MARKER,
  DISCIPLINE_TEMP_SKIN_INSTANCE,
  getCharacterSkin,
  isCampArmorMarker,
  isOutfitChangeProcessSkin,
  LIFEWEAR_SKIN_ID,
  OUTFIT_CHANGE_SKIN_ID,
} from '../data/characterSkins';
import type { AiLivingSave } from './types';

export function ensureCampWornMap(living: AiLivingSave): Record<string, string> {
  if (!living.campWornSkins) living.campWornSkins = {};
  return living.campWornSkins;
}

export function hasLifewearAsset(characterId: string): boolean {
  return !!getCharacterSkin(characterId, LIFEWEAR_SKIN_ID)?.portraitLive;
}

/** 营地基准皮：生活服装（无资源则 null=装甲） */
export function getCampBaselineSkinId(characterId: string): string | null {
  return hasLifewearAsset(characterId) ? LIFEWEAR_SKIN_ID : null;
}

/**
 * 逻辑穿着（账本生效值）：
 * 事件临时 > 明确装甲标记(null) > 日常 campWorn > 生活服装基准 > 装甲
 */
export function getCampLogicalSkinId(
  living: AiLivingSave,
  characterId: string,
): string | null {
  const temp = living.eventTempSkins?.[characterId]?.skinId;
  if (temp) return temp;

  const worn = living.campWornSkins?.[characterId];
  if (isCampArmorMarker(worn)) return null;
  if (worn && !isOutfitChangeProcessSkin(worn)) return worn;

  return getCampBaselineSkinId(characterId);
}

/** 营地最终显示皮：事件临时 > 换装过程皮 > 逻辑穿着 */
export function getCampDisplaySkinId(
  living: AiLivingSave,
  characterId: string,
): string | null {
  const temp = living.eventTempSkins?.[characterId];
  if (temp?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE && temp.skinId) {
    return temp.skinId;
  }

  // 安抚换装中：临时层挂的 huanzhuang 不参与 getCampLogicalSkinId 的 temp 直返，
  // 此处特判走换装过程皮（含遮布/衣柜 AI 同步语义）
  const anfu = living.anfuSession;
  if (
    anfu?.active === true &&
    anfu.characterId === characterId &&
    anfu.phase === 'dressing' &&
    getCharacterSkin(characterId, OUTFIT_CHANGE_SKIN_ID)?.portraitLive
  ) {
    return OUTFIT_CHANGE_SKIN_ID;
  }

  // 舞蹈换舞装中：与安抚 dressing 同拍显示过程皮
  const dance = living.danceSession;
  if (
    dance?.active === true &&
    dance.characterId === characterId &&
    dance.phase === 'dressing' &&
    getCharacterSkin(characterId, OUTFIT_CHANGE_SKIN_ID)?.portraitLive
  ) {
    return OUTFIT_CHANGE_SKIN_ID;
  }

  const pending = living.pendingOutfitChanges?.[characterId];
  if (
    pending?.phase === 'changing' &&
    getCharacterSkin(characterId, OUTFIT_CHANGE_SKIN_ID)?.portraitLive
  ) {
    return OUTFIT_CHANGE_SKIN_ID;
  }

  return getCampLogicalSkinId(living, characterId);
}

/**
 * 原始营地日常账本（不含事件临时、不含生活服装自动回落）。
 * 装甲标记会原样返回 'default'。
 */
export function getCampWornSkinId(
  living: AiLivingSave,
  characterId: string,
): string | null {
  return living.campWornSkins?.[characterId] ?? null;
}

export function setCampWornSkin(
  living: AiLivingSave,
  characterId: string,
  skinId: string | null,
): { ok: boolean; msg: string } {
  const map = ensureCampWornMap(living);

  // null / 空 → 营地基准生活服装（有资源时）；无资源则清空=装甲
  if (!skinId) {
    const baseline = getCampBaselineSkinId(characterId);
    if (baseline) {
      map[characterId] = baseline;
      return { ok: true, msg: `已换回「${getCharacterSkin(characterId, baseline)?.name ?? baseline}」` };
    }
    delete map[characterId];
    return { ok: true, msg: '已换回默认外观' };
  }

  // 明确战斗装甲
  if (isCampArmorMarker(skinId)) {
    map[characterId] = CAMP_ARMOR_MARKER;
    return { ok: true, msg: '已换上默认战斗装甲' };
  }

  if (isOutfitChangeProcessSkin(skinId)) {
    return { ok: false, msg: '换装过程皮不可写入日常穿搭' };
  }
  if (!getCharacterSkin(characterId, skinId)) {
    return { ok: false, msg: '皮肤不存在' };
  }
  map[characterId] = skinId;
  return { ok: true, msg: `营地穿着「${getCharacterSkin(characterId, skinId)?.name ?? skinId}」` };
}

export function clearCampWornSkin(living: AiLivingSave, characterId: string): void {
  setCampWornSkin(living, characterId, null);
}

/** 是否可作为换装目标（过程皮不可；装甲用 default） */
export function hasCampSkinAsset(characterId: string, skinId: string): boolean {
  if (isOutfitChangeProcessSkin(skinId)) return false;
  // 卸甲皮：资源存在即可作为换装目标（穿着门控由 aiSkinChange.canWearXiejiaSkin 把关）
  if (isCampArmorMarker(skinId)) return true;
  return !!getCharacterSkin(characterId, skinId);
}
