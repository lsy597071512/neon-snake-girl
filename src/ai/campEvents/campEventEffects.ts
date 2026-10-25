/**
 * 营地事件副作用（临时换装等）——仅由 livingService 在 tick 后调用，避免循环依赖
 *
 * 规则：营地穿搭与主页玩家装备分离；事件可临时穿有资源的外覆（不依赖购买）。
 * 事件结束后清除临时外覆 → 回落到 campWornSkins，否则默认原皮。
 */
import {
  ANFU_TEMP_SKIN_INSTANCE,
  BATHE_TEMP_SKIN_INSTANCE,
  BATH_ASSIST_TEMP_SKIN_INSTANCE,
  BATH_CO_SKIN_ID,
  BATH_HELP_SKIN_ID,
  CASUAL_FASHION_SKIN_ID,
  DANCE_IDLE_SKIN_ID,
  DANCE_TEMP_SKIN_INSTANCE,
  DISCIPLINE_TEMP_SKIN_INSTANCE,
  getCharacterSkin,
  getCharacterSkins,
  isAloneBathSkinId,
  isOutfitChangeProcessSkin,
  POOL_PARTY_SKIN_ID,
  resolveAloneBathSkinId,
  SLEEPWEAR_SKIN_ID,
} from '../../data/characterSkins';
import { CHARACTER_MAP } from '../../data/characters';
import type { SaveData } from '../../types';
import { getCampWornSkinId } from '../campOutfit';
import { forceScheduleOutfitChange, scheduleEventTempSkinChange } from '../outfitChangeProcess';
import { pushCampLog, pushMemory } from '../memory';
import { clearAllStaleBathIntimateConsent, isBathingForIntimateConsent } from '../bathIntimateConsent';
import type { AiLivingSave, EventTempSkinState } from '../types';

/**
 * 换装过程/叙事锁进行中（本地最小判定，避免引入 outfitChangeProcess 循环依赖）。
 * 期间禁止瞬间挂/扒蒸汽毛巾皮——立绘播换装过程皮或停在旧衣，等换装协议或「换好了」收尾。
 */
function outfitTransitionHoldActive(living: AiLivingSave, id: string): boolean {
  if (living.pendingOutfitChanges?.[id]?.phase === 'changing') return true;
  const hold = living.outfitNarrativeHolds?.[id];
  return !!hold && Date.now() < hold.untilMs;
}

/** 事件建议自动换上的皮肤（参与者有资源则临时穿） */
export const EVENT_AUTO_SKIN: Record<string, string> = {
  pool_party: POOL_PARTY_SKIN_ID,
  movie_night: SLEEPWEAR_SKIN_ID,
  night_snack: SLEEPWEAR_SKIN_ID,
  /** 娱乐夜：优先都市私服（无资源则事件内不会换上） */
  entertainment_night: CASUAL_FASHION_SKIN_ID,
  sleepwalk_scare: SLEEPWEAR_SKIN_ID,
  /** 舞蹈派对：全体换「舞蹈待机」准备皮（起身舞姿循环） */
  dance_party: DANCE_IDLE_SKIN_ID,
};

function ensureTempMap(living: AiLivingSave): Record<string, EventTempSkinState> {
  if (!living.eventTempSkins) living.eventTempSkins = {};
  return living.eventTempSkins;
}

/** 角色是否正在参与进行中的营地事件 */
export function isCharacterInActiveCampEvent(
  living: AiLivingSave,
  characterId: string,
): boolean {
  return (living.activeCampEvents ?? []).some(
    (ev) =>
      ev.phase === 'active' &&
      ev.participants.some(
        (p) => p.characterId === characterId && (p.inCoScreen || p.arrived),
      ),
  );
}

/**
 * 事件临时换装（不解锁、不改主页 activeSkinId）。
 * 若营地日常已穿同一皮肤，无需再盖临时层。
 */
export function setEventTempSkin(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  skinId: string,
  eventInstanceId: string,
): boolean {
  void save;
  if (isOutfitChangeProcessSkin(skinId)) return false;
  const skin = getCharacterSkin(characterId, skinId);
  if (!skin) return false;

  const campWorn = getCampWornSkinId(living, characterId);
  if (campWorn === skinId) {
    return true;
  }

  const map = ensureTempMap(living);
  if (!map[characterId]) {
    map[characterId] = {
      skinId,
      restoreSkinId: campWorn,
      eventInstanceId,
    };
  } else {
    map[characterId] = {
      ...map[characterId]!,
      skinId,
      eventInstanceId,
    };
  }
  return true;
}

