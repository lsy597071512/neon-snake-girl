/**
 * 舞蹈事件会话：单人独舞 / 一对一（与指挥官）共舞 / 营地舞蹈派对（多人）。
 *
 * - 只发生在大厅（1F 大厅1/大厅2、2F 西大厅/中庭/南大厅）。
 * - 邀请制：指挥官按钮 / 打字 / 语音等效；角色也可主动邀请（出确认条）。
 * - 一切舞蹈先切「舞蹈待机」准备皮（pifu12），再执行独舞(pifu11)/共舞(pifu10)。
 * - 单人独舞：无缝循环该角色所有独舞片段（主循环 + _1/_2…），识别前缀认角色，有几个播几个。
 * - 共舞：单次播放，时长即皮肤时长（默认约 9s），跳完退回准备态，继续须重新邀请。
 * - 好感：1v1 共舞每角色每天首次 +N；营地舞蹈派对走关系网（eventEngine.resolve）。
 * - 临时层用 eventInstanceId='dance_session'，不碰 campWornSkins / pendingOutfitChanges。
 *
 * 见 docs/bath-assist-events.md（同构会话）与 src/data/characterSkins.ts。
 */
import {
  DANCE_IDLE_SKIN_ID,
  DANCE_TEMP_SKIN_INSTANCE,
  GONGWU_SKIN_ID,
  DANDU_SKIN_ID,
  getCharacterSkin,
  hasDanceAssets,
  isDanceEventSkinId,
  OUTFIT_CHANGE_SKIN_ID,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import type { SaveData } from '../types';
import { clearEventTempSkinsForInstance, setEventTempSkin } from './campEvents/campEventEffects';
import { getCampLogicalSkinId, getCampWornSkinId } from './campOutfit';
import { snapAgentToRoom } from './campAgents';
import { captureDialogueSceneSnapshot, commitDialogueSceneSnapshot } from './dialogueSceneSync';
import { isInSleepSystem, leaveSleepSystem, sleepWakeDifficulty } from './sleepSystem';
import { cancelTravel, planTravel } from './travel';
import { forceScheduleOutfitChange } from './outfitChangeProcess';
import { LIFEWEAR_SKIN_ID } from '../data/characterSkins';
import { clearAgenda, getAgenda, setAgenda } from './characterAgenda';
import { isBathAssistActiveFor } from './bathAssistSession';
import { isDisciplineActiveFor } from './disciplineSession';
import { isAnfuActiveFor } from './anfuSession';
import { isMiniGameActiveFor } from './miniGameSession';
import { recordPlayerActivityRequest } from './activityFatigue';
import { applyMoodImpulse } from './moodContinuum';
import { pushMemory, pushRecentChat } from './memory';
import { adjustAffinity } from './relationship';
import type { AiLivingSave, CharacterActivity } from './types';
import { resolvePresence } from './livingState';

/** 允许跳舞的大厅房间（1F 大厅1/大厅2、2F 西大厅/中庭/南大厅） */
export const DANCE_ROOM_IDS = [
  'room_1f_hall1',
  'room_1f_hall2',
  'room_2f_hall_west',
  'room_2f_atrium',
  'room_2f_lounge',
];

export function isDanceHallRoom(roomId: string | null | undefined): boolean {
  return !!roomId && DANCE_ROOM_IDS.includes(roomId);
}

/** 共舞默认时长（皮肤播放时长；无精确元数据时退回约 9s） */
export const DANCE_CO_DURATION_MS = 9_000;
/** 进舞蹈前的换装相时长（与安抚室同构：先换舞装，再切待机） */
export const DANCE_DRESS_MS = 7_200;
/** 1v1 共舞每角色每天首次好感增量 */
export const DANCE_CO_AFFINITY = 3;

export type DanceMode = 'solo' | 'co';
/** dressing=换舞装 → prepare=待机 → dancing=起舞 */
export type DancePhase = 'dressing' | 'travel' | 'prepare' | 'unveil' | 'dancing';
export type DanceEntrySource = 'player_button' | 'player_chat' | 'character_invite' | 'recover';

export type DanceSessionState = {
  active: boolean;
  characterId: string;
  mode: DanceMode | null;
  phase: DancePhase;
  prevRoomId: string | null;
  prevCampSkinId: string | null;
  prevEventTemp?: import('./types').EventTempSkinState | null;
  startedAt: number;
  entrySource: DanceEntrySource;
  /** 目标大厅（准备态时角色自主前往） */
  hallRoomId: string;
  /** 换装相到点时刻（dressing→prepare） */
  dressReadyAtMs?: number;
  /** 起舞过渡（换演出服）：到点才真正进入 dancing，音乐也从此刻开始 */
  unveilUntilMs?: number;
  /** 共舞计划时长（unveil 结束才开始计时） */
  coPlannedMs?: number;
  /** 指挥官点按钮提出后，等待角色本轮回应 */
  awaitingAskReply?: boolean;
  /** 待回应的请求模式 */
  pendingAskMode?: DanceMode | null;
  /** 独舞循环当前片段下标（由播放器驱动） */
  soloIndex?: number;
  /** 独舞是否被角色/指挥官暂停 */
  soloPaused?: boolean;
  /** 共舞演出结束时刻（ms） */
  coEndsAtMs?: number;
  justEntered?: boolean;
  justLeft?: boolean;
  justLeftTurnsLeft?: number;
  settling?: boolean;
};

/** 指挥官提出共舞/看独舞后，等待角色本轮答应或拒绝 */
export type DancePlayerAskPending = {
  characterId: string;
  mode: DanceMode;
  proposedAt: number;
  isModeSwitch?: boolean;
};

/** 角色主动邀请（待指挥官确认） */
export type DanceInvitePending = {
  characterId: string;
  mode: DanceMode;
  proposedAt: number;
  dayIndex: number;
  preview: string;
};

export function danceModeLabel(mode: DanceMode): string {
  return mode === 'co' ? '一同跳舞' : '看TA跳舞';
}

export function getDanceSession(living: AiLivingSave): DanceSessionState | null {
  const s = living.danceSession;
  if (!s?.active || !s.characterId) return null;
  return s;
}

export function isDanceActiveFor(living: AiLivingSave, characterId: string): boolean {
  const s = getDanceSession(living);
  return !!s && s.characterId === characterId;
}

export function isDanceTempInstance(eventInstanceId: string | null | undefined): boolean {
  return eventInstanceId === DANCE_TEMP_SKIN_INSTANCE;
}

/** 该角色是否可用于舞蹈（有资源且未处于互斥状态） */
export function canDanceAtAll(living: AiLivingSave, characterId: string): boolean {
  if (isDisciplineActiveFor(living, characterId)) return false;
  if (isBathAssistActiveFor(living, characterId)) return false;
  if (isAnfuActiveFor(living, characterId)) return false;
  if (isMiniGameActiveFor(living, characterId)) return false;
  return hasDanceAssets(characterId);
}

/** 聊天页舞蹈按钮显示条件：资源齐 + 未处于互斥会话 */
export function canShowDanceButtons(living: AiLivingSave, characterId: string): boolean {
  if (isDisciplineActiveFor(living, characterId)) return false;
  if (isBathAssistActiveFor(living, characterId)) return false;
  if (isAnfuActiveFor(living, characterId)) return false;
  if (isMiniGameActiveFor(living, characterId)) return false;
  return hasDanceAssets(characterId);
}

function pickHallRoom(currentRoomId: string | null): string {
  const floor = currentRoomId ? CAMP_ROOM_MAP[currentRoomId]?.floor : undefined;
  if (floor === 2) return 'room_2f_hall_west';
  return 'room_1f_hall1';
}

function danceBehavior(mode: DanceMode | null): string {
  if (mode === 'co') return '在大厅与指挥官共舞，随节拍摆开舞步';
  if (mode === 'solo') return '在大厅独自起舞演出，专注于自己的舞步';
  return '在大厅做准备，摆出起势舞姿';
}

function lockAgenda(living: AiLivingSave, characterId: string, hallRoomId: string): void {
  const activity: CharacterActivity = 'play';
  setAgenda(living, characterId, {
    goal: 'dance',
    targetRoomId: hallRoomId,
    activity,
    behavior: danceBehavior(getDanceSession(living)?.mode ?? null),
    remainGameMin: 240,
    startedGameMin: living.gameMinutes,
    reason: '去大厅跳舞',
    source: 'social',
  });
}

function unlockAgenda(living: AiLivingSave, characterId: string): void {
  const a = getAgenda(living, characterId);
  if (a?.goal === 'dance') clearAgenda(living, characterId);
}

function applyDanceSkin(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  skinId: string,
): void {
  setEventTempSkin(save, living, characterId, skinId, DANCE_TEMP_SKIN_INSTANCE);
  if (!living.eventTempSkins) living.eventTempSkins = {};
  const prev = living.eventTempSkins[characterId];
  living.eventTempSkins[characterId] = {
    skinId,
    restoreSkinId: prev?.restoreSkinId ?? getCampWornSkinId(living, characterId),
    eventInstanceId: DANCE_TEMP_SKIN_INSTANCE,
  };
}

/** 当前应显示的舞蹈皮：换舞装=过程皮，待机=待机皮，演出=独舞/共舞 */
export function danceDisplaySkinId(living: AiLivingSave, characterId: string): string | null {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId) return null;
  if (s.phase === 'dressing') return OUTFIT_CHANGE_SKIN_ID;
  if (s.phase === 'prepare') return DANCE_IDLE_SKIN_ID;
  if (s.mode === 'co') return GONGWU_SKIN_ID;
  return DANDU_SKIN_ID;
}

