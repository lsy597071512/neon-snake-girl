/**
 * Phase D：情绪选装——按状态/时段/意图自动换营地穿搭。
 *
 * 规则要点：
 * - 只写 aiLiving.campWornSkins，绝不改主页玩家 activeSkinId
 * - 不依赖皮肤是否购买/是否在主页应用；有资源即可穿
 * - 事件临时外覆存在时跳过
 * - 有冷却，避免每分钟乱换
 * - 出征：战斗层强制原皮；不清玩家主页装备，只清事件临时层
 */
import {
  CASUAL_FASHION_SKIN_ID,
  getCharacterSkin,
  isAloneBathSkinId,
  LIFEWEAR_SKIN_ID,
  POOL_PARTY_SKIN_ID,
  SLEEPWEAR_SKIN_ID,
  SPECIAL_DARE_SKIN_ID,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_ROOM_MAP, getCharacterSleepRoom } from '../data/campLayout';
import type { SaveData } from '../types';
import {
  getCampLogicalSkinId,
  getCampWornSkinId,
  hasCampSkinAsset,
  setCampWornSkin,
} from './campOutfit';
import { isCharacterInActiveCampEvent } from './campEvents/campEventEffects';
import { forceScheduleOutfitChange, schedulePresenceOutfitChange, shouldHoldAutoOutfit } from './outfitChangeProcess';
import { getAgenda, isAgendaActive } from './characterAgenda';
import { computeDesires } from './characterDesires';
import { personaDayMode } from './characterPersona';
import { getMemoryLines, pushMemory } from './memory';
import { getAffinity } from './relationship';
import { isBathAssistActiveFor } from './bathAssistSession';
import { isDisciplineActiveFor } from './disciplineSession';
import type { AiLivingSave } from './types';
import { getHour } from './worldClock';

/** 同角色两次情绪换装的最短游戏分钟间隔（调情高档可略缩短） */
const OUTFIT_COOLDOWN_GAME_MIN = 75;
const OUTFIT_COOLDOWN_FLIRT_GAME_MIN = 40;

/** 调情 / 撩拨 / 展示身材 等亲近娱乐意图线索 */
const SPECIAL_FLIRT_RE =
  /(调情|撩拨|撩|暧昧|贴近|展示身材|特殊服装|pifu05|想被指挥官|想跟指挥官玩|想捉弄指挥官|逗指挥官|勾人)/;

type OutfitWant = {
  /** null = 默认战斗装甲；生活服装请填 LIFEWEAR_SKIN_ID */
  skinId: string | null;
  reason: string;
  /** 调情高档换装：使用更短冷却 */
  flirtHot?: boolean;
};

type SpecialDrive = {
  tier: 'hot' | 'warm' | 'base';
  chance: number;
  reason: string;
};

