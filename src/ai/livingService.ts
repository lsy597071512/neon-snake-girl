import { saveManager } from '../core/SaveManager';
import type { SaveData } from '../types';
import { CHARACTER_MAP } from '../data/characters';
import { tickHeartbeat } from './heartbeat';
import { consumeOfflineSummary, processOfflineReturn } from './offlineSummary';
import { applyBatheShowerSkins, applyEventTempSkins } from './campEvents/campEventEffects';
import { processTravelArrivals } from './travelArrival';
import { isTraveling, planTravel } from './travel';
import { runPlayerDialogue } from './dialogueEngine';
import { pushCampLog, pushMemory, hydrateCharacterMemoryFromArchive } from './memory';
import { getAgenda, isAgendaActive, tickAllAgendas } from './characterAgenda';
import { forceSyncEmotionOutfitForDialogue, tryApplyEmotionOutfits } from './emotionOutfit';
import {
  applyCombatConsequences,
  applyGiftConsequences,
} from './gameplayConsequences';
import {
  applyCyberAgingByDayIndex,
  seedCyberHealthForOwned,
} from '../systems/CyberHealthSystem';
import { getCoScreenGroupForCharacter, tickCampEvents, trySpawnCampEvent } from './campEvents';
import { syncCharacterSkinRuntime } from '../ui/characterSkinRuntime';
import { getCampEventDef } from './campEvents/catalog';
import { resolveCharacterSceneImageId, resolveCharacterRoomId, resolvePresence } from './livingState';
import { applyGiftAffinity, getAffinity, tickRelationsFromAiBehavior } from './relationship';
import { recordGiftBondFact } from './structuredFacts';
import { refreshPersonasForOwned } from './characterPersona';
import { tickMoodDecayForOwned } from './moodContinuum';
import { nextIndoorId } from './corpusPipeline';
import { createDefaultAiLiving, resolveActiveSceneId, advanceWorldClock, formatGameClock, GAME_MINUTES_PER_REAL_MINUTE, realMsToGameMinutes, isDialogueOverlayOpen } from './worldClock';
import {
  acceptAiMessage,
  dismissAiMessage,
  listPendingAiMessages,
  tickPlayerOutreach,
} from './playerOutreach';
import { getAgent, snapAgentToRoom } from './campAgents';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import {
  captureDialogueSceneSnapshot,
  commitDialogueSceneSnapshot,
  ensureDialogueSceneFields,
} from './dialogueSceneSync';
import { commitPendingDesireAfterDialogue } from './desireNext';
import { completeDueOutfitChange, ensureOutfitChangeFields, applyPendingOutfitChangeNow, remainingOutfitChangeMs, OUTFIT_REVEAL_MOTIVE } from './outfitChangeProcess';
import { clearBathIntimateConsentIfNotBathing } from './bathIntimateConsent';
import { syncOutfitToCurrentPresence } from './dialogueWorldSync';
import { BODY_ANCHOR_TTL_GAME_MIN } from './livingState';
import {
  ensureSleepFields,
  isDeepSleeping,
  isInSleepSystem,
  markSleepDisturbed,
  sleepBackIfLeftAloneAfterWake,
  sleepWakeDifficulty,
  syncSleepCampSkin,
  tickSleepSystem,
} from './sleepSystem';
import {
  recoverStaleDisciplineSession,
  scrubOrphanDisciplineArtifacts,
  maybeProposeDisciplineInvite,
} from './disciplineSession';
import {
  acceptBathAssistInvite,
  buildBathAssistPlayerProposeMessage,
  canShowBathButtons,
  detectPlayerBathAssistMode,
  enterBathAssistSession,
  getBathAssistSession,
  isBathAssistActiveFor,
  rejectBathAssistInvite,
  recoverStaleBathAssistSession,
  setPlayerBathAssistAsk,
  tryCompleteBathAssistPrepare,
} from './bathAssistSession';
import {
  acceptDanceInvite,
  beginCoDance,
  beginSoloDance,
  canShowDanceButtons,
  clearDanceIfLeftHall,
  detectPlayerDanceMode,
  finishDanceDressing,
  finishDanceUnveil,
  getDanceSession,
  leaveDanceSession,
  recoverStaleDanceSession,
  rejectDanceInvite,
  returnToPrepare,
  setPlayerDanceAsk,
  tickDanceSession,
} from './danceSession';
import {
  acceptAnfuInvite,
  buildAnfuAttackPlayerText,
  canShowAnfuButtons,
  clearAnfuIfLeftRoom,
  detectPlayerAnfu,
  enterAnfuSession,
  finishAnfuDressing,
  isAnfuActiveFor,
  leaveAnfuSession,
  recoverStaleAnfuSession,
  rejectAnfuInvite,
  requestAnfuAttack,
  setPlayerAnfuAsk,
  tickAnfuSession,
} from './anfuSession';
import {
  recoverStaleMiniGameSession,
  tickMiniGameSession,
} from './miniGameSession';
import {
  acceptMiniGameInvite,
  canShowMiniGameButtons,
  detectPlayerMiniGameKind,
  getMiniGameSession,
  isMiniGameActiveFor,
  miniGameKindLabel,
  playerGomokuMove,
  playerRpsThrow,
  quitMiniGameByPlayer,
  rejectMiniGameInvite,
  setPlayerMiniGameAsk,
  type MiniGameKind,
} from './miniGameSession';
import type { RpsThrow } from '../game/miniGames/rps';
import { getAnfuClipList, getDanceSoloClipList } from '../data/characterSkins';
import type { AiLivingSave, AiMessageEvent, DialogueRequest, LlmDialogueResult } from './types';
import type { PlayerDialogueOpts } from './dialogueEngine';

function ensureLiving(d: SaveData): AiLivingSave {
  if (!d.aiLiving) d.aiLiving = createDefaultAiLiving();
  const living = d.aiLiving as AiLivingSave;
  if (!living.agendas) living.agendas = {};
  if (!living.activeCampEvents) living.activeCampEvents = [];
  if (!living.eventHistory) living.eventHistory = [];
  if (!living.personas) living.personas = {};
  if (!living.pendingAiMessages) living.pendingAiMessages = [];
  if (!living.aiMessageStats) living.aiMessageStats = {};
  if (!living.pendingNpcSeeks) living.pendingNpcSeeks = [];
  if (living.lastPlayerOutreachEvalAt == null) living.lastPlayerOutreachEvalAt = 0;
  if (!living.campWornSkins) living.campWornSkins = {};
  if (!living.eventTempSkins) living.eventTempSkins = {};
  if (!living.outfitNarrativeHolds) living.outfitNarrativeHolds = {};
  if (!living.bodyAnchors) living.bodyAnchors = {};
  if (!living.emotionOutfitAt) living.emotionOutfitAt = {};
  if (!living.lifeGoals) living.lifeGoals = {};
  if (!living.characterPockets) living.characterPockets = {};
  if (!living.characterCyberHealth) living.characterCyberHealth = {};
  if (!living.characterCyberLoadout) living.characterCyberLoadout = {};
  if (!living.campPlacements) living.campPlacements = {};
  if (!living.structuredFacts) living.structuredFacts = {};
  if (!living.relationshipArcStage) living.relationshipArcStage = {};
  ensureDialogueSceneFields(living);
  ensureOutfitChangeFields(living);
  ensureSleepFields(living);
  if (!Array.isArray(living.pendingCyberHealthEvents)) living.pendingCyberHealthEvents = [];
  return living;
}

