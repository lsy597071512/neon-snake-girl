/**
 * 角色睡眠系统（恢复电力）
 *
 * 流程：准备入睡（换星夜睡衣站立）→ 完全入睡（播 pifu02_sleep）→ 约现实 6 小时后醒来
 * 昼夜均可发生，夜间几率更大；被聊/被扰 → disturbed；可做梦惊醒或环境取消。
 * 脱离睡眠系统时，营地皮肤必须同步为星夜睡衣（站立 idle），不得裸回装甲。
 */
import { getCharacterSleepRoom } from '../data/campLayout';
import { SLEEPWEAR_SKIN_ID, getCharacterSkin } from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import { setCyberHealth, getCyberHealth, CYBER_HEALTH_MAX } from '../systems/CyberHealthSystem';
import { setAgenda, clearAgenda, getAgenda } from './characterAgenda';
import { snapAgentToRoom } from './campAgents';
import { pushCampLog, pushMemory } from './memory';
import { forceScheduleOutfitChange, schedulePresenceOutfitChange, cancelPendingOutfitChange, shouldHoldAutoOutfit } from './outfitChangeProcess';
import { resolveCharacterRoomId } from './livingState';
import { getHour } from './worldClock';
import { isDisciplineActiveFor } from './disciplineSession';
import { adjustAffinity } from './relationship';
import type { AiLivingSave, CharacterAgenda, LightStatusTag, LivingPresence } from './types';

/** 一次完整睡眠 ≈ 现实 6 小时 */
export const SLEEP_REAL_DURATION_MS = 6 * 60 * 60 * 1000;
/** 换睡衣到真正睡着的准备窗口（现实） */
export const SLEEP_PREPARE_REAL_MS = 6 * 60 * 1000;
/** 两次「是否该睡」评估最短间隔（现实） */
const SLEEP_EVAL_GAP_MS = 12 * 60 * 1000;
/** 睡眠中自发惊醒的低概率评估间隔 */
const DREAM_WAKE_EVAL_GAP_MS = 25 * 60 * 1000;

export type SleepPhase = 'awake' | 'preparing' | 'asleep' | 'disturbed';

export type CharacterSleepState = {
  phase: SleepPhase;
  /** 上次完成一整觉的游戏日 */
  lastCompletedDayIndex?: number;
  prepareStartedAtMs?: number;
  asleepStartedAtMs?: number;
  sleepUntilMs?: number;
  disturbedAtMs?: number;
  disturbCount?: number;
  lastWakeReason?: string;
  lastWakeAtMs?: number;
  lastEvalAtMs?: number;
  lastDreamEvalAtMs?: number;
};

function ensureMap(living: AiLivingSave): Record<string, CharacterSleepState> {
  if (!living.characterSleep || typeof living.characterSleep !== 'object') {
    living.characterSleep = {};
  }
  return living.characterSleep;
}

export function ensureSleepFields(living: AiLivingSave): void {
  ensureMap(living);
}

export function getSleepState(
  living: AiLivingSave,
  characterId: string,
): CharacterSleepState {
  const map = ensureMap(living);
  if (!map[characterId]) map[characterId] = { phase: 'awake' };
  return map[characterId];
}

export function isInSleepSystem(living: AiLivingSave, characterId: string): boolean {
  const p = getSleepState(living, characterId).phase;
  return p === 'preparing' || p === 'asleep' || p === 'disturbed';
}

export function isDeepSleeping(living: AiLivingSave, characterId: string): boolean {
  const p = getSleepState(living, characterId).phase;
  return p === 'asleep' || p === 'disturbed';
}

/** 睡眠系统进行中：禁止角色主动发消息 / 对话内自动续说 */
export function proactiveContactBlockReason(
  living: AiLivingSave,
  characterId: string,
): string | null {
  if (!isInSleepSystem(living, characterId)) return null;
  const ph = getSleepState(living, characterId).phase;
  if (ph === 'asleep') return '正在睡觉，不该主动发消息';
  if (ph === 'preparing') return '准备入睡，不该主动发消息';
  if (ph === 'disturbed') return '睡眠中，不宜主动续聊';
  return '睡眠中，不宜主动发消息';
}