/** 换舞装完成：dressing → prepare，挂舞蹈待机皮 */
export function finishDanceDressing(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): string | null {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId || s.phase !== 'dressing') return null;
  s.dressReadyAtMs = undefined;
  applyDanceSkin(save, living, characterId, DANCE_IDLE_SKIN_ID);
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const place = CAMP_ROOM_MAP[s.hallRoomId]?.label ?? '大厅';
  const curRoom = resolvePresence(characterId, living).roomId;
  if (!isDanceHallRoom(curRoom) && CAMP_ROOM_MAP[curRoom]) {
    // 换好舞装再走过去：路程计入，不瞬移
    s.phase = 'travel';
    planTravel(living, characterId, s.hallRoomId, curRoom, {
      activity: 'play',
      behavior: '换好舞装，去大厅准备跳舞',
      reason: 'dance_entry',
      arriveBehavior: '在大厅待机，准备跳舞',
    });
    const a = getAgenda(living, characterId);
    if (a?.goal === 'dance') {
      a.behavior = `换好舞装，正在去${place}`;
      a.activity = 'play';
    }
    return `【系统】${name}换好舞装，正在去${place}的路上。`;
  }
  s.phase = 'prepare';
  const a = getAgenda(living, characterId);
  if (a?.goal === 'dance') {
    a.behavior = `在${place}待机，准备跳舞`;
    a.activity = 'play';
  }
  return `【系统】${name}换好舞装，正在大厅待机——可以开始跳舞了。`;
}

/** 到达大厅（行程结算回调）：travel → prepare */
export function finishDanceTravel(
  living: AiLivingSave,
  characterId: string,
): string | null {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId || s.phase !== 'travel') return null;
  s.phase = 'prepare';
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const place = CAMP_ROOM_MAP[s.hallRoomId]?.label ?? '大厅';
  const a = getAgenda(living, characterId);
  if (a?.goal === 'dance') {
    a.behavior = `在${place}待机，准备跳舞`;
    a.activity = 'play';
  }
  return `【系统】${name}已到${place}，正在待机——可以开始跳舞了。`;
}

/** 由于待机→演出的服装/装扮不同：先播一段「换演出服」过渡，真人不会瞬间换装开跳 */
export const DANCE_UNVEIL_MS = 2_400;

function hasProcessSkin(characterId: string): boolean {
  return Boolean(getCharacterSkin(characterId, OUTFIT_CHANGE_SKIN_ID)?.portraitLive);
}

function beginUnveil(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  mode: DanceMode,
): boolean {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId) return false;
  const needId = mode === 'co' ? GONGWU_SKIN_ID : DANDU_SKIN_ID;
  if (!getCharacterSkin(characterId, needId)) return false;
  s.mode = mode;
  s.soloPaused = false;
  s.coEndsAtMs = undefined;
  s.coPlannedMs = undefined;
  if (!hasProcessSkin(characterId)) {
    // 无过程皮资源：直接起舞（仍保持相位一致）
    s.phase = 'dancing';
    s.unveilUntilMs = undefined;
    s.soloIndex = mode === 'solo' ? 0 : undefined;
    applyDanceSkin(save, living, characterId, needId);
    return true;
  }
  s.phase = 'unveil';
  s.unveilUntilMs = Date.now() + DANCE_UNVEIL_MS;
  applyDanceSkin(save, living, characterId, OUTFIT_CHANGE_SKIN_ID);
  const a = getAgenda(living, characterId);
  if (a?.goal === 'dance') {
    a.behavior = '在大厅换演出服，准备起舞';
    a.activity = 'play';
  }
  return true;
}