/**
 * 事件结束：清掉该实例留下的临时外覆。
 * 默认同时取消该实例排队中的临时换装，并让角色走一次「换回日常」的换装过程；
 * 会话类事件（舞蹈/安抚/浴室）自己组织散场，可传 dressBack:false。
 */
export function clearEventTempSkinsForInstance(
  living: AiLivingSave,
  eventInstanceId: string,
  opts?: { dressBack?: boolean },
): string[] {
  const map = ensureTempMap(living);
  const cleared: string[] = [];
  for (const [cid, st] of Object.entries(map)) {
    if (st.eventInstanceId === eventInstanceId) {
      delete map[cid];
      cleared.push(cid);
    }
  }
  const pending = living.pendingOutfitChanges ?? {};
  for (const [cid, p] of Object.entries(pending)) {
    if (p.applyAsTempInstanceId === eventInstanceId) {
      delete pending[cid];
      if (!cleared.includes(cid)) cleared.push(cid);
    }
  }
  if (opts?.dressBack !== false) {
    for (const cid of cleared) {
      forceScheduleOutfitChange(living, cid, getCampWornSkinId(living, cid), 4_200);
    }
  }
  return cleared;
}

/**
 * 对进行中、带自动皮肤的事件：赴约角色临时换上建议皮肤。
 * 不永久解锁；不读主页玩家装备。
 */
export function applyEventTempSkins(save: SaveData, living: AiLivingSave): void {
  for (const ev of living.activeCampEvents ?? []) {
    if (ev.phase !== 'active') continue;
    const autoSkinId = EVENT_AUTO_SKIN[ev.defId];
    if (!autoSkinId) continue;
    if (ev.meta?.eventSkinApplied === '1') continue;

    const joiners = ev.participants.filter((p) => p.inCoScreen || p.arrived);
    const switched: string[] = [];
    const keptCamp: string[] = [];
    const noAsset: string[] = [];

    for (const p of joiners) {
      // 事件临时皮由活动会话唯一持有，营地事件不得覆盖。
      if (living.eventTempSkins?.[p.characterId]?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE) {
        continue;
      }
      if (living.eventTempSkins?.[p.characterId]?.eventInstanceId === ANFU_TEMP_SKIN_INSTANCE) {
        continue;
      }
      const skins = getCharacterSkins(p.characterId);
      const hasAsset = skins.some((s) => s.id === autoSkinId);
      if (!hasAsset) {
        noAsset.push(p.characterId);
        pushMemory(living, p.characterId, {
          kind: 'event',
          summary: `营地事件：没有「${autoSkinId}」专属外覆资源，仍参与活动`,
          importance: 4,
        });
        continue;
      }

      const already = getCampWornSkinId(living, p.characterId) === autoSkinId;
      if (already) {
        keptCamp.push(p.characterId);
        pushMemory(living, p.characterId, {
          kind: 'event',
          summary: `营地事件：已穿着「${getCharacterSkin(p.characterId, autoSkinId)?.name ?? autoSkinId}」，继续保持`,
          importance: 4,
        });
        continue;
      }

      const q = scheduleEventTempSkinChange(living, p.characterId, autoSkinId, ev.instanceId);
      if (q.queued) {
        switched.push(p.characterId);
        const name = getCharacterSkin(p.characterId, autoSkinId)?.name ?? autoSkinId;
        pushMemory(living, p.characterId, {
          kind: 'event',
          summary: `营地事件：开始换上「${name}」（先换衣再显形，结束后换回营地日常/默认原皮）`,
          importance: 5,
        });
      } else if (
        living.eventTempSkins?.[p.characterId]?.skinId === autoSkinId ||
        living.pendingOutfitChanges?.[p.characterId]?.targetSkinId === autoSkinId
      ) {
        switched.push(p.characterId);
      }
    }

    ev.meta = {
      ...(ev.meta ?? {}),
      eventSkinApplied: '1',
      eventSkinId: autoSkinId,
      eventSkinIds: switched.join(','),
      eventSkinKeptOwned: keptCamp.join(','),
      eventSkinNoAsset: noAsset.join(','),
      // 兼容旧泳池派对 UI/结算字段
      ...(ev.defId === 'pool_party'
        ? {
            swimsuitApplied: '1',
            swimsuitIds: [...switched, ...keptCamp].join(','),
            swimsuitNoAsset: noAsset.join(','),
          }
        : {}),
    };

    const skinLabel =
      autoSkinId === POOL_PARTY_SKIN_ID
        ? '泳池派对泳装'
        : autoSkinId === SLEEPWEAR_SKIN_ID
          ? '星夜睡衣'
          : autoSkinId === CASUAL_FASHION_SKIN_ID
            ? '都市私服'
            : autoSkinId;

    if (switched.length) {
      pushCampLog(living, {
        text: `【${ev.defId === 'pool_party' ? '泳池派对' : '营地事件'}】${switched
          .map((id) => CHARACTER_MAP[id]?.name ?? id)
          .join('、')}临时换上了${skinLabel}外覆。`,
        source: 'system',
        characterIds: switched,
      });
    }
    if (noAsset.length && ev.defId === 'pool_party') {
      pushCampLog(living, {
        text: `【泳池派对】${noAsset.map((id) => CHARACTER_MAP[id]?.name ?? id).join('、')}无专属泳装资源，仍下水玩。`,
        source: 'system',
        characterIds: noAsset,
      });
    }
  }
}