function evaluateSpecialOutfitDrive(opts: {
  living: AiLivingSave;
  characterId: string;
  night: boolean;
  dayMode: string;
  goal: string;
  room: string;
  activity: string;
  social: number;
  agendaBehavior: string;
  agendaReason: string;
}): SpecialDrive | null {
  const {
    living,
    characterId,
    night,
    dayMode,
    goal,
    room,
    activity,
    social,
    agendaBehavior,
    agendaReason,
  } = opts;
  const aff = getAffinity(living, characterId);
  const memBlob = getMemoryLines(living, characterId, 8).join(' ');
  const textBlob = `${goal} ${agendaBehavior} ${agendaReason} ${memBlob}`;
  const flirtCue = SPECIAL_FLIRT_RE.test(textBlob);
  const intimatePlace =
    room === 'room_2f_yule' ||
    room === 'room_2f_lounge' ||
    room === 'room_2f_hall_west' ||
    room.startsWith('room_2f_bed') ||
    room === 'room_yard' ||
    activity === 'play' ||
    activity === 'talking' ||
    activity === 'rest';
  const moodOpen =
    dayMode === 'playful' ||
    dayMode === 'restless' ||
    hasStatus(living, characterId, 'joy_state');

  // HOT：主动性 / 娱乐性 / 挑逗 / 情趣 / 调情指挥官 —— 高概率
  if (
    flirtCue ||
    (aff >= 48 && moodOpen && social >= 48 && intimatePlace) ||
    (aff >= 55 && moodOpen && social >= 55) ||
    (aff >= 62 && social >= 42 && (intimatePlace || moodOpen))
  ) {
    // 深夜仍允许调情档（不当休息强制睡衣时才会走到这里）
    if (night && !flirtCue && !intimatePlace && aff < 60) return null;
    const chance = flirtCue ? 0.88 : aff >= 65 ? 0.78 : 0.68;
    return {
      tier: 'hot',
      chance,
      reason: flirtCue
        ? '想调情/挑逗/展示情趣造型给指挥官，换上特殊服装01'
        : '好感升温+娱乐/亲近欲，想用特殊服装01主动撩指挥官',
    };
  }

  // WARM / BASE：白天偶尔见到
  if (night) return null;
  if (dayMode === 'playful' || dayMode === 'restless' || social >= 55 || moodOpen) {
    if (dayMode === 'playful' && social >= 60) {
      return { tier: 'warm', chance: 0.16, reason: '玩闹心情，偶尔想穿特殊服装01晃一晃' };
    }
    return { tier: 'base', chance: 0.08, reason: '白天闲逛，偶尔想起特殊服装01' };
  }
  return null;
}

function ensureCooldownMap(living: AiLivingSave): Record<string, number> {
  if (!living.emotionOutfitAt) living.emotionOutfitAt = {};
  return living.emotionOutfitAt;
}

function currentCampSkin(living: AiLivingSave, characterId: string): string | null {
  return getCampLogicalSkinId(living, characterId);
}

