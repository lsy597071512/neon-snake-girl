/**
 * 安抚室会话：指挥官与角色在负一层安抚室（库房改造）的棉花游戏。
 *
 * 三相状态机（与舞蹈/浴室会话同构）：
 * - standby（安抚待机）：已换上动物服装待机，还未进入安抚状态；
 *   玩家第一次点击「棉花攻击」→ 进入 soothing。
 * - soothing（安抚中）：棉花不断落在亲近区，安抚值持续上涨；
 *   每次攻击切换安抚片段（按序播，有几个播几个），大幅加值（10~40 由角色判定）；
 *   不攻击时每 5~10 秒被动 +1~3（棉花仍在自动落下），只涨数值不切画面。
 * - exhausted（安抚疲惫）：安抚值到 100，播疲惫皮，攻击键失效，只能聊天或离开。
 *
 * - 地点：room_b1_discipline（负一层库房；中文一律叫「安抚室」）。
 * - 每角色每天限玩一次（anfuPlayDay），次数在进入待机时消耗。
 * - 离开语义按 phase 分流：待机=中性；安抚中=扣好感；疲惫=结算奖励；读档恢复=中性。
 * - 措辞约束（市场模式）：Prompt 与协议只用 T3 安全词与异样情绪正向子集；
 *   喘息拟声/身体愉悦直述/部位直呼一律改写为中性画面词（哼声变调/酥麻暖流/亲近区），
 *   不得作为喂给 LLM 的输出目标。
 *
 * 见 src/data/characterSkins.ts（三相功能皮）与 docs/erotica-headroom-analysis.md（擦边上限）。
 */