function applyGoldDelta(d: SaveData, delta: number): void {
  if (!delta) return;
  d.gold = Math.max(0, (d.gold ?? 0) + delta);
}

/** 时钟推进后的共享副作用：议程 / 事件皮 / 洗浴皮 / 情绪选装 / 关系微变 */
function applyPostClockLivingEffects(
  d: SaveData,
  living: AiLivingSave,
  owned: string[],
  prevGameMinutes: number,
  prevDayIndex: number,
): void {
  seedCyberHealthForOwned(living, owned);
  if (living.dayIndex !== prevDayIndex) {
    applyCyberAgingByDayIndex(living, owned);
  }
  refreshPersonasForOwned(living, owned);
  tickMoodDecayForOwned(living, owned);
  tickAllAgendas(living, owned, prevGameMinutes);
  tickSleepSystem(living, owned);
  // 走路到点 → 落点 + 会话相位切换（舞蹈/安抚到场）
  processTravelArrivals(living);
  tickCampEvents(living, owned, (delta) => applyGoldDelta(d, delta));
  applyEventTempSkins(d, living);
  applyBatheShowerSkins(d, living);
  tickDanceSession(d, living);
  tickAnfuSession(d, living);
  tickMiniGameSession(d, living);
  // 到点的换装（含事件临时外覆）在营地/Hub 也要按时穿上，不能等开对话
  for (const id of owned) {
    try {
      completeDueOutfitChange(d, living, id);
    } catch {
      /* 单个角色失败不阻塞其余 */
    }
  }
  tryApplyEmotionOutfits(d, living, owned);
  if (living.gameMinutes !== prevGameMinutes) {
    tickRelationsFromAiBehavior(living, owned, (id) => resolveCharacterRoomId(id, living));
  }
}

/**
 * 对话开场：角色落在意图房间（或当前 presence），并强制对齐穿搭。
 * 避免「chip 已在泳池、背景/睡衣还停在卧室」。
 * 不冻结场景——后续时钟推进可换房换装，由 Prompt 场景切换块驱动对白跟上。
 */
function settleCharacterForDialogue(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): void {
  // 正在赶路：不瞬移、不抢换装；对白就发生在出发房间（她会说"我正过去"）
  if (isTraveling(living, characterId)) {
    return;
  }
  const co = getCoScreenGroupForCharacter(living, characterId);
  if (co) {
    const def = getCampEventDef(co.defId);
    snapAgentToRoom(characterId, co.focusRoomId, {
      activity: def?.arriveActivity ?? 'idle',
      behavior: `在${co.focusLabel}参与「${co.eventName}」`,
    });
    forceSyncEmotionOutfitForDialogue(save, living, characterId);
    return;
  }

  // 身体实际房间优先：勿用未抵达的议程目标把人瞬移走，避免与上一轮 AI 同步后的皮肤/背景打架
  const agentRoom = getAgent(characterId)?.roomId;
  const agenda = getAgenda(living, characterId);
  let roomId: string | null = null;
  let activity: string | undefined;
  let behavior: string | undefined;

  if (agentRoom && CAMP_ROOM_MAP[agentRoom]) {
    roomId = agentRoom;
    const p = resolvePresence(characterId, living);
    activity = p.activity;
    behavior = p.behavior;
    // 议程目标与身体一致时用议程文案
    if (isAgendaActive(agenda) && agenda?.targetRoomId === agentRoom) {
      activity = agenda.activity;
      behavior = agenda.behavior;
    }
  } else if (isAgendaActive(agenda) && agenda?.targetRoomId && CAMP_ROOM_MAP[agenda.targetRoomId]) {
    const p = resolvePresence(characterId, living);
    if (p.roomId !== agenda.targetRoomId) {
      // 只有议程没有身体：按"正在过去"走行程，不瞬移
      planTravel(living, characterId, agenda.targetRoomId, p.roomId, {
        activity: agenda.activity,
        behavior: agenda.behavior,
        reason: 'agenda_walk',
        arriveBehavior: agenda.behavior,
      });
      forceSyncEmotionOutfitForDialogue(save, living, characterId);
      return;
    }
    roomId = agenda.targetRoomId;
    activity = agenda.activity;
    behavior = agenda.behavior;
  } else {
    const p = resolvePresence(characterId, living);
    roomId = p.roomId;
    activity = p.activity;
    behavior = p.behavior;
  }
  if (roomId) {
    snapAgentToRoom(characterId, roomId, { activity, behavior });
  }
  forceSyncEmotionOutfitForDialogue(save, living, characterId);
}

/**
 * 身体锚点对账：锚点过期且作息表把人挪去了别处 → 显式接管并写记忆，
 * 让下一次对白知道「她离开了××，现在在××」——而不是背景无声瞬移。
 */
export function reconcileBodyAnchor(save: SaveData, living: AiLivingSave, characterId: string): void {
  const anchor = living.bodyAnchors?.[characterId];
  if (!anchor) return;
  const stale = living.gameMinutes - anchor.atGameMin > BODY_ANCHOR_TTL_GAME_MIN;
  if (!stale) return;

  // 锚点已过期：presence 此刻=作息表结果（livingState 不再应用过期锚点）
  const p = resolvePresence(characterId, living);
  const moved = p.roomId !== anchor.roomId;
  if (moved) {
    const name = CHARACTER_MAP[characterId]?.name ?? characterId;
    const fromLabel = CAMP_ROOM_MAP[anchor.roomId]?.label ?? anchor.roomId;
    const toLabel = CAMP_ROOM_MAP[p.roomId]?.label ?? p.roomId;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `${name}结束了在${fromLabel}的事，来到${toLabel}（${p.behavior}）`,
      importance: 4,
    });
    // 出浴室类卫生：清同意/临时皮，皮肤按新房间走延时协议对齐
    clearBathIntimateConsentIfNotBathing(living, characterId);
    syncOutfitToCurrentPresence(save, living, characterId);
  }
  if (!living.bodyAnchors) living.bodyAnchors = {};
  living.bodyAnchors[characterId] = {
    roomId: p.roomId,
    activity: p.activity,
    behavior: p.behavior,
    atGameMin: living.gameMinutes,
    seq: anchor.seq + 1,
  };
}

function cloneLiving(): AiLivingSave {
  return JSON.parse(JSON.stringify(ensureLiving(saveManager.get()))) as AiLivingSave;
}

