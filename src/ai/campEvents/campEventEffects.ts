/**
 * 营地事件副作用（临时换装等）——仅由 livingService 在 tick 后调用，避免循环依赖
 *
 * 规则：营地穿搭与主页玩家装备分离；事件可临时穿有资源的外覆（不依赖购买）。
 * 事件结束后清除临时外覆 → 回落到 campWornSkins，否则默认原皮。
 */
import {
  BATHE_TEMP_SKIN_INSTANCE,
  CASUAL_FASHION_SKIN_ID,
  DISCIPLINE_TEMP_SKIN_INSTANCE,
  getCharacterSkin,
  getCharacterSkins,
  isOutfitChangeProcessSkin,
  POOL_PARTY_SKIN_ID,
  SHOWER_SKIN_ID,
  SLEEPWEAR_SKIN_ID,
} from '../../data/characterSkins';
import { CHARACTER_MAP } from '../../data/characters';
import type { SaveData } from '../../types';
import { getCampWornSkinId } from '../campOutfit';
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

/** 事件结束：清掉该实例留下的临时外覆 */
export function clearEventTempSkinsForInstance(
  living: AiLivingSave,
  eventInstanceId: string,
): string[] {
  const map = ensureTempMap(living);
  const cleared: string[] = [];
  for (const [cid, st] of Object.entries(map)) {
    if (st.eventInstanceId === eventInstanceId) {
      delete map[cid];
      cleared.push(cid);
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
      // 小黑屋的约束皮是活动会话唯一持有的临时层，营地事件不得覆盖。
      if (living.eventTempSkins?.[p.characterId]?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE) {
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

      if (setEventTempSkin(save, living, p.characterId, autoSkinId, ev.instanceId)) {
        switched.push(p.characterId);
        const name = getCharacterSkin(p.characterId, autoSkinId)?.name ?? autoSkinId;
        pushMemory(living, p.characterId, {
          kind: 'event',
          summary: `营地事件：临时换上「${name}」（结束后换回营地日常/默认原皮）`,
          importance: 5,
        });
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
 * 「蒸汽毛巾」(pifu03)：洗浴时刻挂临时外覆；出浴室清除。
 * 不依赖是否购买；不改主页玩家装备。营地事件临时皮优先。
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
    // 约束皮由小黑屋会话管理，洗浴同步不得换上或清除它。
    if (current?.eventInstanceId === DISCIPLINE_TEMP_SKIN_INSTANCE) continue;
    const hasAsset = getCharacterSkins(id).some((s) => s.id === SHOWER_SKIN_ID);
    if (!hasAsset) continue;

    // 换装进行中 / 叙事换装锁：不瞬间挂毛巾皮，也不扒掉（等协议收尾）
    if (outfitTransitionHoldActive(living, id)) continue;

    const bathing = isCharacterBathing(living, id);
    const temp = map[id];
    const isBatheTemp = temp?.eventInstanceId === BATHE_TEMP_SKIN_INSTANCE;

    // 营地日常误穿冲澡皮：非洗浴时脱下
    if (getCampWornSkinId(living, id) === SHOWER_SKIN_ID && !bathing) {
      if (!living.campWornSkins) living.campWornSkins = {};
      delete living.campWornSkins[id];
    }

    if (bathing) {
      // 其他事件临时皮优先
      if (temp && !isBatheTemp) continue;
      if (temp?.skinId === SHOWER_SKIN_ID && isBatheTemp) continue;
      setEventTempSkin(save, living, id, SHOWER_SKIN_ID, BATHE_TEMP_SKIN_INSTANCE);
      continue;
    }

    if (isBatheTemp) {
      delete map[id];
    }
  }

  clearAllStaleBathIntimateConsent(living);
}