import {
  ANFU_ACTIVE_SKIN_ID,
  ANFU_DONE_SKIN_ID,
  ANFU_STANDBY_SKIN_ID,
  ANFU_TEMP_SKIN_INSTANCE,
  getAnfuPoseNote,
  getAnfuClipList,
  getCharacterSkin,
  hasAnfuAssets,
  OUTFIT_CHANGE_SKIN_ID,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import type { SaveData } from '../types';
import { forceScheduleOutfitChange } from './outfitChangeProcess';
import { clearEventTempSkinsForInstance, setEventTempSkin } from './campEvents/campEventEffects';
import { getCampLogicalSkinId, getCampWornSkinId } from './campOutfit';
import { snapAgentToRoom } from './campAgents';
import { clearAgenda, getAgenda, setAgenda } from './characterAgenda';
import { isBathAssistActiveFor } from './bathAssistSession';
import { isDisciplineActiveFor } from './disciplineSession';
import { isDanceActiveFor } from './danceSession';
import { isMiniGameActiveFor } from './miniGameSession';
import { isInSleepSystem, leaveSleepSystem, sleepWakeDifficulty } from './sleepSystem';
import { cancelTravel, planTravel } from './travel';
import { pushMemory, pushRecentChat, pushCampLog } from './memory';
import { adjustAffinity } from './relationship';
import type { AiLivingSave, CharacterActivity, LightStatusTag } from './types';
import { resolvePresence } from './livingState';

/** 安抚室房间（复用负一层库房 id；中文一律称「安抚室」） */
export const ANFU_ROOM_ID = 'room_b1_discipline';
export const ANFU_ROOM_LABEL = '安抚室';

/** 离场回落房间：优先进入前的房间，否则回一楼大厅 */
export function getAnfuExitRoom(prevRoomId: string | null | undefined): string {
  if (prevRoomId && prevRoomId !== ANFU_ROOM_ID && CAMP_ROOM_MAP[prevRoomId]) {
    return prevRoomId;
  }
  return 'room_1f_hall1';
}

/** 安抚值上限 */
export const ANFU_VALUE_MAX = 100;
/** 棉花攻击冷却（墙钟） */
export const ANFU_ATTACK_COOLDOWN_MS = 10_000;
/** 被动涨幅窗口：每 5~10 秒结算一次（取 7.5s 中位由 tick 驱动） */
export const ANFU_DRIP_INTERVAL_MS = 7_500;
/** 被动涨幅：个位数 1~3 */
export const ANFU_DRIP_MIN = 1;
export const ANFU_DRIP_MAX = 3;
/** 攻击加值区间（角色判定，服务端钳制） */
export const ANFU_GAIN_MIN = 10;
export const ANFU_GAIN_MAX = 40;
/** 攻击缺失/超时 fallback */
export const ANFU_GAIN_FALLBACK_MIN = 15;
export const ANFU_GAIN_FALLBACK_MAX = 25;
/** 安抚中途离开惩罚 */
export const ANFU_LEAVE_PENALTY = -6;
/** 结算好感：基础 + 模型 bonus（上限合计 8） */
export const ANFU_SETTLE_BASE = 5;
export const ANFU_SETTLE_BONUS_MAX = 3;

export type AnfuPhase = 'dressing' | 'travel' | 'standby' | 'soothing' | 'exhausted';
export type AnfuEntrySource = 'player_button' | 'player_chat' | 'character_invite' | 'recover';

/**
 * 换装过程时长（挂 huanzhuang 过程皮后切到待机皮）。
 * 取值对齐换装协议 CHANGE_DELAY_MS 的观感：够长到能看清「在换衣服」，
 * 又不至于让玩家干等；到点由 tickAnfuSession 推进到 standby。
 */
export const ANFU_DRESS_MS = 4_600;

export type AnfuSessionState = {
  active: boolean;
  characterId: string;
  phase: AnfuPhase;
  /** 安抚值 0~100（超 100 按 100 计） */
  value: number;
  /** 当前安抚片段下标（只在攻击时推进） */
  clipIndex: number;
  /** 上次攻击墙钟（冷却用） */
  lastAttackAtMs: number;
  /** 上次被动结算墙钟 */
  lastDripAtMs: number;
  /** 等待本轮模型返回 anfu_gain */
  awaitingAttackReply: boolean;
  /** 换装完成时刻（dressing 相）；到点 tick 切 standby 并挂待机皮 */
  dressReadyAtMs: number;
  prevRoomId: string | null;
  prevCampSkinId: string | null;
  prevEventTemp?: import('./types').EventTempSkinState | null;
  startedAt: number;
  entrySource: AnfuEntrySource;
  /** 结算奖励是否已发放（幂等） */
  settled?: boolean;
  justEntered?: boolean;
  justLeft?: boolean;
  justLeftTurnsLeft?: number;
  settling?: boolean;
};

/** 指挥官提出（按钮/打字/语音同一路径），等角色本轮回应 */
export type AnfuPlayerAskPending = {
  characterId: string;
  proposedAt: number;
};

/** 角色主动邀请（待指挥官确认） */
export type AnfuInvitePending = {
  characterId: string;
  proposedAt: number;
  dayIndex: number;
  preview: string;
};

export function getAnfuSession(living: AiLivingSave): AnfuSessionState | null {
  const s = living.anfuSession;
  if (!s?.active || !s.characterId) return null;
  return s;
}

export function isAnfuActiveFor(living: AiLivingSave, characterId: string): boolean {
  const s = getAnfuSession(living);
  return !!s && s.characterId === characterId;
}

export function isAnfuTempInstance(eventInstanceId: string | null | undefined): boolean {
  return eventInstanceId === ANFU_TEMP_SKIN_INSTANCE;
}

export function isAnfuRoom(roomId: string | null | undefined): boolean {
  return roomId === ANFU_ROOM_ID;
}

/** 今日是否已玩过（次数在进入待机时消耗） */
export function hasPlayedAnfuToday(living: AiLivingSave, characterId: string): boolean {
  return living.anfuPlayDay?.[characterId] === living.dayIndex;
}

/** 预留：后续开启限制钩子（默认全开） */
export function isAnfuUnlocked(_living: AiLivingSave, _characterId: string): boolean {
  return true;
}

/** 该角色是否可用于安抚（资源 + 互斥 + 每日一次 + 解锁） */
export function canAnfuAtAll(living: AiLivingSave, characterId: string): boolean {
  if (isDisciplineActiveFor(living, characterId)) return false;
  if (isBathAssistActiveFor(living, characterId)) return false;
  if (isDanceActiveFor(living, characterId)) return false;
  if (isMiniGameActiveFor(living, characterId)) return false;
  if (hasPlayedAnfuToday(living, characterId)) return false;
  if (!isAnfuUnlocked(living, characterId)) return false;
  return hasAnfuAssets(characterId);
}

/** 聊天页安抚按钮显示条件 */
export function canShowAnfuButtons(living: AiLivingSave, characterId: string): boolean {
  return canAnfuAtAll(living, characterId);
}

/**
 * 安抚异样情绪·正向子集（市场模式 T3 安全词）。
 * 游戏即娱乐：气愤/厌恶/害怕几乎不出；紧张只在首击露脸。
 */
export const ANFU_POSITIVE_MOODS = [
  '兴奋',
  '害羞',
  '期待',
  '心动',
  '开心',
  '迷糊',
  '失神',
] as const;

/** 棉花命中亲近区（复用 bodySensitivity zone 中文标签；此处置放逐供 Prompt 引用） */
export const ANFU_HIT_ZONES = [
  '腰侧',
  '身后',
  '胸口',
  '锁骨一带',
  '身侧',
  '耳后',
  '尾巴尖',
] as const;

/**
 * 每团的「缠绕」写法（画面级中性描写，T3 安全词）。
 * 让角色知道棉花怎么落到哪、怎么缠住，而不是只知道「飞过去了」。
 */
const ANFU_WRAP_TEMPLATES: Record<string, string[]> = {
  腰侧: [
    '一团蓬松的棉花黏上你的腰侧，软绵绵地顺着腰线缓缓蹭开，绒毛钻进衣服边缘一圈圈绕着',
    '棉花贴上腰侧的软肉，被体温捂得暖暖的，慢慢塌下来裹住那一小圈',
  ],
  身后: [
    '棉花从背后扑上来，黏在你身后轻轻揉开，绒毛一层层垫着又压紧',
    '一团棉花顺着背后贴住，随你呼吸的起伏一鼓一缩地裹着',
  ],
  胸口: [
    '棉花飘到你胸口上方轻轻落下，被起伏的呼吸带着一点一点下压，软绒裹住轻轻颤',
    '一团棉花贴上胸口就停住不动了，被你的心跳一下一下震着慢慢摊开',
  ],
  锁骨一带: [
    '棉花落在锁骨那一带，软软地填进浅浅的窝里，被你吞咽的动作带着微微滑动',
    '一团棉花顺着颈侧滑到锁骨，蓬松地堆在那儿随呼吸轻轻起伏',
  ],
  身侧: [
    '棉花擦着身侧贴上来，绒毛顺着肋骨的弧度一路铺开，暖烘烘地贴着',
    '一团棉花软软地压上身侧，慢慢化开把那一块裹得严严实实',
  ],
  耳后: [
    '棉花落在耳后，绒毛顺着发丝一路蹭到脖颈，轻轻压着耳廓',
    '一小团棉花贴着耳后停住，被你的心跳一下一下顶着微微发颤',
  ],
  尾巴尖: [
    '棉花一下卷住尾巴尖，蓬松的绒毛把那一小截裹住，随着尾巴的抖动晃',
    '一团棉花黏上尾巴尖，随着你甩动的幅度一松一紧地绕着',
  ],
};

function wrapTextFor(zone: string, seed: number): string {
  const list = ANFU_WRAP_TEMPLATES[zone] ?? ANFU_WRAP_TEMPLATES['身侧']!;
  return list[Math.abs(seed) % list.length]!;
}

/** 当前片段对应的命中部位（攻击与 Prompt 共用同一判定，保证嘴画一致） */
export function anfuCurrentHitZone(clipIndex: number): string {
  return ANFU_HIT_ZONES[Math.max(0, clipIndex) % ANFU_HIT_ZONES.length]!;
}

/**
 * 玩家发射棉花时发给模型的气泡文本。
 *
 * 措辞约束（玩家可见/入模一致）：只描述「棉花落在哪、怎么缠住、切成了什么姿势」，
 * 不出现任何协议/系统/判定口吻（「命中亲近区」「按判定填 anfu_gain」这类官方措辞
 * 会直接出戏）。判定字段由 ANFU_PROTOCOL 单独交代，不混进玩家气泡。
 */
export function buildAnfuAttackPlayerText(
  living: AiLivingSave,
  characterId: string,
): string | null {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) return null;
  const zone = anfuCurrentHitZone(s.clipIndex);
  const pose = getAnfuPoseNote(s.clipIndex);
  const wrap = wrapTextFor(zone, s.clipIndex + characterId.length);
  const first = s.clipIndex === 0;
  const act = first ? '轻轻落在' : '又软软地缠上';
  return (
    `（指挥官抖开一团棉花，${act}你的${zone}）${wrap}。` +
    `你顺势换了个姿势：${pose}。`
  );
}


function anfuBehavior(phase: AnfuPhase): string {
  if (phase === 'soothing') return '在安抚室和指挥官玩棉花游戏，被棉花碰得又舒服又害羞';
  if (phase === 'exhausted') return '在安抚室心满意足地休息，耳朵都耷拉下来了';
  return '在安抚室穿着动物服装待机，等指挥官开始棉花游戏';
}

function lockAgenda(living: AiLivingSave, characterId: string): void {
  const activity: CharacterActivity = 'play';
  setAgenda(living, characterId, {
    goal: 'anfu',
    targetRoomId: ANFU_ROOM_ID,
    activity,
    behavior: anfuBehavior(getAnfuSession(living)?.phase ?? 'standby'),
    remainGameMin: 240,
    startedGameMin: living.gameMinutes,
    reason: '去安抚室玩棉花游戏',
    source: 'social',
  });
}

function unlockAgenda(living: AiLivingSave, characterId: string): void {
  const a = getAgenda(living, characterId);
  if (a?.goal === 'anfu') clearAgenda(living, characterId);
}

/**
 * 挂安抚相位皮（待机 / 安抚中 / 疲惫）。
 * 保留进入前的 restoreSkinId，确保离开时能准确还原玩家原本的营地穿着。
 */
