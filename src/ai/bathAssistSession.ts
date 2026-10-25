/**
 * 浴室互动会话：帮指挥官清洗 (pifu07) / 一同泡澡 (pifu08)
 *
 * - 与独自泡澡(pifu09)/蒸汽毛巾(pifu03)、脱巾同意互斥；结束共浴/帮洗后回挂独自洗浴皮
 * - 按钮仅浴室洗浴中显示；聊天可在任意场景提出（异地 → 强制进浴室）
 * - 指挥官按钮 / 打字 / 语音提出 → 等角色同意后才进房切皮（与角色邀请对称）
 * - 角色主动提出 → 邀请确认条；指挥官同意后才进浴室切立绘
 * - 结束：角色口头结束 / 关聊天页 / 角色离开浴室 → 默认留浴室并切独自泡澡
 */
import {
  BATH_ASSIST_TEMP_SKIN_INSTANCE,
  BATH_CO_SKIN_ID,
  BATH_HELP_SKIN_ID,
  BATHE_TEMP_SKIN_INSTANCE,
  getCharacterSkin,
  isAloneBathSkinId,
  resolveAloneBathSkinId,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import type { SaveData } from '../types';
import { clearEventTempSkinsForInstance, setEventTempSkin } from './campEvents/campEventEffects';
import { getCampWornSkinId } from './campOutfit';
import { forceScheduleOutfitChange, scheduleEventTempSkinChange } from './outfitChangeProcess';
import { isInSleepSystem, leaveSleepSystem, sleepWakeDifficulty } from './sleepSystem';
import { cancelTravel, planTravel } from './travel';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { snapAgentToRoom } from './campAgents';
import { setBathIntimateConsent } from './bathIntimateConsent';
import { clearDialogueSceneSnapshots } from './dialogueSceneSync';
import { isDisciplineActiveFor } from './disciplineSession';
import { isDanceActiveFor } from './danceSession';
import { isAnfuActiveFor } from './anfuSession';
import { isMiniGameActiveFor } from './miniGameSession';
import { recordPlayerActivityRequest } from './activityFatigue';
import { applyMoodImpulse } from './moodContinuum';
import { pushMemory, pushRecentChat } from './memory';
import type { AiLivingSave, CharacterActivity } from './types';
import { resolvePresence } from './livingState';

export const BATH_ASSIST_ROOM_ID = 'room_1f_bath';

export type BathAssistMode = 'help_wash' | 'co_bath';

export type BathAssistEntrySource =
  | 'player_button'
  | 'player_chat'
  | 'character_invite'
  | 'recover';

export type BathAssistSessionState = {
  active: boolean;
  characterId: string;
  mode: BathAssistMode;
  prevRoomId: string | null;
  prevCampSkinId: string | null;
  prevEventTemp?: import('./types').EventTempSkinState | null;
  startedAt: number;
  entrySource: BathAssistEntrySource;
  justEntered?: boolean;
  justLeft?: boolean;
  justLeftTurnsLeft?: number;
  settling?: boolean;
  /**
   * 共浴粘住交互：null=idle 裹巾共浴；2=脱巾粘住（交互02：前奏→_2_loop）。
   * 交互01（对视）为一次性，不写此字段。
   */
  stickyClip?: number | null;
  /** 指挥官点交互按钮后，等待角色本轮回应 */
  awaitingCoClipReply?: boolean;
  /** 等待中的交互：1=看对方；2=脱下浴巾 */
  pendingCoClip?: number | null;
  lastCoClipAt?: number;
};

/** 共浴交互冷却（毫秒） */
export const BATH_CO_CLIP_COOLDOWN_MS = 12_000;

export const BATH_CO_CLIP1_LABEL = '看对方';
export const BATH_CO_CLIP2_LABEL = '解下浴巾';

export function bathCoClipLabel(n: number): string {
  if (n === 1) return BATH_CO_CLIP1_LABEL;
  if (n === 2) return BATH_CO_CLIP2_LABEL;
  return `交互${n}`;
}

export function bathCoClipNote(n: number): string {
  if (n === 1) {
    return '共浴交互01：对视/看对方——暧昧对望、目光交汇；播完回共浴 idle（仍可裹巾）。';
  }
  if (n === 2) {
    return '共浴交互02：解下浴巾——须角色同意；同意后先播解巾前奏，再循环；重新裹巾则回 idle。';
  }
  return `共浴交互${n}`;
}

/**
 * 指挥官侧可见文案（聊天记录里的「你」）：口语情景，禁止出现字段名/代码。
 * 字段填写规则只写在系统提示里，不进玩家气泡。
 */
export function buildBathCoClipPlayerMessage(clip: 1 | 2): string {
  if (clip === 1) {
    return '我想看着你……让我对上你的眼睛。';
  }
  return '蒸汽里好热……浴巾解得下来吗？让我好好看看你。';
}

export type BathAssistInvitePending = {
  characterId: string;
  mode: BathAssistMode;
  proposedAt: number;
  dayIndex: number;
  preview: string;
  /** 指挥官先提出、角色已答应，现等指挥官点「去浴室」 */
  afterPlayerAsk?: boolean;
  /** 帮洗：去浴室前先换冲洗皮，再延迟切帮洗 */
  prepareWithShowerDelay?: boolean;
};

/** 指挥官提出帮洗/共浴后，等待角色本轮答应或拒绝 */
export type BathAssistPlayerAskPending = {
  characterId: string;
  mode: BathAssistMode;
  proposedAt: number;
  /** 已在另一模式中，同意后切换 */
  isModeSwitch?: boolean;
};

/** 口头约定「去浴室冲澡」但尚未落地时的软约会（防误切泳池） */
export type BathRoomRendezvous = {
  characterId: string;
  atGameMin: number;
};

export function buildBathAssistPlayerProposeMessage(mode: BathAssistMode): string {
  return mode === 'help_wash'
    ? '帮我清洗一下吧。'
    : '我们一同泡澡吧。';
}

export function bathAssistSkinId(mode: BathAssistMode): string {
  return mode === 'help_wash' ? BATH_HELP_SKIN_ID : BATH_CO_SKIN_ID;
}

export function bathAssistModeLabel(mode: BathAssistMode): string {
  return mode === 'help_wash' ? '帮指挥官清洗' : '一同泡澡';
}

export function getBathAssistSession(living: AiLivingSave): BathAssistSessionState | null {
  const s = living.bathAssistSession;
  if (!s?.active || !s.characterId) return null;
  return s;
}

export function isBathAssistActiveFor(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const s = getBathAssistSession(living);
  return !!s && s.characterId === characterId;
}

export function isBathAssistTempInstance(eventInstanceId: string | null | undefined): boolean {
  return eventInstanceId === BATH_ASSIST_TEMP_SKIN_INSTANCE;
}

/** 该角色是否具备浴室互动资源（帮洗 pifu07 / 共浴 pifu08） */
export function hasBathAssets(characterId: string): boolean {
  return Boolean(
    getCharacterSkin(characterId, BATH_HELP_SKIN_ID) ||
      getCharacterSkin(characterId, BATH_CO_SKIN_ID),
  );
}

/**
 * 聊天界面「洗浴」按钮显示条件（与舞蹈按钮同构）：
 * 有浴室互动资源 + 当前没有别的独占事件。
 * 注意：不要求角色已经在浴室——指挥官可以在任何场景发起邀请。
 */
export function canShowBathButtons(
  living: AiLivingSave,
  characterId: string,
): boolean {
  if (isDisciplineActiveFor(living, characterId)) return false;
  if (isDanceActiveFor(living, characterId)) return false;
  if (isAnfuActiveFor(living, characterId)) return false;
  if (isBathAssistActiveFor(living, characterId)) return false;
  return hasBathAssets(characterId);
}

/** 角色是否在浴室且处于洗浴语境（按钮显示条件） */
export function canShowBathAssistButtons(
  living: AiLivingSave,
  characterId: string,
): boolean {
  if (isDisciplineActiveFor(living, characterId)) return false;
  if (isDanceActiveFor(living, characterId)) return false;
  if (isAnfuActiveFor(living, characterId)) return false;
  if (isMiniGameActiveFor(living, characterId)) return false;
  const presence = resolvePresence(characterId, living);
  if (presence.roomId !== BATH_ASSIST_ROOM_ID) return false;
  if (presence.activity === 'bathe') return true;
  const temp = living.eventTempSkins?.[characterId];
  if (isAloneBathSkinId(temp?.skinId)) return true;
  if (temp?.skinId === BATH_HELP_SKIN_ID || temp?.skinId === BATH_CO_SKIN_ID) return true;
  const snap = living.dialogueTurnScene?.[characterId];
  if (snap?.roomId === BATH_ASSIST_ROOM_ID) return true;
  return false;
}

function writeBodyAnchor(
  living: AiLivingSave,
  characterId: string,
  roomId: string,
  activity: CharacterActivity,
  behavior: string,
): void {
  if (!living.bodyAnchors) living.bodyAnchors = {};
  const prev = living.bodyAnchors[characterId];
  living.bodyAnchors[characterId] = {
    roomId,
    activity,
    behavior,
    atGameMin: living.gameMinutes,
    seq: (prev?.seq ?? 0) + 1,
  };
}

function behaviorForMode(mode: BathAssistMode): string {
  return mode === 'help_wash'
    ? '在浴室帮指挥官清洗身体，专注冲淋与搓洗'
    : '在浴室与指挥官一同泡澡，共享热水与蒸汽';
}

function lockAgenda(living: AiLivingSave, characterId: string, mode: BathAssistMode): void {
  if (!living.agendas) living.agendas = {};
  living.agendas[characterId] = {
    goal: 'bath_assist',
    targetRoomId: BATH_ASSIST_ROOM_ID,
    activity: 'bathe',
    behavior: behaviorForMode(mode),
    remainGameMin: 9999,
    startedGameMin: living.gameMinutes,
    reason: `浴室互动：${bathAssistModeLabel(mode)}`,
    source: 'event',
    eventInstanceId: BATH_ASSIST_TEMP_SKIN_INSTANCE,
  };
}

function unlockAgenda(living: AiLivingSave, characterId: string): void {
  const a = living.agendas?.[characterId];
  if (a?.eventInstanceId === BATH_ASSIST_TEMP_SKIN_INSTANCE || a?.goal === 'bath_assist') {
    delete living.agendas![characterId];
  }
}

function syncBathAssistBody(
  living: AiLivingSave,
  characterId: string,
  mode: BathAssistMode,
): void {
  const behavior = behaviorForMode(mode);
  const curRoom = resolvePresence(characterId, living).roomId;
  if (living.travelPlans?.[characterId]?.reason === 'bath_entry') {
    // 已在赶路：只更新意图文案，不重置行程
    const a0 = living.agendas?.[characterId];
    if (a0 && (a0.goal === 'bath_assist' || a0.eventInstanceId === BATH_ASSIST_TEMP_SKIN_INSTANCE)) {
      a0.behavior = behavior;
      a0.activity = 'bathe';
    }
    return;
  }
  if (curRoom && curRoom !== BATH_ASSIST_ROOM_ID) {
    // 进浴室也要走路：先登记行程，到点由 tick 落点（不再瞬移）
    planTravel(living, characterId, BATH_ASSIST_ROOM_ID, curRoom, {
      activity: 'bathe',
      behavior: `去浴室${behavior}`,
      reason: 'bath_entry',
      arriveBehavior: behavior,
    });
  } else {
    writeBodyAnchor(living, characterId, BATH_ASSIST_ROOM_ID, 'bathe', behavior);
    snapAgentToRoom(characterId, BATH_ASSIST_ROOM_ID, {
      activity: 'bathe',
      behavior,
    });
  }
  const a = living.agendas?.[characterId];
  if (a && (a.goal === 'bath_assist' || a.eventInstanceId === BATH_ASSIST_TEMP_SKIN_INSTANCE)) {
    a.behavior = behavior;
    a.activity = 'bathe';
  }
}

export type BathAssistEnterResult = {
  ok: boolean;
  msg: string;
  systemLine?: string;
  switched?: boolean;
  /** 角色已答应，转为邀请条等指挥官确认（不立刻进房） */
  awaitingPlayerConfirm?: boolean;
  /** 帮洗：先换冲洗皮，由 UI 延迟后再 enter */
  prepareWithShowerDelay?: boolean;
  prepareCharacterId?: string;
  prepareMode?: BathAssistMode;
  prepareMs?: number;
};

/** 帮洗进房前：换冲洗皮 → 等待毫秒数后再切帮洗皮进浴室 */
export const BATH_HELP_PREPARE_MS = 7_000;

/**
 * 进入浴室互动：强制浴室 + 对应临时皮；清脱巾同意与独自洗浴皮(pifu09/03)。
 * 从独自泡澡切入共浴/帮洗：立绘由 bathe_auto → bath_assist，语义变为「指挥官已在场」。
 */
export function enterBathAssistSession(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  mode: BathAssistMode,
  entrySource: BathAssistEntrySource = 'player_button',
): BathAssistEnterResult {
  if (!CHARACTER_MAP[characterId]) {
    return { ok: false, msg: '角色不存在' };
  }
  if (isDisciplineActiveFor(living, characterId)) {
    return { ok: false, msg: '当前事件中无法开始浴室互动' };
  }
  if (isDanceActiveFor(living, characterId)) {
    return { ok: false, msg: '舞蹈事件中无法开始浴室互动（等舞蹈结束）' };
  }
  if (isAnfuActiveFor(living, characterId)) {
    return { ok: false, msg: '安抚室事件中无法开始浴室互动（等安抚结束）' };
  }
  if (isMiniGameActiveFor(living, characterId)) {
    return { ok: false, msg: '小游戏对局中无法开始浴室互动（等对局结束）' };
  }
  const skinId = bathAssistSkinId(mode);
  if (!getCharacterSkin(characterId, skinId)) {
    return { ok: false, msg: `该角色暂无「${bathAssistModeLabel(mode)}」资源` };
  }

  // 睡眠中要先去浴室就得醒：叫不醒则进不去（不能睡着洗澡）
  if (isInSleepSystem(living, characterId)) {
    if (!sleepWakeDifficulty(living, characterId).wakeable) {
      return { ok: false, msg: '她睡得太沉，叫不醒——等醒了再去浴室' };
    }
    leaveSleepSystem(living, characterId, {
      reason: '被指挥官叫去浴室，醒了过来',
      completed: false,
    });
  }

  const existing = getBathAssistSession(living);
  if (existing) {
    if (existing.characterId !== characterId) {
      return { ok: false, msg: '另一名角色正在浴室互动中' };
    }
    if (existing.mode === mode) {
      return { ok: true, msg: `已在「${bathAssistModeLabel(mode)}」中` };
    }
    // 同角色切换模式：只换皮与行为
    existing.mode = mode;
    existing.justEntered = true;
    existing.stickyClip = null;
    existing.awaitingCoClipReply = false;
    existing.pendingCoClip = null;
    setBathIntimateConsent(living, characterId, false);
    syncBathAssistBody(living, characterId, mode);
    setEventTempSkin(save, living, characterId, skinId, BATH_ASSIST_TEMP_SKIN_INSTANCE);
    if (!living.eventTempSkins) living.eventTempSkins = {};
    living.eventTempSkins[characterId] = {
      skinId,
      restoreSkinId: existing.prevCampSkinId,
      eventInstanceId: BATH_ASSIST_TEMP_SKIN_INSTANCE,
    };
    lockAgenda(living, characterId, mode);
    const name = CHARACTER_MAP[characterId]?.name ?? characterId;
    const systemLine = `【系统】切换为「${bathAssistModeLabel(mode)}」。`;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `${name}与指挥官切换浴室互动：${bathAssistModeLabel(mode)}`,
      importance: 5,
    });
    return { ok: true, msg: systemLine, systemLine, switched: true };
  }

  const presence = resolvePresence(characterId, living);
  const prevRoomId = presence.roomId || null;
  const prevCampSkinId = getCampWornSkinId(living, characterId);
  const prevTempRaw = living.eventTempSkins?.[characterId];
  const prevEventTemp =
    prevTempRaw &&
    prevTempRaw.eventInstanceId !== BATH_ASSIST_TEMP_SKIN_INSTANCE &&
    prevTempRaw.eventInstanceId !== BATHE_TEMP_SKIN_INSTANCE
      ? { ...prevTempRaw }
      : null;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;

  clearDialogueSceneSnapshots(living, [characterId]);
  setBathIntimateConsent(living, characterId, false);

  // 清掉独自泡澡/蒸汽毛巾临时层，避免与 07/08 叠皮
  const prevBatheTemp = living.eventTempSkins?.[characterId];
  if (
    prevBatheTemp &&
    (prevBatheTemp.eventInstanceId === BATHE_TEMP_SKIN_INSTANCE ||
      isAloneBathSkinId(prevBatheTemp.skinId))
  ) {
    delete living.eventTempSkins![characterId];
  }

  living.bathAssistSession = {
    active: true,
    characterId,
    mode,
    prevRoomId,
    prevCampSkinId,
    prevEventTemp,
    startedAt: Date.now(),
    entrySource,
    justEntered: true,
    justLeft: false,
    justLeftTurnsLeft: 0,
    stickyClip: null,
    awaitingCoClipReply: false,
    pendingCoClip: null,
    lastCoClipAt: 0,
  };

  syncBathAssistBody(living, characterId, mode);
  setEventTempSkin(save, living, characterId, skinId, BATH_ASSIST_TEMP_SKIN_INSTANCE);
  if (!living.eventTempSkins) living.eventTempSkins = {};
  living.eventTempSkins[characterId] = {
    skinId,
    restoreSkinId: prevCampSkinId,
    eventInstanceId: BATH_ASSIST_TEMP_SKIN_INSTANCE,
  };
  lockAgenda(living, characterId, mode);

  if (living.pendingOutfitChanges?.[characterId]) {
    delete living.pendingOutfitChanges[characterId];
  }
  if (living.pendingBathAssistInvite?.characterId === characterId) {
    living.pendingBathAssistInvite = undefined;
  }
  clearPlayerBathAssistAsk(living, characterId);
  clearBathRoomRendezvous(living, characterId);

  // 重复活动厌倦：今天第 N 次找她洗澡（超耐心阈值会打厌倦脉冲）
  recordPlayerActivityRequest(living, characterId, 'bath');

  const fromElse =
    prevRoomId && prevRoomId !== BATH_ASSIST_ROOM_ID
      ? `（从${prevRoomId === 'room_1f_bath' ? '浴室' : '别处'}转入浴室）`
      : '';
  const systemLine = `【系统】${name}开始「${bathAssistModeLabel(mode)}」${fromElse}。`;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}与指挥官开始浴室互动：${bathAssistModeLabel(mode)}（来源：${entrySource}）`,
    importance: 6,
  });
  // The next proactive/reply turn must see the transition even when the
  // previous model response was generated before the confirmation click.
  pushRecentChat(
    living,
    characterId,
    'user',
    `【系统事实·已生效】${name}已经接受指挥官的「${bathAssistModeLabel(mode)}」并进入浴室。指挥官已经在现场；当前画面与状态是${bathAssistModeLabel(mode)}，禁止再询问是否同意、是否去浴室或催指挥官进来。`,
  );

  return { ok: true, msg: '已开始浴室互动', systemLine };
}

export type BathAssistLeaveResult = {
  ok: boolean;
  msg: string;
  systemLine?: string;
};

/**
 * 结束浴室互动并还原（幂等）。
 * 默认留在浴室并挂回独自泡澡(pifu09，无则 pifu03)；指挥官离开共浴 → 角色独自继续泡。
 * restorePrevRoom=true 时回进事件前房间。
 */
export function leaveBathAssistSession(
  save: SaveData,
  living: AiLivingSave,
  opts?: {
    reason?: string;
    /** 读档/关页强制完成 */
    force?: boolean;
    /** true=回进事件前房间；false/默认=留在浴室继续独自洗浴 */
    restorePrevRoom?: boolean;
  },
): BathAssistLeaveResult {
  const session = living.bathAssistSession;
  if (!session?.active) {
    scrubOrphanBathAssistArtifacts(living);
    return { ok: false, msg: '未在浴室互动中' };
  }
  if (session.settling && !opts?.force) {
    return { ok: true, msg: '结算中' };
  }
  session.settling = true;

  const characterId = session.characterId;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const modeLabel = bathAssistModeLabel(session.mode);
  const restorePrevRoom = opts?.restorePrevRoom === true;
  const targetRoom =
    restorePrevRoom && session.prevRoomId ? session.prevRoomId : BATH_ASSIST_ROOM_ID;

  clearEventTempSkinsForInstance(living, BATH_ASSIST_TEMP_SKIN_INSTANCE, { dressBack: false });
  unlockAgenda(living, characterId);

  // 还原其它事件临时皮，或挂回独自泡澡（仍在浴室）；都走换装过程，不瞬间切皮
  const aloneId = resolveAloneBathSkinId(characterId);
  if (session.prevEventTemp?.skinId) {
    scheduleEventTempSkinChange(
      living,
      characterId,
      session.prevEventTemp.skinId,
      session.prevEventTemp.eventInstanceId,
      2_600,
    );
  } else if (targetRoom === BATH_ASSIST_ROOM_ID && aloneId) {
    scheduleEventTempSkinChange(living, characterId, aloneId, BATHE_TEMP_SKIN_INSTANCE, 2_600);
  } else {
    // 离开浴室：换回营地日常（换装过程）
    forceScheduleOutfitChange(living, characterId, getCampWornSkinId(living, characterId), 3_600);
  }

  const stayBath = targetRoom === BATH_ASSIST_ROOM_ID;
  const behavior = stayBath
    ? '在浴室独自泡澡/洗浴'
    : `离开浴室互动，回原处`;
  const curRoom = resolvePresence(characterId, living).roomId;
  cancelTravel(living, characterId);
  if (curRoom && curRoom !== targetRoom && CAMP_ROOM_MAP[curRoom]) {
    // 出浴室/回原处也要走路
    planTravel(living, characterId, targetRoom, curRoom, {
      activity: stayBath ? 'bathe' : 'idle',
      behavior,
      reason: 'bath_exit',
      arriveBehavior: behavior,
    });
  } else {
    writeBodyAnchor(
      living,
      characterId,
      targetRoom,
      stayBath ? 'bathe' : 'idle',
      behavior,
    );
    snapAgentToRoom(characterId, targetRoom, {
      activity: stayBath ? 'bathe' : 'idle',
      behavior,
    });
  }

  clearDialogueSceneSnapshots(living, [characterId]);
  setBathIntimateConsent(living, characterId, false);

  living.bathAssistSession = {
    ...session,
    active: false,
    settling: false,
    justEntered: false,
    justLeft: true,
    justLeftTurnsLeft: 2,
    stickyClip: null,
    awaitingCoClipReply: false,
    pendingCoClip: null,
  };

  const reason = opts?.reason ?? '结束';
  const systemLine = `【系统】「${modeLabel}」已结束（${reason}）。${
    stayBath ? `${name}仍在浴室。` : `${name}离开浴室互动。`
  }`;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}结束浴室互动「${modeLabel}」（${reason}）`,
    importance: 5,
  });
  // 浴室互动落幕：心情 up（被照顾/亲密后的放松愉悦）
  applyMoodImpulse(living, characterId, { kind: 'event', tone: 'up' });

  return { ok: true, msg: '已结束浴室互动', systemLine };
}