function cancelPendingOutreachMessages(living: AiLivingSave, characterId: string): void {
  const list = living.pendingAiMessages;
  if (!list?.length) return;
  for (const msg of list) {
    if (msg.characterId === characterId && msg.status === 'pending') {
      msg.status = 'cancelled';
    }
  }
}

function hasSleepwear(characterId: string): boolean {
  return Boolean(getCharacterSkin(characterId, SLEEPWEAR_SKIN_ID));
}

/** 对话打开/睡眠相位：账本与立绘必须对齐睡衣（走换装过程，不硬切） */
export function syncSleepCampSkin(living: AiLivingSave, characterId: string): void {
  if (!isInSleepSystem(living, characterId)) return;
  if (!hasSleepwear(characterId)) return;
  // 独占事件（舞蹈/安抚/浴室）进行中：睡衣会抢掉事件皮，必须让位
  if (
    living.danceSession?.active === true ||
    living.anfuSession?.active === true ||
    living.bathAssistSession?.active === true
  ) {
    return;
  }
  // 玩家已排队的换装优先（例如刚答应换装），睡眠心跳不得覆盖
  if (shouldHoldAutoOutfit(living, characterId)) return;
  forceScheduleOutfitChange(living, characterId, SLEEPWEAR_SKIN_ID, 4_000);
}

function forcePajamas(living: AiLivingSave, characterId: string): void {
  if (!hasSleepwear(characterId)) return;
  // 对话换装排队中 / 展示锁 / 叙事锁：睡眠心跳不得抢回睡衣，更不得清空队列
  // （否则「准备入睡」时玩家让换性感装会口头答应、立绘永远停在睡衣）
  if (shouldHoldAutoOutfit(living, characterId)) return;
  schedulePresenceOutfitChange(living, characterId, SLEEPWEAR_SKIN_ID);
}

function clearFatigue(living: AiLivingSave, characterId: string): void {
  const cur = living.characterStatus[characterId] ?? [];
  living.characterStatus[characterId] = cur.filter((t) => t !== 'fatigue') as LightStatusTag[];
}

function addStatus(living: AiLivingSave, characterId: string, tag: LightStatusTag): void {
  const cur = new Set(living.characterStatus[characterId] ?? []);
  cur.add(tag);
  living.characterStatus[characterId] = [...cur].slice(0, 4) as LightStatusTag[];
}