function applyAnfuSkin(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  skinId: string,
): void {
  if (!living.eventTempSkins) living.eventTempSkins = {};
  const prev = living.eventTempSkins[characterId];
  // restoreSkinId 只在第一次挂载时锁定，后续相位切换不得覆盖（否则会锁到安抚皮自己）
  const restoreSkinId =
    prev?.eventInstanceId === ANFU_TEMP_SKIN_INSTANCE
      ? (prev.restoreSkinId ?? getCampWornSkinId(living, characterId))
      : getCampWornSkinId(living, characterId);
  living.eventTempSkins[characterId] = {
    skinId,
    restoreSkinId,
    eventInstanceId: ANFU_TEMP_SKIN_INSTANCE,
  };
  // 通知形象层刷新（AI 同步用）；不改动账本语义
  setEventTempSkin(save, living, characterId, skinId, ANFU_TEMP_SKIN_INSTANCE);
}

/** 当前应显示的安抚皮（dressing 期走换装过程皮，由 campOutfit 特判） */
export function anfuDisplaySkinId(living: AiLivingSave, characterId: string): string | null {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) return null;
  if (s.phase === 'dressing') return OUTFIT_CHANGE_SKIN_ID;
  if (s.phase === 'soothing') return ANFU_ACTIVE_SKIN_ID;
  if (s.phase === 'exhausted') return ANFU_DONE_SKIN_ID;
  return ANFU_STANDBY_SKIN_ID;
}

/** 当前片段姿势（同步 AI） */
export function anfuCurrentPoseNote(living: AiLivingSave, characterId: string): string {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) return getAnfuPoseNote(0);
  return getAnfuPoseNote(s.clipIndex);
}

export type AnfuEnterResult = {
  ok: boolean;
  msg: string;
  systemLine?: string;
};

/**
 * 进入安抚会话：登记会话、挂待机皮、锁议程、瞬移到安抚室。
 * 每日次数在此刻消耗（待机离开也算玩过）。
 */