export function settleActiveBathAssistSession(
  save: SaveData,
  living: AiLivingSave,
  reason: string,
): BathAssistLeaveResult | null {
  const s = getBathAssistSession(living);
  if (!s) return null;
  if (living.bathAssistSession?.settling) {
    living.bathAssistSession.settling = false;
  }
  return leaveBathAssistSession(save, living, {
    reason,
    force: true,
    restorePrevRoom: true,
  });
}

export function recoverStaleBathAssistSession(
  save: SaveData,
  living: AiLivingSave,
): boolean {
  return Boolean(settleActiveBathAssistSession(save, living, '读档/异常自动结束'));
}

function scrubOrphanBathAssistArtifacts(living: AiLivingSave): void {
  const map = living.eventTempSkins;
  if (map) {
    for (const [cid, st] of Object.entries(map)) {
      if (st.eventInstanceId === BATH_ASSIST_TEMP_SKIN_INSTANCE) {
        delete map[cid];
      }
    }
  }
  const agendas = living.agendas;
  if (agendas) {
    for (const [cid, a] of Object.entries(agendas)) {
      if (a.eventInstanceId === BATH_ASSIST_TEMP_SKIN_INSTANCE || a.goal === 'bath_assist') {
        delete agendas[cid];
      }
    }
  }
}