export function getAiLiving(): AiLivingSave {
  return ensureLiving(saveManager.get());
}

export function mutateAiLiving(fn: (living: AiLivingSave, d: SaveData) => void): void {
  saveManager.mutate((d) => {
    fn(ensureLiving(d), d);
  });
}

let aiLivingBootPromise: Promise<string | null> | null = null;
let heartbeatInFlight: Promise<void> | null = null;

/** 启动：推进时钟 + 离线摘要 + 从永久档案预热已拥有角色的记忆（进程内只跑一次） */
export function bootAiLivingSync(): Promise<string | null> {
  if (!aiLivingBootPromise) {
    aiLivingBootPromise = (async () => {
      const owned = saveManager.get().ownedCharacters.map((c) => c.characterId);
      const startRevision = saveManager.getRevision();
      const working = cloneLiving();
      if (!working.chatDigests) working.chatDigests = {};
      if (!working.recentChats) working.recentChats = {};
      for (const id of owned) {
        await hydrateCharacterMemoryFromArchive(working, id);
      }
      const result = await processOfflineReturn(working, owned);
      if (saveManager.getRevision() !== startRevision) return result;
      saveManager.mutate((d) => {
        d.aiLiving = working;
      });
      return result;
    })();
  }
  return aiLivingBootPromise;
}

/** 等待 AI 生活系统启动完成（营地离线弹窗等依赖） */
export function ensureAiLivingBooted(): Promise<string | null> {
  return bootAiLivingSync();
}

/** 推进时钟 + 意图剩余时间 + 营地事件阶段 + 角色间关系微变 */
export function tickWorldOnly(): void {
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const prev = living.gameMinutes;
    const prevDay = living.dayIndex;
    advanceWorldClock(living);
    const owned = d.ownedCharacters.map((c) => c.characterId);
    applyPostClockLivingEffects(d, living, owned, prev, prevDay);
  });
}

export async function runHeartbeatOnce(): Promise<void> {
  if (heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = runHeartbeatOnceImpl();
  try {
    await heartbeatInFlight;
  } finally {
    heartbeatInFlight = null;
  }
}

async function runHeartbeatOnceImpl(): Promise<void> {
  const owned = saveManager.get().ownedCharacters.map((c) => c.characterId);
  const startRevision = saveManager.getRevision();
  const working = cloneLiving();
  const prev = working.gameMinutes;
  const prevDay = working.dayIndex;
  advanceWorldClock(working);
  seedCyberHealthForOwned(working, owned);
  if (working.dayIndex !== prevDay) {
    applyCyberAgingByDayIndex(working, owned);
  }
  refreshPersonasForOwned(working, owned);
  tickMoodDecayForOwned(working, owned);
  tickAllAgendas(working, owned, prev);
  tickSleepSystem(working, owned);
  let goldDelta = 0;
  tickCampEvents(working, owned, (delta) => {
    goldDelta += delta;
  });
  if (working.gameMinutes !== prev) {
    tickRelationsFromAiBehavior(working, owned, (id) => resolveCharacterRoomId(id, working));
  }
  await tickHeartbeat(working, owned);
  if (saveManager.getRevision() !== startRevision) return;
  saveManager.mutate((d) => {
    applyEventTempSkins(d, working);
    applyBatheShowerSkins(d, working);
    tickDanceSession(d, working);
    tickAnfuSession(d, working);
    tickMiniGameSession(d, working);
    tryApplyEmotionOutfits(d, working, owned);
    d.aiLiving = working;
    applyGoldDelta(d, goldDelta);
  });
}

/** 调试/面板：强制刷一个营地事件 */
export function spawnCampEventNow(forceDefId?: string): string | null {
  let defId: string | null = null;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const owned = d.ownedCharacters.map((c) => c.characterId);
    const ev = trySpawnCampEvent(living, owned, {
      forceDefId,
      chance: 1,
      bypassGap: true,
    });
    defId = ev?.defId ?? null;
    applyEventTempSkins(d, living);
    applyBatheShowerSkins(d, living);
  });
  return defId;
}

export async function talkToCharacter(
  characterId: string,
  playerMessage: string,
  opts?: PlayerDialogueOpts & { turnMode?: 'reply' | 'proactive' | 'continue' | 'outfit_reveal' },
): Promise<LlmDialogueResult> {
  const working = cloneLiving();
  if (!working.lastTalkAt) working.lastTalkAt = {};
  if (!working.recentChats) working.recentChats = {};
  if (!working.chatDigests) working.chatDigests = {};
  const prev = working.gameMinutes;
  const prevDay = working.dayIndex;
  advanceWorldClock(working);
  await hydrateCharacterMemoryFromArchive(working, characterId);

  const last = working.lastTalkAt[characterId] ?? 0;
  const gapMs = Date.now() - last;
  // 对话窗已开时不再用「现实间隔」猛加游戏时间，避免洗浴等短意图中途到期换房
  if (!isDialogueOverlayOpen() && last > 0 && gapMs > 15_000) {
    // 对话空档额外压缩：按当前时间流速换算，避免与 advanceWorldClock 比例脱节
    const extra = Math.min(
      30,
      Math.max(2, realMsToGameMinutes(gapMs - 15_000) + Math.floor(GAME_MINUTES_PER_REAL_MINUTE * 0.4)),
    );
    working.gameMinutes += extra;
  }

  // Mark the interruption before refreshing the dialogue scene so the first
  // prompt and portrait both reflect that the character has been disturbed.
  // 但睡太沉叫不醒时不改相位（否则 Prompt 会写成「已被吵醒」，实际只翻了个身）。
  if ((opts?.turnMode ?? 'reply') === 'reply' && isDeepSleeping(working, characterId)) {
    if (sleepWakeDifficulty(working, characterId).wakeable) {
      markSleepDisturbed(working, characterId, '指挥官在睡觉时找你聊天');
    }
  }

  // 发话前：到点的换装先穿上，再对齐位置；展示锁定期不让情绪选装扒皮
  saveManager.mutate((d) => {
    const owned = d.ownedCharacters.map((c) => c.characterId);
    applyPostClockLivingEffects(d, working, owned, prev, prevDay);
    reconcileBodyAnchor(d, working, characterId);
    if (opts?.turnMode === 'outfit_reveal' || playerMessage === OUTFIT_REVEAL_MOTIVE) {
      applyPendingOutfitChangeNow(d, working, characterId);
    } else {
      completeDueOutfitChange(d, working, characterId);
    }
    settleCharacterForDialogue(d, working, characterId);
    // 玩家本轮文字/语音若在邀请跳舞，登记待回应（按钮同样走此路径，保证三通道等效）
    if ((opts?.turnMode ?? 'reply') === 'reply') {
      const dm = detectPlayerDanceMode(playerMessage);
      if (dm && canShowDanceButtons(working, characterId)) {
        setPlayerDanceAsk(working, characterId, dm);
      }
      if (detectPlayerAnfu(playerMessage) && canShowAnfuButtons(working, characterId)) {
        setPlayerAnfuAsk(working, characterId);
      }
      // 玩家文字/语音里提出「玩剪刀石头布 / 下五子棋」→ 登记待回应（按钮同一路径，三通道等效）
      const mg = detectPlayerMiniGameKind(playerMessage);
      if (mg && canShowMiniGameButtons(working, characterId)) {
        setPlayerMiniGameAsk(working, characterId, mg);
      }
      // 玩家文字/语音里提出「帮我冲澡 / 一同泡澡」→ 登记待回应（按钮同一路径，三通道等效）
      registerPlayerBathAskFromText(working, characterId, playerMessage);
    }
    d.aiLiving = working;
  });
  opts?.onWorldSynced?.();

  const req: DialogueRequest = {
    characterId,
    playerMessage,
    sceneId: resolveCharacterSceneImageId(characterId, working) || resolveActiveSceneId(working),
    turnMode: opts?.turnMode ?? 'reply',
  };
  const result = await runPlayerDialogue(working, req, saveManager.get(), opts);
  // 本轮结束后记下场景，供下一轮检测「已切换」
  commitDialogueSceneSnapshot(working, characterId);
  saveManager.mutate((d) => {
    d.aiLiving = working;
    syncCharacterSkinRuntime(d);
  });
  return result;
}