export function enterAnfuSession(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  entrySource: AnfuEntrySource = 'player_button',
): AnfuEnterResult {
  if (!CHARACTER_MAP[characterId]) return { ok: false, msg: '角色不存在' };
  if (!canAnfuAtAll(living, characterId)) {
    if (hasPlayedAnfuToday(living, characterId)) {
      return { ok: false, msg: '今天已经安抚过一次了，明天再来' };
    }
    return { ok: false, msg: '当前无法进入安抚室' };
  }
  if (getAnfuSession(living)) {
    return { ok: false, msg: '安抚室正忙' };
  }
  if (!getCharacterSkin(characterId, ANFU_STANDBY_SKIN_ID)) {
    return { ok: false, msg: '该角色暂无安抚室资源' };
  }

  // 睡觉时答应去安抚室要先醒：叫不醒就进不去（她答应≠一定能醒）
  if (isInSleepSystem(living, characterId)) {
    const diff = sleepWakeDifficulty(living, characterId);
    if (!diff.wakeable) {
      return { ok: false, msg: '她睡得太沉，叫不醒——等醒了再安抚' };
    }
    leaveSleepSystem(living, characterId, { reason: '被指挥官叫去安抚室', completed: false });
  }

  const presence = resolvePresence(characterId, living);
  const prevRoomId = presence.roomId || null;
  const prevCampSkinId = getCampWornSkinId(living, characterId);
  const prevTempRaw = living.eventTempSkins?.[characterId];
  const prevEventTemp =
    prevTempRaw && prevTempRaw.eventInstanceId !== ANFU_TEMP_SKIN_INSTANCE
      ? { ...prevTempRaw }
      : null;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;

  living.anfuSession = {
    active: true,
    characterId,
    phase: 'dressing',
    value: 0,
    clipIndex: 0,
    lastAttackAtMs: 0,
    lastDripAtMs: Date.now(),
    awaitingAttackReply: false,
    dressReadyAtMs: Date.now() + ANFU_DRESS_MS,
    prevRoomId,
    prevCampSkinId,
    prevEventTemp,
    startedAt: Date.now(),
    entrySource,
    settled: false,
    justEntered: true,
    justLeft: false,
    justLeftTurnsLeft: 0,
  };

  if (!living.anfuPlayDay) living.anfuPlayDay = {};
  living.anfuPlayDay[characterId] = living.dayIndex;

  // 换装相不挂过程皮：huanzhuang 是过程皮，setEventTempSkin 按设计拒绝它；
  // 由 campOutfit.getCampDisplaySkinId / characterSkinRuntime 的 dressing 特判显示换装中动态。
  // 到点 finishAnfuDressing 才正式挂上安抚待机皮。
  //
  // 但仍要「占位」：预留 ANFU_TEMP_SKIN_INSTANCE 槽位（皮仍是换装前那件），
  // 否则换装这几秒里 applyBatheShowerSkins / applyEventTempSkins / 情绪选装
  // 会认为「没人占用」而各自扒皮盖皮 —— 玩家看到的就是「刚要进安抚室，服装莫名乱切」。
  clearEventTempSkinsForInstance(living, ANFU_TEMP_SKIN_INSTANCE, { dressBack: false });
  if (!living.eventTempSkins) living.eventTempSkins = {};
  living.eventTempSkins[characterId] = {
    // 空串 = 「占位但不覆盖」：各下游都按 skinId 真值判断，空串会自然回落到营地日常账本，
    // 同时 eventInstanceId 已占位，洗浴/事件/情绪选装都会跳过这个人。
    skinId: getCampLogicalSkinId(living, characterId) ?? '',
    restoreSkinId: prevCampSkinId,
    eventInstanceId: ANFU_TEMP_SKIN_INSTANCE,
  };
  lockAgenda(living, characterId);
  // 安抚皮由会话唯一持有：进场景前清掉任何排队中的换装（否则换装到点会扒掉安抚皮）
  if (living.pendingOutfitChanges) delete living.pendingOutfitChanges[characterId];
  if (living.outfitNarrativeHolds) delete living.outfitNarrativeHolds[characterId];

  if (!isAnfuRoom(prevRoomId) && CAMP_ROOM_MAP[prevRoomId ?? '']) {
    // 换动物服在原地，换好再走过去（走路有时间，不瞬移）
    snapAgentToRoom(characterId, prevRoomId!, {
      activity: 'play',
      behavior: `在${CAMP_ROOM_MAP[prevRoomId!]?.label ?? '房间'}换动物服装，准备去${ANFU_ROOM_LABEL}`,
    });
  }

  living.pendingAnfuInvite = undefined;
  clearPlayerAnfuAsk(living, characterId);

  const systemLine = `【系统】${name}答应去${ANFU_ROOM_LABEL}，正在自己房间换动物服装，换好再走过去（换装+路程约 20 秒）。`;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}与指挥官进入${ANFU_ROOM_LABEL}（来源：${entrySource}），正在自己房间换动物服装`,
    importance: 5,
  });
  pushRecentChat(
    living,
    characterId,
    'user',
    `【系统事实·已生效】${name}已经答应去${ANFU_ROOM_LABEL}，此刻在自己房间换动物服装（换装中动态），还没到安抚室。禁止说已经到安抚室/已经待机/棉花已飞；换好并走到之后系统会通知你。本轮可写换装过程（遮布/整理衣装）并撒娇让指挥官等一下。`,
  );

  return { ok: true, msg: '已进入安抚室', systemLine };
}

export type AnfuLeaveResult = { ok: boolean; msg: string; systemLine?: string };

/**
 * 结束安抚会话（幂等）。离开语义按 phase 分流：
 * - standby：中性结束（次数已耗，不扣好感）
 * - soothing：中途离开，扣好感 + 高重要记忆
 * - exhausted：结算奖励（只发一次）
 * - recover：读档/异常恢复，中性
 */
export function leaveAnfuSession(
  save: SaveData,
  living: AiLivingSave,
  opts?: { reason?: 'leave' | 'close' | 'recover' | 'switch'; force?: boolean },
): AnfuLeaveResult {
  const session = living.anfuSession;
  if (!session?.active) return { ok: false, msg: '未在安抚中' };
  if (session.settling && !opts?.force) return { ok: true, msg: '结算中' };
  session.settling = true;

  const characterId = session.characterId;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const reason = opts?.reason ?? 'leave';
  const phase = session.phase;

  clearEventTempSkinsForInstance(living, ANFU_TEMP_SKIN_INSTANCE, { dressBack: false });
  unlockAgenda(living, characterId);

  // 离开也要走路：从安抚室回营地有路程（不再瞬移）
  cancelTravel(living, characterId);
  const fallbackRoom = getAnfuExitRoom(session.prevRoomId);
  const exitPresence = resolvePresence(characterId, living);
  if (exitPresence.roomId === ANFU_ROOM_ID) {
    planTravel(living, characterId, fallbackRoom, ANFU_ROOM_ID, {
      activity: 'idle',
      behavior: '离开安抚室，回营地',
      reason: 'anfu_exit',
      arriveBehavior: '回到营地',
    });
  }
  // 对话场景快照同步：下一轮不再读安抚室的旧场景
  delete living.dialogueTurnScene?.[characterId];

  let systemLine = '';
  if (phase === 'exhausted' && !session.settled && reason !== 'recover') {
    session.settled = true;
    systemLine = `【系统】${name}心满意足，离开了${ANFU_ROOM_LABEL}。好好睡一觉可以恢复疲惫。`;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `${name}安抚值满，心满意足地结束${ANFU_ROOM_LABEL}棉花游戏`,
      importance: 6,
    });
  } else if (phase === 'soothing' && reason !== 'recover') {
    adjustAffinity(living, characterId, ANFU_LEAVE_PENALTY);
    systemLine = `【系统】安抚中途结束，${name}有些失落（好感 ${ANFU_LEAVE_PENALTY}）。`;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `${name}在安抚中途被留下/离开${ANFU_ROOM_LABEL}，棉花游戏没能满足，很失落`,
      importance: 7,
    });
  } else {
    systemLine = `【系统】已离开${ANFU_ROOM_LABEL}，${name}正在换回原来的衣服（换装中）。`;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `${name}离开${ANFU_ROOM_LABEL}（${
        phase === 'dressing' ? '换装中离开' : phase === 'travel' ? '赶路中离开' : phase === 'standby' ? '待机未开始' : '恢复'
      }）`,
      importance: 4,
    });
  }

  // 任何离开路径都必须落一条系统事实进聊天/营地日志，不能无声切走
  pushRecentChat(
    living,
    characterId,
    'user',
    `【系统事实·已生效】${systemLine.replace(/^【系统】/, '')}安抚室会话已结束，正在播换装过程（立绘先切换装中，4~5 秒后换回原衣）。`,
  );
  pushCampLog(living, {
    text: `${name}离开了${ANFU_ROOM_LABEL}`,
    source: 'system',
    characterIds: [characterId],
  });

  living.anfuSession = {
    ...session,
    active: false,
    settling: false,
    justEntered: false,
    justLeft: true,
    justLeftTurnsLeft: 2,
  };

  // 散场换装：先把会话置为非活跃（否则换装守卫会拦下），再排队 4.8s 换装过程。
  // 优先换回她进安抚室之前的临时外观；没有就换回营地日常服。
  // 读档/异常恢复不演换装，交给作息自然接管。
  if (reason !== 'recover') {
    const prevTemp = session.prevEventTemp;
    const prevTempUsable =
      prevTemp?.skinId && prevTemp.eventInstanceId !== ANFU_TEMP_SKIN_INSTANCE
        ? prevTemp
        : null;
    const targetSkinId =
      prevTempUsable && getCharacterSkin(characterId, prevTempUsable.skinId)
        ? prevTempUsable.skinId
        : getCampWornSkinId(living, characterId);
    const q = forceScheduleOutfitChange(living, characterId, targetSkinId, 4_800);
    if (q.queued && prevTempUsable && targetSkinId === prevTempUsable.skinId) {
      const pending = living.pendingOutfitChanges?.[characterId];
      if (pending) pending.applyAsTempInstanceId = prevTempUsable.eventInstanceId;
    }
  }

  return { ok: true, msg: '已离开安抚室', systemLine };
}

export function recoverStaleAnfuSession(save: SaveData, living: AiLivingSave): boolean {
  const s = getAnfuSession(living);
  if (!s) return false;
  leaveAnfuSession(save, living, { reason: 'recover', force: true });
  return true;
}

/** 角色已离开安抚室 → 强制结束（中途离开按 phase 语义） */
export function clearAnfuIfLeftRoom(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): void {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) return;
  const presence = resolvePresence(characterId, living);
  if (isAnfuRoom(presence.roomId)) return;
  leaveAnfuSession(save, living, { reason: 'leave', force: true });
}

// ——— 棉花攻击 ———

export type AnfuAttackRequest = {
  ok: boolean;
  msg: string;
  /** 本次切到的片段路径（UI 先切画面，数值等模型回） */
  clipSrc?: string;
  clipIndex?: number;
};

/**
 * 玩家点击「棉花攻击」：
 * - dressing：拒绝（还没换好衣服）
 * - exhausted：拒绝（按钮应已失效，双保险）
 * - standby 首击：进入 soothing，切片段 0
 * - soothing：clipIndex+1 切片，置 awaitingAttackReply 等模型回 anfu_gain
 * 冷却 10s + reply 锁双保险。
 */
export function requestAnfuAttack(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): AnfuAttackRequest {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) {
    return { ok: false, msg: '不在安抚中' };
  }
  if (s.phase === 'dressing') {
    return { ok: false, msg: '还在换动物服装，等换好再发射' };
  }
  if (s.phase === 'travel') {
    return { ok: false, msg: '她还在去安抚室的路上，等到了再发射' };
  }
  if (s.phase === 'exhausted') {
    return { ok: false, msg: '已经心满意足了，棉花停了' };
  }
  const now = Date.now();
  if (s.awaitingAttackReply) {
    return { ok: false, msg: '棉花还在飞，等TA缓一缓' };
  }
  if (now - s.lastAttackAtMs < ANFU_ATTACK_COOLDOWN_MS) {
    const left = Math.ceil((ANFU_ATTACK_COOLDOWN_MS - (now - s.lastAttackAtMs)) / 1000);
    return { ok: false, msg: `棉花装填中，还需 ${left} 秒` };
  }
  const clips = getAnfuClipList(characterId);
  if (!clips.length) return { ok: false, msg: '该角色暂无安抚过程资源' };

  s.lastAttackAtMs = now;
  s.awaitingAttackReply = true;

  if (s.phase === 'standby') {
    s.phase = 'soothing';
    s.clipIndex = 0;
    s.lastDripAtMs = now;
  } else {
    s.clipIndex = Math.min(s.clipIndex + 1, clips.length - 1);
  }

  applyAnfuSkin(save, living, characterId, ANFU_ACTIVE_SKIN_ID);
  const a = getAgenda(living, characterId);
  if (a?.goal === 'anfu') a.behavior = anfuBehavior('soothing');

  const clipSrc = clips[s.clipIndex];
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${CHARACTER_MAP[characterId]?.name ?? characterId}被第${s.clipIndex + 1}团棉花命中（安抚片段 ${s.clipIndex}），等本轮反应判定`,
    importance: 4,
  });
  return { ok: true, msg: '棉花发射！', clipSrc, clipIndex: s.clipIndex };
}