/** 角色已离开浴室 → 强制结束互动 */
export function clearBathAssistIfLeftBathroom(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): void {
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId) return;
  const presence = resolvePresence(characterId, living);
  if (presence.roomId === BATH_ASSIST_ROOM_ID) return;
  leaveBathAssistSession(save, living, {
    reason: '离开浴室',
    force: true,
    restorePrevRoom: false,
  });
}

// ——— 对白检测 ———

/** 指挥官要求「帮我清洗 / 帮我冲澡」 */
export const PLAYER_ASKS_HELP_WASH =
  /帮我(?:清洗|冲澡|洗澡|洗一下|洗洗)|给我(?:清洗|冲澡|洗澡|洗)|帮指挥官(?:清洗|冲澡|洗澡)|你(?:来|帮).{0,8}(?:清洗|冲澡|洗澡)|帮(?:我|指挥官).{0,6}(?:洗(?:个|下)?澡|冲(?:个|下)?澡)/;

/** 指挥官要求「一同泡澡」 */
export const PLAYER_ASKS_CO_BATH =
  /一起(?:泡澡|洗澡|冲澡|洗)|一同泡澡|共浴|跟我一起(?:泡|洗|冲)|陪我(?:泡澡|洗澡)|我们一起(?:泡|洗)/;