/** 起舞过渡到点：正式进入演出（音乐从这一刻开始，以正视起舞为准） */
export function finishDanceUnveil(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): boolean {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId || s.phase !== 'unveil') return false;
  if (Date.now() < (s.unveilUntilMs ?? 0)) return false;
  const mode: DanceMode = s.mode === 'co' ? 'co' : 'solo';
  s.phase = 'dancing';
  s.unveilUntilMs = undefined;
  if (mode === 'co') {
    s.soloIndex = undefined;
    s.coEndsAtMs = Date.now() + Math.max(3_000, s.coPlannedMs ?? DANCE_CO_DURATION_MS);
    applyDanceSkin(save, living, characterId, GONGWU_SKIN_ID);
  } else {
    s.soloIndex = 0;
    s.coEndsAtMs = undefined;
    applyDanceSkin(save, living, characterId, DANDU_SKIN_ID);
  }
  const a = getAgenda(living, characterId);
  if (a?.goal === 'dance') {
    a.behavior = danceBehavior(mode);
    a.activity = 'play';
  }
  return true;
}

/** 角色自己/指挥官请求开始独舞演出（准备态 → 换演出服 → 演出态） */
export function beginSoloDance(save: SaveData, living: AiLivingSave, characterId: string): boolean {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId) return false;
  if (s.phase === 'dressing' || s.phase === 'unveil' || s.phase === 'dancing') return false;
  if (!getCharacterSkin(characterId, DANDU_SKIN_ID)) return false;
  return beginUnveil(save, living, characterId, 'solo');
}

/** 开始共舞演出（准备态 → 换演出服 → 演出态），durationMs 为共舞时长 */
export function beginCoDance(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  durationMs = DANCE_CO_DURATION_MS,
): boolean {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId) return false;
  if (s.phase === 'dressing' || s.phase === 'unveil' || s.phase === 'dancing') return false;
  if (!getCharacterSkin(characterId, GONGWU_SKIN_ID)) return false;
  const ok = beginUnveil(save, living, characterId, 'co');
  if (ok) {
    const s2 = getDanceSession(living);
    if (s2) s2.coPlannedMs = Math.max(3_000, durationMs);
  }
  return ok;
}

/** 独舞暂停/继续（角色自己意愿或指挥官命令） */
export function setSoloPaused(living: AiLivingSave, characterId: string, paused: boolean): void {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId) return;
  s.soloPaused = paused;
}

/** 退回准备态（停下不跳，或共舞结束） */
export function returnToPrepare(save: SaveData, living: AiLivingSave, characterId: string): void {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId) return;
  s.phase = 'prepare';
  s.mode = null;
  s.soloIndex = undefined;
  s.soloPaused = false;
  s.coEndsAtMs = undefined;
  applyDanceSkin(save, living, characterId, DANCE_IDLE_SKIN_ID);
}

/**
 * 共舞演出完成：回准备态 + 1v1 好感（每角色每天首次）。
 * 由 livingService tick 或 UI 播放结束时调用。
 */