/** 打开对话：推进世界 → 对齐位置/穿搭 → 灌记忆；UI 须在完成后刷新背景与立绘 */
export async function openDialogueSession(characterId: string): Promise<{
  history: { role: 'user' | 'assistant'; text: string; action?: string; innerThought?: string }[];
  clock: string;
  digestCount: number;
  /** 开场对齐后的场景 / 位置，供 UI 刷新 */
  sceneId: string;
  roomId: string;
  presenceLabel: string;
}> {
  const working = cloneLiving();
  if (!working.lastTalkAt) working.lastTalkAt = {};
  if (!working.recentChats) working.recentChats = {};
  if (!working.chatDigests) working.chatDigests = {};
  const prev = working.gameMinutes;
  const prevDay = working.dayIndex;
  advanceWorldClock(working);

  const last = working.lastTalkAt[characterId] ?? 0;
  const gapMs = Date.now() - last;
  if (!isDialogueOverlayOpen() && last > 0 && gapMs > 10_000) {
    const extra = Math.min(
      20,
      Math.max(1, realMsToGameMinutes(gapMs - 10_000) + Math.floor(GAME_MINUTES_PER_REAL_MINUTE * 0.2)),
    );
    working.gameMinutes += extra;
  }

  // 先落位置与穿搭并写入存档，再异步灌记忆——缩短「chip 已更新、立绘还旧」窗口
  saveManager.mutate((d) => {
    const owned = d.ownedCharacters.map((c) => c.characterId);
    applyPostClockLivingEffects(d, working, owned, prev, prevDay);
    // 打开对话时再扫一遍：清卡死事件态 / 孤儿锚点
    scrubOrphanDisciplineArtifacts(working);
    recoverStaleDisciplineSession(d, working);
    recoverStaleBathAssistSession(d, working);
    recoverStaleDanceSession(d, working);
    recoverStaleAnfuSession(d, working);
    recoverStaleMiniGameSession(d, working);
    reconcileBodyAnchor(d, working, characterId);
    completeDueOutfitChange(d, working, characterId);
    if (isInSleepSystem(working, characterId)) {
      syncSleepCampSkin(working, characterId);
    }
    settleCharacterForDialogue(d, working, characterId);
    // 开场记下初始场景；首句尚无「切换」，从第二句起才对比
    commitDialogueSceneSnapshot(working, characterId, captureDialogueSceneSnapshot(working, characterId));
    d.aiLiving = working;
    syncCharacterSkinRuntime(d);
  });

  await hydrateCharacterMemoryFromArchive(working, characterId);
  saveManager.mutate((d) => {
    d.aiLiving = working;
  });

  const presence = resolvePresence(characterId, working);
  return {
    history: [...(working.recentChats?.[characterId] ?? [])],
    clock: formatGameClock(working),
    digestCount: working.chatDigests?.[characterId]?.length ?? 0,
    sceneId: resolveCharacterSceneImageId(characterId, working) || presence.locationId,
    roomId: presence.roomId,
    presenceLabel: presence.label,
  };
}

export function setPlayerLocation(locationId: string): void {
  mutateAiLiving((living) => {
    living.playerLocationId = locationId;
    pushCampLog(living, {
      text: `你进入了 ${locationId}`,
      source: 'player',
    });
  });
}

export function roamIndoor(dir: 1 | -1): string {
  const living = getAiLiving();
  const cur = living.playerLocationId.startsWith('indoor_')
    ? living.playerLocationId
    : 'indoor_dating';
  const next = nextIndoorId(cur, dir);
  setPlayerLocation(next);
  return next;
}

export function goToCampExterior(): void {
  setPlayerLocation('camp_auto');
}

export function recordGiftBond(characterId: string, giftPreference: string, tier: 0 | 1 | 2): number {
  let score = 40;
  mutateAiLiving((living) => {
    score = applyGiftAffinity(living, characterId, giftPreference, tier);
    const name = CHARACTER_MAP[characterId]?.name ?? characterId;
    const tierLabel = ['薄礼', '心意礼', '厚礼'][tier] ?? '礼物';
    recordGiftBondFact(living, characterId, tierLabel);
    pushMemory(living, characterId, {
      kind: 'gift',
      summary: `指挥官送给${name}礼物（档 ${tier + 1}），好感→${score}`,
      importance: tier >= 1 ? 7 : 6,
    });
    pushCampLog(living, {
      text: `你把礼物塞给了 ${characterId}`,
      source: 'player',
      characterIds: [characterId],
    });
    applyGiftConsequences(living, characterId, tier);
  });
  return score;
}

/**
 * 远征回营：写营地日志 + 人生时间线「锈带见闻」。
 * stage 可只给名字；有 id/chapter 时写入更具体的地域印象。
 */