/** 角色主动提出帮指挥官洗 */
export const AI_PROPOSES_HELP_WASH =
  /(?:想|要|可以|来).{0,8}帮(?:你|指挥官).{0,8}(?:清洗|冲澡|洗澡|洗)|帮(?:你|指挥官).{0,6}(?:清洗|冲澡|洗澡)|给你(?:清洗|冲澡|洗澡|洗一下)|去浴室.{0,20}帮(?:你|指挥官).{0,8}(?:洗|冲)/;

/** 角色主动提出一同泡澡 / 一起去冲澡 */
export const AI_PROPOSES_CO_BATH =
  /(?:想|要|可以|来|我们|咱们).{0,12}(?:一起|一同).{0,8}(?:泡澡|洗澡|冲澡|洗)|一起(?:泡澡|洗澡|冲澡|洗)|一同泡澡|共浴|陪你(?:泡澡|洗澡)|去(?:营地)?浴室.{0,24}一起|一起.{0,12}去(?:营地)?浴室|把水放好.{0,12}一起|一起洗/;

/** 角色结束互动 */
export const AI_ENDS_BATH_ASSIST =
  /(?:洗|冲|泡)(?:好了|完了|结束)|结束(?:清洗|泡澡|同浴)|不(?:再|继续)(?:帮你洗|一起泡)|先这样(?:吧)?|出水(?:吧|了)|擦干/;

/** 角色答应指挥官的帮洗/共浴邀请 */
export const AI_AGREES_BATH_ASSIST =
  /好的?|好啊|行啊?|可以|没问题|走吧|去吧|来吧|一起(?:吧|啊|呀)?|那就|那我|陪你|嗯+|同意|当然|乐意|答应|勉为其难|既然|坚持|过来吧|别磨蹭|别磨磨蹭蹭/;

/** 角色拒绝指挥官的帮洗/共浴邀请 */
export const AI_REFUSES_BATH_ASSIST =
  /不(?:行|要|能|想)|拒绝|改天|下次|现在不行|先别|等一下再|没空|累了/;

export function detectPlayerBathAssistMode(text: string): BathAssistMode | null {
  const t = text || '';
  // 共浴优先于帮洗（「一起洗」更明确）
  if (PLAYER_ASKS_CO_BATH.test(t)) return 'co_bath';
  if (PLAYER_ASKS_HELP_WASH.test(t)) return 'help_wash';
  return null;
}

export function detectAiBathAssistPropose(text: string): BathAssistMode | null {
  const t = text || '';
  if (AI_PROPOSES_CO_BATH.test(t)) return 'co_bath';
  if (AI_PROPOSES_HELP_WASH.test(t)) return 'help_wash';
  return null;
}

export function detectAiBathAssistEnd(text: string): boolean {
  return AI_ENDS_BATH_ASSIST.test(text || '');
}

export function detectAiAgreesBathAssist(text: string): boolean {
  const t = text || '';
  if (!t.trim()) return false;
  if (AI_REFUSES_BATH_ASSIST.test(t) && !AI_AGREES_BATH_ASSIST.test(t)) return false;
  return AI_AGREES_BATH_ASSIST.test(t);
}

export function detectAiRefusesBathAssist(text: string): boolean {
  const t = text || '';
  if (!t.trim()) return false;
  return AI_REFUSES_BATH_ASSIST.test(t) && !/但是|不过|虽然/.test(t.slice(0, 12));
}

export function parseBathAssistActionField(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === '""' || v === 'none' || v === 'null') return undefined;
  if (
    v === 'end' ||
    v === 'propose_help' ||
    v === 'propose_co' ||
    v === 'start_help' ||
    v === 'start_co'
  ) {
    return v;
  }
  if (v === '结束' || v === '停下') return 'end';
  if (v.includes('propose') && v.includes('help')) return 'propose_help';
  if (v.includes('propose') && (v.includes('co') || v.includes('bath'))) return 'propose_co';
  if (v.includes('start') && v.includes('help')) return 'start_help';
  if (v.includes('start') && (v.includes('co') || v.includes('bath'))) return 'start_co';
  return undefined;
}

/** 指挥官提出（按钮/打字/语音同一路径）：只登记等待，不立刻切皮 */
export function setPlayerBathAssistAsk(
  living: AiLivingSave,
  characterId: string,
  mode: BathAssistMode,
): BathAssistPlayerAskPending | null {
  if (isDisciplineActiveFor(living, characterId)) return null;
  if (isMiniGameActiveFor(living, characterId)) return null;
  if (!getCharacterSkin(characterId, bathAssistSkinId(mode))) return null;

  const cur = getBathAssistSession(living);
  if (cur?.characterId === characterId && cur.mode === mode) return null;

  const pending: BathAssistPlayerAskPending = {
    characterId,
    mode,
    proposedAt: Date.now(),
    isModeSwitch: Boolean(cur?.characterId === characterId && cur.mode !== mode),
  };
  living.pendingPlayerBathAssistAsk = pending;
  // 与角色邀请互斥：指挥官已主动提出时清掉对方邀请条
  if (living.pendingBathAssistInvite?.characterId === characterId) {
    living.pendingBathAssistInvite = undefined;
  }
  return pending;
}

export function clearPlayerBathAssistAsk(living: AiLivingSave, characterId?: string): void {
  const p = living.pendingPlayerBathAssistAsk;
  if (!p) return;
  if (characterId && p.characterId !== characterId) return;
  living.pendingPlayerBathAssistAsk = undefined;
}

export function getPlayerBathAssistAsk(
  living: AiLivingSave,
  characterId?: string,
): BathAssistPlayerAskPending | null {
  const p = living.pendingPlayerBathAssistAsk;
  if (!p) return null;
  if (characterId && p.characterId !== characterId) return null;
  return p;
}

