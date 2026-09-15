/**
 * AI 自主换装：只改营地穿搭（campWornSkins / 事件临时层），
 * 绝不改写主页玩家装备 activeSkinId。
 */
import {
  BATHE_TEMP_SKIN_INSTANCE,
  getCharacterSkin,
  isOutfitChangeProcessSkin,
  LIFEWEAR_SKIN_ID,
  SHOWER_SKIN_ID,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import type { SaveData } from '../types';
import { setCampWornSkin, hasCampSkinAsset } from './campOutfit';
import {
  isCharacterBathing,
  isCharacterInActiveCampEvent,
  setEventTempSkin,
} from './campEvents/campEventEffects';
import { isDisciplineActiveFor } from './disciplineSession';
import { recordLifeNote } from './lifeArchive';
import type { AiLivingSave } from './types';

function noteSkinChange(
  living: AiLivingSave,
  characterId: string,
  text: string,
): void {
  try {
    void recordLifeNote(living, text, { kind: 'skin', characterId });
  } catch {
    /* boot 前可忽略 */
  }
}

/**
 * - default：清临时层并回营地默认原皮
 * - 皮肤 id：有资源即可穿（不依赖购买）；事件中优先临时层
 * - pifu03 蒸汽毛巾：仅洗浴中可临时穿
 */
export function applyAiSkinChange(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  wantRaw: string,
): { ok: boolean; msg: string } {
  const want = wantRaw.trim().toLowerCase();
  if (!want) return { ok: false, msg: '空换装指令' };

  if (isDisciplineActiveFor(living, characterId)) {
    return { ok: false, msg: '小黑屋调教中不可换装逃出约束皮' };
  }

  if (want === 'default' || want === 'armor' || want === 'none' || want === 'clear') {
    if (living.eventTempSkins?.[characterId]) {
      delete living.eventTempSkins[characterId];
    }
    // default/armor = 战斗装甲；none/clear = 回营地生活服装基准
    const toArmor = want === 'default' || want === 'armor';
    const r = setCampWornSkin(living, characterId, toArmor ? 'default' : null);
    if (r.ok) {
      noteSkinChange(
        living,
        characterId,
        toArmor
          ? `${CHARACTER_MAP[characterId]?.name ?? characterId}在营地换上了默认战斗装甲`
          : `${CHARACTER_MAP[characterId]?.name ?? characterId}在营地换回了生活服装/基准外观`,
      );
    }
    return r;
  }

  const skin = getCharacterSkin(characterId, want);
  if (!skin) return { ok: false, msg: '皮肤不存在' };
  if (isOutfitChangeProcessSkin(want)) {
    return { ok: false, msg: '换装过程皮不可作为穿戴目标（系统在换装等待期自动播放）' };
  }
  if (!hasCampSkinAsset(characterId, want)) return { ok: false, msg: '无此外覆资源' };

  // 冲澡皮：只允许洗浴时临时外覆
  if (want === SHOWER_SKIN_ID) {
    if (!isCharacterBathing(living, characterId)) {
      return { ok: false, msg: '蒸汽毛巾仅洗浴/冲澡时可穿' };
    }
    if (living.eventTempSkins?.[characterId]?.eventInstanceId !== BATHE_TEMP_SKIN_INSTANCE) {
      if (
        living.eventTempSkins?.[characterId] &&
        living.eventTempSkins[characterId]!.eventInstanceId !== BATHE_TEMP_SKIN_INSTANCE
      ) {
        return { ok: false, msg: '事件临时外覆进行中，暂不换蒸汽毛巾' };
      }
    }
    const ok = setEventTempSkin(save, living, characterId, want, BATHE_TEMP_SKIN_INSTANCE);
    if (ok) {
      noteSkinChange(
        living,
        characterId,
        `${CHARACTER_MAP[characterId]?.name ?? characterId}洗浴中裹上了「${skin.name}」`,
      );
      return { ok: true, msg: `洗浴中穿着「${skin.name}」` };
    }
    return { ok: false, msg: '无法切换蒸汽毛巾' };
  }

  // 事件进行中：写临时层，结束后回落到营地日常穿搭
  if (isCharacterInActiveCampEvent(living, characterId)) {
    const ev =
      (living.activeCampEvents ?? []).find(
        (e) =>
          e.phase === 'active' &&
          e.participants.some(
            (p) => p.characterId === characterId && (p.inCoScreen || p.arrived),
          ),
      ) ?? null;
    if (ev) {
      const ok = setEventTempSkin(save, living, characterId, want, ev.instanceId);
      if (ok) {
        noteSkinChange(
          living,
          characterId,
          `${CHARACTER_MAP[characterId]?.name ?? characterId}事件中临时换上了「${skin.name}」`,
        );
        return { ok: true, msg: `事件中临时穿着「${skin.name}」` };
      }
    }
  }

  // 清临时层后写入营地日常穿搭（不影响主页玩家装备）
  if (living.eventTempSkins?.[characterId]) {
    delete living.eventTempSkins[characterId];
  }
  const r = setCampWornSkin(living, characterId, want);
  if (r.ok) {
    noteSkinChange(
      living,
      characterId,
      `${CHARACTER_MAP[characterId]?.name ?? characterId}在营地换上了「${skin.name}」`,
    );
  }
  return r;
}