function hash01(characterId: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < characterId.length; i++) h = (h * 31 + characterId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function sleptToday(living: AiLivingSave, st: CharacterSleepState): boolean {
  return st.lastCompletedDayIndex === living.dayIndex;
}

/** 夜间（21–5）高概率；白天低概率，疲劳/低电力会抬高 */
function sleepStartChance(living: AiLivingSave, characterId: string): number {
  const hour = getHour(living);
  const night = hour >= 21 || hour < 5;
  const st = getSleepState(living, characterId);
  if (sleptToday(living, st)) return 0;
  const cyber = getCyberHealth(living, characterId);
  const fatigued = (living.characterStatus[characterId] ?? []).includes('fatigue');
  let p = night ? 0.42 : 0.06;
  if (fatigued) p += night ? 0.12 : 0.1;
  if (cyber < 70) p += night ? 0.1 : 0.08;
  if (cyber < 40) p += 0.08;
  return Math.min(0.85, p);
}

function writeSleepAgenda(
  living: AiLivingSave,
  characterId: string,
  activity: 'rest' | 'sleeping',
  behavior: string,
  reason: string,
): void {
  const sleep = getCharacterSleepRoom(characterId);
  const agenda: CharacterAgenda = {
    goal: activity === 'sleeping' ? 'sleep' : 'prepare_sleep',
    targetRoomId: sleep.id,
    activity,
    behavior,
    remainGameMin: 9999,
    startedGameMin: living.gameMinutes,
    reason,
    source: 'schedule',
  };
  setAgenda(living, characterId, agenda);
  snapAgentToRoom(characterId, sleep.id, { activity, behavior });
}

/**
 * 准备入睡：回卧室、换睡衣站立（尚未播睡眠循环）。
 */
export function beginPrepareSleep(
  living: AiLivingSave,
  characterId: string,
  now = Date.now(),
  reason = '该睡了，回房换睡衣准备入睡',
): boolean {
  if (!hasSleepwear(characterId)) return false;
  const st = getSleepState(living, characterId);
  if (st.phase !== 'awake') return false;
  st.phase = 'preparing';
  st.prepareStartedAtMs = now;
  st.asleepStartedAtMs = undefined;
  st.sleepUntilMs = undefined;
  st.disturbedAtMs = undefined;
  st.disturbCount = 0;
  forcePajamas(living, characterId);
  cancelPendingOutreachMessages(living, characterId);
  writeSleepAgenda(living, characterId, 'rest', '换上星夜睡衣，准备入睡', reason);
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  pushCampLog(living, {
    text: `${name}回房换上睡衣，准备睡觉恢复电力`,
    source: 'system',
    characterIds: [characterId],
  });
  return true;
}

/**
 * 完全入睡：播睡眠皮肤；会话持续现实约 6 小时。
 * fellAsleepAtMs：实际睡着的时间点（准备入睡的补偿：离线/迟到结算时不重新计满 6 小时）。
 */
export function beginDeepSleep(
  living: AiLivingSave,
  characterId: string,
  now = Date.now(),
  fellAsleepAtMs?: number,
): boolean {
  if (!hasSleepwear(characterId)) return false;
  const st = getSleepState(living, characterId);
  if (st.phase === 'asleep') return false;
  const fell = fellAsleepAtMs ?? now;
  st.phase = 'asleep';
  st.asleepStartedAtMs = fell;
  st.sleepUntilMs = fell + SLEEP_REAL_DURATION_MS;
  st.disturbedAtMs = undefined;
  forcePajamas(living, characterId);
  cancelPendingOutreachMessages(living, characterId);
  writeSleepAgenda(
    living,
    characterId,
    'sleeping',
    '侧躺睡着，睡眠循环中恢复电力',
    '进入深度睡眠恢复电力',
  );
  return true;
}

/**
 * 被玩家/他人打扰：仍在睡眠系统内，情绪变烦/累（由 AI 判定语气）。
 */
export function markSleepDisturbed(
  living: AiLivingSave,
  characterId: string,
  reason: string,
  now = Date.now(),
): boolean {
  const st = getSleepState(living, characterId);
  if (st.phase !== 'asleep' && st.phase !== 'disturbed') return false;
  st.phase = 'disturbed';
  st.disturbedAtMs = now;
  st.disturbCount = (st.disturbCount ?? 0) + 1;
  addStatus(living, characterId, st.disturbCount >= 2 ? 'anxiety_state' : 'fatigue');
  writeSleepAgenda(
    living,
    characterId,
    'sleeping',
    '被人吵醒，仍困在床上（被打扰）',
    reason,
  );
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `睡眠被打扰：${reason}`,
    importance: 5,
  });
  return true;
}

/**
 * 睡眠唤醒难度：深睡 + 高疲劳/低电力 + 首次被打扰 → 叫不醒（只能梦呓/翻身）。
 * 连续尝试会降低难度（disturbCount 递增），符合「摇一摇也许能醒」的现实感。
 */
export function sleepWakeDifficulty(
  living: AiLivingSave,
  characterId: string,
): { deep: boolean; wakeable: boolean; note: string } {
  const st = getSleepState(living, characterId);
  if (st.phase === 'preparing') {
    return { deep: false, wakeable: true, note: '还没完全睡着，很容易叫醒' };
  }
  if (st.phase === 'disturbed') {
    return { deep: false, wakeable: true, note: '已被吵醒过一次，再叫就能醒' };
  }
  if (st.phase !== 'asleep') return { deep: false, wakeable: true, note: '醒着' };
  const cyber = getCyberHealth(living, characterId);
  const fatigued = (living.characterStatus[characterId] ?? []).includes('fatigue');
  const heavy = cyber <= 30 || fatigued;
  const attempts = st.disturbCount ?? 0;
  if (heavy && attempts === 0) {
    return { deep: true, wakeable: false, note: '深度睡眠，第一声叫不醒' };
  }
  return {
    deep: true,
    wakeable: true,
    note: heavy ? '深度睡眠，但连续摇晃能叫醒' : '浅睡，能被叫醒',
  };
}