/**
 * 角色本轮回应指挥官邀请：同意则进会话；拒绝则清除等待。
 * 返回 enter 结果或拒绝说明。
 */
export function resolvePlayerBathAssistAskFromTurn(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  opts: {
    bathAssistAction?: string;
    dialogue: string;
    action?: string;
  },
): BathAssistEnterResult | null {
  const pending = getPlayerBathAssistAsk(living, characterId);
  if (!pending) return null;

  const speech = `${opts.dialogue} ${opts.action ?? ''}`;
  const action = opts.bathAssistAction;
  const startMatch =
    (pending.mode === 'help_wash' && action === 'start_help') ||
    (pending.mode === 'co_bath' && action === 'start_co') ||
    (pending.mode === 'help_wash' && action === 'propose_help') ||
    (pending.mode === 'co_bath' && action === 'propose_co');

  const refused = action === 'end' || detectAiRefusesBathAssist(speech);
  const topical =
    /清洗|冲澡|洗澡|泡澡|共浴|一起(?:泡|洗|冲)|浴室|帮你洗|陪你|喷头|水温|热水|水脏|乱动|坚持|答应/.test(
      speech,
    ) || detectAiBathAssistPropose(speech) === pending.mode;
  const agreed =
    startMatch ||
    (!refused &&
      topical &&
      (detectAiAgreesBathAssist(speech) || detectAiBathAssistPropose(speech) === pending.mode));

  if (refused && !startMatch) {
    clearPlayerBathAssistAsk(living, characterId);
    const name = CHARACTER_MAP[characterId]?.name ?? characterId;
    return {
      ok: false,
      msg: `${name}婉拒了「${bathAssistModeLabel(pending.mode)}」。`,
      systemLine: `【系统】${name}婉拒了「${bathAssistModeLabel(pending.mode)}」。`,
    };
  }

  if (!agreed) {
    // 尚未表态：保持等待，下轮再判
    return null;
  }

  clearPlayerBathAssistAsk(living, characterId);

  // 已在浴室互动中切换模式：立刻切皮
  if (pending.isModeSwitch) {
    return enterBathAssistSession(save, living, characterId, pending.mode, 'player_chat');
  }

  // 首次进入：角色答应后先发确认邀请，不立刻拖进场景
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const label = bathAssistModeLabel(pending.mode);
  const prepareHelp = pending.mode === 'help_wash';
  living.pendingBathAssistInvite = {
    characterId,
    mode: pending.mode,
    proposedAt: Date.now(),
    dayIndex: living.dayIndex,
    preview: prepareHelp
      ? `${name}答应帮你清洗了。去浴室吗？她会先换上浴巾冲澡皮，稍后再开始帮洗。`
      : `${name}答应「${label}」了。去浴室吗？`,
    afterPlayerAsk: true,
    prepareWithShowerDelay: prepareHelp,
  };
  const systemLine = `【系统】${name}答应了「${label}」。请确认是否去浴室。`;
  living.bathAssistUiFlash = systemLine;
  return {
    ok: true,
    msg: systemLine,
    systemLine,
    awaitingPlayerConfirm: true,
  };
}

/**
 * 角色在让指挥官去冲澡（「你先去洗澡」），不是自己赴约进浴室。
 * 这类对白不得强制角色进浴室换冲洗皮。
 */
export function isDirectingPlayerToBathe(speech: string): boolean {
  const s = speech || '';
  if (!/(?:冲澡|洗澡|洗浴|冲个澡|洗个澡|去浴室)/.test(s)) return false;
  if (/我们一起|一起(?:去|来)?(?:冲澡|洗澡|洗)|我(?:也|就|这就|现在)?(?:去|来)(?:冲澡|洗澡|洗)/.test(s)) {
    return false;
  }
  return /你(?:先|就|也)?(?:去|来)(?:冲澡|洗澡|洗浴|冲个澡|洗个澡|浴室)|指挥官(?:你)?(?:先)?(?:去|来)(?:冲澡|洗澡|洗)|那你(?:先)?去(?:冲澡|洗澡)/.test(
    s,
  );
}

/** 口头「去浴室冲澡」约会：防说好冲澡却落到泳池 */
export function noteBathRoomRendezvous(
  living: AiLivingSave,
  characterId: string,
  speech: string,
): void {
  if (isBathAssistActiveFor(living, characterId)) return;
  if (isDirectingPlayerToBathe(speech)) return;
  if (
    /去(?:营地)?浴室|(?:去|来)(?:冲澡|洗澡|洗浴)|浴室.{0,12}(?:放水|放好|热水)|一起(?:冲澡|洗澡|洗)|冲个澡|洗个澡/.test(
      speech || '',
    )
  ) {
    living.pendingBathRoomRendezvous = {
      characterId,
      atGameMin: living.gameMinutes,
    };
  }
}

export function clearBathRoomRendezvous(living: AiLivingSave, characterId?: string): void {
  const p = living.pendingBathRoomRendezvous;
  if (!p) return;
  if (characterId && p.characterId !== characterId) return;
  living.pendingBathRoomRendezvous = undefined;
}

/** 是否应强制落到浴室（口头约定 + 动身/答应）——没点确认只准嘴上约，不准动手 */
export function shouldForceBathRoomFromRendezvous(
  living: AiLivingSave,
  characterId: string,
  speech: string,
  playerMessage = '',
): boolean {
  const p = living.pendingBathRoomRendezvous;
  if (!p || p.characterId !== characterId) return false;
  // 有确认条没点之前，一律不准强拖进浴室
  if (living.pendingBathAssistInvite?.characterId === characterId) return false;
  if (living.gameMinutes - p.atGameMin > 45) {
    clearBathRoomRendezvous(living, characterId);
    return false;
  }
  const all = `${speech} ${playerMessage}`;
  // 光回好嗯行不算数，必须明确说去浴室才算数，防随口就被拖进去
  const depart =
    /现在就过去|这就(?:走|去)|走吧|去吧|过去吧|那我们(?:现在)?就|出发|往门口|一起去(?:吧)?|去浴室/.test(
      all,
    );
  const playerOk =
    /去浴室|一起去|走吧|冲澡|洗澡/.test(playerMessage || '') &&
    !/^(好|好的|行|嗯+|走|去|可以|来吧|一起)([。.!！~～…]*)$/i.test((playerMessage || '').trim());
  if (depart || playerOk) {
    clearBathRoomRendezvous(living, characterId);
    return true;
  }
  // 对白已声称在浴室
  if (/(?:我|我们)(?:现在|已经|就)?在(?:营地)?浴室|进了浴室|到了浴室/.test(speech)) {
    clearBathRoomRendezvous(living, characterId);
    return true;
  }
  return false;
}

/** 本轮对白是否明确约定去浴室（非泳池） */
export function speechCommitsToBathroom(speech: string, playerMessage = ''): boolean {
  const all = `${speech} ${playerMessage}`;
  if (/在泳池|泳池边|下水游|戏水/.test(all) && !/浴室|冲澡|洗澡/.test(all)) return false;
  // 「那你先去洗澡」=让指挥官去，不是角色自己进浴室换冲洗皮
  if (isDirectingPlayerToBathe(speech) && !/我们一起|一起(?:去|来)?(?:冲澡|洗澡)|我(?:也|就|这就)(?:去|来)(?:冲澡|洗澡)/.test(all)) {
    return false;
  }
  return (
    /(?:去|到|进)(?:营地)?浴室/.test(all) ||
    /(?:去|来)(?:冲澡|洗澡|洗浴)/.test(all) ||
    (/浴室|冲澡|洗澡/.test(all) &&
      /现在就过去|这就(?:走|去)|走吧|去吧|一起去|把水放好/.test(all))
  );
}

export function consumeBathAssistJustEntered(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId || !s.justEntered) return false;
  s.justEntered = false;
  return true;
}