function hash01(characterId: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < characterId.length; i++) h = (h * 31 + characterId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function hasStatus(living: AiLivingSave, characterId: string, tag: string): boolean {
  return (living.characterStatus[characterId] ?? []).includes(tag as never);
}

/**
 * 根据情绪/时段/议程建议穿着（仅建议，不校验冷却）。
 * 返回 null 表示「保持现状」。
 */
export function suggestEmotionOutfit(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): OutfitWant | null {
  void save;
  if (living.eventTempSkins?.[characterId]) return null;
  // 事件进行中留给事件自动皮 / AI skin_change，避免抢戏
  if (isCharacterInActiveCampEvent(living, characterId)) return null;

  const hour = getHour(living);
  const dayMode = personaDayMode(living, characterId);
  const agenda = getAgenda(living, characterId);
  const desires = computeDesires(living, characterId);
  const night = hour >= 21 || hour < 6;
  const lateNight = hour >= 22 || hour < 5;
  const hasSleep = hasCampSkinAsset(characterId, SLEEPWEAR_SKIN_ID);
  const hasPool = hasCampSkinAsset(characterId, POOL_PARTY_SKIN_ID);
  const hasCasual = hasCampSkinAsset(characterId, CASUAL_FASHION_SKIN_ID);
  const hasSpecial = hasCampSkinAsset(characterId, SPECIAL_DARE_SKIN_ID);
  const hasLife = hasCampSkinAsset(characterId, LIFEWEAR_SKIN_ID);
  const cur = currentCampSkin(living, characterId);
  const salt = living.gameMinutes + living.dayIndex * 17;
  const toBaseline = (): OutfitWant => ({
    skinId: hasLife ? LIFEWEAR_SKIN_ID : null,
    reason: hasLife ? '换回生活服装（营地日常基准）' : '换回默认外观',
  });

  const goal = agenda && isAgendaActive(agenda) ? agenda.goal : '';
  const room = agenda && isAgendaActive(agenda) ? agenda.targetRoomId : '';
  const activity = agenda && isAgendaActive(agenda) ? agenda.activity : '';

  // 0) 独自洗浴皮绝不作为营地日常；误穿则回生活服装
  if (isAloneBathSkinId(cur)) {
    return { ...toBaseline(), reason: '独自泡澡/蒸汽毛巾不可日常穿着，换回生活服装' };
  }
  // 0a) 帮洗/共浴皮仅会话临时；误穿则回生活服装
  if (cur === 'pifu07' || cur === 'pifu08') {
    return { ...toBaseline(), reason: '帮洗/共浴皮不可日常穿着，换回生活服装' };
  }

  // 0b) 特殊服装01：执勤时脱下 → 装甲
  if (cur === SPECIAL_DARE_SKIN_ID) {
    const dutyRoom0 =
      room === 'room_1f_armory' ||
      room === 'room_1f_tower' ||
      CAMP_ROOM_MAP[room]?.kind === 'mechanical';
    if (dutyRoom0 && (activity === 'patrol' || activity === 'guard' || activity === 'maintain')) {
      return { skinId: null, reason: '特殊服装01不宜执勤，换上默认战斗装甲' };
    }
  }

  // 1) 执勤 / 武器库 / 塔 / 守门 → 默认甲。
  // 必须要「执勤场地 + 执勤活动」同时成立；大厅里随口说一句「修枪/守卫」
  // 不再套装甲，否则营地里装甲占比会失控（用户反馈：说话时还穿着一身战斗甲）。
  const dutyRoom =
    room === 'room_1f_armory' ||
    room === 'room_1f_tower' ||
    CAMP_ROOM_MAP[room]?.kind === 'mechanical';
  const dutyAct = activity === 'patrol' || activity === 'guard' || activity === 'maintain';
  if (dutyRoom && dutyAct) {
    if (cur) return { skinId: null, reason: '执勤/军械/武装相关，换上默认战斗装甲' };
    return null;
  }
  if (dutyAct && /patrol|guard|armory|duty|tower/.test(goal) && cur) {
    return { skinId: null, reason: '执勤/军械/武装相关，换上默认战斗装甲' };
  }

  // 洗浴中：独自泡澡由 applyBatheShowerSkins 临时挂载，情绪选装勿抢
  if (activity === 'bathe' || room === 'room_1f_bath' || goal === 'bathe') {
    return null;
  }

  // 2) 泳池意图或强泳欲 → 泳装
  if (
    hasPool &&
    (room === 'room_1f_pool' ||
      /pool|swim|浴后|洗后/.test(goal) ||
      desires.scores.swim >= 55)
  ) {
    if (cur !== POOL_PARTY_SKIN_ID) {
      return { skinId: POOL_PARTY_SKIN_ID, reason: '想下水/玩水，换上泳池派对外覆' };
    }
    return null;
  }

  // 3) 夜间回房睡觉 / 正在睡眠 → 睡衣（大厅发呆/维护不得默认睡衣）
  const sleepRoomId = getCharacterSleepRoom(characterId).id;
  const inSleepRoom = room === sleepRoomId || /sleep|nap|回房睡|睡觉/.test(goal);
  const wantSleepwear =
    activity === 'sleeping' ||
    /^(?:sleep|nap)/.test(goal) ||
    /睡觉|入睡|回房睡/.test(goal) ||
    (lateNight && (activity === 'rest' || dayMode === 'withdrawn') && inSleepRoom);

  if (hasSleep && wantSleepwear) {
    if (cur !== SLEEPWEAR_SKIN_ID) {
      return { skinId: SLEEPWEAR_SKIN_ID, reason: '回房休息/睡觉，换上星夜睡衣' };
    }
    return null;
  }

  // 3b) 大厅/公共区仍穿睡衣 → 白天或清醒活动时换回生活服装（营地默认）
  if (cur === SLEEPWEAR_SKIN_ID) {
    const publicHall =
      room === 'room_1f_hall1' ||
      room === 'room_1f_hall2' ||
      room === 'room_2f_lounge' ||
      room === 'room_2f_atrium' ||
      room === 'room_2f_yule' ||
      /hall|lounge|atrium|yule|shop|yard/.test(goal);
    const awakeBusy =
      activity === 'busy' ||
      activity === 'talking' ||
      activity === 'play' ||
      activity === 'idle' ||
      activity === 'rest' ||
      dayMode === 'dutiful' ||
      dayMode === 'restless' ||
      dayMode === 'playful' ||
      dayMode === 'idle' ||
      /maintain|work|hall|busy/.test(goal);
    if ((hour >= 7 && hour < 22 && awakeBusy) || publicHall) {
      return { ...toBaseline(), reason: '营地清醒活动，换回生活服装（非睡衣）' };
    }
  }

  // 4) 白天还穿睡衣但已开工/社交 → 回生活服装（非装甲，除非上面执勤分支）
  if (cur === SLEEPWEAR_SKIN_ID && hour >= 8 && hour < 20) {
    if (
      dayMode === 'dutiful' ||
      dayMode === 'restless' ||
      activity === 'busy' ||
      /work|hall|shop|patrol/.test(goal)
    ) {
      return { ...toBaseline(), reason: '白天要活动，换回生活服装' };
    }
  }

  const agendaBehavior = agenda && isAgendaActive(agenda) ? agenda.behavior : '';
  const agendaReason = agenda && isAgendaActive(agenda) ? agenda.reason : '';

  // 5a) 特殊服装 HOT：调情/挑逗/情趣意图 —— 优先于偶发泳装与私服
  if (hasSpecial && cur !== SPECIAL_DARE_SKIN_ID) {
    const drive = evaluateSpecialOutfitDrive({
      living,
      characterId,
      night,
      dayMode,
      goal,
      room,
      activity,
      social: desires.scores.social,
      agendaBehavior,
      agendaReason,
    });
    if (drive?.tier === 'hot' && hash01(characterId, salt + 9) < drive.chance) {
      return {
        skinId: SPECIAL_DARE_SKIN_ID,
        reason: `${drive.reason}（≈${Math.round(drive.chance * 100)}%）`,
        flirtHot: true,
      };
    }
  }

  // 5b) 玩闹心情偶发泳装（已下调，给特殊服装留空间）
  if (
    hasPool &&
    !night &&
    dayMode === 'playful' &&
    desires.scores.swim >= 35 &&
    (room === 'room_yard' || room === 'room_1f_pool' || !isAgendaActive(agenda))
  ) {
    if (cur !== POOL_PARTY_SKIN_ID && hash01(characterId, salt) < 0.18) {
      return { skinId: POOL_PARTY_SKIN_ID, reason: '心情轻快，偶尔想穿泳池派对外覆晃一晃' };
    }
  }

  // 5c) 都市私服：娱乐/派对/好心情（几率下调）
  const wantCasualPlace =
    room === 'room_2f_yule' ||
    room === 'room_1f_pool' ||
    room === 'room_yard' ||
    room === 'room_2f_lounge' ||
    activity === 'play' ||
    /play|party|hall_chat|娱乐|派对|逛街|活动/.test(goal);
  const moodGreat =
    dayMode === 'playful' ||
    hasStatus(living, characterId, 'joy_state') ||
    desires.scores.social >= 55;
  if (hasCasual && !night && (wantCasualPlace || moodGreat)) {
    const chance = wantCasualPlace ? 0.26 : moodGreat ? 0.18 : 0.08;
    if (cur !== CASUAL_FASHION_SKIN_ID && hash01(characterId, salt + 5) < chance) {
      return {
        skinId: CASUAL_FASHION_SKIN_ID,
        reason: wantCasualPlace
          ? '活动/娱乐场合，换上都市私服'
          : '心情很好，想穿都市私服晃一晃',
      };
    }
  }

  // 5d) 特殊服装 WARM/BASE：白天偶尔见到
  if (hasSpecial && cur !== SPECIAL_DARE_SKIN_ID) {
    const drive = evaluateSpecialOutfitDrive({
      living,
      characterId,
      night,
      dayMode,
      goal,
      room,
      activity,
      social: desires.scores.social,
      agendaBehavior,
      agendaReason,
    });
    if (
      drive &&
      drive.tier !== 'hot' &&
      hash01(characterId, salt + 11) < drive.chance
    ) {
      return {
        skinId: SPECIAL_DARE_SKIN_ID,
        reason: `${drive.reason}（≈${Math.round(drive.chance * 100)}%）`,
      };
    }
  }

  // 6) 焦虑/吃醋时若正穿花哨外覆且不在泳池 → 回生活服装
  if (
    (cur === POOL_PARTY_SKIN_ID ||
      cur === CASUAL_FASHION_SKIN_ID ||
      cur === SPECIAL_DARE_SKIN_ID) &&
    room !== 'room_1f_pool' &&
    (hasStatus(living, characterId, 'anxiety_state') ||
      hasStatus(living, characterId, 'jealousy')) &&
    hash01(characterId, salt + 3) < 0.4
  ) {
    return { ...toBaseline(), reason: '心情沉，不想再穿着花哨外覆，换回生活服装' };
  }

  // 7) 正穿着装甲但无执勤/军械由头 → 回生活服装（避免装甲占比过大）
  if (!cur && hasLife) {
    const act = String(activity || '');
    const stillDuty =
      (dutyRoom && (act === 'patrol' || act === 'guard' || act === 'maintain')) ||
      ((act === 'patrol' || act === 'guard') && /armory|tower|duty/.test(goal));
    if (!stillDuty) {
      return { skinId: LIFEWEAR_SKIN_ID, reason: '无执勤/军械需要，换回生活服装' };
    }
  }

  return null;
}

function queueWant(
  living: AiLivingSave,
  characterId: string,
  want: OutfitWant,
): boolean {
  // null → 战斗装甲标记；生活服装必须显式 LIFEWEAR_SKIN_ID
  // 统一走延时换装：先播「换装中」过程皮，到点才换上新衣（禁止静止硬切）
  const r = schedulePresenceOutfitChange(living, characterId, want.skinId ?? 'default');
  return r.queued;
}

/**
 * 对拥有角色尝试情绪选装（尊重冷却与事件外覆）。
 * @returns 实际换装的角色 id
 */
export function tryApplyEmotionOutfits(
  save: SaveData,
  living: AiLivingSave,
  ownedIds: string[],
): string[] {
  const changed: string[] = [];
  const cd = ensureCooldownMap(living);
  for (const id of ownedIds) {
    if (shouldHoldAutoOutfit(living, id)) continue;
    const last = cd[id] ?? -9999;
    const wantProbe = suggestEmotionOutfit(save, living, id);
    const curBefore = currentCampSkin(living, id);
    // 脱战斗装甲回生活服装是「纠正」，不是「换装表演」：不受换装冷却与展示锁限制，
    // 否则出错一次装甲就要在营地里挂 75+ 游戏分钟。
    const corrective =
      wantProbe?.skinId === LIFEWEAR_SKIN_ID && curBefore == null;
    if (corrective && queueWant(living, id, wantProbe!)) {
      cd[id] = living.gameMinutes;
      changed.push(id);
      continue;
    }
    const cdNeed = wantProbe?.flirtHot
      ? OUTFIT_COOLDOWN_FLIRT_GAME_MIN
      : OUTFIT_COOLDOWN_GAME_MIN;
    if (living.gameMinutes - last < cdNeed) continue;
    const want = wantProbe;
    if (!want) continue;
    const cur = currentCampSkin(living, id);
    const already =
      (want.skinId == null && cur == null) ||
      (want.skinId != null && cur === want.skinId);
    if (already) continue;
    if (queueWant(living, id, want)) {
      cd[id] = living.gameMinutes;
      changed.push(id);
    }
  }
  return changed;
}

/**
 * 对话开场对齐穿着：改为延时排队，禁止开场瞬间连切皮肤。
 */
export function forceSyncEmotionOutfitForDialogue(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): boolean {
  if (isDisciplineActiveFor(living, characterId)) return false;
  if (isBathAssistActiveFor(living, characterId)) return false;
  if (living.eventTempSkins?.[characterId]) return false;
  const want = suggestEmotionOutfit(save, living, characterId);
  if (!want) return false;
  const cur = currentCampSkin(living, characterId);
  const already =
    (want.skinId == null && cur == null) ||
    (want.skinId != null && cur === want.skinId);
  if (already) return false;
  // 装甲 → 生活服装属于纠正性回落，展示锁/换装锁不该拦住它
  const corrective = want.skinId === LIFEWEAR_SKIN_ID && cur == null;
  if (!corrective && shouldHoldAutoOutfit(living, characterId)) return false;
  // 独自洗浴皮由世界同步处理；情绪选装不在开场瞬时扒掉/换上
  if (isAloneBathSkinId(want.skinId)) return false;
  const q = schedulePresenceOutfitChange(
    living,
    characterId,
    want.skinId ?? 'default',
  );
  if (!q.queued) return false;
  ensureCooldownMap(living)[characterId] = living.gameMinutes;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}对话前准备换装：${q.msg}（${want.reason}）`,
    importance: 3,
  });
  return true;
}

/**
 * 出征前：清事件临时外覆（战斗层强制原皮）。
 * 不再改写玩家主页 activeSkinId；营地日常 campWornSkins 保留，回营后续穿。
 */
export function prepareSquadDefaultArmor(
  save: SaveData,
  living: AiLivingSave | null | undefined,
  squadIds: string[],
): string[] {
  void save;
  const changed: string[] = [];
  if (!living) return changed;
  if (!living.eventTempSkins) living.eventTempSkins = {};
  for (const id of squadIds) {
    // 活动事件会话必须先正常结束；不能由出征清理临时皮。
    if (isDisciplineActiveFor(living, id)) continue;
    if (isBathAssistActiveFor(living, id)) continue;
    if (living.eventTempSkins[id]) {
      delete living.eventTempSkins[id];
      // 出征前更衣也算换装：排一次过程（战斗页看不到，但回来时状态自洽，
      // 且不会在营地里出现"瞬间剥皮"）
      forceScheduleOutfitChange(living, id, getCampWornSkinId(living, id), 3_500);
      const name = CHARACTER_MAP[id]?.name ?? id;
      pushMemory(living, id, {
        kind: 'event',
        summary: `${name}出征前卸下临时外覆，锈带战斗使用默认装甲。`,
        importance: 5,
      });
      changed.push(id);
    }
  }
  return changed;
}

/** Prompt 用：当前是否「该」换装的一句提示（不强制模型每轮填 skin_change） */
export function emotionOutfitPromptHint(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): string {
  if (shouldHoldAutoOutfit(living, characterId)) return '';
  const want = suggestEmotionOutfit(save, living, characterId);
  const cur = currentCampSkin(living, characterId);
  const curName = cur ? getCharacterSkin(characterId, cur)?.name ?? cur : '默认外观';
  if (!want) {
    return `当前营地外观「${curName}」与情绪/意图大致匹配；不必为换而换。主页玩家装备与此无关。`;
  }
  const next =
    want.skinId == null
      ? '默认外观'
      : getCharacterSkin(characterId, want.skinId)?.name ?? want.skinId;
  const idHint = want.skinId ?? 'default';
  return `情绪选装建议（可选）：营地可 skin_change=${idHint} →「${next}」。动机：${want.reason}。当前营地「${curName}」。`;
}