export function completeCoDance(save: SaveData, living: AiLivingSave, characterId: string): void {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId || s.phase !== 'dancing' || s.mode !== 'co') return;
  applyDanceAffinityForCo(living, characterId);
  // 共舞一曲落幕：心情 up（被陪伴、被注视的愉悦）
  applyMoodImpulse(living, characterId, { kind: 'event', tone: 'up' });
  returnToPrepare(save, living, characterId);
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${CHARACTER_MAP[characterId]?.name ?? characterId}与指挥官共舞一曲结束，退回准备态`,
    importance: 4,
  });
}

/** 1v1 共舞好感去重：每角色每天首次 +N */
export function applyDanceAffinityForCo(living: AiLivingSave, characterId: string): boolean {
  if (!living.danceAffinityDay) living.danceAffinityDay = {};
  if (living.danceAffinityDay[characterId] === living.dayIndex) return false;
  living.danceAffinityDay[characterId] = living.dayIndex;
  adjustAffinity(living, characterId, DANCE_CO_AFFINITY);
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `与指挥官共舞，好感 +${DANCE_CO_AFFINITY}`,
    importance: 5,
  });
  return true;
}

export type DanceEnterResult = {
  ok: boolean;
  msg: string;
  systemLine?: string;
  switched?: boolean;
  /** 角色已答应，转成邀请条等指挥官确认（不立刻进场景） */
  awaitingPlayerConfirm?: boolean;
};

/**
 * 进入舞蹈会话：登记会话、切准备态皮、锁议程、若不在大厅则自主前往。
 * 不依赖购买；不改主页玩家装备。
 */
export function enterDanceSession(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  mode: DanceMode,
  entrySource: DanceEntrySource = 'player_button',
  opts?: { hallRoomId?: string },
): DanceEnterResult {
  if (!CHARACTER_MAP[characterId]) return { ok: false, msg: '角色不存在' };
  if (isDisciplineActiveFor(living, characterId)) {
    return { ok: false, msg: '当前事件中无法跳舞' };
  }
  if (isBathAssistActiveFor(living, characterId)) {
    return { ok: false, msg: '正在冲澡/浴室互动中，无法跳舞' };
  }
  if (isAnfuActiveFor(living, characterId)) {
    return { ok: false, msg: '正在安抚室，无法同时跳舞' };
  }
  if (isMiniGameActiveFor(living, characterId)) {
    return { ok: false, msg: '小游戏对局中，无法同时跳舞' };
  }
  if (!hasDanceAssets(characterId)) {
    return { ok: false, msg: '该角色暂无舞蹈资源' };
  }
  const needId =
    mode === 'co' ? GONGWU_SKIN_ID : DANDU_SKIN_ID;
  if (!getCharacterSkin(characterId, needId)) {
    return { ok: false, msg: `该角色暂无「${danceModeLabel(mode)}」资源` };
  }

  const existing = getDanceSession(living);
  if (existing) {
    if (existing.characterId !== characterId) {
      return { ok: false, msg: '另一名角色正在跳舞' };
    }
    existing.justEntered = true;
    // 还在换舞装：只记下模式，换好后再起舞
    if (existing.phase === 'dressing' || existing.phase === 'unveil') {
      existing.mode = mode;
      const systemLine =
        existing.phase === 'unveil'
          ? `【系统】正在换演出服，马上跳「${danceModeLabel(mode)}」。`
          : `【系统】换好舞装后跳「${danceModeLabel(mode)}」。`;
      return { ok: true, msg: systemLine, systemLine, switched: true };
    }
    if (existing.phase === 'dancing' && existing.mode === mode) {
      return { ok: true, msg: '已经在跳了', switched: false };
    }
    // 同角色切换模式（准备态）：走「换演出服」过渡再起舞
    if (mode === 'co') beginCoDance(save, living, characterId);
    else beginSoloDance(save, living, characterId);
    const label = danceModeLabel(mode);
    const systemLine = `【系统】切换为「${label}」。`;
    return { ok: true, msg: systemLine, systemLine, switched: true };
  }

  // 睡眠系统会把 presence 锁在卧室（「准备入睡」），舞蹈必须先把人叫醒，
  // 否则背景永远停在卧室、Prompt 里还写着睡觉 → 角色答「我在睡觉」。
  // 但她可以选择拒绝/睡太沉叫不醒：叫不醒就进不了舞蹈事件。
  if (isInSleepSystem(living, characterId)) {
    const diff = sleepWakeDifficulty(living, characterId);
    if (!diff.wakeable) {
      return { ok: false, msg: '她睡得太沉，叫不醒——先别跳舞了' };
    }
    leaveSleepSystem(living, characterId, { reason: '被指挥官叫去大厅跳舞', completed: false });
  }

  const presence = resolvePresence(characterId, living);
  const prevRoomId = presence.roomId || null;
  const prevCampSkinId = getCampWornSkinId(living, characterId);
  const prevTempRaw = living.eventTempSkins?.[characterId];
  const prevEventTemp =
    prevTempRaw && prevTempRaw.eventInstanceId !== DANCE_TEMP_SKIN_INSTANCE
      ? { ...prevTempRaw }
      : null;
  const hallRoomId = opts?.hallRoomId ?? pickHallRoom(prevRoomId);
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const canDress = Boolean(
    getCharacterSkin(characterId, OUTFIT_CHANGE_SKIN_ID)?.portraitLive,
  );
  const inHallNow = isDanceHallRoom(prevRoomId);

  living.danceSession = {
    active: true,
    characterId,
    mode,
    phase: canDress ? 'dressing' : inHallNow ? 'prepare' : 'travel',
    dressReadyAtMs: canDress ? Date.now() + DANCE_DRESS_MS : undefined,
    prevRoomId,
    prevCampSkinId,
    prevEventTemp,
    startedAt: Date.now(),
    entrySource,
    hallRoomId,
    awaitingAskReply: false,
    pendingAskMode: null,
    justEntered: true,
    justLeft: false,
    justLeftTurnsLeft: 0,
  };

  // 不在大厅且无需换舞装：先登记行程（走路有时间），到点才进大厅
  if (!canDress && !inHallNow && prevRoomId) {
    planTravel(living, characterId, hallRoomId, prevRoomId, {
      activity: 'play',
      behavior: '去大厅准备跳舞',
      reason: 'dance_entry',
      arriveBehavior: '在大厅待机，准备跳舞',
    });
  }

  // 换装相不挂过程皮（过程皮由 campOutfit / characterSkinRuntime 的 dressing 特判显示）；
  // 但先占住 DANCE_TEMP_SKIN_INSTANCE 槽位，避免洗浴/事件/情绪选装在这几秒里互相扒皮。
  clearEventTempSkinsForInstance(living, DANCE_TEMP_SKIN_INSTANCE, { dressBack: false });
  if (!living.eventTempSkins) living.eventTempSkins = {};
  living.eventTempSkins[characterId] = {
    skinId: canDress ? (getCampLogicalSkinId(living, characterId) ?? '') : DANCE_IDLE_SKIN_ID,
    restoreSkinId: prevCampSkinId,
    eventInstanceId: DANCE_TEMP_SKIN_INSTANCE,
  };

  lockAgenda(living, characterId, hallRoomId);

  // 舞蹈皮由会话独占：清掉排队中的换装与叙事挂起，否则会在换装皮上卡死
  if (living.pendingOutfitChanges) delete living.pendingOutfitChanges[characterId];
  if (living.outfitNarrativeHolds) delete living.outfitNarrativeHolds[characterId];
  if (living.outfitWearLocks) delete living.outfitWearLocks[characterId];

  // 移动不由这里瞬移：换舞装在本处完成，之后走 planTravel 去大厅（走路有时间）。
  // 已在厅内则无需行程；否则由 finishDanceDressing 登记行程。
  const place = CAMP_ROOM_MAP[hallRoomId]?.label ?? '大厅';

  living.pendingDanceInvite = undefined;
  clearPlayerDanceAsk(living, characterId);

  // 重复活动厌倦：今天第 N 次让她跳舞（超耐心阈值会打厌倦脉冲）
  recordPlayerActivityRequest(living, characterId, 'dance');

  // 本轮对白起就要以「舞蹈·当前所在」为世界快照，避免 Prompt 仍用开场时的旧房间/睡衣
  commitDialogueSceneSnapshot(
    living,
    characterId,
    captureDialogueSceneSnapshot(living, characterId),
  );

  const systemLine = canDress
    ? `【系统】${name}答应跳舞，正在换舞装（换装中）。`
    : inHallNow
      ? `【系统】${name}在${place}待机，准备起舞。`
      : `【系统】${name}答应跳舞，正在去${place}的路上（约十几秒）。`;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}与指挥官准备跳舞（${danceModeLabel(mode)}，来源：${entrySource}）`,
    importance: 5,
  });
  pushRecentChat(
    living,
    characterId,
    'user',
    `【系统事实·已生效】${name}已经答应跳舞，此刻在${place}${canDress ? '换舞装（换装中动态）' : '待机'}。禁止说还没答应/还在别处/在做别的事；换装完成后系统会通知，之后才可以起舞。`,
  );

  return {
    ok: true,
    msg: canDress ? '已进入换舞装阶段' : '已进入舞蹈待机',
    systemLine,
  };
}

export type DanceLeaveResult = { ok: boolean; msg: string; systemLine?: string };