export function playerAffirmsBathInvite(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/不(?:行|要|去)|拒绝|算了|下次/.test(t)) return false;
  return (
    /^(好|好的|行|嗯+|走|去|可以|来吧|一起|去浴室|走吧)([。.!！~～…]*)$/i.test(t) ||
    /去浴室|一起去|走吧|那就去|来吧/.test(t)
  );
}

export function playerRejectsBathInvite(text: string): boolean {
  const t = (text || '').trim();
  return /不(?:行|要|去)|拒绝|算了|下次再说|先不/.test(t);
}

// ——— 邀请条 ———

export function maybeProposeBathAssistInvite(
  living: AiLivingSave,
  characterId: string,
  dialogue: string,
  modeHint?: BathAssistMode | null,
): BathAssistInvitePending | null {
  if (isBathAssistActiveFor(living, characterId)) return null;
  if (isDisciplineActiveFor(living, characterId)) return null;
  if (isMiniGameActiveFor(living, characterId)) return null;
  // While already in the bathroom, standalone bath proposals are stale:
  // the character is physically in the bath scene even during the brief idle
  // state after saying「泡好了」. Never create a new invitation from there.
  const presence = resolvePresence(characterId, living);
  const anchor = living.bodyAnchors?.[characterId];
  const scene = living.dialogueTurnScene?.[characterId];
  const physicallyInBath =
    presence.roomId === BATH_ASSIST_ROOM_ID ||
    anchor?.roomId === BATH_ASSIST_ROOM_ID ||
    scene?.roomId === BATH_ASSIST_ROOM_ID;
  if (physicallyInBath) return null;
  if (living.bathAssistPrepare?.characterId === characterId) return null;
  if (living.pendingBathAssistInvite?.characterId) return null;
  if (living.pendingPlayerBathAssistAsk?.characterId) return null;
  if (living.pendingDisciplineInvite?.characterId) return null;
  if (living.pendingMiniGameInvite?.characterId) return null;
  if (living.pendingPlayerMiniGameAsk?.characterId) return null;

  const cool = living.bathAssistInviteCooldownDay?.[characterId];
  if (cool != null && cool === living.dayIndex) return null;

  const mode = modeHint ?? detectAiBathAssistPropose(dialogue);
  if (!mode) return null;
  if (!getCharacterSkin(characterId, bathAssistSkinId(mode))) return null;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const pending: BathAssistInvitePending = {
    characterId,
    mode,
    proposedAt: Date.now(),
    dayIndex: living.dayIndex,
    preview: `${name}想${mode === 'help_wash' ? '帮你清洗' : '与你一同泡澡'}，去浴室吗？`,
  };
  living.pendingBathAssistInvite = pending;
  noteBathRoomRendezvous(living, characterId, dialogue);
  return pending;
}

export function acceptBathAssistInvite(
  save: SaveData,
  living: AiLivingSave,
): BathAssistEnterResult {
  const pending = living.pendingBathAssistInvite;
  if (!pending) return { ok: false, msg: '没有待确认的浴室邀请' };
  const characterId = pending.characterId;
  const mode = pending.mode;
  const prepare = Boolean(pending.prepareWithShowerDelay && mode === 'help_wash');
  living.pendingBathAssistInvite = undefined;
  if (!living.bathAssistInviteCooldownDay) living.bathAssistInviteCooldownDay = {};
  living.bathAssistInviteCooldownDay[characterId] = living.dayIndex;

  if (prepare) {
    const prep = beginBathHelpShowerPrepare(save, living, characterId, mode);
    return {
      ok: true,
      msg: prep.systemLine,
      systemLine: prep.systemLine,
      prepareWithShowerDelay: true,
      prepareCharacterId: characterId,
      prepareMode: mode,
      prepareMs: BATH_HELP_PREPARE_MS,
    };
  }

  return enterBathAssistSession(save, living, characterId, mode, 'character_invite');
}

/**
 * 帮洗确认后：先换独自洗浴/浴巾皮（优先 pifu09），由 UI 等待后再 enterBathAssistSession。
 */
