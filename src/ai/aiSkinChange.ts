/**
 * AI 自主换装：只改营地穿搭（campWornSkins / 事件临时层），
 * 绝不改写主页玩家装备 activeSkinId。
 */
import {
  BATHE_TEMP_SKIN_INSTANCE,
  BATH_CO_SKIN_ID,
  BATH_HELP_SKIN_ID,
  DANCE_IDLE_SKIN_ID,
  DANDU_SKIN_ID,
  GONGWU_SKIN_ID,
  getCharacterSkin,
  isAloneBathSkinId,
  isOutfitChangeProcessSkin,
  LIFEWEAR_SKIN_ID,
  XIEJIA_SKIN_ID,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import type { SaveData } from '../types';
import { setCampWornSkin, hasCampSkinAsset } from './campOutfit';
import {
  isCharacterBathing,
  isCharacterInActiveCampEvent,
  setEventTempSkin,
} from './campEvents/campEventEffects';
import { isBathAssistActiveFor } from './bathAssistSession';
import { isDanceActiveFor } from './danceSession';
import { isDisciplineActiveFor } from './disciplineSession';
import { recordLifeNote } from './lifeArchive';
import { resolvePresence } from './livingState';
import { canWearXiejiaSkin } from './xiejiaSkin';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import type { AiLivingSave } from './types';

/** 只有「执勤场地 + 执勤活动」才允许换回默认战斗装甲 */
function isDutyContextForArmor(living: AiLivingSave, characterId: string): boolean {
  const p = resolvePresence(characterId, living);
  const kind = CAMP_ROOM_MAP[p.roomId]?.kind;
  const dutyPlace =
    p.roomId === 'room_1f_armory' ||
    p.roomId === 'room_1f_tower' ||
    kind === 'armory' ||
    kind === 'tower' ||
    kind === 'mechanical';
  const dutyAct = p.activity === 'patrol' || p.activity === 'guard' || p.activity === 'maintain';
  return dutyPlace && dutyAct;
}

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
 * - pifu09 独自泡澡 / pifu03 蒸汽毛巾：仅洗浴中可临时穿（进浴室系统也会自动挂）
 * - pifu07/08：禁止 skin_change，仅浴室互动会话
 * - pifu12 舞蹈待机 / pifu11 独舞 / pifu10 共舞：禁止 skin_change，仅舞蹈会话
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
    return { ok: false, msg: '当前事件中不可换装' };
  }
  if (isBathAssistActiveFor(living, characterId)) {
    return { ok: false, msg: '浴室互动中不可换装逃出帮洗/共浴皮' };
  }
  if (isDanceActiveFor(living, characterId)) {
    return { ok: false, msg: '舞蹈事件中不可换装逃出舞蹈皮' };
  }
  const anfuSession = living.anfuSession;
  if (anfuSession?.active && anfuSession.characterId === characterId) {
    return { ok: false, msg: '安抚室事件中不可换装' };
  }

  if (want === 'default' || want === 'armor' || want === 'none' || want === 'clear') {
    if (living.eventTempSkins?.[characterId]) {
      delete living.eventTempSkins[characterId];
    }
    // default/armor = 战斗装甲；none/clear = 回营地生活服装基准
    // 营地日常（非执勤）不允许把立绘切成战斗装甲：自动降级为生活服装。
    const wantsArmor = want === 'default' || want === 'armor';
    const toArmor = wantsArmor && isDutyContextForArmor(living, characterId);
    const r = setCampWornSkin(living, characterId, toArmor ? 'default' : null);
    if (r.ok && wantsArmor && !toArmor) {
      return { ok: true, msg: '非执勤场合不换战斗装甲，已按营地日常穿生活服装' };
    }
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
  // 卸甲皮：玩家请求 + 角色同意的轻装坦诚态，位置/事件门控在此把关
  if (skin.id === XIEJIA_SKIN_ID) {
    const gate = canWearXiejiaSkin(living, characterId);
    if (!gate.ok) {
      return { ok: false, msg: `卸甲不可穿：${gate.msg}` };
    }
  }
  if (!hasCampSkinAsset(characterId, want)) return { ok: false, msg: '无此外覆资源' };

  // 独自泡澡 / 蒸汽毛巾：只允许洗浴时临时外覆
  if (isAloneBathSkinId(want)) {
    if (!isCharacterBathing(living, characterId)) {
      return { ok: false, msg: '独自泡澡/蒸汽毛巾仅浴室洗浴时可穿' };
    }
    if (living.eventTempSkins?.[characterId]?.eventInstanceId !== BATHE_TEMP_SKIN_INSTANCE) {
      if (
        living.eventTempSkins?.[characterId] &&
        living.eventTempSkins[characterId]!.eventInstanceId !== BATHE_TEMP_SKIN_INSTANCE
      ) {
        return { ok: false, msg: '事件临时外覆进行中，暂不换独自洗浴皮' };
      }
    }
    const ok = setEventTempSkin(save, living, characterId, want, BATHE_TEMP_SKIN_INSTANCE);
    if (ok) {
      noteSkinChange(
        living,
        characterId,
        `${CHARACTER_MAP[characterId]?.name ?? characterId}洗浴中换上了「${skin.name}」`,
      );
      return { ok: true, msg: `洗浴中穿着「${skin.name}」` };
    }
    return { ok: false, msg: '无法切换独自洗浴皮' };
  }

  if (want === BATH_HELP_SKIN_ID || want === BATH_CO_SKIN_ID) {
    return { ok: false, msg: '帮洗/共浴皮仅由浴室互动会话切换，不可 skin_change' };
  }

  if (
    want === DANCE_IDLE_SKIN_ID ||
    want === DANDU_SKIN_ID ||
    want === GONGWU_SKIN_ID
  ) {
    return { ok: false, msg: '舞蹈待机/独舞/共舞皮仅由舞蹈事件会话切换，不可 skin_change' };
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