/** 服务端钳制：攻击加值 10~40 */
export function clampAnfuGain(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(ANFU_GAIN_MIN, Math.min(ANFU_GAIN_MAX, Math.floor(n)));
}

function clampAnfuBonus(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(ANFU_SETTLE_BONUS_MAX, Math.floor(n));
}

function addAnfuValue(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  delta: number,
): { value: number; reachedMax: boolean } {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) return { value: 0, reachedMax: false };
  s.value = Math.min(ANFU_VALUE_MAX, Math.max(0, s.value + delta));
  if (s.value >= ANFU_VALUE_MAX && s.phase === 'soothing') {
    settleAnfuExhausted(save, living, characterId);
    return { value: s.value, reachedMax: true };
  }
  return { value: s.value, reachedMax: false };
}

/**
 * 本轮模型返回 anfu_gain 后落盘（攻击结算）。
 * 缺失/超时由调用方传 fallback；此处只做钳制 + 系统行通知。
 */
export function resolveAnfuAttackGain(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  opts: { gain?: unknown; hitZone?: string; mood?: string; fallback?: boolean },
): { value: number; reachedMax: boolean } {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) return { value: 0, reachedMax: false };
  s.awaitingAttackReply = false;

  let gain = clampAnfuGain(opts.gain);
  if (gain == null) {
    gain =
      ANFU_GAIN_FALLBACK_MIN +
      Math.floor(Math.random() * (ANFU_GAIN_FALLBACK_MAX - ANFU_GAIN_FALLBACK_MIN + 1));
  }
  const zone = opts.hitZone || ANFU_HIT_ZONES[s.clipIndex % ANFU_HIT_ZONES.length];
  const { value, reachedMax } = addAnfuValue(save, living, characterId, gain);
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  pushRecentChat(
    living,
    characterId,
    'user',
    `【系统事实·已生效】第${s.clipIndex + 1}团棉花落在「${zone}」（亲近区），当前姿势：${getAnfuPoseNote(s.clipIndex)}；安抚值 ${value}/${ANFU_VALUE_MAX}（本次 +${gain}）。${reachedMax ? `${name}已心满意足，安抚值满，棉花停了。` : ''}${
      opts.fallback ? '（本轮模型未给判定，用中位估计）' : ''
    }`,
  );
  return { value, reachedMax };
}

/**
 * 换装完成：dressing → standby，挂待机皮。
 * 由 tickAnfuSession 驱动；UI accept 路径也可主动推进一次（黑屏中间已过 1.1s）。
 */
export function finishAnfuDressing(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): boolean {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId || s.phase !== 'dressing') return false;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  applyAnfuSkin(save, living, characterId, ANFU_STANDBY_SKIN_ID);
  const curRoom = resolvePresence(characterId, living).roomId;
  if (!isAnfuRoom(curRoom) && CAMP_ROOM_MAP[curRoom]) {
    // 换好动物服再走过去：路程计入，不瞬移
    s.phase = 'travel';
    planTravel(living, characterId, ANFU_ROOM_ID, curRoom, {
      activity: 'play',
      behavior: `穿着动物服，去${ANFU_ROOM_LABEL}`,
      reason: 'anfu_entry',
      arriveBehavior: `在${ANFU_ROOM_LABEL}待机，等第一团棉花`,
    });
    const a = getAgenda(living, characterId);
    if (a?.goal === 'anfu') a.behavior = `换好动物服，正在去${ANFU_ROOM_LABEL}`;
    pushRecentChat(
      living,
      characterId,
      'user',
      `【系统事实·已生效】${name}已换好动物服装，正在去${ANFU_ROOM_LABEL}的路上（玩家眼前仍是出发房间场景）。禁止说已经待机/已经开始安抚；到了系统会通知。`,
    );
    return true;
  }
  s.phase = 'standby';
  const a = getAgenda(living, characterId);
  if (a?.goal === 'anfu') a.behavior = anfuBehavior('standby');
  pushRecentChat(
    living,
    characterId,
    'user',
    `【系统事实·已生效】${name}已换好动物服装（安抚待机动态），在${ANFU_ROOM_LABEL}等第一团棉花。还没进入安抚状态；此刻可撒娇催促指挥官发射。`,
  );
  return true;
}

/** 到达安抚室（行程结算回调）：travel → standby */
export function finishAnfuTravel(
  living: AiLivingSave,
  characterId: string,
): string | null {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId || s.phase !== 'travel') return null;
  s.phase = 'standby';
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const a = getAgenda(living, characterId);
  if (a?.goal === 'anfu') a.behavior = anfuBehavior('standby');
  pushRecentChat(
    living,
    characterId,
    'user',
    `【系统事实·已生效】${name}已到${ANFU_ROOM_LABEL}，换上动物服待机，等第一团棉花。`,
  );
  return `【系统】${name}已到${ANFU_ROOM_LABEL}，换好动物服待机。`;
}

/**
 * 被动涨幅：soothing 中每 5~10 秒 +1~3（由 tickAnfuSession 驱动）。
 * 只涨数值不切画面；同样可触发满值结算。
 * dressing 相：到点自动切 standby（换装完成）。
 */
export function tickAnfuSession(save: SaveData, living: AiLivingSave, now = Date.now()): void {
  const s = getAnfuSession(living);
  if (!s) return;
  if (s.phase === 'dressing') {
    if (now >= s.dressReadyAtMs) {
      finishAnfuDressing(save, living, s.characterId);
    }
    return;
  }
  if (s.phase !== 'soothing') return;
  if (now - s.lastDripAtMs < ANFU_DRIP_INTERVAL_MS) return;
  s.lastDripAtMs = now;
  const drip = ANFU_DRIP_MIN + Math.floor(Math.random() * (ANFU_DRIP_MAX - ANFU_DRIP_MIN + 1));
  const { value, reachedMax } = addAnfuValue(save, living, s.characterId, drip);
  if (reachedMax) return;
  const name = CHARACTER_MAP[s.characterId]?.name ?? s.characterId;
  pushRecentChat(
    living,
    s.characterId,
    'user',
    `【系统事实·已生效】棉花持续落在${name}身上（亲近区），安抚值缓慢上涨至 ${value}/${ANFU_VALUE_MAX}（本次 +${drip}）。当前姿势：${getAnfuPoseNote(s.clipIndex)}。`,
  );
}

