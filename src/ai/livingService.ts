import { saveManager } from '../core/SaveManager';
import type { SaveData } from '../types';
import { CHARACTER_MAP } from '../data/characters';
import { tickHeartbeat } from './heartbeat';
import { consumeOfflineSummary, processOfflineReturn } from './offlineSummary';
import { applyBatheShowerSkins, applyEventTempSkins } from './campEvents/campEventEffects';
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
  syncSleepCampSkin,
  tickSleepSystem,
} from './sleepSystem';
import {
  recoverStaleDisciplineSession,
  scrubOrphanDisciplineArtifacts,
  maybeProposeDisciplineInvite,
} from './disciplineSession';
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
  tickCampEvents(living, owned, (delta) => applyGoldDelta(d, delta));
  applyEventTempSkins(d, living);
  applyBatheShowerSkins(d, living);
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
  if ((opts?.turnMode ?? 'reply') === 'reply' && isDeepSleeping(working, characterId)) {
    markSleepDisturbed(working, characterId, '指挥官在睡觉时找你聊天');
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
    // 打开对话时再扫一遍：清卡死调教态 / 孤儿束缚锚点
    scrubOrphanDisciplineArtifacts(working);
    recoverStaleDisciplineSession(d, working);
    reconcileBodyAnchor(d, working, characterId);
    completeDueOutfitChange(d, working, characterId);
    if (isInSleepSystem(working, characterId)) {
      syncSleepCampSkin(working, characterId);
    }
    settleCharacterForDialogue(d, working, characterId);
    // 开场记下初始场景；首句尚无「切换」，从第二句起才对比
    commitDialogueSceneSnapshot(working, characterId, captureDialogueSceneSnapshot(working, characterId));
    d.aiLiving = working;
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
      } catch {
        /* 单角色卫生失败不阻塞其余 */
      }
    }
    ensureDialogueSceneFields(living);
  });
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