/** 结束舞蹈会话并还原（幂等） */
export function leaveDanceSession(
  save: SaveData,
  living: AiLivingSave,
  opts?: { reason?: string; force?: boolean },
): DanceLeaveResult {
  const session = living.danceSession;
  if (!session?.active) return { ok: false, msg: '未在跳舞中' };
  if (session.settling && !opts?.force) return { ok: true, msg: '结算中' };
  session.settling = true;

  const characterId = session.characterId;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;

  clearEventTempSkinsForInstance(living, DANCE_TEMP_SKIN_INSTANCE, { dressBack: false });
  unlockAgenda(living, characterId);

  if (session.prevEventTemp?.skinId) {
    if (!living.eventTempSkins) living.eventTempSkins = {};
    living.eventTempSkins[characterId] = { ...session.prevEventTemp };
  }

  living.danceSession = {
    ...session,
    active: false,
    settling: false,
    phase: 'prepare',
    mode: null,
    justEntered: false,
    justLeft: true,
    justLeftTurnsLeft: 2,
    soloIndex: undefined,
    coEndsAtMs: undefined,
  };

  const reason = opts?.reason ?? '结束';
  const systemLine = `【系统】舞蹈已结束（${reason}）。`;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}结束跳舞（${reason}）`,
    importance: 4,
  });

  // 散场仪式：离开大厅 + 换下舞装（走换装过程，杜绝瞬间硬切/瞬移）。
  // 读档/异常恢复不搬人也不换装，交给作息自然接管。
  cancelTravel(living, characterId);
  if (!/读档|恢复/.test(reason)) {
    const curRoom = resolvePresence(characterId, living).roomId;
    const stillInHall = isDanceHallRoom(curRoom);
    if (stillInHall) {
      const back =
        session.prevRoomId && CAMP_ROOM_MAP[session.prevRoomId]
          ? session.prevRoomId
          : 'room_1f_hall1';
      const backLabel = CAMP_ROOM_MAP[back]?.label ?? '大厅';
      const behavior = `换下舞装，回${backLabel}`;
      const travel = planTravel(living, characterId, back, curRoom, {
        activity: 'idle',
        behavior,
        reason: 'dance_exit',
        arriveBehavior: `换下舞装，回到${backLabel}`,
      });
      if (!travel.started && back === curRoom) {
        snapAgentToRoom(characterId, back, { activity: 'idle', behavior });
        if (!living.bodyAnchors) living.bodyAnchors = {};
        const prevAnchor = living.bodyAnchors[characterId];
        living.bodyAnchors[characterId] = {
          roomId: back,
          activity: 'idle',
          behavior,
          atGameMin: living.gameMinutes,
          seq: (prevAnchor?.seq ?? 0) + 1,
        };
      }
    }
    forceScheduleOutfitChange(living, characterId, LIFEWEAR_SKIN_ID, 5_200);
  }

  return { ok: true, msg: '已结束跳舞', systemLine };
}

export function recoverStaleDanceSession(
  save: SaveData,
  living: AiLivingSave,
): boolean {
  const s = getDanceSession(living);
  if (!s) return false;
  leaveDanceSession(save, living, { reason: '读档/异常自动结束', force: true });
  return true;
}

/** 角色已离开大厅 → 强制结束 */
export function clearDanceIfLeftHall(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): void {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId) return;
  const presence = resolvePresence(characterId, living);
  if (isDanceHallRoom(presence.roomId)) return;
  // 换舞装/赶路中本来就还没到大厅，不算"离开"
  if (s.phase === 'dressing' || s.phase === 'travel') return;
  // 准备态仍在赶路，允许；已进入演出却离开大厅才收尾
  if (s.phase === 'prepare' && presence.roomId !== s.hallRoomId && resolvePresence(characterId, living).roomId) {
    return;
  }
  if (s.phase === 'dancing' || s.phase === 'unveil') {
    leaveDanceSession(save, living, { reason: '离开大厅', force: true });
  }
}

/**
 * 推进舞蹈会话（世界 tick / 对话回合前调用）：
 * - 换舞装到点 → 切待机（dressing → prepare）
 * - 待机/换装中若被挪出大厅 → 拉回大厅（会话独占位置）
 * - 共舞到点 → 完成并回准备态
 * 注意：不再自动起舞——开始跳舞必须由角色（dance_action）或指挥官按钮触发。
 */
export function tickDanceSession(save: SaveData, living: AiLivingSave, now = Date.now()): void {
  const s = getDanceSession(living);
  if (!s) return;
  const presence = resolvePresence(s.characterId, living);

  if (s.phase === 'dressing' && now >= (s.dressReadyAtMs ?? 0)) {
    finishDanceDressing(save, living, s.characterId);
  }
  if (s.phase === 'unveil' && now >= (s.unveilUntilMs ?? 0)) {
    finishDanceUnveil(save, living, s.characterId);
  }

  const s2 = getDanceSession(living);
  if (!s2) return;
  // 换舞装/赶路/演出途中不"拉回大厅"：赶路本身就在路上，演出中离开才由 clearDanceIfLeftHall 收尾
  if (
    s2.phase !== 'dancing' &&
    s2.phase !== 'unveil' &&
    s2.phase !== 'dressing' &&
    s2.phase !== 'travel' &&
    !isDanceHallRoom(presence.roomId)
  ) {
    snapAgentToRoom(s2.characterId, s2.hallRoomId, {
      activity: 'play',
      behavior: `在${CAMP_ROOM_MAP[s2.hallRoomId]?.label ?? '大厅'}准备跳舞`,
    });
  }

  if (s2.phase === 'dancing' && s2.mode === 'co' && s2.coEndsAtMs && now >= s2.coEndsAtMs) {
    completeCoDance(save, living, s2.characterId);
  }
}

// ——— 对白检测（文本/语音等效） ———

/** 指挥官要求「一同跳舞」 */
export const PLAYER_ASKS_CO_DANCE =
  /一起(?:跳|共舞|来一段)|一同(?:跳|跳舞|共舞)|跟我(?:一起)?跳|陪我跳|共舞|我们(?:一起)?跳|跳(?:个|支|段)(?:舞|双人舞)/;
/** 指挥官要求「想看你跳舞」（独舞） */
export const PLAYER_ASKS_SOLO_DANCE =
  /(?:想看|看看|看你|欣赏)(?:你)?(?:跳舞|独舞|跳一段|舞)|你(?:去|来)?跳(?:个|支|段)?(?:舞|独舞)|自己跳|单独跳|表演(?:一段)?舞/;

/** 角色主动邀请共舞 */
export const AI_PROPOSES_CO_DANCE =
  /(?:想|要|可以|来|我们|咱们).{0,12}(?:一起|一同).{0,8}跳|一起跳|共舞|陪我跳一段|来段双人舞/;
/** 角色主动想跳舞/邀请看你独舞 */
export const AI_PROPOSES_SOLO_DANCE =
  /(?:想|要|可以).{0,10}(?:跳|起舞)|跳(?:一段|支|个)舞|给你(?:跳|表演)|献舞|跳给你看/;

export const AI_STOPS_DANCE = /不跳了|停下|停一下|歇一歇|跳累|先不跳|结束了?/;
export const AI_CONTINUES_DANCE = /继续跳|接着跳|再跳|跳下去|别停/;
export const AI_AGREES_DANCE = /好的?|好啊|行啊?|可以|没问题|走吧|来吧|一起(?:吧|啊)?|那就|陪你|嗯+|同意|当然|乐意|答应/;
export const AI_REFUSES_DANCE = /不(?:行|要|想)|拒绝|改天|下次|现在不行|先别|没空|累了|不想跳/;
/** 有条件答应/还没准备好：不能当同意直接拉进场景 */
export const AI_HEDGES_DANCE =
  /先.*(处理|忙|准备|收拾|看看|把手头|换|整理|交代|收尾)|等一下|稍等|等我把|等我先|过一会儿|待会儿|等会儿|回头|再说|还没(?:好|准备)/;

export function detectPlayerDanceMode(text: string): DanceMode | null {
  const t = text || '';
  if (PLAYER_ASKS_CO_DANCE.test(t)) return 'co';
  if (PLAYER_ASKS_SOLO_DANCE.test(t)) return 'solo';
  return null;
}

export function detectAiDancePropose(text: string): DanceMode | null {
  const t = text || '';
  if (AI_PROPOSES_CO_DANCE.test(t)) return 'co';
  if (AI_PROPOSES_SOLO_DANCE.test(t)) return 'solo';
  return null;
}

export function detectAiStopsDance(text: string): boolean {
  return AI_STOPS_DANCE.test(text || '');
}

export function detectAiContinuesDance(text: string): boolean {
  return AI_CONTINUES_DANCE.test(text || '');
}

export function detectAiAgreesDance(text: string): boolean {
  const t = text || '';
  if (!t.trim()) return false;
  if (AI_REFUSES_DANCE.test(t) && !AI_AGREES_DANCE.test(t)) return false;
  return AI_AGREES_DANCE.test(t);
}

export function detectAiRefusesDance(text: string): boolean {
  const t = text || '';
  if (!t.trim()) return false;
  return AI_REFUSES_DANCE.test(t) && !/但是|不过|虽然/.test(t.slice(0, 12));
}

/** dance_action 字段：propose_solo|propose_co|start_solo|start_co|stop|end */
export function parseDanceActionField(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === '""' || v === 'none' || v === 'null') return undefined;
  if (
    v === 'end' ||
    v === 'stop' ||
    v === 'propose_solo' ||
    v === 'propose_co' ||
    v === 'start_solo' ||
    v === 'start_co'
  ) {
    return v;
  }
  if (v === '结束' || v === '停下') return 'end';
  if (v.includes('propose') && v.includes('solo')) return 'propose_solo';
  if (v.includes('propose') && v.includes('co')) return 'propose_co';
  if (v.includes('start') && v.includes('solo')) return 'start_solo';
  if (v.includes('start') && v.includes('co')) return 'start_co';
  return undefined;
}

// ——— 指挥官提出（按钮/打字/语音同一路径），等角色本轮回应 ———

export function setPlayerDanceAsk(
  living: AiLivingSave,
  characterId: string,
  mode: DanceMode,
): DancePlayerAskPending | null {
  if (isDisciplineActiveFor(living, characterId)) return null;
  if (isBathAssistActiveFor(living, characterId)) return null;
  if (isAnfuActiveFor(living, characterId)) return null;
  if (isMiniGameActiveFor(living, characterId)) return null;
  if (!hasDanceAssets(characterId)) return null;
  const cur = getDanceSession(living);
  if (cur?.characterId === characterId && cur.mode === mode && cur.phase === 'dancing') return null;

  const pending: DancePlayerAskPending = {
    characterId,
    mode,
    proposedAt: Date.now(),
    isModeSwitch: Boolean(cur?.characterId === characterId),
  };
  living.pendingPlayerDanceAsk = pending;
  if (living.pendingDanceInvite?.characterId === characterId) {
    living.pendingDanceInvite = undefined;
  }
  return pending;
}

export function clearPlayerDanceAsk(living: AiLivingSave, characterId?: string): void {
  const p = living.pendingPlayerDanceAsk;
  if (!p) return;
  if (characterId && p.characterId !== characterId) return;
  living.pendingPlayerDanceAsk = undefined;
}

/**
 * 角色愿意跳舞 → 只登记「待指挥官确认」的邀请条，不直接拉进场景。
 * 与安抚室同一规则：含糊答应（先忙完/等一下）不算同意。
 */
export function offerDanceInviteFromTurn(
  living: AiLivingSave,
  characterId: string,
  mode: DanceMode,
): DanceInvitePending | null {
  const active = isDanceActiveFor(living, characterId);
  if (active && getDanceSession(living)?.mode === mode) return null;
  if (isDisciplineActiveFor(living, characterId)) return null;
  if (isBathAssistActiveFor(living, characterId)) return null;
  if (isAnfuActiveFor(living, characterId)) return null;
  if (isMiniGameActiveFor(living, characterId)) return null;
  if (living.pendingDanceInvite?.characterId === characterId) {
    return living.pendingDanceInvite;
  }
  if (living.pendingPlayerDanceAsk?.characterId) return null;
  if (living.pendingDisciplineInvite?.characterId) return null;
  if (living.pendingBathAssistInvite?.characterId) return null;
  if (living.pendingMiniGameInvite?.characterId) return null;
  if (living.pendingPlayerMiniGameAsk?.characterId) return null;
  if (!hasDanceAssets(characterId)) return null;

  const needId = mode === 'co' ? GONGWU_SKIN_ID : DANDU_SKIN_ID;
  if (!getCharacterSkin(characterId, needId)) return null;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const pending: DanceInvitePending = {
    characterId,
    mode,
    proposedAt: Date.now(),
    dayIndex: living.dayIndex,
    preview:
      mode === 'co'
        ? `${name}愿意和你一同跳舞，现在去大厅吗？`
        : `${name}愿意跳舞给你看，现在去大厅吗？`,
  };
  living.pendingDanceInvite = pending;
  return pending;
}

export function getPlayerDanceAsk(
  living: AiLivingSave,
  characterId?: string,
): DancePlayerAskPending | null {
  const p = living.pendingPlayerDanceAsk;
  if (!p) return null;
  if (characterId && p.characterId !== characterId) return null;
  return p;
}

/** 角色本轮回应指挥官邀请 */
export function resolvePlayerDanceAskFromTurn(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  opts: { danceAction?: string; dialogue: string; action?: string },
): DanceEnterResult | null {
  const pending = getPlayerDanceAsk(living, characterId);
  if (!pending) return null;

  const speech = `${opts.dialogue} ${opts.action ?? ''}`;
  const action = opts.danceAction;
  const startMatch =
    (pending.mode === 'co' && action === 'start_co') ||
    (pending.mode === 'solo' && action === 'start_solo');
  const proposeMatch =
    (pending.mode === 'co' && action === 'propose_co') ||
    (pending.mode === 'solo' && action === 'propose_solo');
  const refused = action === 'end' || detectAiRefusesDance(speech);
  const hedged = AI_HEDGES_DANCE.test(speech);
  // 「等我换一下衣服 / 我换好就过去 / 正准备出门」= 已在为跳舞做准备，属于同意而不是拖延。
  const preparing =
    /换(?:一下|个|好|完)?(?:衣服|衣裳|装|舞装|裙)|我换好了?|这就(?:去|来|过去)|马上(?:就)?(?:去|过去|到)|准备一下就(?:去|过去)|收拾(?:一下|好)就(?:去|过去)|正要去|这就过去/.test(
      speech,
    );
  const topical =
    /跳|起舞|独舞|共舞|大厅|舞|节拍|音乐|一段|过去|一起去|走吧/.test(speech) ||
    detectAiDancePropose(speech) === pending.mode;
  // 语音/打字触发修复（与小游戏/安抚同病）：fresh 窗口（邀请发出 5 分钟内）的简短明确
  // 同意词免 topical——LLM 常只说"好呀"，此前会被静默丢弃；过窗后仍需 topical 防误触。
  const askFresh = Date.now() - pending.proposedAt < 5 * 60_000;
  const softAgree =
    askFresh &&
    !refused &&
    !hedged &&
    speech.trim().length > 0 &&
    speech.trim().length <= 24 &&
    /好的?|好啊?|行啊?|可以|来吧|来嘛|嗯+|走吧|去吧|跳吧|开始吧/.test(speech);
  const agreed =
    !refused &&
    (startMatch ||
      proposeMatch ||
      preparing ||
      softAgree ||
      (!hedged &&
        topical &&
        (detectAiAgreesDance(speech) || detectAiDancePropose(speech) === pending.mode)));

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;

  if (refused && !startMatch) {
    clearPlayerDanceAsk(living, characterId);
    return {
      ok: false,
      msg: `${name}婉拒了「${danceModeLabel(pending.mode)}」。`,
      systemLine: `【系统】${name}婉拒了「${danceModeLabel(pending.mode)}」。`,
    };
  }
  if (!agreed) {
    // 含糊答应（先把手头的事处理完再说 / 回头再说）：不取消邀请，保留待回应，下一轮继续判；
    // 绝不能因为一次拖延就把事件清掉（历史 BUG：说「还没换衣服等我一下」把邀请清空 → 舞蹈永远开不了）。
    if (hedged) {
      return null;
    }
    return null;
  }

  clearPlayerDanceAsk(living, characterId);

  // 已在舞蹈事件中切换模式：事件内直接换，不涉及"强行拉进场景"
  if (pending.isModeSwitch) {
    return enterDanceSession(save, living, characterId, pending.mode, 'player_chat');
  }

  // 首次进入：答应即进场景（先进换舞装相 → 舞蹈待机 → 起舞）。
  // 「等我换衣服」这句正好对应 enterDanceSession 的 dressing 相，不需要额外的确认步。
  return enterDanceSession(save, living, characterId, pending.mode, 'player_chat');
}

export function playerAffirmsDanceInvite(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/不(?:行|要|去)|拒绝|算了|下次/.test(t)) return false;
  return (
    /^(好|好的|行|嗯+|走|去|可以|来吧|一起|跳舞|走吧)([。.!！~～…]*)$/i.test(t) ||
    /一起跳|跳吧|那就跳|来吧|好啊/.test(t)
  );
}

export function playerRejectsDanceInvite(text: string): boolean {
  const t = (text || '').trim();
  return /不(?:行|要|去)|拒绝|算了|下次再说|先不|不跳/.test(t);
}

// ——— 角色主动邀请 ———

export function maybeProposeDanceInvite(
  living: AiLivingSave,
  characterId: string,
  dialogue: string,
  modeHint?: DanceMode | null,
): DanceInvitePending | null {
  const active = isDanceActiveFor(living, characterId);
  if (isDisciplineActiveFor(living, characterId)) return null;
  if (isBathAssistActiveFor(living, characterId)) return null;
  if (isMiniGameActiveFor(living, characterId)) return null;
  if (living.pendingDanceInvite?.characterId === characterId) return null;
  if (living.pendingPlayerDanceAsk?.characterId) return null;
  if (living.pendingDisciplineInvite?.characterId) return null;
  if (living.pendingBathAssistInvite?.characterId) return null;
  if (living.pendingMiniGameInvite?.characterId) return null;
  if (living.pendingPlayerMiniGameAsk?.characterId) return null;
  if (!hasDanceAssets(characterId)) return null;

  const cool = living.danceInviteCooldownDay?.[characterId];
  if (cool != null && cool === living.dayIndex) return null;

  const mode = modeHint ?? detectAiDancePropose(dialogue);
  if (!mode) return null;
  const needId = mode === 'co' ? GONGWU_SKIN_ID : DANDU_SKIN_ID;
  if (!getCharacterSkin(characterId, needId)) return null;
  if (active && getDanceSession(living)?.mode === mode) return null;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const pending: DanceInvitePending = {
    characterId,
    mode,
    proposedAt: Date.now(),
    dayIndex: living.dayIndex,
    preview:
      mode === 'co'
        ? `${name}想邀你一同跳舞，去大厅吗？`
        : `${name}想让你看她跳舞，去大厅吗？`,
  };
  living.pendingDanceInvite = pending;
  return pending;
}

export function acceptDanceInvite(save: SaveData, living: AiLivingSave): DanceEnterResult {
  const pending = living.pendingDanceInvite;
  if (!pending) return { ok: false, msg: '没有待确认的舞蹈邀请' };
  const characterId = pending.characterId;
  const mode = pending.mode;
  living.pendingDanceInvite = undefined;
  if (!living.danceInviteCooldownDay) living.danceInviteCooldownDay = {};
  living.danceInviteCooldownDay[characterId] = living.dayIndex;
  return enterDanceSession(save, living, characterId, mode, 'character_invite');
}

export function rejectDanceInvite(living: AiLivingSave): void {
  const pending = living.pendingDanceInvite;
  if (!pending) return;
  living.pendingDanceInvite = undefined;
  if (!living.danceInviteCooldownDay) living.danceInviteCooldownDay = {};
  living.danceInviteCooldownDay[pending.characterId] = living.dayIndex;
}

export function consumeDanceJustEntered(living: AiLivingSave, characterId: string): boolean {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId || !s.justEntered) return false;
  s.justEntered = false;
  return true;
}

// ——— Prompt 块 ———

export function buildDanceActivePromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const s = getDanceSession(living);
  if (!s || s.characterId !== characterId) return '';
  const label = s.mode ? danceModeLabel(s.mode) : '准备跳舞';
  const inHallNow = isDanceHallRoom(resolvePresence(characterId, living).roomId);
  if (s.phase === 'dressing') {
    return `【世界同步·舞蹈·换舞装中·最高优先】