/**
 * 满值结算：切疲惫皮、挂 fatigue、发好感（基础 + bonus 上限合计 8）。
 * settling 锁保证只跑一次；攻击/被动两条路径共用。
 */
export function settleAnfuExhausted(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  bonusRaw?: unknown,
): void {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) return;
  if (s.settling) return;
  s.settling = true;
  try {
    s.phase = 'exhausted';
    s.value = ANFU_VALUE_MAX;
    s.awaitingAttackReply = false;
    applyAnfuSkin(save, living, characterId, ANFU_DONE_SKIN_ID);
    const a = getAgenda(living, characterId);
    if (a?.goal === 'anfu') a.behavior = anfuBehavior('exhausted');

    const cur = new Set<LightStatusTag>(living.characterStatus?.[characterId] ?? []);
    cur.add('fatigue');
    if (!living.characterStatus) living.characterStatus = {};
    living.characterStatus[characterId] = [...cur].slice(0, 4);

    const bonus = clampAnfuBonus(bonusRaw);
    adjustAffinity(living, characterId, ANFU_SETTLE_BASE + bonus);
    const name = CHARACTER_MAP[characterId]?.name ?? characterId;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: `${name}安抚值满（100），心满意足地放松下来，好感 +${ANFU_SETTLE_BASE + bonus}，感到疲惫（需睡觉恢复）`,
      importance: 7,
    });
    pushRecentChat(
      living,
      characterId,
      'user',
      `【系统事实·已生效】${name}安抚值达到 100，已心满意足：棉花全部停下，攻击键失效，安抚值冻结；立绘切到「安抚疲惫」动态。此刻只能慵懒聊天，或由指挥官点「离开安抚室」结束，禁止再喊被棉花碰。`,
    );
  } finally {
    s.settling = false;
  }
}

// ——— 对白检测（文本/语音等效） ———

/** 指挥官要求去安抚室 */
export const PLAYER_ASKS_ANFU =
  /(安抚室|安抚一下|去安抚|玩棉花|棉花游戏|发射棉花|来一发棉花|安抚安抚)/;
/** 角色主动邀请去安抚室 */
export const AI_PROPOSES_ANFU =
  /(想.*安抚|去安抚室|玩棉花|棉花游戏|发射棉花|安抚安抚|陪我.*安抚)/;
export const AI_REFUSES_ANFU = /不(?:行|要|去)|拒绝|改天|下次|现在不行|先别|没空|累了|不想/;
export const AI_AGREES_ANFU = /好的?|好啊|行啊?|可以|没问题|走吧|来吧|一起(?:吧|啊)?|那就|陪你|嗯+|同意|当然|乐意|答应/;
/**
 * 有条件答应/还没准备好：这类话不能当"同意"直接拉进安抚室。
 * 例：「行，不过我得先把这边的风向确认一下」——有「行」但语义是先处理手头的事。
 */
export const AI_HEDGES_ANFU =
  /先.*(确认|处理|忙|准备|收拾|看看|过去|把手头|整理|交代|收尾)|等一下|稍等|等我把|等我先|过一会儿|待会儿|等会儿|回头|再说|风向|还没(?:好|准备)/;

export function detectPlayerAnfu(text: string): boolean {
  return PLAYER_ASKS_ANFU.test(text || '');
}

export function detectAiAnfuPropose(text: string): boolean {
  return AI_PROPOSES_ANFU.test(text || '');
}

export function detectAiRefusesAnfu(text: string): boolean {
  const t = text || '';
  if (!t.trim()) return false;
  return AI_REFUSES_ANFU.test(t) && !/但是|不过|虽然/.test(t.slice(0, 12));
}

/** anfu_action 字段：propose|start|end */
export function parseAnfuActionField(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === '""' || v === 'none' || v === 'null') return undefined;
  if (v === 'end' || v === 'stop' || v === 'propose' || v === 'start') {
    return v === 'stop' ? 'end' : v;
  }
  if (v === '结束' || v === '停下') return 'end';
  if (v.includes('propose')) return 'propose';
  if (v.includes('start')) return 'start';
  return undefined;
}