export type SleepInterruptOutcome = 'none' | 'woke' | 'kept_sleeping' | 'cant_wake';

const SLEEP_TALK_STAY_RE =
  /(继续睡|再睡|回去睡|接着睡|补觉|别吵|让我睡|我要睡|不聊了|晚安|你走吧|离开吧)/;
const SLEEP_WANT_WAKE_RE = /(起来|不睡|醒着|睡不着|陪你|一起聊|起来聊|好好好我醒)/;

/**
 * 玩家聊天/邀请时的睡眠结算（由对白驱动，不硬锁）：
 * - 准备入睡：愿意聊就离开睡眠流程（可以去换装/做别的），说想睡就留着
 * - 深睡且叫不醒：只能梦呓，保持睡眠（连续尝试后才可能醒）
 * - 能被叫醒：离开睡眠系统；深睡被叫醒有打扰代价（好感/状态）
 */
export function handleSleepInterruptFromTurn(
  living: AiLivingSave,
  characterId: string,
  opts: { speech: string; interruptReaction?: string },
): SleepInterruptOutcome {
  if (!isInSleepSystem(living, characterId)) return 'none';
  const st = getSleepState(living, characterId);
  const speech = opts.speech ?? '';
  const stay = SLEEP_TALK_STAY_RE.test(speech) && !SLEEP_WANT_WAKE_RE.test(speech);
  const angry = opts.interruptReaction === 'annoyed' || opts.interruptReaction === 'angry';

  if (st.phase === 'preparing') {
    if (stay) return 'kept_sleeping';
    leaveSleepSystem(living, characterId, {
      reason: '准备入睡时被指挥官叫住，决定先不睡',
      completed: false,
    });
    return 'woke';
  }

  if (st.phase === 'asleep' || st.phase === 'disturbed') {
    const diff = sleepWakeDifficulty(living, characterId);
    if (!diff.wakeable) {
      // 叫不醒：只记一次尝试（下次难度下降），保持睡眠
      st.disturbCount = (st.disturbCount ?? 0) + 1;
      pushMemory(living, characterId, {
        kind: 'event',
        summary: '睡得太沉，指挥官的呼唤只换来几声梦呓',
        importance: 3,
      });
      return 'cant_wake';
    }
    if (stay) {
      markSleepDisturbed(living, characterId, '被吵醒后赌气继续睡');
      return 'kept_sleeping';
    }
    leaveSleepSystem(living, characterId, {
      reason: angry ? '被吵醒，带着起床气爬起来' : '被指挥官叫醒',
      completed: false,
    });
    if (diff.deep || angry) {
      // 打扰代价：好感下滑 + 状态标签（性格可在 LLM affection_change 里放大）
      adjustAffinity(living, characterId, angry ? -3 : -2);
      addStatus(living, characterId, angry ? 'anxiety_state' : 'fatigue');
    }
    return 'woke';
  }
  return 'none';
}

/**
 * 被叫醒后又选择回去睡（她想睡就让她睡，但要付「白折腾一场」的好感代价）。
 */
export function maybeReturnToSleepFromSpeech(
  living: AiLivingSave,
  characterId: string,
  speech: string,
): boolean {
  const st = getSleepState(living, characterId);
  if (st.phase !== 'awake') return false;
  if (!st.lastWakeReason) return false;
  if (!hasSleepwear(characterId)) return false;
  const t = speech ?? '';
  if (!/(继续睡|再睡|回去睡|接着睡|补觉|我还困|要睡了|再躺一会)/.test(t)) return false;
  if (/(不睡了|醒着|陪你|起来)/.test(t)) return false;
  const now = Date.now();
  beginPrepareSleep(living, characterId, now, '被叫醒后又回去睡');
  beginDeepSleep(living, characterId, now);
  adjustAffinity(living, characterId, -1);
  pushMemory(living, characterId, {
    kind: 'event',
    summary: '被折腾醒后又睡回去（有点不爽，好感小幅下滑）',
    importance: 4,
  });
  return true;
}