当前舞蹈事件：你正在换舞装，玩家眼前是「换装中」动态，还看不到舞装。
- 你${inHallNow ? '已经' : '还没'}在大厅：以【你在营地的位置】为准；还没到就禁止说已经在大厅。
- 本轮不要填 dance_action，禁止说已经换好/已经待机/已经在跳。
- 可以写换装过程（拉拉链、整理裙摆）并让指挥官等一下；换完系统会通知你，之后还要走过去。
- 禁止假装在做别的事。`.trim();
  }
  if (s.phase === 'travel') {
    const remain = (() => {
      const p = resolvePresence(characterId, living);
      return p.behavior;
    })();
    return `【世界同步·舞蹈·赶路中·最高优先】
当前舞蹈事件：你正在去大厅的路上（${remain}），还没开始换舞装/起舞。
- 本轮不要填 dance_action；禁止说已经在大厅待机或已经在跳。
- 可以写走楼梯、推门、路上遇见谁之类的过程；到了大厅系统会通知你。
- 玩家眼前是你当前所在处（出发房间/楼梯/大厅，随脚步实时切换），以【你在营地的位置】为准。`.trim();
  }
  if (s.phase === 'unveil') {
    return `【世界同步·舞蹈·换演出服·最高优先】
当前舞蹈事件：你正在大厅换演出服（玩家眼前是换装中动态），马上开始跳。
- 本轮不要填 dance_action，禁止说已经在跳/已经跳完。
- 可以写整理衣摆、调整呼吸之类的过程；系统会在几秒后正式开始（音乐随之响起）。
- 禁止假装在别的房间或做别的事。`.trim();
  }
  if (s.phase === 'prepare') {
    return `【世界同步·舞蹈准备中·最高优先】