/** anfu_gain 字段：10~40（服务端再钳制） */
export function parseAnfuGainField(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

/** anfu_bonus 字段：0~3 */
export function parseAnfuBonusField(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.floor(n);
}

// ——— 指挥官提出，等角色本轮回应 ———

export function setPlayerAnfuAsk(
  living: AiLivingSave,
  characterId: string,
): AnfuPlayerAskPending | null {
  if (!canAnfuAtAll(living, characterId)) return null;
  if (getAnfuSession(living)) return null;
  const pending: AnfuPlayerAskPending = { characterId, proposedAt: Date.now() };
  living.pendingPlayerAnfuAsk = pending;
  if (living.pendingAnfuInvite?.characterId === characterId) {
    living.pendingAnfuInvite = undefined;
  }
  return pending;
}

export function clearPlayerAnfuAsk(living: AiLivingSave, characterId?: string): void {
  const p = living.pendingPlayerAnfuAsk;
  if (!p) return;
  if (characterId && p.characterId !== characterId) return;
  living.pendingPlayerAnfuAsk = undefined;
}

export function getPlayerAnfuAsk(
  living: AiLivingSave,
  characterId?: string,
): AnfuPlayerAskPending | null {
  const p = living.pendingPlayerAnfuAsk;
  if (!p) return null;
  if (characterId && p.characterId !== characterId) return null;
  return p;
}

/**
 * 角色愿意去安抚室 → 只登记「待指挥官确认」的邀请条，不直接进场景。
 * 必须是玩家点「去安抚室」才 enterAnfuSession —— 否则模型一句含糊的
 * 「行，不过我先确认下风向」就会把角色强行拉走（截图 BUG）。
 */
export function offerAnfuInviteFromTurn(
  living: AiLivingSave,
  characterId: string,
): AnfuInvitePending | null {
  if (isAnfuActiveFor(living, characterId)) return null;
  if (!canAnfuAtAll(living, characterId)) return null;
  if (living.pendingAnfuInvite?.characterId === characterId) {
    return living.pendingAnfuInvite;
  }
  if (living.pendingPlayerAnfuAsk?.characterId) return null;
  if (living.pendingDanceInvite?.characterId) return null;
  if (living.pendingBathAssistInvite?.characterId) return null;
  if (living.pendingDisciplineInvite?.characterId) return null;
  if (living.pendingMiniGameInvite?.characterId) return null;
  if (living.pendingPlayerMiniGameAsk?.characterId) return null;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const pending: AnfuInvitePending = {
    characterId,
    proposedAt: Date.now(),
    dayIndex: living.dayIndex,
    preview: `${name}愿意去${ANFU_ROOM_LABEL}，现在过去吗？`,
  };
  living.pendingAnfuInvite = pending;
  return pending;
}

/** 角色本轮回应指挥官邀请 */
export function resolvePlayerAnfuAskFromTurn(
  _save: SaveData,
  living: AiLivingSave,
  characterId: string,
  opts: { anfuAction?: string; dialogue: string; action?: string },
): AnfuEnterResult | null {
  const pending = getPlayerAnfuAsk(living, characterId);
  if (!pending) return null;

  const speech = `${opts.dialogue} ${opts.action ?? ''}`;
  const action = opts.anfuAction;
  const startMatch = action === 'start';
  const refused = action === 'end' || detectAiRefusesAnfu(speech);
  const hedged = AI_HEDGES_ANFU.test(speech);
  const topical = /安抚|棉花|安抚室/.test(speech) || detectAiAnfuPropose(speech);
  // 语音/打字触发修复（与小游戏同病）：邀请挂起时她只需口头答应即可，不强制复述"安抚/棉花"
  // 关键词——LLM 常只说"好呀，走吧"，此前会被静默丢弃（口头答应、事件未挂起）。
  // fresh 窗口（5 分钟内）+ 简短明确同意词 → 免 topical；过窗后仍需 topical 防误触。
  const askFresh = Date.now() - pending.proposedAt < 5 * 60_000;
  const softAgree =
    askFresh &&
    !refused &&
    !hedged &&
    speech.trim().length > 0 &&
    speech.trim().length <= 24 &&
    /好的?|好啊?|行啊?|可以|走吧|去吧|来吧|来嘛|嗯+|想|愿意|带我去/.test(speech);
  const agreed =
    !refused && !hedged && (startMatch || softAgree || (topical && AI_AGREES_ANFU.test(speech)));

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;

  if (refused && !startMatch) {
    clearPlayerAnfuAsk(living, characterId);
    return {
      ok: false,
      msg: `${name}婉拒了去安抚室。`,
      systemLine: `【系统】${name}婉拒了去安抚室。`,
    };
  }
  if (!agreed) {
    // 有条件答应（先确认风向/先忙完）：不自动进场景，给一句明确系统提示。
    if (hedged) {
      clearPlayerAnfuAsk(living, characterId);
      return {
        ok: true,
        msg: `${name}还没答应，要先处理手头的事。`,
        systemLine: `【系统】${name}还没答应去安抚室——她要先把手头的事处理完，等她主动邀请或稍后再问。`,
      };
    }
    return null;
  }

  clearPlayerAnfuAsk(living, characterId);
  const offered = offerAnfuInviteFromTurn(living, characterId);
  if (!offered) {
    return {
      ok: false,
      msg: '现在无法去安抚室',
      systemLine: hasPlayedAnfuToday(living, characterId)
        ? `【系统】${name}今天已经去过${ANFU_ROOM_LABEL}了，明天再来。`
        : `【系统】现在无法去${ANFU_ROOM_LABEL}。`,
    };
  }
  return {
    ok: true,
    msg: `${name}愿意去安抚室，等待指挥官确认。`,
    systemLine: `【系统】${name}愿意去${ANFU_ROOM_LABEL}。点「去安抚室」确认后才会过去。`,
  };
}

export function playerAffirmsAnfuInvite(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/不(?:行|要|去)|拒绝|算了|下次/.test(t)) return false;
  return (
    /^(好|好的|行|嗯+|走|去|可以|来吧|一起|安抚|走吧)([。.!！~～…]*)$/i.test(t) ||
    /去安抚|安抚吧|那就去|来吧|好啊/.test(t)
  );
}

export function playerRejectsAnfuInvite(text: string): boolean {
  const t = (text || '').trim();
  return /不(?:行|要|去)|拒绝|算了|下次再说|先不|不去/.test(t);
}

// ——— 角色主动邀请 ———

export function maybeProposeAnfuInvite(
  living: AiLivingSave,
  characterId: string,
  dialogue: string,
): AnfuInvitePending | null {
  if (isAnfuActiveFor(living, characterId)) return null;
  if (!canAnfuAtAll(living, characterId)) return null;
  if (living.pendingAnfuInvite?.characterId === characterId) return null;
  if (living.pendingPlayerAnfuAsk?.characterId) return null;
  if (living.pendingDanceInvite?.characterId) return null;
  if (living.pendingBathAssistInvite?.characterId) return null;
  if (living.pendingDisciplineInvite?.characterId) return null;
  if (living.pendingMiniGameInvite?.characterId) return null;
  if (living.pendingPlayerMiniGameAsk?.characterId) return null;

  const cool = living.anfuInviteCooldownDay?.[characterId];
  if (cool != null && cool === living.dayIndex) return null;
  if (!detectAiAnfuPropose(dialogue)) return null;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const pending: AnfuInvitePending = {
    characterId,
    proposedAt: Date.now(),
    dayIndex: living.dayIndex,
    preview: `${name}想邀你去安抚室玩棉花游戏，去吗？`,
  };
  living.pendingAnfuInvite = pending;
  return pending;
}

export function acceptAnfuInvite(save: SaveData, living: AiLivingSave): AnfuEnterResult {
  const pending = living.pendingAnfuInvite;
  if (!pending) return { ok: false, msg: '没有待确认的安抚邀请' };
  const characterId = pending.characterId;
  living.pendingAnfuInvite = undefined;
  if (!living.anfuInviteCooldownDay) living.anfuInviteCooldownDay = {};
  living.anfuInviteCooldownDay[characterId] = living.dayIndex;
  return enterAnfuSession(save, living, characterId, 'character_invite');
}

export function rejectAnfuInvite(living: AiLivingSave): void {
  const pending = living.pendingAnfuInvite;
  if (!pending) return;
  living.pendingAnfuInvite = undefined;
  if (!living.anfuInviteCooldownDay) living.anfuInviteCooldownDay = {};
  living.anfuInviteCooldownDay[pending.characterId] = living.dayIndex;
}

export function consumeAnfuJustEntered(living: AiLivingSave, characterId: string): boolean {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId || !s.justEntered) return false;
  s.justEntered = false;
  return true;
}

// ——— Prompt 块（市场模式措辞：只用 T3 安全词与正向异样情绪） ———

/**
 * 被棉花缠绕的「异样快意」分层（T3 安全措辞）。
 * 措辞约束：直述身体愉悦的那个 T2 词会让 qwen 自我审查/降智，
 * Prompt 层一律写成「异样快意 / 酥麻舒坦」等中性画面词，概念不变。
 * 快意只存在于 soothing 相，且强度随安抚值水涨船高；
 * 安抚状态结束（离开/满值转疲惫）后自然退去，不残留。
 */
export function anfuSensationNote(value: number): string {
  const v = Math.max(0, Math.min(ANFU_VALUE_MAX, value));
  if (v >= 75) {
    return '酥麻暖流几乎铺满全身，脑子被暖意泡得发懵，脚尖发软，只剩含糊的哼声和自己的心跳';
  }
  if (v >= 50) {
    return '异样的舒坦顺着被缠裹的地方一圈圈化开，越裹越不想挣开，哼声开始变调';
  }
  if (v >= 25) {
    return '酥麻暖意渐渐变浓，被绒毛裹住的地方开始发软发热，身体慢慢记住这种触感';
  }
  return '棉花刚缠上身，只有一点陌生的暖意和微微的酥，说不上难受也说不上舒服';
}