/**
 * 叫醒后指挥官就走：她大概率会窝回床上继续睡（白折腾一场 → 好感小幅下降）。
 * 只在刚被叫醒、且电力仍不足时发生；自然醒/睡满不会触发。
 */
export function sleepBackIfLeftAloneAfterWake(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const st = getSleepState(living, characterId);
  if (st.phase !== 'awake') return false;
  if (!st.lastWakeReason) return false;
  if (!/叫醒|吵醒|打扰/.test(st.lastWakeReason)) return false;
  // 只处理「刚被叫醒」的窗口（现实 30 分钟内），避免隔了很久又莫名回床
  if (st.lastWakeAtMs && Date.now() - st.lastWakeAtMs > 30 * 60 * 1000) return false;
  if (!hasSleepwear(characterId)) return false;
  if (isDisciplineActiveFor(living, characterId)) return false;
  // 正在独占事件（舞蹈/安抚/浴室）不可能同时去睡——先结束事件再谈睡觉
  if (
    living.danceSession?.active === true ||
    living.anfuSession?.active === true ||
    living.bathAssistSession?.active === true
  ) {
    return false;
  }
  const cyber = getCyberHealth(living, characterId);
  const fatigued = (living.characterStatus[characterId] ?? []).includes('fatigue');
  if (cyber >= 72 && !fatigued) return false;
  const now = Date.now();
  beginPrepareSleep(living, characterId, now, '被叫醒后指挥官走了，又睡回去');
  beginDeepSleep(living, characterId, now);
  st.lastWakeReason = undefined;
  adjustAffinity(living, characterId, -1);
  addStatus(living, characterId, 'fatigue');
  pushCampLog(living, {
    text: `${CHARACTER_MAP[characterId]?.name ?? characterId} 被叫醒后又睡了回去（好感 -1）`,
    source: 'system',
    characterIds: [characterId],
  });
  pushMemory(living, characterId, {
    kind: 'event',
    summary: '被叫醒、聊了两句指挥官就走，她又睡回去了（白折腾一场，好感小幅下滑）',
    importance: 4,
  });
  return true;
}

/**
 * 脱离睡眠系统：必须同步为睡衣站立；可带「被吵醒/自然醒」理由。
 * completed=true 时记今日已睡并恢复电力。
 */
export function leaveSleepSystem(
  living: AiLivingSave,
  characterId: string,
  opts: {
    reason: string;
    completed?: boolean;
    now?: number;
  },
): void {
  const st = getSleepState(living, characterId);
  if (st.phase === 'awake') {
    forcePajamas(living, characterId);
    return;
  }
  const completed = opts.completed === true;
  const sleep = getCharacterSleepRoom(characterId);
  st.phase = 'awake';
  st.lastWakeReason = opts.reason;
  st.lastWakeAtMs = opts.now ?? Date.now();
  st.prepareStartedAtMs = undefined;
  st.asleepStartedAtMs = undefined;
  st.sleepUntilMs = undefined;
  st.disturbedAtMs = undefined;
  // 醒了就不会被立刻重新判定入睡（避免「刚醒又被作息塞回床上」）
  st.lastEvalAtMs = opts.now ?? Date.now();
  if (completed) {
    st.lastCompletedDayIndex = living.dayIndex;
    clearFatigue(living, characterId);
    const cur = getCyberHealth(living, characterId);
    const gain = Math.max(12, Math.round((CYBER_HEALTH_MAX - cur) * 0.45));
    setCyberHealth(living, characterId, Math.min(CYBER_HEALTH_MAX, cur + gain), '睡眠恢复电力');
  }
  forcePajamas(living, characterId);
  const agenda = getAgenda(living, characterId);
  if (agenda?.goal === 'sleep' || agenda?.goal === 'prepare_sleep' || agenda?.activity === 'sleeping') {
    clearAgenda(living, characterId);
  }
  snapAgentToRoom(characterId, sleep.id, {
    activity: 'rest',
    behavior: completed ? '睡醒了，仍穿着星夜睡衣' : '离开睡眠，仍穿着星夜睡衣',
  });
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  pushCampLog(living, {
    text: `${name}${completed ? '睡醒了' : '脱离睡眠'}（${opts.reason}），仍穿着星夜睡衣`,
    source: 'system',
    characterIds: [characterId],
  });
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `脱离睡眠：${opts.reason}${completed ? '；电力已恢复' : ''}`,
    importance: completed ? 6 : 5,
  });
}