export function recordCombatReturn(
  victory: boolean,
  stage:
    | string
    | {
        id?: number;
        name: string;
        chapter?: number;
      },
  opts?: { kills?: number },
): void {
  const stageName = typeof stage === 'string' ? stage : stage.name;
  const chapter =
    typeof stage === 'string'
      ? undefined
      : stage.chapter ?? (stage.id != null ? Math.ceil(stage.id / 8) : undefined);
  const regionHint =
    chapter === 1
      ? '零号月台外缘的铁锈味还挂在装甲缝里'
      : chapter === 2
        ? '锈带走廊的数字门嗡鸣还没从耳里散尽'
        : chapter === 3
          ? '白棺谷的冷雾好像还黏在接口上'
          : chapter === 4
            ? '熔炉城废墟的热浪与焦油味跟着回了营'
            : chapter === 5
              ? '星核禁区的压迫感让营里灯光都显得温柔'
              : '门外锈带的风沙还留在靴底';

  mutateAiLiving((living, d) => {
    const feat = d.settings.hubFeaturedCharId ?? d.squad[0];
    const squad = (d.squad?.length ? d.squad : feat ? [feat] : []).filter(Boolean);
    const kills = opts?.kills ?? 0;
    const text = victory
      ? `远征归来：清扫「${stageName}」成功${kills ? `（击破约 ${kills}）` : ''}，营地灯为你们亮着。`
      : `远征受挫：从「${stageName}」撤归${kills ? `（仍击破约 ${kills}）` : ''}，有人沉默地递来湿巾。`;
    pushCampLog(living, {
      text,
      source: 'system',
      characterIds: squad.length ? squad : undefined,
    });
    for (const cid of squad) {
      const name = CHARACTER_MAP[cid]?.name ?? cid;
      pushMemory(living, cid, {
        kind: 'combat_return',
        summary: `${name}${victory ? '参与' : '经历'}「${stageName}」${victory ? '胜利归来' : '撤归'}：${text} ${regionHint}。`,
        importance: victory ? 7 : 8,
      });
    }
    // 留在营里的同伴也会听说「锈带见闻」（低一档，便于回营闲聊）
    const stay = d.ownedCharacters
      .map((o) => o.characterId)
      .filter((id) => !squad.includes(id))
      .slice(0, 6);
    for (const cid of stay) {
      const name = CHARACTER_MAP[cid]?.name ?? cid;
      pushMemory(living, cid, {
        kind: 'event',
        summary: `${name}听说小队从「${stageName}」${victory ? '凯旋' : '撤归'}：${regionHint}。`,
        importance: 5,
      });
    }
    applyCombatConsequences(living, {
      victory,
      stageName,
      chapter,
      kills,
      squadIds: squad,
    });
    // 义体健康改由战斗内「每次被命中 -1」结算，回营不再整场再扣
  });
}

export function peekAffinity(characterId: string): number {
  return getAffinity(getAiLiving(), characterId);
}

/** 对话 UI（P3）：到点立即落换装（不等下一轮 LLM 前置），返回是否穿上 */
export function settleDueOutfitChangeNow(characterId: string): { applied: boolean; msg: string } {
  let out = { applied: false, msg: '' };
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    out = completeDueOutfitChange(d, living, characterId);
    d.aiLiving = living;
  });
  return out;
}

/** 营地/Hub 轻量心跳：只处理"到点的换装"，不推进世界、不写盘（无到期直接返回） */
export function tickDueOutfitChanges(): void {
  const living = getAiLiving();
  const pending = living.pendingOutfitChanges;
  const now = Date.now();
  const outfitDue = !!pending &&
    Object.values(pending).some((p) => p.phase === 'changing' && now >= p.readyAtMs);
  const travelDue =
    !!living.travelPlans &&
    Object.values(living.travelPlans).some(
      (p) =>
        now >= p.arriveAtMs ||
        (p.waypoints ?? []).some((w) => !w.reached && now - p.startedAtMs >= w.atMs),
    );
  if (!outfitDue && !travelDue) return;
  saveManager.mutate((d) => {
    const live = ensureLiving(d);
    // 先落点（可能切会话相位），再补换装
    processTravelArrivals(live);
    for (const c of d.ownedCharacters) {
      try {
        completeDueOutfitChange(d, live, c.characterId);
      } catch {
        /* 单角色失败不阻塞其余 */
      }
    }
    d.aiLiving = live;
  });
}

/** 对话内 1s 心跳：行程到点即时落点/切相位（返回系统行） */
export function processTravelArrivalsNow(): string[] {
  let lines: string[] = [];
  const living = getAiLiving();
  if (!living.travelPlans || !Object.keys(living.travelPlans).length) return lines;
  const now = Date.now();
  const due = Object.values(living.travelPlans).some(
    (p) =>
      now >= p.arriveAtMs ||
      (p.waypoints ?? []).some((w) => !w.reached && now - p.startedAtMs >= w.atMs),
  );
  if (!due) return lines;
  saveManager.mutate((d) => {
    const live = ensureLiving(d);
    lines = processTravelArrivals(live);
    d.aiLiving = live;
  });
  return lines;
}

/** 对话 UI（P3）：换装剩余毫秒；无挂起换装 = 0 */
export function getOutfitChangeCountdownMs(characterId: string): number {
  return remainingOutfitChangeMs(getAiLiving(), characterId);
}

/**
 * 对话关闭：
 * - 挂起的「之后想去」此时才开始走路；
 * - 【保留】每角色最后一份场景快照——下次开对话时 buildSceneTransitionPromptBlock
 *   能生成「浴室→大厅」类硬规则，逼对白交代换环境（修复「背景已换、嘴上还在洗澡」）；
 * - 收尾卫生：到点换装穿上、出浴室清同意/临时皮、皮肤按锚点房间对齐。
 */
export function releaseDialogueSceneSession(characterIds?: string[]): void {
  mutateAiLiving((living, d) => {
    const ids =
      characterIds && characterIds.length
        ? characterIds
        : Object.keys(living.pendingDesires ?? {});
    const touched = new Set(ids);
    // 快照保留：不再 clearDialogueSceneSnapshots（跨会话的「场景已切换」叙述依赖它）
    for (const id of ids) {
      commitPendingDesireAfterDialogue(living, id);
    }
    // 同房间其他同屏角色也做卫生（快照保留，不动）
    for (const id of Object.keys(living.bodyAnchors ?? {})) touched.add(id);
    for (const id of touched) {
      try {
        completeDueOutfitChange(d, living, id);
        clearBathIntimateConsentIfNotBathing(living, id);
        syncOutfitToCurrentPresence(d, living, id);
        clearDanceIfLeftHall(d, living, id);
        clearAnfuIfLeftRoom(d, living, id);
      } catch {
        /* 单角色卫生失败不阻塞其余 */
      }
    }
    ensureDialogueSceneFields(living);
  });
}

export function observeDanceStateForUi(characterId: string): {
  active: boolean;
  mode: 'solo' | 'co' | null;
  phase: 'dressing' | 'travel' | 'prepare' | 'unveil' | 'dancing' | null;
  soloPaused: boolean;
  hasAssets: boolean;
  pendingInvite: boolean;
} {
  const living = getAiLiving();
  const s = living.danceSession;
  const mine = s?.active && s.characterId === characterId ? s : null;
  return {
    active: Boolean(mine),
    mode: (mine?.mode ?? null) as 'solo' | 'co' | null,
    phase: (mine?.phase ?? null) as 'dressing' | 'travel' | 'prepare' | 'unveil' | 'dancing' | null,
    soloPaused: Boolean(mine?.soloPaused),
    hasAssets: canShowDanceButtons(living, characterId),
    pendingInvite: living.pendingDanceInvite?.characterId === characterId,
  };
}