当前舞蹈事件：换好舞装，玩家眼前是你摆出起势站姿的「舞蹈待机」动态（pifu12）。
- 你${inHallNow ? '已在大厅' : '在大厅'}，还没开始跳。${label === '准备跳舞' ? '' : `本次想跳「${label}」。`}
- 本轮可继续寒暄/整装；准备就绪后填 dance_action=start_solo 或 start_co 开始；指挥官点按钮也会立刻开始。
- 禁止说已经在跳或已经跳完。`.trim();
  }
  if (s.mode === 'co') {
    const leftSec = s.coEndsAtMs ? Math.max(0, Math.ceil((s.coEndsAtMs - Date.now()) / 1000)) : 0;
    return `【世界同步·共舞中·最高优先】
当前舞蹈事件：你正与指挥官在大厅共舞（pifu10）。约 ${leftSec} 秒后本曲结束，随后退回准备态。
- 共舞按段落进行，跳完回到准备态；要继续须指挥官或你重新邀请。
- 想歇一下填 dance_action=stop（回舞蹈待机，事件仍在）；不想再跳了填 dance_action=end（换下舞装、离开大厅，事件结束）。
- 禁止假装在别的房间或做别的事。`.trim();
  }
  return `【世界同步·独舞中·最高优先】
当前舞蹈事件：你正独自在大厅起舞演出（pifu11），系统会无缝循环你的多段独舞动作，画面看起来你一直在跳。
- 可即兴、可邀功；想歇一下填 dance_action=stop（回舞蹈待机，事件仍在），想继续填 start_solo。
- 不想再跳、想去做别的事或换别的衣服：填 dance_action=end（系统会让你换下舞装并离开大厅，事件结束）。
- 你也可凭自己意愿停下或结束。
- 禁止假装在别的房间或做别的事。`.trim();
}

export function buildPlayerDanceAskPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const p = getPlayerDanceAsk(living, characterId);
  if (!p) return '';
  const label = danceModeLabel(p.mode);
  const start = p.mode === 'co' ? 'start_co' : 'start_solo';
  return `【世界同步·待你回应舞蹈邀请】