const SLEEP_ASK_RE =
  /睡(觉|吧|去|一会|会儿)|让你睡|好好休息|晚安|不打扰你|不吵你|别吵你了|不烦你了|让你休息/;
const SLEEP_PLAYER_REFUSE_RE = /不睡|睡不着|别睡|不要睡|不准睡|别吵我|别打扰我|起来|醒着|还不想睡/;
const SLEEP_CHAR_REFUSE_RE = /不睡|睡不着|别睡|起来|醒着|还不想睡/;
const SLEEP_AGREE_RE =
  /嗯|好|行|睡|闭眼|知道了|不说了|休息|晚安|去吧|好梦|安静|闭上/;

function playerAsksCharacterToSleep(playerMessage: string): boolean {
  const ask = playerMessage.trim();
  if (!ask) return false;
  if (SLEEP_PLAYER_REFUSE_RE.test(ask)) return false;
  return SLEEP_ASK_RE.test(ask);
}

/**
 * 指挥官让睡 + 角色答应 → 立刻进入睡眠系统（不等 12min 心跳 / 6min 准备窗）。
 * 被打扰(disturbed) 后可凭此回到深度睡眠。
 */
export function tryCommitSleepFromDialogue(
  living: AiLivingSave,
  characterId: string,
  playerMessage: string,
  reply: string,
  action?: string,
): boolean {
  if (!hasSleepwear(characterId)) return false;
  if (isDisciplineActiveFor(living, characterId)) return false;

  const ask = playerMessage.trim();
  const ans = `${reply} ${action ?? ''}`.trim();
  if (!ask || !ans) return false;
  if (!playerAsksCharacterToSleep(ask)) return false;
  if (SLEEP_CHAR_REFUSE_RE.test(ans) && !SLEEP_AGREE_RE.test(ans)) return false;
  if (!SLEEP_AGREE_RE.test(ans) && !/睡|闭眼|休息|晚安/.test(ans)) return false;

  cancelPendingOutfitChange(living, characterId);

  const st = getSleepState(living, characterId);
  const sleep = getCharacterSleepRoom(characterId);
  const curRoom = resolveCharacterRoomId(characterId, living);
  const now = Date.now();
  const reason = '指挥官让你睡觉休息';

  if (st.phase === 'disturbed' || st.phase === 'preparing' || st.phase === 'asleep') {
    if (curRoom !== sleep.id) {
      snapAgentToRoom(characterId, sleep.id, {
        activity: 'sleeping',
        behavior: '回床继续睡',
      });
    }
    return beginDeepSleep(living, characterId, now);
  }

  if (curRoom !== sleep.id) {
    beginPrepareSleep(living, characterId, now, reason);
    snapAgentToRoom(characterId, sleep.id, {
      activity: 'rest',
      behavior: '回房准备睡觉',
    });
    return beginDeepSleep(living, characterId, now);
  }

  beginPrepareSleep(living, characterId, now, reason);
  return beginDeepSleep(living, characterId, now);
}

/** 对白/行为暗示主动醒来 */
export function tryWakeFromSpeech(
  living: AiLivingSave,
  characterId: string,
  speech: string,
): boolean {
  if (!isInSleepSystem(living, characterId)) return false;
  if (!/(醒|起来|不睡|睡不着|噩梦|惊醒|起来了|别吵.*起来)/.test(speech)) return false;
  leaveSleepSystem(living, characterId, {
    reason: '对白中主动醒来/惊醒',
    completed: false,
  });
  return true;
}