export function beginBathHelpShowerPrepare(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  mode: BathAssistMode = 'help_wash',
): { ok: boolean; systemLine: string } {
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const aloneId = resolveAloneBathSkinId(characterId);
  if (!aloneId) {
    const entered = enterBathAssistSession(save, living, characterId, mode, 'character_invite');
    return { ok: entered.ok, systemLine: entered.systemLine ?? entered.msg };
  }
  setBathIntimateConsent(living, characterId, false);
  // 换浴巾也要有过程：先换装中，到点才挂洗浴皮
  scheduleEventTempSkinChange(living, characterId, aloneId, BATHE_TEMP_SKIN_INSTANCE, 2_600);
  // 人在原地"收拾/换浴巾"，还没进浴室；到点才走过去（行程在 enter 时登记）
  const curRoom = resolvePresence(characterId, living).roomId;
  if (curRoom && CAMP_ROOM_MAP[curRoom]) {
    writeBodyAnchor(
      living,
      characterId,
      curRoom,
      'idle',
      `换上浴巾，收拾东西准备去浴室帮指挥官清洗`,
    );
    snapAgentToRoom(characterId, curRoom, {
      activity: 'idle',
      behavior: `换上浴巾，收拾东西准备去浴室帮指挥官清洗`,
    });
  }
  living.bathAssistPrepare = {
    characterId,
    mode,
    readyAt: Date.now() + BATH_HELP_PREPARE_MS,
  };
  const systemLine = `【系统】${name}换上浴巾洗浴皮，准备去浴室帮你清洗…（约 ${Math.round(BATH_HELP_PREPARE_MS / 1000)} 秒）`;
  living.bathAssistUiFlash = systemLine;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}换上浴巾洗浴皮，准备帮指挥官清洗`,
    importance: 4,
  });
  return { ok: true, systemLine };
}

/** 准备倒计时结束后切帮洗进浴室；未到点返回 null */
export function tryCompleteBathAssistPrepare(
  save: SaveData,
  living: AiLivingSave,
  opts?: { force?: boolean },
): BathAssistEnterResult | null {
  const prep = living.bathAssistPrepare;
  if (!prep) return null;
  if (!opts?.force && Date.now() < prep.readyAt) return null;
  living.bathAssistPrepare = undefined;
  return enterBathAssistSession(save, living, prep.characterId, prep.mode, 'character_invite');
}

export function getBathAssistPrepareRemainMs(living: AiLivingSave): number {
  const prep = living.bathAssistPrepare;
  if (!prep) return 0;
  return Math.max(0, prep.readyAt - Date.now());
}

export function rejectBathAssistInvite(living: AiLivingSave): void {
  const pending = living.pendingBathAssistInvite;
  if (!pending) return;
  living.pendingBathAssistInvite = undefined;
  if (!living.bathAssistInviteCooldownDay) living.bathAssistInviteCooldownDay = {};
  living.bathAssistInviteCooldownDay[pending.characterId] = living.dayIndex;
}

// ——— 共浴交互 01 / 02 ———

export function isCoBathActiveFor(living: AiLivingSave, characterId: string): boolean {
  const s = getBathAssistSession(living);
  return !!s && s.characterId === characterId && s.mode === 'co_bath';
}

export function getBathCoStickyClip(
  living: AiLivingSave,
  characterId: string,
): number | null {
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId || s.mode !== 'co_bath') return null;
  const n = s.stickyClip;
  return n != null && n >= 1 ? n : null;
}

export function getBathCoClipCooldownRemainingMs(living: AiLivingSave): number {
  const s = getBathAssistSession(living);
  if (!s?.active || !s.lastCoClipAt) return 0;
  return Math.max(0, BATH_CO_CLIP_COOLDOWN_MS - (Date.now() - s.lastCoClipAt));
}

export function isBathCoClipUiLocked(living: AiLivingSave, characterId: string): boolean {
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId || s.mode !== 'co_bath') return true;
  if (s.awaitingCoClipReply) return true;
  return getBathCoClipCooldownRemainingMs(living) > 0;
}

export type BathCoClipRequestResult = {
  ok: boolean;
  msg: string;
  playerMessage?: string;
  clip?: 1 | 2;
};

/** 指挥官点交互按钮：进入等待确认，不立刻播 */
export function requestBathCoClip(
  living: AiLivingSave,
  characterId: string,
  clip: 1 | 2,
): BathCoClipRequestResult {
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId || s.mode !== 'co_bath') {
    return { ok: false, msg: '未在一同泡澡中' };
  }
  if (!getCharacterSkin(characterId, BATH_CO_SKIN_ID)?.portraitLiveSecondaries?.[clip - 1]) {
    return { ok: false, msg: `缺少交互${clip}资源` };
  }
  if (s.awaitingCoClipReply) {
    return { ok: false, msg: '请等待角色回应上一交互' };
  }
  const cool = getBathCoClipCooldownRemainingMs(living);
  if (cool > 0) {
    return { ok: false, msg: `交互冷却中（${Math.ceil(cool / 1000)}s）` };
  }
  s.awaitingCoClipReply = true;
  s.pendingCoClip = clip;
  // 冷却改在「同意并真正开播」时写入，避免点按钮后同意失败也锁 12s
  return {
    ok: true,
    msg: '',
    clip,
    playerMessage: buildBathCoClipPlayerMessage(clip),
  };
}

/** 语音和打字同样视为点按钮：提前记一张小纸条等她回，避免只有按钮好使 */
export function ensureVoiceCoClipPending(
  living: AiLivingSave,
  characterId: string,
  playerMessage: string,
): void {
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId || s.mode !== 'co_bath') return;
  if (s.awaitingCoClipReply) return;
  const t = (playerMessage || '').replace(/[\s，。！？、,.!?~～…]/g, '');
  const wantsUndress =
    /(?:把|将|帮我)?(?:你的|妳的)?(?:浴巾|毛巾)(?:脱下来|脱掉|解开|拿开|扯开)|(?:脱下|脱掉|解开|拿开)(?:你的|妳的)?(?:浴巾|毛巾)|不要裹|别裹|脱下来|脱掉吧/.test(t);
  const wantsLook = /看对方|对视|看着你|让我看看|对上.*眼/.test(t);
  if (wantsUndress) {
    if (getCharacterSkin(characterId, BATH_CO_SKIN_ID)?.portraitLiveSecondaries?.[1]) {
      s.awaitingCoClipReply = true;
      s.pendingCoClip = 2;
    }
  } else if (wantsLook) {
    s.awaitingCoClipReply = true;
    s.pendingCoClip = 1;
  }
}

/** 共浴里嘴上答应脱了就必须同时换画面，免得嘴画两张皮 */
export function syncCoBathStickyWithConsent(
  living: AiLivingSave,
  characterId: string,
): void {
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId || s.mode !== 'co_bath') return;
  const consented = Boolean(living.bathIntimateConsent?.[characterId]);
  if (consented && s.stickyClip !== 2) {
    s.stickyClip = 2;
    s.lastCoClipAt = Date.now();
  }
  if (!consented && s.stickyClip === 2) {
    s.stickyClip = null;
  }
}

export type BathCoClipResolveResult = {
  /** 一次性对视 */
  playOnce: number | null;
  /** 粘住脱巾；null=无变化；0=清除粘住回 idle */
  sticky: number | null | 0;
  consented?: boolean;
};

/**
 * 本轮对白后结算共浴交互：
 * - 等待中的 pending：同意才播；拒绝清除等待
 * - AI 主动 skin_clip / 脱巾同意也可触发
 */
export function resolveBathCoClipFromTurn(
  living: AiLivingSave,
  characterId: string,
  opts: {
    skinClip?: number;
    bathConsent?: boolean;
    dialogue: string;
    action?: string;
    playerMessage?: string;
  },
): BathCoClipResolveResult {
  const out: BathCoClipResolveResult = { playOnce: null, sticky: null };
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId || s.mode !== 'co_bath') return out;

  const speech = `${opts.dialogue} ${opts.action ?? ''}`;
  // 勿把「怎么能不脱」里的「不脱」判成拒绝
  const refuse =
    /拒绝|别看|不准看|才不|不要脱|别脱|不准脱|不行|不给|不要(?!脱)|不能(?!不脱)|(?<![能会])不脱|(?:重新)?裹着/.test(
      speech,
    );
  const agreeLook =
    /对视|看你|看我|看过来|看着|凝视|对上眼|行吧|好吧|那就|可以|看哦|看吧|看呀|随便看|准你看|给你看/.test(
      speech,
    );
  const softUndressAgree =
    /脱(?:下|掉|了)?(?:浴巾|毛巾)?|不裹了|解开|脱掉|脱了|脱吧|怎么能不脱|怎么能不|看好了|看仔细|不许后悔|那我就脱|既然.{0,12}(?:脱|解)/.test(
      speech,
    );
  const clipAsk = opts.skinClip != null && opts.skinClip >= 1 ? Math.floor(opts.skinClip) : 0;
  const playerAsksUndress =
    /脱(?:下|掉|了)?(?:你的|妳的)?(?:浴巾|毛巾)|(?:浴巾|毛巾).{0,6}(?:脱|解|拿开|扯)|别裹|不要裹|解开.{0,4}(?:浴巾|毛巾)/.test(
      opts.playerMessage ?? '',
    );

  // 等待指挥官提出的交互（按钮路径：未明确拒绝即可软通过）
  if (s.awaitingCoClipReply && s.pendingCoClip) {
    const want = s.pendingCoClip;
    s.awaitingCoClipReply = false;
    const pending = want;
    s.pendingCoClip = null;

    if (refuse && clipAsk !== pending) {
      return out;
    }

    if (pending === 1) {
      const ok =
        clipAsk === 1 ||
        (agreeLook && !refuse) ||
        (/看|对视|凝视|眼睛/.test(speech) &&
          /可以|行|好|嗯|准|随便|那|看吧|看呀|看哦/.test(speech) &&
          !refuse) ||
        // 按钮已提出；对白未拒绝且有正向/现场感 → 开播
        (!refuse && /好|行|嗯|可以|看|对视|心跳|认真/.test(speech));
      if (ok) {
        s.lastCoClipAt = Date.now();
        out.playOnce = 1;
      }
      return out;
    }

    if (pending === 2) {
      const consented =
        opts.bathConsent === true ||
        (clipAsk === 2 && !refuse) ||
        (softUndressAgree && !refuse) ||
        // 按钮已提出；对白未拒绝即可软通过（「那我就脱掉吧」等）
        (!refuse && /好|行|嗯|可以|那|既然|看|热|蒸汽|脱|解开|不裹/.test(speech));
      if (consented) {
        setBathIntimateConsent(living, characterId, true);
        s.stickyClip = 2;
        s.lastCoClipAt = Date.now();
        out.sticky = 2;
        out.consented = true;
        out.playOnce = 2; // 先播再粘住由 UI 处理
      } else {
        setBathIntimateConsent(living, characterId, false);
      }
      return out;
    }
  }

  // AI 主动 / 脱巾门控（非按钮等待）
  if (opts.bathConsent !== true && s.stickyClip === 2) {
    // 重新裹巾或拒绝维持脱巾
    if (opts.bathConsent === false || /重新裹|裹回去|裹上(?:浴巾|毛巾)/.test(speech)) {
      s.stickyClip = null;
      setBathIntimateConsent(living, characterId, false);
      out.sticky = 0;
      return out;
    }
  }

  if (opts.bathConsent === true || clipAsk === 2 || (playerAsksUndress && softUndressAgree && !refuse)) {
    if (!refuse) {
      setBathIntimateConsent(living, characterId, true);
      s.stickyClip = 2;
      s.lastCoClipAt = Date.now();
      // 嘴上答应必须同步画面粘住，修嘴画两张皮
      syncCoBathStickyWithConsent(living, characterId);
      out.sticky = 2;
      out.consented = true;
      if (clipAsk === 2 || opts.bathConsent === true || playerAsksUndress) out.playOnce = 2;
    }
    return out;
  }

  if (clipAsk === 1) {
    s.lastCoClipAt = Date.now();
    out.playOnce = 1;
  }

  return out;
}

/** Prompt：进行中 */
export function buildBathAssistActivePromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const s = getBathAssistSession(living);
  if (!s || s.characterId !== characterId) return '';
  if (s.mode === 'help_wash') {
    return `【世界同步·浴室互动中·最高优先】