export function buildAnfuActivePromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const s = getAnfuSession(living);
  if (!s || s.characterId !== characterId) return '';
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const zone = anfuCurrentHitZone(s.clipIndex);
  const pose = getAnfuPoseNote(s.clipIndex);

  if (s.phase === 'dressing') {
    return `【世界同步·安抚换装中·最高优先】
你正在自己房间/当前位置换动物服装（玩家眼前是换装中动态循环）。
- 还没到安抚室：禁止说已经到了安抚室、已经待机、棉花已飞或已经满足。
- 本轮只写换装过程（遮布/整理衣装），可撒娇让指挥官等一下；换好还要走过去，到了系统会通知你。`.trim();
  }
  if (s.phase === 'standby') {
    return `【世界同步·安抚待机·最高优先】
你已换上动物服装待在安抚室软垫旁（安抚待机动态），等指挥官发射第一团棉花。
- 还没进入安抚状态：安抚值 0/100；禁止说已经被棉花碰、已经满足或已经结束。
- 本轮可撒娇催促指挥官开始，指挥官点「发射棉花」即可。
${s.justEntered ? '- 本轮刚换好装：先回应换装完成、乖乖待机的现场感。' : ''}`.trim();
  }
  if (s.phase === 'exhausted') {
    return `【世界同步·安抚满足·最高优先】
${name}安抚值已满（100/100），心满意足地放松下来休息（安抚疲惫动态）。
- 被棉花缠裹的异样快意已随安抚结束完全退去，只剩满足后的松弛与困意；禁止继续描写还在酥麻、还在被缠绕。
- 棉花已经全部停下，攻击键失效，安抚值冻结；禁止再喊被棉花碰、禁止再涨安抚值。
- 可慵懒聊天；你可以继续陪指挥官聊，也可以主动说想回去休息——对白明确说「我先回去/我先走了」，系统会写系统通知并结束安抚。不要没表态就突然消失。`.trim();
  }
  if (s.phase === 'travel') {
    return `【世界同步·安抚赶路中·最高优先】
你已经换好动物服装，正在去安抚室的路上（玩家眼前是你当前所在处：出发房间/楼梯，随脚步实时切换）。
- 禁止说已经到安抚室、已经待机、棉花已飞或已经满足。
- 本轮可写走路/推门/紧张期待的过程；到了系统会通知你。`.trim();
  }
  const moodHint = ANFU_POSITIVE_MOODS[s.clipIndex % ANFU_POSITIVE_MOODS.length];
  return `【世界同步·安抚中·最高优先】
你正在安抚室和指挥官玩棉花游戏（安抚中动态第 ${s.clipIndex + 1} 段）。
- 当前安抚值：${s.value}/100（满 100 即满足，棉花停下切休息态）。
- 身体被棉花缠绕的异样快意（随安抚值 ${s.value}/100 水涨船高，写作强度以此为准）：${anfuSensationNote(s.value)}。这份快意只属于安抚进行时，一旦结束便自然退去，平时与事后都不要提起。
- 刚命中的亲近区：「${zone}」；当前姿势：${pose}。
- 对白必须对齐上述部位与姿势：舒服、害羞，并写出来——心跳加速、脸颊发热、耳根发烫、呼吸变调、声音发软、哼声漏出来、咬住下唇、身体发软、酥麻暖流窜过；异样情绪取正向（${ANFU_POSITIVE_MOODS.join('、')}），本轮偏向「${moodHint}」。
- 安抚值判定（本轮必须填 anfu_gain）：10~40，越接近满越易满足取高段；前两次宜取 10~20。
- 全程是开心的娱乐：不许出现气愤/厌恶/害怕；紧张只允许在第一团棉花时露脸。
- 禁止说棉花停了、禁止说已经满足（除非安抚值已满），禁止假装在别的房间。`.trim();
}

export function buildPlayerAnfuAskPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const p = getPlayerAnfuAsk(living, characterId);
  if (!p) return '';
  return `【世界同步·待你回应安抚邀请】
指挥官提出「去安抚室玩棉花游戏」（按钮/打字/语音等效）。
- 若愿意：对白明确答应（可害羞可期待），并填 anfu_action=start；系统只会先弹「去安抚室」确认条，指挥官点确认后才切立绘、带你过去。
- 若拒绝：对白说明原因，anfu_action 填 ""；不要描写已经换装或已经在安抚室。
- 若还没准备好（要先处理手头的事/确认环境）：明确说出来，anfu_action 填 "" 或 propose，不能算答应。
- 未表态前禁止假装立绘已切换；本事件期间禁止 skin_change 换装。`.trim();
}

export function buildAnfuJustLeftPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const s = living.anfuSession;
  if (!s || s.characterId !== characterId || !s.justLeft) return '';
  const left = s.justLeftTurnsLeft ?? 0;
  if (left <= 0) {
    s.justLeft = false;
    return '';
  }
  s.justLeftTurnsLeft = left - 1;
  if (s.justLeftTurnsLeft <= 0) s.justLeft = false;
  return '【世界同步·安抚刚结束】安抚室已离开，立绘已回日常外观；被棉花缠裹的异样快意也已一并消散。禁止继续写棉花、安抚现场或残留的酥麻。';
}

export const ANFU_PROTOCOL = `【安抚室 · anfu_action】
- 地点：负一层安抚室（原库房改造，软垫/棉花/暖光）。指挥官点「安抚」按钮、打字或语音提出，效果相同；你也可主动邀请。
- 四相：安抚换装中（先换动物服装）→ 安抚待机（换好了，还没进入状态）→ 安抚中（棉花不断落下）→ 安抚疲惫（值满后的满足休息）。
- 换装中：只写换装过程，禁止说已经换好/已经待机。
- 指挥官提出：先在对白里答应或拒绝；愿意填 anfu_action=start，拒绝填 "" 并说明。注意：anfu_action=start 只代表你愿意，系统不会直接拉你走，而是先弹「去安抚室」确认条，指挥官点确认后才进场景。
- 你也可主动邀请：填 anfu_action=propose 并说清楚；系统弹确认条，指挥官同意后才进场景。
- 安抚期间禁止 skin_change / world_intent 换装或移动（动物的安抚服装由系统唯一持有）。
- 安抚中每轮必须填 anfu_gain（10~40，越接近满越易满足；前两次宜 10~20）；服务端的钳制为准，填 99 也只按 40 计。
- 命中亲近区与当前姿势由系统行同步给你，对白必须对齐；异样情绪只取正向（兴奋/害羞/期待/心动/开心/迷糊/失神）。
- 是否离开安抚室：玩家可点「结束安抚 / 离开安抚室」；安抚值满后的尾声里你也可以主动离开——对白明确说想走并填 anfu_action=end，系统会写系统通知并结算。安抚中途离开会让TA失落（扣好感），不要没表态就消失。
- 每角色每天限玩一次；非安抚事件时 anfu_action/anfu_gain 填 ""。`.trim();