/**
 * Presence 覆盖：睡眠系统进行中时锁卧室 + 活动相位。
 * 今日已完成一整觉时，作息表残留的 sleeping 降为 rest（避免睡醒后仍播睡眠循环）。
 */
export function applySleepPresenceOverride(
  characterId: string,
  living: AiLivingSave,
  base: LivingPresence,
): LivingPresence {
  const st = getSleepState(living, characterId);
  if (st.phase === 'awake') {
    // 醒着就是醒着：位置/活动交给作息与议程（不硬锁在床上），
    // 否则「叫醒后又被拖回卧室睡」——人醒了完全可以去做别的。
    return base;
  }
  const sleep = getCharacterSleepRoom(characterId);
  if (st.phase === 'preparing') {
    return {
      ...base,
      roomId: sleep.id,
      locationId: sleep.sceneId,
      activity: 'rest',
      behavior: '换上星夜睡衣，准备入睡',
      label: `准备入睡 · ${sleep.floor}楼·${sleep.label}`,
      statusTags: [...base.statusTags],
    };
  }
  const disturbed = st.phase === 'disturbed';
  const tags = [...base.statusTags];
  if (!tags.includes('fatigue')) tags.push('fatigue');
  if (disturbed && !tags.includes('anxiety_state') && (st.disturbCount ?? 0) >= 2) {
    tags.push('anxiety_state');
  }
  return {
    ...base,
    roomId: sleep.id,
    locationId: sleep.sceneId,
    activity: 'sleeping',
    behavior: disturbed
      ? '被人吵醒，仍困在床上（被打扰：气愤或疲惫）'
      : '睡着了，睡眠循环中恢复电力',
    label: `${disturbed ? '被吵醒' : '睡觉'} · ${sleep.floor}楼·${sleep.label}`,
    statusTags: tags.slice(0, 4) as LightStatusTag[],
  };
}

export function describeSleepForPrompt(
  living: AiLivingSave,
  characterId: string,
): string {
  const st = getSleepState(living, characterId);
  const remainMs =
    st.sleepUntilMs != null ? Math.max(0, st.sleepUntilMs - Date.now()) : 0;
  const remainH = (remainMs / 3_600_000).toFixed(1);
  const cyber = getCyberHealth(living, characterId);
  const diff = sleepWakeDifficulty(living, characterId);
  const lines = [
    '【睡眠系统·你是活人不是开关】',
    '- 每个角色每天需要睡眠恢复电力；一整觉约等于现实 6 小时。准备入睡 → 换星夜睡衣站立；完全入睡 → 睡眠循环立绘。',
    '- 睡眠不是死锁：被打扰时由你决定——可以赌气继续睡、可以醒来一起聊天、也可以答应换装/去大厅/去安抚室等别的事（答应就会醒）。',
    '- 也可以说自己困了、回房再睡；被叫醒又睡回去会让指挥官白折腾，好感会小幅下降。',
    `- 义体健康/电力感约 ${cyber}/100；今日${sleptToday(living, st) ? '已完成过一整觉' : '尚未完成一整觉'}。`,
  ];
  if (st.phase === 'preparing') {
    lines.push('【此刻相位】准备入睡：已穿星夜睡衣站立，还没睡着。玩家找你说话，你可以选择不睡了陪他，也可以说「我要睡了」。');
  } else if (st.phase === 'asleep') {
    lines.push(
      `【此刻相位】完全入睡：睡眠循环立绘，预计还要约 ${remainH} 小时自然醒。${diff.note}。`,
      diff.wakeable
        ? '- 被找聊天/邀请时你可以醒来（会带起床气或迷糊），也可以只是翻个身继续睡。'
        : '- 你睡得很沉：本轮只能梦呓/翻身，不得起身、不得答应任何活动；指挥官的呼唤叫不醒你。',
    );
  } else if (st.phase === 'disturbed') {
    lines.push(
      `【此刻相位】被打扰：人被吵醒还赖在床上，打扰次数 ${st.disturbCount ?? 1}。语气带烦/累；可以继续睡，也可以真的爬起来。`,
    );
  } else if (st.lastWakeReason) {
    lines.push(`【最近醒来】${st.lastWakeReason}（已醒着，可以正常聊天/做别的事，也可说困了再回去睡）。`);
  }
  return lines.join('\n');
}