/**
 * 按钮/文本邀请统一入口：
 * - 舞蹈事件已在进行 → 直接起舞（换舞装中则提示稍等）
 * - 未在事件中 → 登记「待角色回应」的舞蹈请求
 * @returns true = 本条请求已由系统直接处理（不再发对话）
 */
export function requestPlayerDance(characterId: string, mode: 'solo' | 'co'): boolean {
  let started = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const s = getDanceSession(living);
    if (s?.active && s.characterId === characterId) {
      if (s.phase === 'dressing' || s.phase === 'unveil' || s.phase === 'travel') {
        s.mode = mode;
        living.danceUiFlash =
          s.phase === 'travel'
            ? `【系统】还在去大厅的路上，到了就${mode === 'co' ? '一起跳' : '跳'}。`
            : s.phase === 'unveil'
              ? `【系统】正在换演出服，马上${mode === 'co' ? '一起跳' : '跳'}。`
              : `【系统】${mode === 'co' ? '一起跳' : '跳一段'}要等换好舞装——马上就好。`;
        started = true;
        return;
      }
      const ok = mode === 'co'
        ? beginCoDance(d, living, characterId)
        : beginSoloDance(d, living, characterId);
      const after = getDanceSession(living);
      living.danceUiFlash = ok
        ? after?.phase === 'unveil'
          ? '【系统】正在换演出服，马上起舞。'
          : `【系统】${mode === 'co' ? '共舞开始' : '独舞开始'}。`
        : '【系统】起舞失败：缺少舞蹈资源。';
      started = true;
    } else {
      setPlayerDanceAsk(living, characterId, mode);
    }
    d.aiLiving = living;
  });
  return started;
}

/** 关闭对话＝玩家离开：刚被叫醒又没人陪，她会窝回去睡（好感 -1，营日志可见） */
export function settleSleepOnDialogueClose(characterId: string): boolean {
  let sleptBack = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    sleptBack = sleepBackIfLeftAloneAfterWake(living, characterId);
    d.aiLiving = living;
  });
  return sleptBack;
}

/** 换舞装到点：dressing → 待机（UI 心跳兜底，不等下一轮对话） */
export function finishDanceDressingNow(): { characterId: string; systemLine: string } | null {
  let out: { characterId: string; systemLine: string } | null = null;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const s = getDanceSession(living);
    if (!s || s.phase !== 'dressing') return;
    if (Date.now() < (s.dressReadyAtMs ?? 0)) return;
    const line = finishDanceDressing(d, living, s.characterId);
    if (line) out = { characterId: s.characterId, systemLine: line };
    d.aiLiving = living;
  });
  return out;
}

/** 起舞过渡到点：换好演出服 → dancing（音乐随之开始） */
export function finishDanceUnveilNow(): { characterId: string; systemLine: string } | null {
  let out: { characterId: string; systemLine: string } | null = null;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const s = getDanceSession(living);
    if (!s || s.phase !== 'unveil') return;
    if (Date.now() < (s.unveilUntilMs ?? 0)) return;
    if (finishDanceUnveil(d, living, s.characterId)) {
      const modeLabel = s.mode === 'co' ? '共舞' : '独舞';
      out = { characterId: s.characterId, systemLine: `【系统】${modeLabel}开始。` };
    }
    d.aiLiving = living;
  });
  return out;
}

/** 只是停下休息：回舞蹈待机，舞蹈事件继续 */
export function stopDanceNow(): string {
  let line = '';
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const s = getDanceSession(living);
    if (!s) return;
    if (s.phase === 'dancing') {
      returnToPrepare(d, living, s.characterId);
      line = '【系统】停下休息，回到舞蹈待机（事件仍在，可以再开始）。';
    }
    d.aiLiving = living;
  });
  return line;
}

/** 结束舞蹈事件：换下舞装 + 离开大厅 */
export function endDanceNow(): string {
  let line = '';
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    if (!getDanceSession(living)) return;
    const r = leaveDanceSession(d, living, { reason: '指挥官结束舞蹈' });
    line = r.systemLine ?? '【系统】舞蹈已结束。';
    d.aiLiving = living;
  });
  return line;
}

export function acceptPendingDanceInviteNow(): boolean {
  let ok = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const r = acceptDanceInvite(d, living);
    ok = r.ok;
    if (r.systemLine) living.danceUiFlash = r.systemLine;
    d.aiLiving = living;
  });
  return ok;
}

export function rejectPendingDanceInviteNow(): void {
  mutateAiLiving((living) => {
    rejectDanceInvite(living);
  });
}

export function takeDanceUiFlash(): string | null {
  let text: string | null = null;
  mutateAiLiving((living) => {
    if (living.danceUiFlash) {
      text = living.danceUiFlash;
      living.danceUiFlash = undefined;
    }
  });
  return text;
}

/* ================= 小游戏（聊天界面「游戏」按钮：五子棋/猜拳） ================= */

/** 对话 UI：游戏按钮可见性 + 当前对局状态 */
export function observeMiniGameStateForUi(characterId: string): {
  available: boolean;
  active: boolean;
  kind: MiniGameKind | null;
  turn: 'player' | 'ai' | null;
  remainMs: number;
  pendingInvite: boolean;
  pendingInviteKind: MiniGameKind | null;
  stakeWinner: 'player' | 'ai' | null;
} {
  const living = getAiLiving();
  const s = living.miniGameSession;
  const mine = s?.active && s.characterId === characterId ? s : null;
  const stake = living.miniGameStake;
  return {
    available: canShowMiniGameButtons(living, characterId),
    active: Boolean(mine),
    kind: (mine?.kind ?? null) as MiniGameKind | null,
    turn: (mine?.turn ?? null) as 'player' | 'ai' | null,
    remainMs: mine ? Math.max(0, mine.turnDeadlineMs - Date.now()) : 0,
    pendingInvite: living.pendingMiniGameInvite?.characterId === characterId,
    pendingInviteKind: living.pendingMiniGameInvite?.characterId === characterId
      ? (living.pendingMiniGameInvite?.kind ?? null)
      : null,
    stakeWinner: stake && stake.characterId === characterId ? stake.winner : null,
  };
}

/**
 * 按钮邀请统一入口：登记「待角色回应」的小游戏请求（等角色本轮答复）。
 * 已在该角色对局中 → 不再发对话，由面板直接交互。
 * @returns true = 已在该角色对局中（系统直接处理）
 */
export function requestPlayerMiniGame(characterId: string, kind: MiniGameKind): boolean {
  let inGame = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    if (isMiniGameActiveFor(living, characterId)) {
      inGame = true;
      return;
    }
    setPlayerMiniGameAsk(living, characterId, kind);
    d.aiLiving = living;
  });
  return inGame;
}