指挥官提出「${label}」（按钮/打字/语音等效）。
- 若愿意：对白明确答应，并填 dance_action=${start}；系统会通知并把你带到大厅——先进「换舞装」相，再切「舞蹈待机」(pifu12)，之后才开始跳。
- 若不愿，或你正在冲澡/安抚室/调教等其它事件中：对白说明原因并婉拒，dance_action 填 ""；不要描写已经在跳舞或已经在大厅。
- 未表态前禁止假装立绘已切到舞蹈。`.trim();
}

export function buildDanceJustLeftPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const s = living.danceSession;
  if (!s || s.characterId !== characterId || !s.justLeft) return '';
  const left = s.justLeftTurnsLeft ?? 0;
  if (left <= 0) {
    s.justLeft = false;
    return '';
  }
  s.justLeftTurnsLeft = left - 1;
  if (s.justLeftTurnsLeft <= 0) s.justLeft = false;
  return '【世界同步·舞蹈刚结束】刚才的舞蹈已结束，立绘已回日常外观。禁止继续写跳舞现场。';
}

export const DANCE_PROTOCOL = `【舞蹈事件 · dance_action】
- 只会在大厅（1F 大厅1/大厅2、2F 西大厅/中庭/南大厅）发生。指挥官点「舞蹈」按钮、打字或语音提出，效果相同。
- 两种玩法：一同跳舞（共舞，pifu10）/ 看你跳舞（独舞，pifu11）。
- 指挥官提出：先在对白里答应或拒绝；愿意填 dance_action=start_co（共舞）或 start_solo（独舞），拒绝填 "" 并说明。答应后系统会通知并把你带到大厅：先进「换舞装」相，再切「舞蹈待机」(pifu12)，之后才开始跳。禁止在换装/待机时说自己已经在跳。
- 你也可主动邀请：填 propose_co / propose_solo 并说清楚；系统弹确认条，指挥官同意后才进场景。
- 独舞：系统会无缝循环你的多段独舞动作，看起来一直在跳；你可自己或听指挥官停下/继续。
- 共舞：按片段时长进行，跳完退回准备态；要继续须重新邀请。
- 停下 vs 结束：
  · 只是累了想歇一会儿：dance_action=stop → 回舞蹈待机（事件继续，之后可再 start_solo/start_co）。
  · 不想再跳、想去做别的事/换别的衣服：dance_action=end → 系统会让你换下舞装并离开大厅，舞蹈事件结束（之后要做别的需重新邀请）。
- 【互斥·现实规则】人不可能同时做两件事：你正在冲澡/浴室互动、安抚室、调教或其它事件中时，指挥官约你跳舞必须婉拒并说明「等这边结束」，不得答应，也不得描写已经在大厅/已经在跳；系统不会把你从浴室或安抚室拉走。
- 非舞蹈事件时 dance_action 填 ""。`.trim();