/**
 * 世界时钟/心跳推进：评估入睡、准备→睡着、满 6h 醒、偶发梦醒。
 */
export function tickSleepSystem(
  living: AiLivingSave,
  ownedIds: string[],
  now = Date.now(),
): void {
  ensureSleepFields(living);
  for (const id of ownedIds) {
    // 活动事件会话独占地点与临时皮；睡眠不得抢回卧室或睡衣。
    if (isDisciplineActiveFor(living, id)) continue;
    if (
      (living.danceSession?.active && living.danceSession.characterId === id) ||
      (living.anfuSession?.active && living.anfuSession.characterId === id) ||
      (living.bathAssistSession?.active && living.bathAssistSession.characterId === id)
    ) {
      continue;
    }
    if (!hasSleepwear(id)) continue;
    const st = getSleepState(living, id);

    if (st.phase === 'preparing') {
      forcePajamas(living, id);
      const started = st.prepareStartedAtMs ?? now;
      if (now - started >= SLEEP_PREPARE_REAL_MS) {
        // 补偿：她真正入睡的时间点是「准备到点」，不是这次结算的 now
        beginDeepSleep(living, id, now, started + SLEEP_PREPARE_REAL_MS);
      }
      continue;
    }

    if (st.phase === 'asleep' || st.phase === 'disturbed') {
      forcePajamas(living, id);
      if (st.sleepUntilMs != null && now >= st.sleepUntilMs) {
        leaveSleepSystem(living, id, {
          reason: '睡满约现实6小时，自然醒并恢复电力',
          completed: true,
          now,
        });
        continue;
      }
      // 低概率梦醒 / 环境惊醒（未睡满不算完整恢复）
      if (
        !st.lastDreamEvalAtMs ||
        now - st.lastDreamEvalAtMs >= DREAM_WAKE_EVAL_GAP_MS
      ) {
        st.lastDreamEvalAtMs = now;
        const roll = hash01(id, living.dayIndex * 1000 + Math.floor(now / DREAM_WAKE_EVAL_GAP_MS));
        const thresh = st.phase === 'disturbed' ? 0.14 : 0.04;
        if (roll < thresh) {
          leaveSleepSystem(living, id, {
            reason: roll < thresh * 0.4 ? '环境动静惊醒' : '做梦惊醒',
            completed: false,
            now,
          });
        }
      }
      continue;
    }

    // awake：议程已要睡觉，或按日/夜概率进入准备入睡
    if (st.lastEvalAtMs && now - st.lastEvalAtMs < SLEEP_EVAL_GAP_MS) {
      const agenda = getAgenda(living, id);
      if (
        !sleptToday(living, st) &&
        (agenda?.goal === 'sleep' || agenda?.activity === 'sleeping')
      ) {
        beginPrepareSleep(living, id, now, agenda?.reason || '按作息回房睡觉');
      }
      continue;
    }
    st.lastEvalAtMs = now;
    const agenda = getAgenda(living, id);
    if (
      !sleptToday(living, st) &&
      (agenda?.goal === 'sleep' || agenda?.activity === 'sleeping')
    ) {
      beginPrepareSleep(living, id, now, agenda?.reason || '按作息回房睡觉');
      continue;
    }
    const chance = sleepStartChance(living, id);
    if (chance <= 0) continue;
    const roll = hash01(
      id,
      living.dayIndex * 917 + getHour(living) * 13 + Math.floor(now / SLEEP_EVAL_GAP_MS),
    );
    if (roll < chance) {
      beginPrepareSleep(living, id, now);
    }
  }
}