当前浴室互动：「帮指挥官清洗」。玩家眼前是你裹着白浴巾帮指挥官冲澡/搓洗的动态立绘（pifu07）。
- 外形锁死：你此刻穿的是白浴巾（湿透贴身），不是「帮洗制服/服务装/连衣裙」。被问穿什么必须答裹着浴巾。
- 你在营地浴室（room_1f_bath），activity=bathe；指挥官已在现场由你清洗，禁止说他还没来。
- 帮洗模式禁止解巾独自泡澡动态；bath_intimate_consent 填 ""/false。
- 氛围可写：指尖滑过肩背、水声与呼吸、湿发垂落、发烫的耳根——点到即止。
- 想结束：对白明确收尾，并填 bath_assist_action=end；或等指挥官关聊天页。
- 禁止假装还在大厅/卧室；禁止假装共浴泡缸。
${s.justEntered ? '- 本轮刚开始：先回应正在帮他清洗的现场感。' : ''}`.trim();
  }

  const undressed = s.stickyClip === 2 || Boolean(living.bathIntimateConsent?.[characterId]);
  const pending =
    s.awaitingCoClipReply && s.pendingCoClip
      ? s.pendingCoClip === 1
        ? '- 指挥官刚轻声提出想与你对视：本轮须明确答应或婉拒；答应则对白体现对视，并填 skin_clip=1；拒绝则说明原因且 skin_clip 留空。'
        : '- 指挥官刚提出想让你解下浴巾：本轮须明确答应或婉拒；答应则对白体现已解/在解，填 bath_intimate_consent=true 且 skin_clip=2；拒绝则 false 且 skin_clip 留空。'
      : '';
  return `【世界同步·一同泡澡中·最高优先】
当前浴室互动：「一同泡澡」。指挥官已经和你在同一浴缸里共浴——禁止说他还没来、催他过来、等他进浴室、或假装你在独自泡。
玩家眼前默认是共浴 idle（pifu08，白浴巾裹身）。
- 交互01「看对方」：暧昧对视。同意填 skin_clip=1（播完回 idle）。也可你主动想暧昧对视时填 skin_clip=1。
- 交互02「解下浴巾」：同意填 bath_intimate_consent=true 且 skin_clip=2；立绘先播解巾前奏再循环。重新裹巾填 false。也可你主动想展示身材、撩人时自愿解巾。
- 立绘氛围可写：水汽、湿发贴颊、肩背相触、水温与心跳呼吸——点到即止，越含蓄越勾人。
- 此刻立绘：${undressed ? '已解巾共浴循环——对白必须按已解巾写，禁止再说裹着浴巾。' : '仍裹白浴巾/共浴 idle——被问穿什么必须答裹着浴巾；勿说未裹巾除非本轮同意解巾。'}
- 聊天页按钮 / 打字 / 语音提出交互=指挥官请求，须等你回应后才播。
- 想结束：bath_assist_action=end 或对白收尾；指挥官关页也会结束 → 立绘回独自泡澡(pifu09)。
- 禁止假装独自泡澡或帮洗现场；禁止继续写「拿喷头帮他冲澡/搓锈」——那是帮洗模式。
${pending}
${s.justEntered ? '- 本轮刚切入共浴：指挥官已在浴缸里与你同浴，先回应同浴现场感，不要沿用帮洗/独自泡澡话术，不要催他过来。' : ''}`.trim();
}

export function buildBathAssistJustLeftPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const s = living.bathAssistSession;
  if (!s || s.characterId !== characterId || !s.justLeft) return '';
  const left = s.justLeftTurnsLeft ?? 0;
  if (left <= 0) {
    s.justLeft = false;
    return '';
  }
  s.justLeftTurnsLeft = left - 1;
  if (s.justLeftTurnsLeft <= 0) s.justLeft = false;
  return `【世界同步·浴室互动刚结束】「${bathAssistModeLabel(s.mode)}」已结束。禁止继续写帮洗/共浴现场；若仍在浴室，立绘已是独自泡澡——可按独自泡缸收尾或回房。`.trim();
}

/** 指挥官已提出、等待你答应时的提示 */
export function buildPlayerBathAssistAskPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const p = getPlayerBathAssistAsk(living, characterId);
  if (!p) return '';
  const label = bathAssistModeLabel(p.mode);
  const start = p.mode === 'help_wash' ? 'start_help' : 'start_co';
  const switchHint = p.isModeSwitch
    ? `指挥官想从当前浴室互动切换为「${label}」。`
    : `指挥官提出「${label}」（按钮/打字/语音等效）。`;
  return `【世界同步·待你回应浴室互动】
${switchHint}
- 若同意：对白明确答应，并填 bath_assist_action=${start}。${
    p.isModeSwitch
      ? '系统随即切换立绘。'
      : '系统会请指挥官确认是否去浴室；确认前禁止描写已经在帮洗/共浴现场。'
  }
- 若拒绝：对白说明原因，bath_assist_action 填 ""；不要描写已经在帮洗/共浴现场。
- 未表态前禁止假装立绘已切换。`.trim();
}

/** 浴室场景下的玩法提示（非会话中） */
export const BATH_ASSIST_PROTOCOL = `【浴室互动 · bath_assist_action】
- 指挥官点「帮我清洗」「一同泡澡」按钮、打字或语音提出：效果相同。你须先在对白里答应或拒绝；同意填 bath_assist_action=start_help 或 start_co，拒绝则填 "" 并说明。系统在你同意后会请指挥官确认是否去浴室——禁止假装已经在帮洗/共浴现场。
- 已在帮洗中指挥官改提共浴（或反之）：同样先答应再切；同意填对应 start_*（可立刻切换）。
- 你也可主动提出：填 propose_help / propose_co 并说清楚；系统弹确认条，指挥官同意后才进浴室切立绘。
- 帮洗经确认后：角色先换独自洗浴/浴巾皮(pifu09)，稍后再进浴室切帮洗立绘(pifu07)。共浴确认后进浴室切共浴立绘(pifu08)。约定去泡澡/冲澡必须去浴室(room_1f_bath)，禁止误去泳池。
- 你独自想去泡澡、或被指挥官/同伴叫去泡澡：进浴室后系统挂独自泡澡(pifu09)；是否解巾由你填 bath_intimate_consent。
- 共浴结束（指挥官离开）：系统回挂独自泡澡——对白改按独自泡缸，勿继续写「他在同缸」。
- 独自泡澡中指挥官提出共浴且你同意：系统从 pifu09 切到 pifu08，对白改按共浴。
- 共浴专属：skin_clip=1 看对方（交互01）；skin_clip=2 + bath_intimate_consent=true 解下浴巾（交互02，前奏→解巾后循环）。帮洗中禁止解巾同意。
- 结束：填 bath_assist_action=end，或对白明确洗完/结束；指挥官关聊天页也会结束。
- 非浴室互动时 bath_assist_action 填 ""。`.trim();

export const BATH_CO_CLIP_PROTOCOL = `【共浴交互 · skin_clip / bath_intimate_consent】
仅「一同泡澡」会话有效（指挥官已在同一浴缸）：
- skin_clip=1：看对方/对视（交互01）。播完回共浴 idle。暧昧想看对方时可主动填。
- skin_clip=2 + bath_intimate_consent=true：解下浴巾（交互02）。先播解巾前奏，再循环；重新裹巾填 false。想展示外形、暧昧时可主动解巾。
- 指挥官点按钮 / 打字 / 语音提出时，聊天里是口语请求（不会出现字段名）；你在 JSON 里按上规则填字段。答应才播放。
- 帮洗会话不要填上述共浴交互；帮洗中禁止假装共浴或继续只聊「帮他冲澡」若已切共浴。`.trim();