/** @deprecated 使用 applyEventTempSkins */
export function applyPoolPartySwimsuits(save: SaveData, living: AiLivingSave): void {
  applyEventTempSkins(save, living);
}

/** 角色此刻是否在洗浴/冲澡（活动、浴室、对话场景快照） */
export function isCharacterBathing(living: AiLivingSave, characterId: string): boolean {
  return isBathingForIntimateConsent(living, characterId);
}

/**
 * 独自洗浴临时外覆：优先「独自泡澡」(pifu09)，无资源回退「蒸汽毛巾」(pifu03)。
 * 浴室泡澡/冲澡时刻挂上；出浴室清除。不依赖购买；不改主页玩家装备。
 * 帮洗/共浴 (bath_assist) 进行中不覆盖。
 */
export function applyBatheShowerSkins(save: SaveData, living: AiLivingSave): void {
  const map = ensureTempMap(living);
  const ids = new Set<string>([
    ...save.ownedCharacters.map((o) => o.characterId),
    ...Object.keys(living.campWornSkins ?? {}),
    ...Object.keys(map),
  ]);

  for (const id of ids) {
    const current = map[id];
    // 事件皮由会话管理，洗浴同步不得换上或清除它。
    if (current?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE) continue;
    // 帮洗/共浴(pifu07/pifu08)由 bathAssistSession 管理，不得被独自泡澡覆盖或清除。
    // 注意：BATH_ASSIST_TEMP_SKIN_INSTANCE 与 BATHE_TEMP_SKIN_INSTANCE 同值，
    // 必须按"皮肤 id"区分，否则独自浴巾也会被一起跳过（离浴室后浴巾不脱）。
    if (current?.skinId === BATH_HELP_SKIN_ID || current?.skinId === BATH_CO_SKIN_ID) {
      continue;
    }
    // 舞蹈事件由 danceSession 管理，不得被独自泡澡覆盖或清除。
    if (current?.eventInstanceId === DANCE_TEMP_SKIN_INSTANCE) continue;
    // 安抚事件由 anfuSession 管理，不得被独自泡澡覆盖或清除。
    if (current?.eventInstanceId === ANFU_TEMP_SKIN_INSTANCE) continue;
    const aloneId = resolveAloneBathSkinId(id);
    if (!aloneId) continue;

    // 换装进行中 / 叙事换装锁：不瞬间挂洗浴皮，也不扒掉（等协议收尾）
    if (outfitTransitionHoldActive(living, id)) continue;

    const bathing = isCharacterBathing(living, id);
    const temp = map[id];
    // 独自泡澡临时层判定必须看"皮肤 id"：BATH_ASSIST_TEMP_SKIN_INSTANCE 与
    // BATHE_TEMP_SKIN_INSTANCE 是同一个值，只看 instance 会把帮洗/共浴皮也当成独自泡澡皮。
    const isBatheTemp =
      !!temp && isAloneBathSkinId(temp.skinId) && temp.eventInstanceId === BATHE_TEMP_SKIN_INSTANCE;

    // 营地日常误穿独自洗浴皮：非洗浴时脱下
    const worn = getCampWornSkinId(living, id);
    if (isAloneBathSkinId(worn) && !bathing) {
      if (!living.campWornSkins) living.campWornSkins = {};
      delete living.campWornSkins[id];
    }

    if (bathing) {
      // 其他事件临时皮优先
      if (temp && !isBatheTemp) continue;
      // 已是目标独自皮则不动（含从 pifu03 升到 pifu09 时仍会重挂）
      if (temp?.skinId === aloneId && isBatheTemp) continue;
      // 先换衣再显形：浴室外/浴室里都要有"脱/裹"的过程，不瞬间挂浴巾
      scheduleEventTempSkinChange(living, id, aloneId, BATHE_TEMP_SKIN_INSTANCE, 2_800);
      continue;
    }

    if (isBatheTemp) {
      delete map[id];
      forceScheduleOutfitChange(living, id, getCampWornSkinId(living, id), 3_600);
    }
  }

  clearAllStaleBathIntimateConsent(living);
}