/** 玩家落子（五子棋面板） */
export function miniGameGomokuMoveNow(idx: number): { ok: boolean; msg: string; systemLine?: string } {
  let out: { ok: boolean; msg: string; systemLine?: string } = { ok: false, msg: '未在对局中' };
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    out = playerGomokuMove(d, living, idx);
    d.aiLiving = living;
  });
  return out;
}

/** 玩家出拳（猜拳面板） */
export function miniGameRpsThrowNow(playerThrow: RpsThrow): { ok: boolean; msg: string; systemLine?: string } {
  let out: { ok: boolean; msg: string; systemLine?: string } = { ok: false, msg: '未在对局中' };
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    out = playerRpsThrow(d, living, playerThrow);
    d.aiLiving = living;
  });
  return out;
}

/** 玩家中途退出/关闭对话：判负 + 扣好感 */
export function quitMiniGameNow(reason: string): string {
  let line = '';
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    if (!getMiniGameSession(living)) return;
    const r = quitMiniGameByPlayer(d, living, reason);
    line = r.systemLine ?? '【系统】对局已结束（你中途退出，判负）。';
    d.aiLiving = living;
  });
  return line;
}

export function acceptPendingMiniGameInviteNow(): boolean {
  let ok = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const r = acceptMiniGameInvite(d, living);
    ok = r.ok;
    if (r.systemLine) living.miniGameUiFlash = r.systemLine;
    d.aiLiving = living;
  });
  return ok;
}

export function rejectPendingMiniGameInviteNow(): void {
  mutateAiLiving((living) => {
    rejectMiniGameInvite(living);
  });
}

export function takeMiniGameUiFlash(): string | null {
  let text: string | null = null;
  mutateAiLiving((living) => {
    if (living.miniGameUiFlash) {
      text = living.miniGameUiFlash;
      living.miniGameUiFlash = undefined;
    }
  });
  return text;
}

/** 面板重绘用：读取当前对局完整状态（只读快照；含刚结算完的终局态，供结果横幅显示） */
export function getMiniGameSnapshotForUi(): {
  characterId: string;
  kind: MiniGameKind;
  active: boolean;
  turn: 'player' | 'ai';
  remainMs: number;
  gomoku?: { board: number[]; lastMove: number | null };
  rps?: {
    round: number;
    playerWins: number;
    aiWins: number;
    lastPlayerThrow: string | null;
    lastAiThrow: string | null;
    lastRoundOutcome: number | null;
  };
  result: 'player_win' | 'ai_win' | 'draw' | null;
  resultReason?: string;
} | null {
  const living = getAiLiving();
  const s = living.miniGameSession;
  if (!s?.characterId) return null;
  if (!s.active && !s.result) return null;
  return {
    characterId: s.characterId,
    kind: s.kind,
    active: s.active === true,
    turn: s.turn,
    remainMs: s.active ? Math.max(0, s.turnDeadlineMs - Date.now()) : 0,
    gomoku: s.gomoku
      ? { board: s.gomoku.board.slice(), lastMove: s.gomoku.lastMove ?? null }
      : undefined,
    rps: s.rps
      ? {
          round: s.rps.round,
          playerWins: s.rps.playerWins,
          aiWins: s.rps.aiWins,
          lastPlayerThrow: s.rps.lastPlayerThrow ?? null,
          lastAiThrow: s.rps.lastAiThrow ?? null,
          lastRoundOutcome: s.rps.lastRoundOutcome ?? null,
        }
      : undefined,
    result: s.result ?? null,
    resultReason: s.resultReason,
  };
}

/** 赛后约定状态（面板提示用） */
export function getMiniGameStakeForUi(characterId: string): { winner: 'player' | 'ai'; kind: MiniGameKind } | null {
  const living = getAiLiving();
  const stake = living.miniGameStake;
  if (!stake || stake.characterId !== characterId) return null;
  return { winner: stake.winner, kind: stake.kind };
}

export { miniGameKindLabel };

/* ================= 浴室互动（聊天界面「洗浴」按钮） ================= */

/** 对话 UI：浴室按钮可见性 + 当前会话状态 */
export function observeBathStateForUi(characterId: string): {
  available: boolean;
  active: boolean;
  mode: 'help_wash' | 'co_bath' | null;
  pendingInvite: boolean;
  pendingAsk: boolean;
} {
  const living = getAiLiving();
  const s = getBathAssistSession(living);
  return {
    available: canShowBathButtons(living, characterId),
    active: Boolean(s && s.characterId === characterId),
    mode: s && s.characterId === characterId ? s.mode : null,
    pendingInvite: living.pendingBathAssistInvite?.characterId === characterId,
    pendingAsk: living.pendingPlayerBathAssistAsk?.characterId === characterId,
  };
}

/**
 * 指挥官点「帮我（指挥官冲澡）」「一同泡澡」：登记待回应，等角色答复。
 * @returns true = 事件已在进行并直接切换（本轮不再发对话）
 */
export function requestPlayerBathAssist(
  characterId: string,
  mode: 'help_wash' | 'co_bath',
): boolean {
  let started = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const s = getBathAssistSession(living);
    if (s?.active && s.characterId === characterId) {
      // 已在浴室互动中：直接切模式（帮洗 ⇄ 共浴）
      if (s.mode !== mode) {
        const r = enterBathAssistSession(d, living, characterId, mode, 'player_button');
        if (r.ok) {
          living.bathAssistUiFlash = r.systemLine ?? r.msg;
          started = true;
        }
      } else {
        started = true;
      }
      d.aiLiving = living;
      return;
    }
    setPlayerBathAssistAsk(living, characterId, mode);
    d.aiLiving = living;
  });
  return started;
}

/** 指挥官点「帮我（指挥官冲澡）」「一同泡澡」时发出的口语请求（与打字/语音等效） */
export function buildPlayerBathAskText(mode: 'help_wash' | 'co_bath'): string {
  return buildBathAssistPlayerProposeMessage(mode);
}

export function acceptPendingBathAssistInviteNow(): boolean {
  let ok = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const r = acceptBathAssistInvite(d, living);
    ok = r.ok;
    if (r.systemLine) living.bathAssistUiFlash = r.systemLine;
    d.aiLiving = living;
  });
  return ok;
}

export function rejectPendingBathAssistInviteNow(): void {
  mutateAiLiving((living) => {
    rejectBathAssistInvite(living);
  });
}

export function takeBathAssistUiFlash(): string | null {
  let text: string | null = null;
  mutateAiLiving((living) => {
    if (living.bathAssistUiFlash) {
      text = living.bathAssistUiFlash;
      living.bathAssistUiFlash = undefined;
    }
  });
  return text;
}

/** 帮洗前的「先换浴巾」准备倒计时到点：切帮洗立绘 */
export function finishBathAssistPrepareNow(): string | null {
  let line: string | null = null;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const r = tryCompleteBathAssistPrepare(d, living);
    if (r) line = r.systemLine ?? r.msg;
    d.aiLiving = living;
  });
  return line;
}

/** 聊天 UI：玩家文字/语音里提出帮洗/共浴时登记待回应（与按钮等效） */
export function registerPlayerBathAskFromText(
  living: AiLivingSave,
  characterId: string,
  playerMessage: string,
): void {
  if (!canShowBathButtons(living, characterId)) return;
  const mode = detectPlayerBathAssistMode(playerMessage);
  if (!mode) return;
  setPlayerBathAssistAsk(living, characterId, mode);
}

/** 对话 UI：独舞循环片段列表（主循环 + _1/_2…），供无缝循环播放 */
export function getDanceSoloClips(characterId: string): string[] {
  return getDanceSoloClipList(characterId);
}

/** 安抚室 UI 门面：状态观察（按钮显隐/进度条/邀请条共用） */
export function observeAnfuStateForUi(characterId: string): {
  active: boolean;
  phase: 'dressing' | 'travel' | 'standby' | 'soothing' | 'exhausted' | null;
  value: number;
  clipIndex: number;
  attackCoolingMs: number;
  awaitingReply: boolean;
  hasAssets: boolean;
  pendingInvite: boolean;
  playedToday: boolean;
} {
  const living = getAiLiving();
  const s = living.anfuSession;
  const mine = s?.active && s.characterId === characterId ? s : null;
  const cooling = mine
    ? Math.max(0, 10_000 - (Date.now() - mine.lastAttackAtMs))
    : 0;
  return {
    active: Boolean(mine),
    phase: (mine?.phase ?? null) as 'dressing' | 'travel' | 'standby' | 'soothing' | 'exhausted' | null,
    value: mine?.value ?? 0,
    clipIndex: mine?.clipIndex ?? 0,
    attackCoolingMs: cooling,
    awaitingReply: Boolean(mine?.awaitingAttackReply),
    hasAssets: canShowAnfuButtons(living, characterId),
    pendingInvite: living.pendingAnfuInvite?.characterId === characterId,
    playedToday: living.anfuPlayDay?.[characterId] === living.dayIndex,
  };
}

/** 安抚按钮统一入口：登记「待角色回应」的安抚请求 */
export function requestPlayerAnfu(characterId: string): void {
  mutateAiLiving((living) => {
    setPlayerAnfuAsk(living, characterId);
  });
}

export function acceptPendingAnfuInviteNow(): boolean {
  let ok = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const r = acceptAnfuInvite(d, living);
    ok = r.ok;
    if (r.systemLine) living.anfuUiFlash = r.systemLine;
    d.aiLiving = living;
  });
  return ok;
}

export function rejectPendingAnfuInviteNow(): void {
  mutateAiLiving((living) => {
    rejectAnfuInvite(living);
  });
}

export function takeAnfuUiFlash(): string | null {
  let text: string | null = null;
  mutateAiLiving((living) => {
    if (living.anfuUiFlash) {
      text = living.anfuUiFlash;
      living.anfuUiFlash = undefined;
    }
  });
  return text;
}

/**
 * 棉花攻击按钮统一入口：切片段 + 置锁等模型回。
 * 返回 clipSrc 供 UI 先切画面、attackText 供 UI 发给模型（含部位/缠绕/姿势）；
 * 数值等本轮模型返回 anfu_gain 后落盘。
 */
export function requestAnfuAttackNow(
  characterId: string,
): { ok: boolean; msg: string; clipSrc?: string; clipIndex?: number; attackText?: string } {
  let out: { ok: boolean; msg: string; clipSrc?: string; clipIndex?: number; attackText?: string } = {
    ok: false,
    msg: '不在安抚中',
  };
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    const r = requestAnfuAttack(d, living, characterId);
    out = { ...r, attackText: buildAnfuAttackPlayerText(living, characterId) ?? undefined };
    d.aiLiving = living;
  });
  return out;
}

/** 换装完成推进（黑屏/对话轮后调用，幂等） */
export function finishAnfuDressingNow(characterId: string): boolean {
  let ok = false;
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    ok = finishAnfuDressing(d, living, characterId);
    d.aiLiving = living;
  });
  return ok;
}

/** 对话 UI：安抚过程片段列表（按攻击顺序播） */
export function getAnfuClips(characterId: string): string[] {
  return getAnfuClipList(characterId);
}

/** 对话 UI：直接进入安抚（邀请已确认路径复用） */
export function enterAnfuNow(
  characterId: string,
): { ok: boolean; msg: string; systemLine?: string } {
  let out: { ok: boolean; msg: string; systemLine?: string } = { ok: false, msg: '' };
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    out = enterAnfuSession(d, living, characterId, 'player_button');
    if (out.systemLine) living.anfuUiFlash = out.systemLine;
    d.aiLiving = living;
  });
  return out;
}

/** 对话 UI：离开安抚室（按 phase 分流语义） */
export function leaveAnfuNow(
  reason: 'leave' | 'close' = 'leave',
): { ok: boolean; msg: string; systemLine?: string } {
  let out: { ok: boolean; msg: string; systemLine?: string } = { ok: false, msg: '' };
  saveManager.mutate((d) => {
    const living = ensureLiving(d);
    out = leaveAnfuSession(d, living, { reason });
    if (out.systemLine) living.anfuUiFlash = out.systemLine;
    d.aiLiving = living;
  });
  return out;
}

export function takeOfflineBanner(): string | null {
  let text: string | null = null;
  mutateAiLiving((living) => {
    text = consumeOfflineSummary(living);
  });
  return text;
}

/** 主城/营地：评估/投递角色主动消息 */
export async function runPlayerOutreachOnce(opts?: {
  forceCharacterId?: string;
  bypassCooldown?: boolean;
}): Promise<{ kind: string; detail?: string }> {
  const owned = saveManager.get().ownedCharacters.map((c) => c.characterId);
  const working = cloneLiving();
  advanceWorldClock(working);
  const result = await tickPlayerOutreach(working, owned, opts ?? {});
  if (result.kind === 'sent' && working.pendingAiMessages?.length) {
    const message = working.pendingAiMessages[working.pendingAiMessages.length - 1];
    if (message?.status === 'pending') {
      const save = saveManager.get();
      maybeProposeDisciplineInvite(save, working, message.characterId, message.openingDialogue);
    }
  }
  saveManager.mutate((d) => {
    d.aiLiving = working;
  });
  return result;
}

export function peekPendingAiMessages(): AiMessageEvent[] {
  return listPendingAiMessages(getAiLiving());
}

/** 点选主动消息：接受该条并取消其余；返回角色 id 供打开对话 */
export function acceptPendingAiMessage(messageId: string): AiMessageEvent | null {
  let accepted: AiMessageEvent | null = null;
  mutateAiLiving((living) => {
    accepted = acceptAiMessage(living, messageId);
  });
  return accepted;
}

export function dismissPendingAiMessage(messageId: string): boolean {
  let ok = false;
  mutateAiLiving((living) => {
    ok = dismissAiMessage(living, messageId);
  });
  return ok;
}
